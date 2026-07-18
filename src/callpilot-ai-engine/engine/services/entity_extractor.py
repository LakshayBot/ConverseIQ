"""GLiNER entity extraction from document text.

Runs only at document ingest time — never on the live-call hot path.
Extracts: competitors, product names, integrations, pricing tiers, features.
"""
from __future__ import annotations

import logging
from typing import Optional, Set

logger = logging.getLogger(__name__)

# GLiNER is lazily loaded — the model is ~600 MB and we don't want to
# block startup.  Call get_extractor() to obtain the singleton.
_extractor: Optional["EntityExtractor"] = None

# Labels passed to GLiNER that map to our internal entity types.
# NOTE: 'competitor' is intentionally excluded — competitors are detected
# dynamically via the competitor_classifier (heuristic + LLM), not via GLiNER.
GLINER_LABELS = [
    "product name",
    "software integration",
    "pricing tier",
    "product feature",
]

# Mapping from GLiNER label → internal entity_type stored in DB.
LABEL_TYPE_MAP = {
    "product name": "product",
    "software integration": "integration",
    "pricing tier": "pricing",
    "product feature": "feature",
}

# Quality gate applied to every GLiNER hit before it lands in the trie.
# Anything below MIN_ENTITY_LEN chars is dropped unless it is a known
# industry acronym (shared with trie_scanner.ACRONYM_ALLOWLIST).
MIN_ENTITY_LEN = 4
ACRONYM_ALLOWLIST: Set[str] = {
    "dlms", "ct", "ami", "hes", "ics", "at&c", "gsm", "gprs", "rms", "hpl",
    "cosem", "zigbee", "rf",
}

# Common English stop-words / fragments that GLiNER occasionally emits as
# "product name" hits.  Kept small and obvious — anything more aggressive
# and we start dropping real product tokens.
STOP_WORDS: Set[str] = {
    "the", "and", "for", "with", "this", "that", "it", "is", "are",
    "your", "our", "their", "you", "we", "they", "have", "has", "had",
    "can", "could", "will", "would", "should", "may", "might", "must",
    "from", "into", "onto", "upon", "over", "under", "after", "before",
    "via", "than", "also", "just", "only", "very", "more", "most", "less",
    "such", "any", "all", "one", "two", "three", "four", "five", "six",
    "seven", "eight", "nine", "ten", "first", "second", "third",
    "meter", "meters", "module", "modular", "system", "systems",
    "phase", "three-phase", "single-phase", "smart", "class",
    "plus", "plus+", "core", "edge", "hub", "kit", "kits",
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
        logger.info("GLiNER model loaded")

    def extract(
        self,
        text: str,
        confidence_threshold: float = 0.3,
    ) -> list[dict]:
        """Run GLiNER over *text* and return a deduplicated list of entities.

        Each dict has keys: ``entity_text``, ``entity_type``, ``confidence``.

        A quality gate is applied to every raw GLiNER hit before it is
        returned: tokens shorter than ``MIN_ENTITY_LEN`` (unless acronym),
        pure stop-words, and tokens that are pure digits are dropped.
        This stops GLiNER's frequent fragment-token emissions (e.g. "han",
        "am", "th") from polluting the trie and producing false-positive
        ``ProductMentioned`` events on the live call.
        """
        self._ensure_model()

        raw = self._model.predict_entities(text, labels=GLINER_LABELS, threshold=confidence_threshold)

        entities: list[dict] = []
        seen: set[tuple[str, str]] = set()
        for ent in raw:
            etext = ent["text"].strip().lower()
            etype = LABEL_TYPE_MAP.get(ent["label"], "product")
            if not self._is_valid_entity_text(etext):
                continue
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

    @staticmethod
    def _is_valid_entity_text(text: str) -> bool:
        """Quality gate: drop fragments, stop-words, pure-digit tokens."""
        if not text:
            return False
        t = text.strip()
        if not t:
            return False
        # Acronyms are always allowed, even when short.
        if t.lower() in ACRONYM_ALLOWLIST:
            return True
        # Pure-digit tokens (e.g. "100", "210") are useful as part of a brand
        # name but on their own are not a product.  The trie (which has the
        # surrounding phrase) will surface them in context.
        if t.isdigit():
            return False
        if len(t) < MIN_ENTITY_LEN:
            return False
        if t.lower() in STOP_WORDS:
            return False
        return True


def get_extractor() -> EntityExtractor:
    global _extractor
    if _extractor is None:
        _extractor = EntityExtractor()
    return _extractor


async def extract_entities(text: str, confidence_threshold: float = 0.3) -> list[dict]:
    """Async wrapper — runs the GLiNER call in a thread executor."""
    import asyncio

    extractor = get_extractor()
    return await asyncio.get_event_loop().run_in_executor(
        None, extractor.extract, text, confidence_threshold
    )
