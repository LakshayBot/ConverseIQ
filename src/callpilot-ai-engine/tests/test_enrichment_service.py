"""Tests for the LLM enrichment service.

The Groq HTTP call is mocked via a monkeypatched ``_call_groq`` so the
tests don't need a running model.  The goal is to lock in the behaviour
the caller depends on:

  * JSON parse succeeds → returns parsed ``EnrichedProduct`` list and an
    outcome with ``status="ok"``.
  * JSON parse fails (truncated, garbage) → returns ``[]`` with
    ``status="parse_error"``, no exception.
  * Groq unreachable / timeout / 4xx / 5xx → returns ``[]`` with the
    matching ``outcome.status`` (``timeout``, ``http_4xx``, ``http_5xx``,
    ``connection_error``).
  * Missing API key → ``status="missing_key"``.
  * Empty page text → ``status="no_products"`` without calling the LLM.
  * Page type whitelist enforced.
  * ``to_chunk_text()`` format is stable (the .NET handler persists it
    verbatim).
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from engine.services.enrichment_service import (
    EnrichedProduct,
    PAGE_TYPES,
    _GroqResult,
    _call_groq_with_retry,
    _classify_groq_exception,
    _parse_enrichment_response,
    _parse_retry_after_seconds,
    enrich_page,
    enrich_pages,
    MAX_RATE_LIMIT_RETRIES,
    MIN_RETRY_WAIT_S,
)


# ── _classify_groq_exception ───────────────────────────────────────────────

class TestClassifyGroqException:
    def test_timeout(self):
        class APITimeoutError(Exception): pass
        assert _classify_groq_exception(APITimeoutError()) == "timeout"

    def test_connection_error(self):
        class APIConnectionError(Exception): pass
        assert _classify_groq_exception(APIConnectionError()) == "connection_error"

    def test_auth_error_is_4xx(self):
        class AuthenticationError(Exception): pass
        assert _classify_groq_exception(AuthenticationError()) == "http_4xx"

    def test_bad_request_is_4xx(self):
        class BadRequestError(Exception): pass
        assert _classify_groq_exception(BadRequestError()) == "http_4xx"

    def test_rate_limit_is_5xx(self):
        class RateLimitError(Exception): pass
        assert _classify_groq_exception(RateLimitError()) == "http_5xx"

    def test_internal_server_error_is_5xx(self):
        class InternalServerError(Exception): pass
        assert _classify_groq_exception(InternalServerError()) == "http_5xx"

    def test_unknown_falls_through(self):
        class WeirdError(Exception): pass
        assert _classify_groq_exception(WeirdError()) == "unknown"


# ── _parse_enrichment_response ─────────────────────────────────────────────

class TestParseEnrichmentResponse:
    def test_empty_input(self):
        assert _parse_enrichment_response("") == []

    def test_garbage_returns_empty(self):
        assert _parse_enrichment_response("not json at all") == []

    def test_truncated_json_returns_empty(self):
        # No closing brace → JSONDecodeError → empty list, no raise.
        assert _parse_enrichment_response('{"products": [{"name": "X"') == []

    def test_valid_object_with_products(self):
        raw = json.dumps({
            "products": [
                {
                    "name": "Apex 100",
                    "category": "Precision Meter",
                    "headline": "Class 0.2S for transmission",
                    "key_features": ["DLMS COSEM", "4-quadrant"],
                    "pricing": None,
                    "best_for": "Transmission substations",
                    "differentiators": ["Built-in CT"],
                    "raw_claims": ["99.9% accuracy"],
                }
            ],
            "page_type": "product_listing",
        })
        out = _parse_enrichment_response(raw)
        assert len(out) == 1
        p = out[0]
        assert p.name == "Apex 100"
        assert p.category == "Precision Meter"
        assert p.headline == "Class 0.2S for transmission"
        assert p.key_features == ["DLMS COSEM", "4-quadrant"]
        assert p.pricing is None
        assert p.best_for == "Transmission substations"
        assert p.differentiators == ["Built-in CT"]
        assert p.raw_claims == ["99.9% accuracy"]
        assert p.page_type == "product_listing"

    def test_page_type_falls_back_to_other_for_unknown(self):
        raw = json.dumps({"products": [], "page_type": "made_up_value"})
        out = _parse_enrichment_response(raw)
        # Even with no products, parsing should succeed and the
        # (invalid) page_type gets coerced to "other" if a product
        # appears.  Verify with a product.
        raw2 = json.dumps({
            "products": [{"name": "X"}],
            "page_type": "made_up_value",
        })
        out2 = _parse_enrichment_response(raw2)
        assert out2[0].page_type == "other"

    def test_page_type_coerced_for_all_products(self):
        # When page has 3 products, the page_type from the top-level JSON
        # gets stamped on each one.
        raw = json.dumps({
            "products": [
                {"name": "A"},
                {"name": "B"},
                {"name": "C"},
            ],
            "page_type": "comparison",
        })
        out = _parse_enrichment_response(raw)
        assert len(out) == 3
        assert all(p.page_type == "comparison" for p in out)

    def test_product_without_name_dropped(self):
        # LLM occasionally emits a row with empty name.  Skip it.
        raw = json.dumps({
            "products": [
                {"name": ""},
                {"name": "   "},
                {"name": "Real One"},
            ],
            "page_type": "overview",
        })
        out = _parse_enrichment_response(raw)
        assert len(out) == 1
        assert out[0].name == "Real One"

    def test_non_object_root_returns_empty(self):
        # Root is a list, not a dict.
        assert _parse_enrichment_response("[1, 2, 3]") == []
        # Root is a string.
        assert _parse_enrichment_response('"just a string"') == []

    def test_no_products_field_returns_empty(self):
        raw = json.dumps({"page_type": "overview"})
        assert _parse_enrichment_response(raw) == []

    def test_products_not_a_list_returns_empty(self):
        raw = json.dumps({"products": "not a list", "page_type": "overview"})
        assert _parse_enrichment_response(raw) == []

    def test_string_features_coerced(self):
        # The LLM sometimes sends a single string for arrays.  Coerce
        # to single-element list.
        raw = json.dumps({
            "products": [
                {
                    "name": "X",
                    "key_features": "single feature string",
                }
            ],
            "page_type": "overview",
        })
        out = _parse_enrichment_response(raw)
        assert out[0].key_features == ["single feature string"]

    def test_empty_string_fields_become_none(self):
        raw = json.dumps({
            "products": [
                {
                    "name": "X",
                    "category": "",
                    "headline": "",
                }
            ],
            "page_type": "overview",
        })
        out = _parse_enrichment_response(raw)
        assert out[0].category is None
        assert out[0].headline is None

    def test_markdown_fences_stripped_before_parse(self):
        # Groq is called with response_format=json_object so this is a
        # defensive parse — fences should still be tolerated if the
        # contract ever changes.
        raw = "```json\n" + json.dumps({
            "products": [{"name": "Apex 100"}],
            "page_type": "product_listing",
        }) + "\n```"
        out = _parse_enrichment_response(raw)
        assert len(out) == 1
        assert out[0].name == "Apex 100"


# ── to_chunk_text (stable format — .NET persists this verbatim) ────────────

class TestToChunkText:
    def test_minimal(self):
        p = EnrichedProduct(name="Prodigy")
        text = p.to_chunk_text()
        # Period after name — separates the entity from its tagline for
        # embedding models and keeps retrieval-readable text.
        assert text == "Prodigy."

    def test_full_card(self):
        p = EnrichedProduct(
            name="Apex 100",
            category="Precision Meter",
            headline="Class 0.2S for transmission",
            key_features=["DLMS COSEM", "4-quadrant"],
            pricing="On request",
            best_for="Transmission substations",
            differentiators=["Built-in CT", "Side-out module"],
            raw_claims=["99.9% accuracy"],
            page_type="product_listing",
        )
        text = p.to_chunk_text()
        assert "Apex 100" in text
        assert "Class 0.2S for transmission" in text
        assert "Category: Precision Meter." in text
        assert "Key features: DLMS COSEM, 4-quadrant." in text
        assert "Pricing: On request." in text
        assert "Best for: Transmission substations." in text
        assert "Differentiators: Built-in CT, Side-out module." in text
        assert "Claims: 99.9% accuracy." in text
        # Stable ordering matters — .NET stores this verbatim.
        assert text == (
            "Apex 100. "
            "Class 0.2S for transmission. "
            "Category: Precision Meter. "
            "Key features: DLMS COSEM, 4-quadrant. "
            "Pricing: On request. "
            "Best for: Transmission substations. "
            "Differentiators: Built-in CT, Side-out module. "
            "Claims: 99.9% accuracy."
        )

    def test_skips_empty_arrays(self):
        p = EnrichedProduct(
            name="X",
            key_features=[],
            differentiators=[],
            raw_claims=[],
        )
        text = p.to_chunk_text()
        assert "Key features" not in text
        assert "Differentiators" not in text
        assert "Claims" not in text

    def test_strips_whitespace_in_features(self):
        p = EnrichedProduct(
            name="X",
            key_features=["  a  ", "", "  b"],
        )
        text = p.to_chunk_text()
        assert "Key features: a, b." in text

    def test_to_dict_includes_chunk_text(self):
        p = EnrichedProduct(name="Prodigy", category="CT Meter")
        d = p.to_dict()
        assert d["name"] == "Prodigy"
        assert d["category"] == "CT Meter"
        assert d["chunk_text"] == "Prodigy. Category: CT Meter."


# ── enrich_page (with mocked Groq) ─────────────────────────────────────────

class TestEnrichPageMocked:
    @pytest.mark.asyncio
    async def test_returns_parsed_products_with_ok_outcome(self):
        raw = json.dumps({
            "products": [
                {"name": "Apex 100", "key_features": ["DLMS"]},
                {"name": "Prodigy"},
            ],
            "page_type": "product_listing",
        })
        ok_result = _GroqResult(content=raw, outcome_status="ok", duration_ms=42)
        with patch("engine.services.enrichment_service._call_groq",
                   new_callable=AsyncMock, return_value=ok_result):
            result = await enrich_page("Apex 100 and Prodigy are great.")
        assert [p.name for p in result.products] == ["Apex 100", "Prodigy"]
        assert result.outcome["status"] == "ok"
        assert result.outcome["model"] == "llama-3.1-8b-instant"
        assert result.outcome["duration_ms"] == 42
        assert result.outcome["error"] is None

    @pytest.mark.asyncio
    async def test_groq_returns_missing_key_yields_no_products(self):
        result_mk = _GroqResult(
            content=None, outcome_status="missing_key",
            error_message="GROQ_API_KEY is not set", duration_ms=0,
        )
        with patch("engine.services.enrichment_service._call_groq",
                   new_callable=AsyncMock, return_value=result_mk):
            result = await enrich_page("any text")
        assert result.products == []
        assert result.outcome["status"] == "missing_key"
        assert "GROQ_API_KEY" in (result.outcome["error"] or "")

    @pytest.mark.asyncio
    async def test_groq_returns_http_4xx_yields_no_products(self):
        result_4xx = _GroqResult(
            content=None, outcome_status="http_4xx",
            error_message="Invalid API Key", duration_ms=120,
        )
        with patch("engine.services.enrichment_service._call_groq",
                   new_callable=AsyncMock, return_value=result_4xx):
            result = await enrich_page("any text")
        assert result.products == []
        assert result.outcome["status"] == "http_4xx"
        assert result.outcome["error"] == "Invalid API Key"

    @pytest.mark.asyncio
    async def test_groq_returns_garbage_yields_parse_error(self):
        result_garbage = _GroqResult(
            content="not json {{{", outcome_status="ok", duration_ms=80,
        )
        with patch("engine.services.enrichment_service._call_groq",
                   new_callable=AsyncMock, return_value=result_garbage):
            result = await enrich_page("any text")
        assert result.products == []
        assert result.outcome["status"] == "parse_error"

    @pytest.mark.asyncio
    async def test_groq_returns_empty_products_is_no_products(self):
        result_empty = _GroqResult(
            content=json.dumps({"products": [], "page_type": "other"}),
            outcome_status="ok", duration_ms=50,
        )
        with patch("engine.services.enrichment_service._call_groq",
                   new_callable=AsyncMock, return_value=result_empty):
            result = await enrich_page("Contact us at ...")
        assert result.products == []
        assert result.outcome["status"] == "no_products"

    @pytest.mark.asyncio
    async def test_empty_page_text_skips_call(self):
        # Don't even hit Groq for empty input.
        with patch("engine.services.enrichment_service._call_groq",
                   new_callable=AsyncMock) as mock:
            result = await enrich_page("")
            assert result.products == []
            assert result.outcome["status"] == "no_products"
            mock.assert_not_called()

    @pytest.mark.asyncio
    async def test_groq_raises_yields_unknown_outcome(self):
        # If the call itself raises (e.g. unexpected httpx error), we
        # still get a structured failure.  The HTTP layer catches most
        # cases; this is a last-line-of-defence test.
        async def _boom(_prompt: str):
            raise RuntimeError("kaboom")
        with patch("engine.services.enrichment_service._call_groq",
                   new=_boom):
            result = await enrich_page("text")
        assert result.products == []
        assert result.outcome["status"] == "unknown"


# ── enrich_pages (batch helper used by the /enrich endpoint) ───────────────

class TestEnrichPages:
    @pytest.mark.asyncio
    async def test_returns_same_page_count_even_on_failure(self):
        pages = [{"page": 1, "text": "x"}, {"page": 2, "text": "y"}]
        none_result = _GroqResult(
            content=None, outcome_status="connection_error",
            error_message="refused", duration_ms=10,
        )
        with patch("engine.services.enrichment_service._call_groq",
                   new_callable=AsyncMock, return_value=none_result):
            results = await enrich_pages(pages)
        assert len(results) == 2
        assert all(r["products"] == [] for r in results)
        assert all(r["page_type"] == "other" for r in results)
        assert all(r["outcome"]["status"] == "connection_error" for r in results)
        assert results[0]["page"] == 1
        assert results[1]["page"] == 2

    @pytest.mark.asyncio
    async def test_mixed_success_and_failure(self):
        page_results = [
            _GroqResult(
                content=json.dumps({"products": [{"name": "A"}], "page_type": "overview"}),
                outcome_status="ok", duration_ms=20,
            ),
            _GroqResult(
                content=None, outcome_status="timeout",
                error_message="per-page timeout", duration_ms=30000,
            ),
        ]
        pages = [{"page": 1, "text": "a"}, {"page": 2, "text": "b"}]

        async def _mock_call(prompt: str):
            return page_results.pop(0) if page_results else None

        with patch("engine.services.enrichment_service._call_groq",
                   new_callable=AsyncMock, side_effect=_mock_call):
            results = await enrich_pages(pages)
        assert results[0]["products"][0]["name"] == "A"
        assert results[0]["page_type"] == "overview"
        assert results[0]["outcome"]["status"] == "ok"
        assert results[1]["products"] == []
        assert results[1]["page_type"] == "other"
        assert results[1]["outcome"]["status"] == "timeout"

    @pytest.mark.asyncio
    async def test_serializes_product_dicts_with_chunk_text(self):
        # enrich_pages must emit product dicts in the shape .NET expects
        # (i.e. as_dict() output, which includes chunk_text).
        raw = json.dumps({
            "products": [{"name": "Apex 100", "headline": "Class 0.2S"}],
            "page_type": "product_listing",
        })
        ok_result = _GroqResult(content=raw, outcome_status="ok", duration_ms=15)
        with patch("engine.services.enrichment_service._call_groq",
                   new_callable=AsyncMock, return_value=ok_result):
            results = await enrich_pages([{"page": 1, "text": "..."}])
        prod = results[0]["products"][0]
        assert "name" in prod
        assert "chunk_text" in prod
        assert "Apex 100" in prod["chunk_text"]
        assert "Class 0.2S" in prod["chunk_text"]
        # Per-page outcome is attached for the dashboard to read.
        assert results[0]["outcome"]["status"] == "ok"

    @pytest.mark.asyncio
    async def test_outcome_includes_model_name(self):
        ok_result = _GroqResult(
            content=json.dumps({"products": [], "page_type": "other"}),
            outcome_status="ok", duration_ms=5,
        )
        with patch("engine.services.enrichment_service._call_groq",
                   new_callable=AsyncMock, return_value=ok_result):
            results = await enrich_pages([{"page": 7, "text": "..."}])
        assert results[0]["outcome"]["model"] == "llama-3.1-8b-instant"
        assert results[0]["outcome"]["duration_ms"] == 5


# ── PAGE_TYPES guard ───────────────────────────────────────────────────────

class TestPageTypesWhitelist:
    def test_known_values(self):
        # The tuple used in the prompt — any change here is breaking for
        # downstream consumers.
        assert "product_listing" in PAGE_TYPES
        assert "comparison" in PAGE_TYPES
        assert "overview" in PAGE_TYPES
        assert "pricing" in PAGE_TYPES
        assert "contact" in PAGE_TYPES
        assert "other" in PAGE_TYPES


# ── _parse_retry_after_seconds ─────────────────────────────────────

class TestParseRetryAfter:
    def test_extracts_seconds_from_groq_error(self):
        msg = (
            "Error code: 429 - {'error': {'message': 'Rate limit reached for model `llama-3.1-8b-instant` "
            "in organization `org_xxx` service tier `on_demand` on tokens per minute (TPM): "
            "Limit 6000, Used 5909, Requested 655. Please try again in 5.64s. ...'}}"
        )
        assert _parse_retry_after_seconds(msg) == 5.64

    def test_returns_none_for_unrelated_error(self):
        assert _parse_retry_after_seconds("some random error") is None

    def test_returns_none_for_empty_string(self):
        assert _parse_retry_after_seconds("") is None

    def test_returns_none_for_401_auth_error(self):
        msg = "Error code: 401 - {'error': {'message': 'Invalid API Key'}}"
        assert _parse_retry_after_seconds(msg) is None


# ── _call_groq_with_retry ─────────────────────────────────────────

class TestCallGroqWithRetry:
    @pytest.mark.asyncio
    async def test_returns_immediately_on_success(self):
        ok = _GroqResult(content="{}", outcome_status="ok", duration_ms=10)
        with patch("engine.services.enrichment_service._call_groq",
                   new_callable=AsyncMock, return_value=ok) as mock:
            result = await _call_groq_with_retry("prompt")
        assert result.outcome_status == "ok"
        assert result.retry_count == 0
        # _call_groq is called exactly once (no retry on success).
        assert mock.call_count == 1

    @pytest.mark.asyncio
    async def test_does_not_retry_non_rate_limit_5xx(self):
        # A 5xx without the "Please try again" hint is a generic outage;
        # retrying won't help, so we return immediately.
        bad = _GroqResult(content=None, outcome_status="http_5xx",
                          error_message="Service unavailable", duration_ms=20)
        with patch("engine.services.enrichment_service._call_groq",
                   new_callable=AsyncMock, return_value=bad) as mock:
            result = await _call_groq_with_retry("prompt")
        assert result.outcome_status == "http_5xx"
        assert result.retry_count == 0
        assert mock.call_count == 1

    @pytest.mark.asyncio
    async def test_does_not_retry_auth_errors(self):
        bad = _GroqResult(content=None, outcome_status="http_4xx",
                          error_message="Invalid API Key", duration_ms=5)
        with patch("engine.services.enrichment_service._call_groq",
                   new_callable=AsyncMock, return_value=bad) as mock:
            result = await _call_groq_with_retry("prompt")
        assert result.outcome_status == "http_4xx"
        assert mock.call_count == 1

    @pytest.mark.asyncio
    async def test_retries_on_rate_limit_and_succeeds(self):
        # First call hits 429 with a wait hint, second call succeeds.
        rate_limited = _GroqResult(
            content=None, outcome_status="http_5xx",
            error_message="Error code: 429 - Please try again in 1.0s", duration_ms=15)
        ok = _GroqResult(content='{"products":[]}', outcome_status="ok", duration_ms=42)
        with patch("engine.services.enrichment_service._call_groq",
                   new_callable=AsyncMock, side_effect=[rate_limited, ok]) as mock, \
             patch("engine.services.enrichment_service.asyncio.sleep",
                   new_callable=AsyncMock) as sleep_mock:
            result = await _call_groq_with_retry("prompt")
        assert result.outcome_status == "ok"
        assert result.retry_count == 1
        assert mock.call_count == 2
        # Wait was called with the hint * buffer factor (1.0 * 1.2 = 1.2)
        sleep_mock.assert_called_once()
        assert 1.0 <= sleep_mock.call_args.args[0] <= 2.0

    @pytest.mark.asyncio
    async def test_gives_up_after_max_retries(self):
        # All MAX_RATE_LIMIT_RETRIES+1 attempts hit 429; final result
        # has retry_count = MAX_RATE_LIMIT_RETRIES and the last error.
        rate_limited = _GroqResult(
            content=None, outcome_status="http_5xx",
            error_message="Error code: 429 - Please try again in 0.5s",
            duration_ms=10)
        with patch("engine.services.enrichment_service._call_groq",
                   new_callable=AsyncMock, return_value=rate_limited) as mock, \
             patch("engine.services.enrichment_service.asyncio.sleep",
                   new_callable=AsyncMock):
            result = await _call_groq_with_retry("prompt")
        assert result.outcome_status == "http_5xx"
        assert result.retry_count == MAX_RATE_LIMIT_RETRIES
        # 1 initial + MAX_RATE_LIMIT_RETRIES retries
        assert mock.call_count == 1 + MAX_RATE_LIMIT_RETRIES

    @pytest.mark.asyncio
    async def test_retry_waits_at_least_min_floor(self):
        # Even with a "Please try again in 0.01s" hint, we wait at
        # least MIN_RETRY_WAIT_S to avoid hammering the API.
        rate_limited = _GroqResult(
            content=None, outcome_status="http_5xx",
            error_message="Error code: 429 - Please try again in 0.01s",
            duration_ms=5)
        ok = _GroqResult(content="{}", outcome_status="ok", duration_ms=10)
        with patch("engine.services.enrichment_service._call_groq",
                   new_callable=AsyncMock, side_effect=[rate_limited, ok]), \
             patch("engine.services.enrichment_service.asyncio.sleep",
                   new_callable=AsyncMock) as sleep_mock:
            await _call_groq_with_retry("prompt")
        wait = sleep_mock.call_args.args[0]
        assert wait >= MIN_RETRY_WAIT_S
