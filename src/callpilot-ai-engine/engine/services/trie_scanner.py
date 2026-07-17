"""Aho-Corasick trie scanner for fast multi-pattern entity matching.

Built from document_entities stored in PostgreSQL via the .NET API.
Replaces the hardcoded 28-competitor substring scan with O(n+m) matching.
"""

from __future__ import annotations

import logging
from typing import Dict, List

import ahocorasick

logger = logging.getLogger(__name__)

# In-memory trie singleton.  Rebuilt on startup and after every document ingest.
_trie: ahocorasick.Automaton | None = None


def build_trie(entities: List[dict]) -> ahocorasick.Automaton | None:
    """Construct a new trie from a list of entity dictionaries.

    Each entity dict must have: ``entity_text``, ``entity_type``, ``document_id``.
    Only product, feature, integration, and pricing entities are indexed.

    Returns the new automaton, or ``None`` if no indexable entities were
    supplied.  Callers should treat ``None`` as "no trie available" — the
    matching :func:`scan_text` will simply return ``[]`` instead of crashing.
    """
    global _trie

    automaton = ahocorasick.Automaton()
    indexed = 0

    for ent in entities:
        text = ent.get("entity_text")
        if not text:
            continue
        etype = ent.get("entity_type", "product")
        if etype == "competitor":
            continue  # competitors are handled dynamically in Phase 2
        doc_id = ent.get("document_id", "")
        doc_ids = ent.get("document_ids", [])

        if automaton.exists(text):
            existing = automaton.get(text)
            if existing:
                if doc_id and doc_id not in existing.get("document_ids", []):
                    existing.setdefault("document_ids", []).append(doc_id)
                if doc_ids:
                    for d in doc_ids:
                        if d not in existing.get("document_ids", []):
                            existing.setdefault("document_ids", []).append(d)
        else:
            payload = {
                "entity_text": text,
                "entity_type": etype,
                "document_ids": [doc_id] if doc_id else list(doc_ids),
            }
            automaton.add_word(text, payload)
            indexed += 1

    if indexed == 0:
        # ahocorasick's Automaton is left in a non-iterable state when
        # make_automaton() is called with zero patterns — the first .iter()
        # call raises AttributeError.  Leave the global as None so
        # scan_text() short-circuits cleanly.
        _trie = None
        logger.info("Trie built with 0 entities (no indexable patterns)")
        return None

    automaton.make_automaton()
    _trie = automaton
    logger.info("Trie built with %d entities", indexed)
    return automaton


def get_trie() -> ahocorasick.Automaton | None:
    return _trie


def scan_text(text: str) -> list[dict]:
    """Scan *text* through the trie and return list of matched entities.

    Each result: ``{"entity_text": str, "entity_type": str, "document_ids": list[str]}``
    Returns empty list if the trie is not yet built (no documents ingested).
    """
    if _trie is None:
        return []

    text_lower = text.lower()
    results: list[dict] = []
    seen: set[str] = set()

    try:
        iterator = _trie.iter(text_lower)
    except AttributeError:
        # Defensive: ahocorasick raises this if make_automaton() was never
        # finalised. Treat it the same as an empty trie.
        return []

    for end_idx, payload in iterator:
        etext = payload["entity_text"]
        if etext in seen:
            continue
        seen.add(etext)
        results.append({
            "entity_text": etext,
            "entity_type": payload["entity_type"],
            "document_ids": payload.get("document_ids", []),
        })

    return results
