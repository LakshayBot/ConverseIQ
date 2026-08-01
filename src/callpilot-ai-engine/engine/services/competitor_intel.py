"""Tavily web search + LLM summarization for competitive intelligence.

Phase 2: Fetches real-time intel about a competitor.
Phase 3: Caches results in Redis (7-day TTL) to avoid repeat searches.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

_redis: Optional["Redis"] = None


def _get_redis():
    global _redis
    if _redis is not None:
        return _redis
    try:
        import redis.asyncio as aioredis
        _redis = aioredis.from_url(REDIS_URL, decode_responses=True)
        logger.info("Redis connected to %s", REDIS_URL)
    except Exception as exc:
        logger.warning("Redis unavailable (%s) - cache disabled", exc)
        _redis = None
    return _redis


@dataclass
class CompetitorIntel:
    competitor: str
    summary: str
    sources: list[str] = field(default_factory=list)
    fetched_at: str = ""
    cached: bool = False


async def _tavily_search(query: str, max_results: int = 3) -> list[dict]:
    """Run a Tavily search and return raw results."""
    if not TAVILY_API_KEY:
        logger.warning("TAVILY_API_KEY not set - web search disabled")
        return []

    try:
        from tavily import AsyncTavilyClient
        client = AsyncTavilyClient(api_key=TAVILY_API_KEY)
        response = await client.search(
            query=query,
            max_results=max_results,
            search_depth="basic",
        )
        return response.get("results", [])
    except ImportError:
        logger.warning("tavily-python not installed - web search disabled")
        return []
    except Exception as exc:
        logger.error("Tavily search failed for query='%s': %s", query, exc)
        return []


async def _summarize_with_llm(competitor: str, search_results: list[dict], llm_client=None) -> str:
    """Summarize Tavily results into a concise competitor profile."""
    if not search_results:
        return ""

    snippets = "\n".join(
        f"- {r.get('title', '')}: {r.get('content', '')[:300]}"
        for r in search_results[:3]
    )

    if llm_client is None:
        return snippets[:500]

    prompt = (
        f"Summarize what is known about {competitor} as a product. "
        f"Focus on: features, pricing, and any commonly cited weaknesses. "
        f"Max 200 words. Be factual, no speculation.\n\n"
        f"Sources:\n{snippets}"
    )

    try:
        return await llm_client(prompt)
    except Exception as exc:
        logger.warning("LLM summarization failed: %s", exc)
        return snippets[:500]


async def fetch_competitor_intel(
    competitor: str,
    your_product_context: str = "",
    llm_client=None,
) -> CompetitorIntel:
    """Fetch competitive intelligence, with Redis caching.

    Args:
        competitor: Name of the competing product/company
        your_product_context: Brief description of your product (for search context)
        llm_client: Optional async callable for LLM summarization
    """
    # ── Redis cache check ─────────────────────────────────────────────
    redis = _get_redis()
    cache_key = f"competitor_intel:{competitor.lower().strip()}"

    if redis is not None:
        try:
            cached = await redis.get(cache_key)
            if cached:
                data = json.loads(cached)
                logger.info("Redis cache HIT for competitor='%s'", competitor)
                return CompetitorIntel(
                    competitor=competitor,
                    summary=data.get("summary", ""),
                    sources=data.get("sources", []),
                    fetched_at=data.get("fetched_at", ""),
                    cached=True,
                )
        except Exception as exc:
            logger.warning("Redis read failed: %s", exc)

    # ── Web search ────────────────────────────────────────────────────
    query = f"{competitor} product features pricing alternatives"
    if your_product_context:
        query += f" vs {your_product_context[:60]}"

    search_results = await _tavily_search(query, max_results=3)
    summary = await _summarize_with_llm(competitor, search_results, llm_client)
    sources = [r.get("url", "") for r in search_results if r.get("url")]

    result = CompetitorIntel(
        competitor=competitor,
        summary=summary,
        sources=sources,
        fetched_at="",
        cached=False,
    )

    # ── Redis cache write ─────────────────────────────────────────────
    if redis is not None and summary:
        try:
            await redis.setex(
                cache_key,
                604800,  # 7 days
                json.dumps({
                    "summary": summary,
                    "sources": sources,
                    "fetched_at": result.fetched_at,
                }),
            )
            logger.info("Redis cache SET for competitor='%s' (TTL=7d)", competitor)
        except Exception as exc:
            logger.warning("Redis write failed: %s", exc)

    return result


async def invalidate_cache(competitor: str) -> bool:
    """Delete a competitor from the Redis cache."""
    redis = _get_redis()
    if redis is None:
        return False
    try:
        cache_key = f"competitor_intel:{competitor.lower().strip()}"
        await redis.delete(cache_key)
        logger.info("Cache invalidated for competitor='%s'", competitor)
        return True
    except Exception as exc:
        logger.warning("Cache invalidation failed: %s", exc)
        return False
