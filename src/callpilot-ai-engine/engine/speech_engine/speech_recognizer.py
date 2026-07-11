import logging
import re
import time
from typing import Optional

import numpy as np
from faster_whisper import WhisperModel

from ..models import TranscriptSegment

logger = logging.getLogger(__name__)


def _tokenize(text: str) -> list[str]:
    """Lower-case word tokens with punctuation stripped."""
    return [w.strip(".,!?;:()[]{}\"'") for w in text.lower().split() if w.strip(".,!?;:()[]{}\"'")]


class SpeechRecognizer:
    def __init__(
        self,
        model_size: str = "medium.en",
        device: str = "cpu",
        compute_type: str = "int8",
        beam_size: int = 5,
        language: str = "en",
        confidence_threshold: float = 0.6,
    ):
        logger.info(f"Loading Faster Whisper model: {model_size} on {device}/{compute_type}")
        self.model = WhisperModel(model_size, device=device, compute_type=compute_type)
        self.model_name = model_size
        self.beam_size = beam_size
        self.language = language
        self.confidence_threshold = confidence_threshold
        self._accumulated_audio: dict[str, np.ndarray] = {}
        self._segment_counter: dict[str, int] = {}
        self._silent_chunk_count: dict[str, int] = {}
        self._empty_transcript_count: dict[str, int] = {}
        self._silence_warned: dict[str, bool] = {}
        self._last_transcribe_length: dict[str, int] = {}
        self._last_transcript_text: dict[str, str] = {}
        self._min_new_samples: int = 32000  # 2.0s of audio at 16kHz (was 8000=0.5s — too small for medium.en)
        self._overlap_samples: int = 4800  # 300ms overlap (was 32000=2s — caused cascading repetition)

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
        last_len = self._last_transcribe_length.get(meeting_id, 0)
        new_samples = len(accumulated) - last_len
        if new_samples < self._min_new_samples:
            return None

        # Safety cap: prevent buffer from growing unbounded (e.g. during prolonged silence).
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

            segments_list = list(segments)
            whisper_ms = (time.time() - whisper_start) * 1000
            if not segments_list:
                self._empty_transcript_count[meeting_id] = self._empty_transcript_count.get(meeting_id, 0) + 1
                empty_count = self._empty_transcript_count[meeting_id]
                overlap = min(self._overlap_samples, len(accumulated))
                self._accumulated_audio[meeting_id] = accumulated[-overlap:] if overlap > 0 else accumulated[-16000:]
                self._last_transcribe_length[meeting_id] = overlap if overlap > 0 else 16000
                if empty_count >= 10 and not self._silence_warned.get(meeting_id, False):
                    acc_rms = float(np.sqrt(np.mean(accumulated ** 2)))
                    logger.warning(
                        f"[{meeting_id}] Whisper returned no speech after {empty_count} attempts. "
                        f"Accumulated audio: {duration_seconds:.1f}s, RMS: {acc_rms:.6f}."
                    )
                    self._silence_warned[meeting_id] = True
                return None

            # ── JOIN ALL VALID SEGMENTS (was BUG: only took last_segment) ──
            valid_segments = []
            for seg in segments_list:
                if seg.no_speech_prob > 0.99:
                    continue
                text = seg.text.strip()
                if not text:
                    continue
                word_alpha = sum(1 for c in text if c.isalpha())
                if len(text.split()) <= 1 and word_alpha <= 3:
                    continue
                if seg.avg_logprob < -2.0 and len(text) < 10:
                    continue
                valid_segments.append(seg)

            if not valid_segments:
                return None

            # Join all valid segment texts
            combined_text = " ".join(seg.text.strip() for seg in valid_segments)

            # ── TEXT-BASED OVERLAP DEDUP ──
            # Remove prefix that overlaps with the previous transcription.
            # Much faster than word_timestamps (no cross-attention overhead).
            last_text = self._last_transcript_text.get(meeting_id, "")
            if last_text and combined_text != last_text:
                deduped = self._deduplicate_overlap(last_text, combined_text)
                if deduped is None:
                    # Fully redundant — return None the first time,
                    # but if it keeps happening, let through to avoid deadlock
                    repeat_key = f"{meeting_id}_repeat"
                    self._segment_counter[repeat_key] = self._segment_counter.get(repeat_key, 0) + 1
                    if self._segment_counter[repeat_key] < 3:
                        return None
                    # After 3 consecutive redundant calls, let this through
                    deduped = combined_text
                elif deduped != combined_text:
                    combined_text = deduped

            self._last_transcript_text[meeting_id] = combined_text

            # Aggregate confidence across all kept segments
            avg_confidence = sum(
                max(0.0, min(1.0, 1.0 - seg.no_speech_prob))
                for seg in valid_segments
            ) / len(valid_segments)

            first_start = valid_segments[0].start
            last_end = valid_segments[-1].end

            self._segment_counter[meeting_id] = self._segment_counter.get(meeting_id, 0) + 1
            self._empty_transcript_count[meeting_id] = 0
            self._silence_warned[meeting_id] = False

            # Trim to 300ms overlap window (was 2s — caused cascading repetition)
            overlap = min(self._overlap_samples, len(accumulated))
            self._accumulated_audio[meeting_id] = accumulated[-overlap:]
            self._last_transcribe_length[meeting_id] = overlap

            buf_dur = len(accumulated) / 16000.0
            logger.info(
                f"[{meeting_id}] Whisper: model={self.model_name}, "
                f"buf={buf_dur:.1f}s, segs={len(valid_segments)}/{len(segments_list)}, "
                f"whisper={whisper_ms:.0f}ms, text_len={len(combined_text)}"
            )

            return TranscriptSegment(
                speaker=self._get_speaker(source),
                text=combined_text,
                confidence=avg_confidence,
                start=f"{max(0, first_start):.2f}",
                end=f"{last_end:.2f}",
                is_final=True,
                meeting_id=meeting_id,
                sequence=self._segment_counter[meeting_id],
            )
        except Exception as e:
            logger.error(f"Transcription error for meeting {meeting_id}: {e}")
            return None

    def _deduplicate_overlap(self, previous: str, current: str) -> Optional[str]:
        """Remove overlapping prefix from `current` that appeared in `previous`.

        Uses word-level suffix→prefix matching (punctuation-stripped) to strip
        repeated content caused by the audio overlap window between successive
        Whisper calls.  Returns None when the entire current is redundant.

        Example:
          previous = "we need more people to do this"
          current  = "more people to do this and it was weird"
          Returns:           "and it was weird"
        """
        prev_toks = _tokenize(previous)
        curr_toks = _tokenize(current)

        # ── exact / near-exact duplicate ──
        if curr_toks == prev_toks:
            return None  # pure duplicate — caller should suppress
        if len(curr_toks) <= len(prev_toks) and all(
            c == p for c, p in zip(curr_toks, prev_toks[-len(curr_toks):])
        ):
            return None  # current is a suffix of previous — pure overlap

        if not prev_toks or not curr_toks:
            return current

        # Find longest suffix of previous that matches a prefix of current
        best_match_len = 0
        max_check = min(len(prev_toks), len(curr_toks), 15)

        for match_len in range(max_check, 1, -1):
            if prev_toks[-match_len:] == curr_toks[:match_len]:
                best_match_len = match_len
                break

        if best_match_len > 0:
            new_words = curr_toks[best_match_len:]
            if new_words:
                return " ".join(new_words)
            return None  # fully redundant

        return current

    def reset_meeting(self, meeting_id: str) -> None:
        self._accumulated_audio.pop(meeting_id, None)
        self._segment_counter.pop(meeting_id, None)
        self._silent_chunk_count.pop(meeting_id, None)
        self._empty_transcript_count.pop(meeting_id, None)
        self._silence_warned.pop(meeting_id, None)
        self._last_transcribe_length.pop(meeting_id, None)
        self._last_transcript_text.pop(meeting_id, None)

    @staticmethod
    def _get_speaker(source: str) -> str:
        if source == "microphone":
            return "Salesperson"
        elif source == "desktop":
            return "Customer-1"
        return "Unknown"
