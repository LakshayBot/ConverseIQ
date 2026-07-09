import logging
import time
import uuid

from ..models import AudioChunkRequest, SpeechTaskResult, TranscriptSegment
from ..speech_engine.transcript_pipeline import TranscriptPipeline

logger = logging.getLogger(__name__)


class SpeechWorker:
    def __init__(
        self,
        model_size: str = "small.en",
        device: str = "cpu",
        compute_type: str = "int8",
    ):
        self.pipeline = TranscriptPipeline(
            model_size=model_size,
            device=device,
            compute_type=compute_type,
        )
        logger.info(f"SpeechWorker initialized: model={model_size}, device={device}")

    async def process_audio(
        self,
        meeting_id: str,
        audio_bytes: bytes,
        sequence: int,
        sample_rate: int = 16000,
        channels: int = 1,
        source: str = "microphone",
    ) -> SpeechTaskResult:
        task_id = str(uuid.uuid4())
        start = time.time()

        try:
            chunk = AudioChunkRequest(
                meeting_id=str(meeting_id),
                sequence=sequence,
                timestamp="any",
                sample_rate=sample_rate,
                channels=channels,
                audio=audio_bytes,
                source=source,
            )

            transcript = await self.pipeline.process_audio_chunk(chunk)

            duration = (time.time() - start) * 1000

            return SpeechTaskResult(
                task_id=task_id,
                success=True,
                transcript=transcript,
                duration_ms=duration,
            )
        except Exception as e:
            logger.error(f"SpeechWorker error for meeting {meeting_id}: {e}")
            return SpeechTaskResult(
                task_id=task_id,
                success=False,
                error=str(e),
                duration_ms=(time.time() - start) * 1000,
            )

    def reset_meeting(self, meeting_id: str) -> None:
        self.pipeline.reset_meeting(meeting_id)
