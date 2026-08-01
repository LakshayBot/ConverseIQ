"""Competitor classifier - heuristic-first, LLM-fallback.

Runs inline during live-call event processing. Returns True/False
for whether an unknown entity appears to be a competing product.
"""

from __future__ import annotations

import re
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Fast heuristic trigger phrases - these strongly indicate a competitive mention
TRIGGER_PHRASES = [
    "better than",
    "compared to",
    "instead of",
    "switching from",
    "currently using",
    "we use",
    "not as good as",
    "cheaper than",
    "their product",
    "your competitor",
    "alternative to",
    "we looked at",
    "evaluating",
    "considering",
    "migrating from",
    "replacing",
    "versus",
    " vs ",
]


def heuristic_classify(entity: str, segment: str) -> bool:
    """Check if *entity* appears near trigger phrases in *segment*."""
    segment_lower = segment.lower()
    entity_lower = entity.lower()

    if entity_lower not in segment_lower:
        return False

    for phrase in TRIGGER_PHRASES:
        if phrase in segment_lower:
            # Check proximity: entity within 100 chars of trigger phrase
            pos_phrase = segment_lower.find(phrase)
            pos_entity = segment_lower.find(entity_lower)
            if abs(pos_phrase - pos_entity) < 150:
                logger.debug("Heuristic match: trigger='%s' near entity='%s'", phrase, entity)
                return True

    return False


async def llm_classify(entity: str, segment: str, llm_client=None) -> bool:
    """LLM fallback: simple YES/NO classification.

    Uses the cheapest available model because this is a simple binary decision.
    """
    if llm_client is None:
        return False

    prompt = (
        f"In this sales call transcript segment, is '{entity}' "
        f"being mentioned as a competing product or company?\n\n"
        f"Segment: \"{segment}\"\n\n"
        f"Answer only: YES or NO"
    )

    try:
        response = await llm_client(prompt)
        return response and "YES" in response.strip().upper()
    except Exception as exc:
        logger.warning("LLM classification failed for entity=%s: %s", entity, exc)
        return False


async def classify(entity: str, segment: str, llm_client=None) -> bool:
    """Full pipeline: heuristic → LLM fallback."""
    if not entity or not segment:
        return False

    # Rule out common non-competitor words
    entity_lower = entity.lower().strip()
    if entity_lower in {"the", "it", "that", "this", "i", "we", "you", "they", "our", "your"}:
        return False

    # Heuristic first (zero latency)
    if heuristic_classify(entity, segment):
        return True

    # LLM fallback (only if heuristic inconclusive)
    if llm_client and len(entity_lower.split()) <= 3:
        return await llm_classify(entity, segment, llm_client)

    return False
