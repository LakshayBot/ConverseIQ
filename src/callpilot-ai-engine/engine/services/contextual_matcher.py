"""Contextual matching - a second, non-keyword battle-card trigger layer.

The Aho-Corasick / regex event detector (engine/event_engine/event_detector.py)
only fires on exact keyword hits.  This module is a PARALLEL layer: it embeds
each sentence of a finalised PROSPECT turn, compares against the user's stored
KnowledgeChunk embeddings, and - when the best sentence/chunk pair clears
CONTEXTUAL_MATCH_THRESHOLD - returns a ContextualMatchResult so the .NET side
can generate a battle card even when no keyword matched.

Design notes:
  * Sentence embeddings come from the SAME in-process EmbeddingService that
    powers /api/v1/ai/embeddings and produced the stored chunk vectors at
    ingest time, so cosine similarity is semantic and dimension-consistent.
    (No self-HTTP round trip - the matcher lives inside the engine already.)
  * The trigger sentence's embedding (not the full turn's) is used as the
    retrieval query, which yields more precise chunk selection.
  * Chunk lists are cached per user with a short TTL - chunks only change on
    document ingest, never per call.
"""

from __future__ import annotations

import logging
import os
import re
import time
from dataclasses import dataclass
from typing import Awaitable, Callable, Optional

import numpy as np

logger = logging.getLogger(__name__)

# Default similarity floor. Configurable via CONTEXTUAL_MATCH_THRESHOLD -
# never hardcode at call sites.
DEFAULT_CONTEXTUAL_MATCH_THRESHOLD = 0.72

# Candidate chunk cache TTL (seconds). Chunks change only on ingest.
_CHUNK_CACHE_TTL_SECONDS = 120.0

# Above this many chunks the in-Python cosine scan approaches the latency
# budget - warn so the deployment knows to shard or prune.
_CHUNK_COUNT_WARNING = 2000

_LATENCY_BUDGET_MS = 250.0

_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")


@dataclass
class ContextualMatchResult:
    """A single chunk whose embedding cleared the threshold against one
    sentence of the buyer's turn."""

    chunk_id: str
    chunk_text: str
    similarity: float
    trigger_span: str      # the buyer sentence that drove the match
    knowledge_source: str  # KnowledgeChunk.Source ("fast" | "structured" | "enriched")


def _split_sentences(text: str) -> list[str]:
    """Split on [.!?] boundaries, keeping the punctuation with the sentence."""
    return [s.strip() for s in _SENTENCE_SPLIT_RE.split(text or "") if s.strip()]


def _cosine_matrix(query: np.ndarray, matrix: np.ndarray) -> np.ndarray:
    """Cosine similarity of one query vector against every row of *matrix*.

    Rows of *matrix* are pre-normalised by the caller; the query is
    normalised here so a plain dot product is the cosine.
    """
    norm = float(np.linalg.norm(query))
    if norm == 0.0:
        return np.zeros(matrix.shape[0], dtype=np.float64)
    return matrix @ (query / norm)


class ContextualMatcher:
    """Semantic turn-vs-knowledge matcher.

    Parameters
    ----------
    embed_fn:
        async callable text -> list[float]. Defaults to nothing - callers
        (main.py) wire the in-process EmbeddingService via asyncio.to_thread.
        Injectable for tests.
    fetch_chunks_fn:
        async callable user_id -> list[dict] with the raw chunk payload
        ({chunk_id, embedding_csv, chunk_text, source}). Defaults to the
        .NET internal endpoint. Injectable for tests.
    threshold:
        Explicit similarity floor. When None, CONTEXTUAL_MATCH_THRESHOLD is
        read from the environment (default 0.72).
    """

    def __init__(
        self,
        embed_fn: Optional[Callable[[str], Awaitable[list[float]]]] = None,
        fetch_chunks_fn: Optional[Callable[[str], Awaitable[list[dict]]]] = None,
        threshold: Optional[float] = None,
    ) -> None:
        if threshold is not None:
            self.threshold = float(threshold)
        else:
            self.threshold = float(
                os.getenv("CONTEXTUAL_MATCH_THRESHOLD", DEFAULT_CONTEXTUAL_MATCH_THRESHOLD)
            )
        self._embed_fn = embed_fn
        self._fetch_chunks_fn = fetch_chunks_fn
        # user_id -> (fetched_at_monotonic, parsed_chunks)
        self._chunk_cache: dict[str, tuple[float, list[dict]]] = {}

    # ── Embedding source ─────────────────────────────────────────────────────

    async def _embed(self, text: str) -> Optional[np.ndarray]:
        if self._embed_fn is None:
            logger.error("ContextualMatcher has no embed_fn configured")
            return None
        vec = await self._embed_fn(text)
        if not vec:
            return None
        return np.asarray(vec, dtype=np.float32)

    # ── Chunk source (with TTL cache) ────────────────────────────────────────

    async def _fetch_chunks_raw(self, user_id: str) -> list[dict]:
        """Default chunk source: the .NET internal chunks endpoint."""
        import httpx

        server_url = os.getenv("CALLPILOT_SERVER_URL", "http://server:5001").rstrip("/")
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(f"{server_url}/internal/chunks/{user_id}")
            resp.raise_for_status()
            return resp.json() or []

    async def _get_chunks(self, user_id: str) -> list[dict]:
        now = time.monotonic()
        cached = self._chunk_cache.get(user_id)
        if cached is not None and now - cached[0] < _CHUNK_CACHE_TTL_SECONDS:
            return cached[1]

        raw = await self._fetch_chunks_fn(user_id) if self._fetch_chunks_fn else await self._fetch_chunks_raw(user_id)

        parsed: list[dict] = []
        for item in raw or []:
            csv = item.get("embedding_csv")
            if not csv:
                continue
            try:
                vec = np.asarray([float(x) for x in csv.split(",")], dtype=np.float32)
            except ValueError:
                continue
            norm = float(np.linalg.norm(vec))
            if norm == 0.0:
                continue
            parsed.append(
                {
                    "chunk_id": str(item.get("chunk_id", "")),
                    "chunk_text": item.get("chunk_text", ""),
                    "source": item.get("source", "fast"),
                    # Pre-normalised so the scan is a single matmul.
                    "vector": vec / norm,
                }
            )

        self._chunk_cache[user_id] = (now, parsed)
        return parsed

    # ── Match ────────────────────────────────────────────────────────────────

    async def match(
        self, turn_text: str, meeting_id: str, user_id: str
    ) -> Optional[ContextualMatchResult]:
        """Find the best sentence/chunk pair for a finalised buyer turn.

        Returns None below the threshold - callers treat that as 'no match'
        and the keyword pipeline stays the only trigger.
        """
        t0 = time.perf_counter()

        sentences = _split_sentences(turn_text)
        if not sentences:
            return None

        chunks = await self._get_chunks(user_id)
        if not chunks:
            logger.debug(
                "contextual match: no cached chunks for user %s", user_id
            )
            return None

        if len(chunks) > _CHUNK_COUNT_WARNING:
            logger.warning(
                "contextual match: %d chunks for user %s exceeds %d - "
                "cosine scan approaches the %.0fms latency budget",
                len(chunks), user_id, _CHUNK_COUNT_WARNING, _LATENCY_BUDGET_MS,
            )

        matrix = np.stack([c["vector"] for c in chunks])

        best_sim = -1.0
        best_chunk_idx = -1
        best_sentence = ""

        for sentence in sentences:
            query = await self._embed(sentence)
            if query is None:
                continue
            if query.shape[0] != matrix.shape[1]:
                logger.warning(
                    "contextual match: sentence embedding dim %d != chunk dim %d "
                    "- stored chunk vectors are from a different model; skipping",
                    query.shape[0], matrix.shape[1],
                )
                return None

            sims = _cosine_matrix(query.astype(np.float64), matrix.astype(np.float64))
            idx = int(np.argmax(sims))
            sim = float(sims[idx])
            if sim > best_sim:
                best_sim = sim
                best_chunk_idx = idx
                best_sentence = sentence

        elapsed_ms = (time.perf_counter() - t0) * 1000.0

        if best_chunk_idx < 0 or best_sim < self.threshold:
            logger.info(
                "contextual match: no match for meeting %s (%.1fms, best_sim=%.3f < %.2f, "
                "%d sentences, %d chunks)",
                meeting_id, elapsed_ms, max(best_sim, 0.0), self.threshold,
                len(sentences), len(chunks),
            )
            return None

        chunk = chunks[best_chunk_idx]
        logger.info(
            "contextual match: matched meeting %s (%.1fms, sim=%.3f, chunk=%s, "
            "%d sentences scanned, %d chunks)",
            meeting_id, elapsed_ms, best_sim, chunk["chunk_id"],
            len(sentences), len(chunks),
        )
        return ContextualMatchResult(
            chunk_id=chunk["chunk_id"],
            chunk_text=chunk["chunk_text"],
            similarity=best_sim,
            trigger_span=best_sentence,
            knowledge_source=chunk["source"],
        )
