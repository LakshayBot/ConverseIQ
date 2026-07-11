import logging
import time
from typing import Optional

import numpy as np
from faster_whisper import WhisperModel

from ..models import TranscriptSegment

logger = logging.getLogger(__name__)


class SpeechRecognizer:
    def __init__(
        self,
        model_size: str = "small.en",
        device: str = "cpu",
        compute_type: str = "int8",
        beam_size: int = 5,
        language: str = "en",
        confidence_threshold: float = 0.6,
    ):
        logger.info(f"Loading Faster Whisper model: {model_size} on {device}/{compute_type}")
        self.model = WhisperModel(model_size, device=device, compute_type=compute_type)
        self.beam_size = beam_size
        self.language = language
        self.confidence_threshold = confidence_threshold
        self._accumulated_audio: dict[str, np.ndarray] = {}
        self._segment_counter: dict[str, int] = {}
        self._silent_chunk_count: dict[str, int] = {}
        self._empty_transcript_count: dict[str, int] = {}
        self._silence_warned: dict[str, bool] = {}
        self._last_transcribe_length: dict[str, int] = {}
        self._min_new_samples: int = 8000  # 0.5s of audio at 16kHz

    def transcribe(
        self,
        meeting_id: str,
        audio: np.ndarray,
        source: str = "unknown",
    ) -> Optional[TranscriptSegment]:
        audio = audio.astype(np.float32)

        rms = float(np.sqrt(np.mean(audio ** 2)))
        if rms < 0.0001:
            self._silent_chunk_count[meeting_id] = self._silent_chunk_count.get(meeting_id, 0) + 1
            count = self._silent_chunk_count[meeting_id]
            if count == 125 and not self._silence_warned.get(meeting_id, False):
                logger.warning(
                    f"[{meeting_id}] Audio has been silent (near-zero) for 5+ seconds "
                    f"({count} chunks). Check: (1) microphone permissions are granted, "
                    f"(2) correct device is selected — run 'dotnet run -- --list-devices', "
                    f"(3) microphone is not muted."
                )
                self._silence_warned[meeting_id] = True
            return None
        else:
            self._silent_chunk_count[meeting_id] = 0
            self._silence_warned[meeting_id] = False

        if meeting_id not in self._accumulated_audio:
            self._accumulated_audio[meeting_id] = audio.copy()
        else:
            self._accumulated_audio[meeting_id] = np.concatenate(
                [self._accumulated_audio[meeting_id], audio]
            )

        accumulated = self._accumulated_audio[meeting_id]

        duration_seconds = len(accumulated) / 16000.0
        if duration_seconds < 0.5:
            return None

        # Only run Whisper if enough NEW audio has accumulated since last transcription.
        # Without this, after the first successful transcription the 2s overlap window
        # keeps the buffer > 0.5s, triggering Whisper on every 40ms chunk (1.5s CPU each).
        last_len = self._last_transcribe_length.get(meeting_id, 0)
        new_samples = len(accumulated) - last_len
        if new_samples < self._min_new_samples:
            return None

        # Safety cap: prevent buffer from growing unbounded (e.g. during prolonged silence).
        # Whisper runs in O(n log n), so processing 30s of audio costs ~10x more than 3s.
        MAX_BUFFER_SAMPLES = 240000  # 15 seconds
        if len(accumulated) > MAX_BUFFER_SAMPLES:
            accumulated = accumulated[-MAX_BUFFER_SAMPLES:]
            self._accumulated_audio[meeting_id] = accumulated

        try:
            whisper_start = time.time()
            segments, info = self.model.transcribe(
                accumulated,
                beam_size=self.beam_size,
                language=self.language,
                vad_filter=False,
                condition_on_previous_text=False,
                no_speech_threshold=0.6,
                best_of=2,
            )
            whisper_ms = (time.time() - whisper_start) * 1000

            segments_list = list(segments)
            if not segments_list:
                self._empty_transcript_count[meeting_id] = self._empty_transcript_count.get(meeting_id, 0) + 1
                empty_count = self._empty_transcript_count[meeting_id]
                # Trim buffer to overlap window — without this, the buffer grows
                # unbounded on silence, making each successive Whisper call slower.
                overlap = min(32000, len(accumulated))
                self._accumulated_audio[meeting_id] = accumulated[-overlap:] if overlap > 0 else accumulated[-16000:]
                self._last_transcribe_length[meeting_id] = overlap if overlap > 0 else 16000
                if empty_count >= 10 and not self._silence_warned.get(meeting_id, False):
                    acc_rms = float(np.sqrt(np.mean(accumulated ** 2)))
                    logger.warning(
                        f"[{meeting_id}] Whisper returned no speech after {empty_count} attempts. "
                        f"Accumulated audio: {duration_seconds:.1f}s, RMS: {acc_rms:.6f}. "
                        f"The audio signal is present but contains no recognizable speech — "
                        f"check that the correct microphone is selected and you are speaking."
                    )
                    self._silence_warned[meeting_id] = True
                return None

            last_segment = segments_list[-1]

            if last_segment.no_speech_prob > 0.99:
                logger.debug(f"[{meeting_id}] Rejected: no_speech_prob={last_segment.no_speech_prob:.2f}, rms={rms:.4f}, whisper={whisper_ms:.0f}ms")
                return None

            text = last_segment.text.strip()
            if not text:
                return None

            # Filter whisper silence hallucinations (single short words like "You", "I", "." etc.)
            word_alpha = sum(1 for c in text if c.isalpha())
            if len(text.split()) <= 1 and word_alpha <= 3:
                return None

            # Filter very low confidence + short text (noise)
            if last_segment.avg_logprob < -2.0 and len(text) < 10:
                return None

            confidence = max(0.0, min(1.0, 1.0 - last_segment.no_speech_prob))

            self._segment_counter[meeting_id] = self._segment_counter.get(meeting_id, 0) + 1
            self._empty_transcript_count[meeting_id] = 0
            self._silence_warned[meeting_id] = False

            # Trim to overlap window
            overlap_samples = min(32000, len(accumulated))
            self._accumulated_audio[meeting_id] = accumulated[-overlap_samples:]
            # Mark entire remaining buffer as transcribed — next Whisper run
            # only triggers after _min_new_samples of NEW audio arrives
            self._last_transcribe_length[meeting_id] = overlap_samples

            is_final = True

            return TranscriptSegment(
                speaker=self._get_speaker(source),
                text=text,
                confidence=confidence,
                start=f"{max(0, last_segment.start):.2f}",
                end=f"{last_segment.end:.2f}",
                is_final=is_final,
                meeting_id=meeting_id,
                sequence=self._segment_counter[meeting_id],
            )
        except Exception as e:
            logger.error(f"Transcription error for meeting {meeting_id}: {e}")
            return None

    def reset_meeting(self, meeting_id: str) -> None:
        self._accumulated_audio.pop(meeting_id, None)
        self._segment_counter.pop(meeting_id, None)
        self._silent_chunk_count.pop(meeting_id, None)
        self._empty_transcript_count.pop(meeting_id, None)
        self._silence_warned.pop(meeting_id, None)
        self._last_transcribe_length.pop(meeting_id, None)

    @staticmethod
    def _get_speaker(source: str) -> str:
        if source == "microphone":
            return "Salesperson"
        elif source == "desktop":
            return "Customer-1"
        return "Unknown"
