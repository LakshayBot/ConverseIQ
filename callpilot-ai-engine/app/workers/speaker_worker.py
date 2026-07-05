import logging

from app.models.models import AiTask, AiResponse
from app.workers.base import BaseWorker

logger = logging.getLogger(__name__)


class SpeakerWorker(BaseWorker):
    async def execute(self, task: AiTask) -> AiResponse:
        segments = task.payload.get("segments", [])

        if not segments:
            return AiResponse(
                task_id=task.task_id,
                success=True,
                duration_ms=0,
                confidence=1.0,
                result={"speakers": []},
            )

        labeled = []
        current_speaker = "Customer-1"
        for i, seg in enumerate(segments):
            labeled.append(
                {
                    **seg,
                    "speaker": current_speaker,
                }
            )
            if i % 3 == 2:
                current_speaker = (
                    "Customer-2" if current_speaker == "Customer-1" else "Customer-1"
                )

        return AiResponse(
            task_id=task.task_id,
            success=True,
            duration_ms=0,
            confidence=0.85,
            result={"speakers": labeled},
        )
