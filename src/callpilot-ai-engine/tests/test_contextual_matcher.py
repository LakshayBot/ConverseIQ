"""Tests for the contextual (non-keyword) match layer.

The matcher is exercised through injected fakes - a stubbed embed_fn
(simulating the EmbeddingService call) and a stubbed chunk source (simulating
GET /internal/chunks/{user_id}) - so no model download or HTTP is needed.
"""

import asyncio
import math
import time

import numpy as np
import pytest

from engine.services.contextual_matcher import ContextualMatcher


def _unit(vec: list[float]) -> list[float]:
    arr = np.asarray(vec, dtype=np.float64)
    return (arr / np.linalg.norm(arr)).tolist()


def _chunk(chunk_id: str, text: str, vector: list[float], source: str = "fast") -> dict:
    return {
        "chunk_id": chunk_id,
        "embedding_csv": ",".join(f"{v:.6f}" for v in vector),
        "chunk_text": text,
        "source": source,
    }


def _make_matcher(chunks: list[dict], embed_fn, threshold: float | None = None) -> ContextualMatcher:
    async def _fetch(user_id: str) -> list[dict]:
        return chunks

    return ContextualMatcher(embed_fn=embed_fn, fetch_chunks_fn=_fetch, threshold=threshold)


def test_contextual_matcher_returns_none_below_threshold():
    # Chunk cosine similarity to the query is 0.65 - below the 0.72 floor.
    query = [1.0, 0.0]
    chunk_vec = [0.65, math.sqrt(1 - 0.65**2)]
    assert math.isclose(float(np.dot(_unit(query), _unit(chunk_vec))), 0.65, abs_tol=1e-6)

    async def _embed(text: str) -> list[float]:
        return _unit(query)

    matcher = _make_matcher(
        [_chunk("c1", "Enterprise pricing starts at $12k/year.", chunk_vec)],
        _embed,
        threshold=0.72,
    )

    result = asyncio.run(matcher.match("We love the product.", "m-1", "u-1"))
    assert result is None


def test_contextual_matcher_returns_result_above_threshold():
    query = [1.0, 0.0]
    chunk_vec = [0.80, math.sqrt(1 - 0.80**2)]

    async def _embed(text: str) -> list[float]:
        return _unit(query)

    matcher = _make_matcher(
        [_chunk("chunk-42", "Accuracy holds at 99.2% for six months.", chunk_vec, "enriched")],
        _embed,
        threshold=0.72,
    )

    result = asyncio.run(
        matcher.match("Tell me about accuracy.", "m-1", "u-1")
    )

    assert result is not None
    assert result.chunk_id == "chunk-42"
    assert result.trigger_span == "Tell me about accuracy."
    assert result.knowledge_source == "enriched"
    assert pytest.approx(result.similarity, abs=1e-6) == 0.80


def test_trigger_span_is_sentence_not_full_turn():
    # 2-dim embeddings: only sentence 2 is near the chunk; sentences 1 and 3
    # are orthogonal to it.
    chunk_vec = _unit([1.0, 0.0])
    s1_vec = _unit([0.0, 1.0])
    s2_vec = _unit([0.99, 0.141])  # ~0.94 cosine to the chunk
    s3_vec = _unit([-1.0, 0.0])

    async def _embed(text: str) -> list[float]:
        if "billing cycle" in text:
            return s2_vec
        if "first sentence" in text:
            return s1_vec
        return s3_vec

    matcher = _make_matcher([_chunk("c9", "accuracy", chunk_vec)], _embed, threshold=0.72)

    turn = (
        "First sentence about something unrelated. "
        "Our billing cycle is confusing to the team. "
        "Third sentence about weather."
    )
    result = asyncio.run(matcher.match(turn, "m-1", "u-1"))

    assert result is not None
    assert result.trigger_span == "Our billing cycle is confusing to the team."
    assert result.trigger_span != turn


def test_latency_under_250ms():
    dim = 8
    rng = np.random.default_rng(7)
    chunks = [
        _chunk(f"c{i}", f"chunk {i}", _unit(rng.normal(size=dim).tolist()))
        for i in range(500)
    ]

    async def _embed(text: str) -> list[float]:
        await asyncio.sleep(0.05)  # simulated model inference
        return _unit(rng.normal(size=dim).tolist())

    matcher = _make_matcher(chunks, _embed, threshold=0.72)

    t0 = time.perf_counter()
    result = asyncio.run(matcher.match("One sentence only.", "m-1", "u-1"))
    elapsed_ms = (time.perf_counter() - t0) * 1000

    assert elapsed_ms < 250, f"match took {elapsed_ms:.1f}ms, budget is 250ms"
    # Below threshold (random vectors) - the latency assert is the point here.
    assert result is None or isinstance(result.trigger_span, str)
