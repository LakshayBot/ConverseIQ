"""Competitive intelligence orchestrator — ties classification, search, and talking points.

Called when the trie scan returns no hit for an entity found in a transcript segment.
Runs asynchronously (fire-and-forget from .NET perspective), completes in <4 seconds.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

from engine.services.competitor_classifier import classify as classify_competitor
from engine.services.competitor_intel import fetch_competitor_intel
from engine.services.competitive_prompt import generate_talking_points, TalkingPointsResult

logger = logging.getLogger(__name__)


async def handle_unknown_entity(
    entity: str,
    segment: str,
    meeting_id: str,
    company_name: str = "",
    llm_client=None,
    cosine_search_fn=None,
) -> Optional[dict]:
    """Full competitive intelligence pipeline for an unknown entity.

    Returns None if entity is not a competitor, or a CompetitorIntelCard dict.
    """
    if not entity or not segment:
        return None

    # Step A: classify
    try:
        is_competitor = await classify_competitor(entity, segment, llm_client)
    except Exception as exc:
        logger.warning("Classification failed for entity=%s: %s", entity, exc)
        return None

    if not is_competitor:
        return None

    logger.info("Competitor detected: '%s' in meeting %s", entity, meeting_id)

    # Step B: fetch in parallel
    your_chunks_task = asyncio.create_task(
        _safe_cosine_search(cosine_search_fn, f"{entity} comparison competitive advantages", 3)
    )
    web_intel_task = asyncio.create_task(
        fetch_competitor_intel(entity, company_name, llm_client)
    )

    try:
        your_chunks, web_intel = await asyncio.gather(
            your_chunks_task, web_intel_task
        )
    except Exception as exc:
        logger.exception("Parallel fetch failed for competitor=%s: %s", entity, exc)
        your_chunks, web_intel = [], None

    # Step C: generate talking points
    web_summary = web_intel.summary if web_intel else ""

    result: TalkingPointsResult = await generate_talking_points(
        competitor=entity,
        transcript_snippet=segment[:500],
        your_chunks=your_chunks,
        web_summary=web_summary,
        company_name=company_name,
        llm_client=llm_client,
    )

    return {
        "event_type": "CompetitorIntelCard",
        "competitor": entity,
        "talking_points": result.talking_points,
        "confidence": result.confidence,
        "sources": web_intel.sources if web_intel else [],
        "cached": web_intel.cached if web_intel else False,
        "meeting_id": meeting_id,
    }


async def _safe_cosine_search(search_fn, query: str, top_k: int) -> list[str]:
    """Wrapper that handles missing/invalid cosine search function."""
    if search_fn is None:
        return []
    try:
        results = await search_fn(query, top_k)
        if isinstance(results, list):
            return [r if isinstance(r, str) else str(r) for r in results[:top_k]]
        return []
    except Exception as exc:
        logger.warning("Cosine search failed: %s", exc)
        return []
