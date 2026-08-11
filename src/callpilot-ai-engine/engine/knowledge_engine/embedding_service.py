import logging
import os
from typing import Optional

import numpy as np
from sentence_transformers import SentenceTransformer

logger = logging.getLogger(__name__)

# One embedding model for the whole pipeline: ingest chunk embeddings AND
# live query embeddings (the .NET RecommendationEngine calls this same
# endpoint).  Changing it means .NET must be re-deployed with a matching
# default model name + dimension (GenerateLocalEmbedding fallback).
DEFAULT_EMBEDDING_MODEL = "BAAI/bge-base-en-v1.5"  # 768-dim


class EmbeddingService:
    def __init__(self, model_name: Optional[str] = None):
        self.model_name = model_name or os.getenv("EMBEDDING_MODEL", DEFAULT_EMBEDDING_MODEL)
        self._model: Optional[SentenceTransformer] = None

    def load_model(self):
        logger.info(f"Loading embedding model: {self.model_name}")
        # EMBEDDING_DEVICE is the canonical name; WHISPER_DEVICE is read as a
        # legacy alias so existing deployments keep working unchanged.
        device = os.getenv("EMBEDDING_DEVICE") or os.getenv("WHISPER_DEVICE", "cpu")
        self._model = SentenceTransformer(
            self.model_name,
            device=device,
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
