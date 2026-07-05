import time
import logging
from abc import ABC, abstractmethod
from app.models.models import AiTask, AiResponse

logger = logging.getLogger(__name__)


class BaseWorker(ABC):
    @abstractmethod
    async def execute(self, task: AiTask) -> AiResponse:
        ...

    async def run(self, task: AiTask) -> AiResponse:
        start = time.perf_counter()
        try:
            response = await self.execute(task)
            response.duration_ms = (time.perf_counter() - start) * 1000
            return response
        except Exception as e:
            duration = (time.perf_counter() - start) * 1000
            logger.exception("Worker %s failed: %s", self.__class__.__name__, e)
            return AiResponse(
                task_id=task.task_id,
                success=False,
                duration_ms=duration,
                confidence=0.0,
                result={"error": str(e)},
            )
