import logging
import numpy as np

from app.models.models import AiTask, AiResponse
from app.workers.base import BaseWorker

logger = logging.getLogger(__name__)


class EmbeddingWorker(BaseWorker):
    def __init__(self):
        self._model = None
        self._tokenizer = None

    def _load_model(self):
        if self._model is None:
            logger.info("Loading embedding model...")
            from sentence_transformers import SentenceTransformer

            self._model = SentenceTransformer("all-MiniLM-L6-v2")
            logger.info("Embedding model loaded")
        return self._model

    async def execute(self, task: AiTask) -> AiResponse:
        texts = task.payload.get("texts", [])
        if not texts:
            return AiResponse(
                task_id=task.task_id,
                success=False,
                duration_ms=0,
                confidence=0.0,
                result={"error": "No texts provided"},
            )

        model = self._load_model()
        embeddings = model.encode(texts, normalize_embeddings=True)

        return AiResponse(
            task_id=task.task_id,
            success=True,
            duration_ms=0,
            confidence=1.0,
            result={
                "embeddings": embeddings.tolist(),
                "dimensions": embeddings.shape[1],
                "count": len(texts),
            },
        )
