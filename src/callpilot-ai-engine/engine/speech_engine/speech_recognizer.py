import logging
from typing import Optional

import numpy as np
from faster_whisper import WhisperModel

from ..models import TranscriptSegment

logger = logging.getLogger(__name__)


class SpeechRecognizer:
    def __init__(
        self,
        model_size: str = "tiny",
        device: str = "cpu",
        compute_type: str = "int8",
        beam_size: int = 5,
        language: str | None = None,
        confidence_threshold: float = 0.6,
    ):
        logger.info(f"Loading Faster Whisper model: {model_size} on {device}/{compute_type}")
        self.model = WhisperModel(model_size, device=device, compute_type=compute_type)
        self.beam_size = beam_size
        self.language = language
        self.confidence_threshold = confidence_threshold
        self._accumulated_audio: dict[str, np.ndarray] = {}
        self._segment_counter: dict[str, int] = {}

    def transcribe(
        self,
        meeting_id: str,
        audio: np.ndarray,
        source: str = "unknown",
    ) -> Optional[TranscriptSegment]:
        audio = audio.astype(np.float32)

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

        try:
            segments, info = self.model.transcribe(
                accumulated,
                beam_size=self.beam_size,
                language=self.language,
                vad_filter=False,
                condition_on_previous_text=False,
                no_speech_threshold=0.9,
            )

            segments_list = list(segments)
            if not segments_list:
                return None

            last_segment = segments_list[-1]

            if last_segment.no_speech_prob > 0.95:
                return None

            text = last_segment.text.strip()
            if not text:
                return None

            confidence = min(max(last_segment.avg_logprob / 0.0 + 0.5, 0.0), 1.0)
            confidence = 0.85 if confidence < 0.5 else min(confidence, 0.99)

            self._segment_counter[meeting_id] = self._segment_counter.get(meeting_id, 0) + 1

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

    @staticmethod
    def _get_speaker(source: str) -> str:
        if source == "microphone":
            return "Salesperson"
        elif source == "desktop":
            return "Customer-1"
        return "Unknown"
