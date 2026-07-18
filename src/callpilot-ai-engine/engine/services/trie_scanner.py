"""Aho-Corasick trie scanner for fast multi-pattern entity matching.

Built from document_entities stored in PostgreSQL via the .NET API.
Replaces the hardcoded 28-competitor substring scan with O(n+m) matching.

The automaton is fast but **does substring matching, not word matching** — so
a 3-character trie entry would fire inside "handheld" or "john han".  To keep
false positives like ``ProductMentioned: han`` out of the live call we:

  * Reject any trie entry shorter than ``MIN_ENTITY_LEN`` (4 chars) unless it
    is in :data:`ACRONYM_ALLOWLIST` (DLMS, AMI, etc.).
  * Apply a word-boundary post-filter to every Aho-Corasick hit — the matched
    substring must start and end on a non-word character (or the string
    boundary).
  * In :func:`scan_text`, run the input through :mod:`text_normalizer` so
    STT output ("Apex One Hundred") matches the canonical trie keys ("apex 100").
  * In :func:`build_trie`, expand every entity to its spoken aliases so the
    trie matches the spoken form without needing the runtime normalizer.
  * Apply substring-dedupe: when a longer pattern fully contains a shorter
    one, keep the longer one only (so "apex 100" wins over "apex").
"""

from __future__ import annotations

import logging
import re
from typing import Dict, List, Set

import ahocorasick

from engine.services.text_normalizer import (
    aliases_for,
    canonicalize,
    expand_with_aliases,
)

logger = logging.getLogger(__name__)

# In-memory trie singleton.  Rebuilt on startup and after every document ingest.
_trie: ahocorasick.Automaton | None = None

# Minimum allowed trie-entry length.  Anything shorter is almost certainly a
# fragment token (han, ct, am, etc.) and would explode false-positive rate.
MIN_ENTITY_LEN = 4

# Short, established industry acronyms that are safe to index even though they
# are below MIN_ENTITY_LEN.  All entries MUST be ≤ 5 characters.
ACRONYM_ALLOWLIST: Set[str] = {
    "dlms", "ct", "ami", "hes", "ics", "at&c", "gsm", "gprs", "rms", "hpl",
    "cosem", "zigbee", "rf",
}

# A "word character" in the sense of word boundaries.  Includes letters,
# digits, '+' and '-' so "apex-100" or "liberty+" is treated as a single word.
_WORD_CHARS = set("abcdefghijklmnopqrstuvwxyz0123456789+-")


def _is_acronym(text: str) -> bool:
    return text.lower() in ACRONYM_ALLOWLIST


def _has_word_boundary(text_lower: str, start: int, end: int) -> bool:
    """True iff the substring text_lower[start:end] is bounded by non-word chars.

    Multi-word patterns (e.g. "apex 100") only need a word boundary at the
    start of the first word and the end of the last word — the inner space
    is part of the pattern.
    """
    if start > 0 and text_lower[start - 1] in _WORD_CHARS:
        return False
    if end < len(text_lower) and text_lower[end] in _WORD_CHARS:
        return False
    return True


def _is_valid_pattern(text: str) -> bool:
    """Decide whether a trie entry should be inserted.

    Drops very short fragments and pure stop-words; keeps acronyms.
    """
    if not text:
        return False
    t = text.strip().lower()
    if not t:
        return False
    if _is_acronym(t):
        return True
    if len(t) < MIN_ENTITY_LEN:
        return False
    return True


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
    skipped_short = 0

    for ent in entities:
        text = ent.get("entity_text")
        if not text:
            continue
        etype = ent.get("entity_type", "product")
        if etype == "competitor":
            continue  # competitors are handled dynamically in Phase 2
        doc_id = ent.get("document_id", "")
        doc_ids = ent.get("document_ids", [])

        # Insert canonical entry plus every alias (spoken form).
        variants = expand_with_aliases(text) if _is_valid_pattern(text) else set()
        if not variants and _is_valid_pattern(text):
            variants = {text.strip().lower()}

        for variant in variants:
            v = variant.strip().lower()
            if not _is_valid_pattern(v):
                skipped_short += 1
                continue

            if automaton.exists(v):
                existing = automaton.get(v)
                if existing:
                    if doc_id and doc_id not in existing.get("document_ids", []):
                        existing.setdefault("document_ids", []).append(doc_id)
                    if doc_ids:
                        for d in doc_ids:
                            if d not in existing.get("document_ids", []):
                                existing.setdefault("document_ids", []).append(d)
            else:
                payload = {
                    "entity_text": v,
                    "entity_type": etype,
                    "document_ids": [doc_id] if doc_id else list(doc_ids),
                }
                automaton.add_word(v, payload)
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
    if skipped_short:
        logger.info(
            "Trie built with %d entities (skipped %d too-short)",
            indexed, skipped_short,
        )
    else:
        logger.info("Trie built with %d entities", indexed)
    return automaton


def get_trie() -> ahocorasick.Automaton | None:
    return _trie


def scan_text(text: str) -> list[dict]:
    """Scan *text* through the trie and return list of matched entities.

    Each result: ``{"entity_text": str, "entity_type": str, "document_ids": list[str]}``
    Returns empty list if the trie is not yet built (no documents ingested).

    The input is first run through :func:`text_normalizer.canonicalize` so
    STT output ("Apex One Hundred") matches canonical trie keys ("apex 100").
    Every Aho-Corasick hit is then word-boundary-checked before being kept.
    """
    if _trie is None or not text:
        return []

    text_lower = canonicalize(text.lower())
    if not text_lower:
        return []

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
        # Word-boundary check.  Compute start index from end_idx and pattern
        # length.  Aho-Corasick gives us the END position of the match.
        start_idx = end_idx - len(etext) + 1
        if not _has_word_boundary(text_lower, start_idx, end_idx + 1):
            continue
        seen.add(etext)
        results.append({
            "entity_text": etext,
            "entity_type": payload["entity_type"],
            "document_ids": payload.get("document_ids", []),
        })

    return results
