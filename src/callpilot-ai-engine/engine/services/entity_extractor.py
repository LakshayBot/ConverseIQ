"""GLiNER entity extraction from document text.

Runs only at document ingest time — never on the live-call hot path.
Extracts: competitors, product names, integrations, pricing tiers, features.
"""
from __future__ import annotations

import logging
from typing import Optional

logger = logging.getLogger(__name__)

# GLiNER is lazily loaded — the model is ~600 MB and we don't want to
# block startup.  Call get_extractor() to obtain the singleton.
_extractor: Optional["EntityExtractor"] = None

# Labels passed to GLiNER that map to our internal entity types.
GLINER_LABELS = [
    "competitor",
    "product name",
    "software integration",
    "pricing tier",
    "product feature",
]

# Mapping from GLiNER label → internal entity_type stored in DB.
LABEL_TYPE_MAP = {
    "competitor": "competitor",
    "product name": "product",
    "software integration": "integration",
    "pricing tier": "pricing",
    "product feature": "feature",
}


class EntityExtractor:
    def __init__(self, model_id: str = "knowledgator/gliner-multitask-large-v0.5"):
        self._model_id = model_id
        self._model = None

    @property
    def is_loaded(self) -> bool:
        return self._model is not None

    def _ensure_model(self):
        if self._model is not None:
            return
        logger.info("Loading GLiNER model %s ...", self._model_id)
        from gliner import GLiNER

        self._model = GLiNER.from_pretrained(self._model_id, load_tokenizer=True)
        logger.info("GLiNER model loaded (device=%s)", self._model.model.device)

    def extract(
        self,
        text: str,
        confidence_threshold: float = 0.4,
    ) -> list[dict]:
        """Run GLiNER over *text* and return a deduplicated list of entities.

        Each dict has keys: ``entity_text``, ``entity_type``, ``confidence``.
        """
        self._ensure_model()

        raw = self._model.predict_entities(text, labels=GLINER_LABELS, threshold=confidence_threshold)

        entities: list[dict] = []
        seen: set[tuple[str, str]] = set()
        for ent in raw:
            etext = ent["text"].strip().lower()
            etype = LABEL_TYPE_MAP.get(ent["label"], "product")
            key = (etext, etype)
            if key in seen:
                continue
            seen.add(key)
            entities.append({
                "entity_text": etext,
                "entity_type": etype,
                "confidence": round(ent["score"], 4),
            })
        return entities


def get_extractor() -> EntityExtractor:
    global _extractor
    if _extractor is None:
        _extractor = EntityExtractor()
    return _extractor


async def extract_entities(text: str, confidence_threshold: float = 0.4) -> list[dict]:
    """Async wrapper — runs the GLiNER call in a thread executor."""
    import asyncio

    extractor = get_extractor()
    return await asyncio.get_event_loop().run_in_executor(
        None, extractor.extract, text, confidence_threshold
    )
