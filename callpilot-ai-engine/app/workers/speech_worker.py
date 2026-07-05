import io
import logging
import numpy as np

from app.config import settings
from app.models.models import AiTask, AiResponse, TranscriptSegment
from app.workers.base import BaseWorker

logger = logging.getLogger(__name__)


class SpeechWorker(BaseWorker):
    def __init__(self):
        self._model = None

    def _get_model(self):
        if self._model is None:
            logger.info(
                "Loading Whisper model '%s' on %s...",
                settings.whisper_model,
                settings.whisper_device,
            )
            from faster_whisper import WhisperModel

            self._model = WhisperModel(
                settings.whisper_model,
                device=settings.whisper_device,
                compute_type=settings.whisper_compute_type,
            )
            logger.info("Whisper model loaded")
        return self._model

    async def execute(self, task: AiTask) -> AiResponse:
        audio_bytes = task.payload.get("audio")
        if not audio_bytes:
            return AiResponse(
                task_id=task.task_id,
                success=False,
                duration_ms=0,
                confidence=0.0,
                result={"error": "No audio data provided"},
            )

        audio_array = np.frombuffer(
            bytes(audio_bytes), dtype=np.float32
        ).copy()

        sample_rate = task.payload.get("sample_rate", 16000)

        model = self._get_model()
        segments, info = model.transcribe(audio_array, beam_size=5)

        transcript_segments = []
        for seg in segments:
            transcript_segments.append(
                TranscriptSegment(
                    text=seg.text.strip(),
                    confidence=seg.avg_logprob,
                    start=seg.start,
                    end=seg.end,
                    is_final=True,
                ).model_dump()
            )

        return AiResponse(
            task_id=task.task_id,
            success=True,
            duration_ms=0,
            confidence=float(info.average_logprob),
            result={
                "segments": transcript_segments,
                "language": info.language,
                "duration": info.duration,
            },
        )
