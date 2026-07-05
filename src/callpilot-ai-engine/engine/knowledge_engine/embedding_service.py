import logging
import os
from typing import Optional

import numpy as np
from sentence_transformers import SentenceTransformer

logger = logging.getLogger(__name__)


class EmbeddingService:
    def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
        self.model_name = model_name
        self._model: Optional[SentenceTransformer] = None

    def load_model(self):
        logger.info(f"Loading embedding model: {self.model_name}")
        self._model = SentenceTransformer(
            self.model_name,
            device=os.getenv("WHISPER_DEVICE", "cpu"),
        )
        logger.info("Embedding model loaded")

    def generate(self, text: str) -> list[float]:
        if self._model is None:
            raise RuntimeError("Embedding model not loaded")

        embedding = self._model.encode(text, normalize_embeddings=True)
        return embedding.tolist()

    def generate_batch(self, texts: list[str]) -> list[list[float]]:
        if self._model is None:
            raise RuntimeError("Embedding model not loaded")

        embeddings = self._model.encode(texts, normalize_embeddings=True)
        return embeddings.tolist()
