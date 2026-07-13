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

# Fallback seed data — guarantees the trie is warm even before any docs are uploaded.
_SEED_COMPETITORS = [
    "salesforce", "hubspot", "zendesk", "freshdesk", "intercom", "zoho",
    "pipedrive", "microsoft dynamics", "sap", "oracle", "servicenow",
    "jira", "asana", "monday.com", "notion", "confluence", "slack",
    "teams", "zoom", "google meet", "gong", "chorus", "salesloft",
    "outreach", "clari", "people.ai", "6sense", "zoominfo",
]


def build_trie(entities: List[dict]) -> ahocorasick.Automaton:
    """Construct a new trie from a list of entity dictionaries.

    Each entity dict must have: ``entity_text``, ``entity_type``, ``document_id``.
    Seed competitors are merged in automatically.
    """
    global _trie

    automaton = ahocorasick.Automaton()

    # Seed competitors so the trie is warm before any docs are uploaded
    for comp in _SEED_COMPETITORS:
        payload = {
            "entity_text": comp,
            "entity_type": "competitor",
            "document_ids": [],
        }
        automaton.add_word(comp, payload)

    # Add user-document entities
    for ent in entities:
        text = ent["entity_text"]
        etype = ent.get("entity_type", "product")
        doc_id = ent.get("document_id", "")
        doc_ids = ent.get("document_ids", [])

        # Build or merge payload
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

    automaton.make_automaton()
    _trie = automaton
    logger.info("Trie built with %d entities (%d seed + %d document)",
                 len(automaton), len(_SEED_COMPETITORS), len(entities))
    return automaton


def get_trie() -> ahocorasick.Automaton | None:
    return _trie


def scan_text(text: str) -> list[dict]:
    """Scan *text* through the trie and return list of matched entities.

    Each result: ``{"entity_text": str, "entity_type": str, "document_ids": list[str]}``
    Returns empty list if trie is not yet built.
    """
    if _trie is None:
        return []

    text_lower = text.lower()
    results: list[dict] = []
    seen: set[str] = set()

    for end_idx, payload in _trie.iter(text_lower):
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
