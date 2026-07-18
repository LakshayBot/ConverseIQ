"""Tests for the LLM enrichment service.

The actual Ollama HTTP call is mocked via a monkeypatched ``_call_ollama``
so the tests don't need a running model.  The goal is to lock in the
behaviour the caller depends on:

  * JSON parse succeeds (raw JSON, with markdown fences, with leading
    whitespace) → returns parsed ``EnrichedProduct`` list.
  * JSON parse fails (truncated, garbage) → returns ``[]``, no exception.
  * Ollama unreachable / timeout → returns ``[]``, no exception.
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
    _parse_enrichment_response,
    _strip_markdown_fences,
    enrich_page,
    enrich_pages,
)


# ── _strip_markdown_fences ─────────────────────────────────────────────────

class TestStripMarkdownFences:
    def test_pure_json_unchanged(self):
        assert _strip_markdown_fences('{"a": 1}') == '{"a": 1}'

    def test_json_fenced_json(self):
        raw = "```json\n{\"a\": 1}\n```"
        assert _strip_markdown_fences(raw) == '{"a": 1}'

    def test_json_fenced_plain(self):
        raw = "```\n{\"a\": 1}\n```"
        assert _strip_markdown_fences(raw) == '{"a": 1}'

    def test_whitespace_tolerated(self):
        raw = "  \n  {\"a\": 1}  \n  "
        assert _strip_markdown_fences(raw) == '{"a": 1}'

    def test_fenced_with_preamble(self):
        raw = "```json\nHere you go:\n{\"a\": 1}\n```"
        result = _strip_markdown_fences(raw)
        # The fence regex strips only the outer fence lines, the inner
        # "Here you go:" remains.  The JSON parse will then fail and the
        # caller logs the warning.  This is acceptable — fail-open.
        assert result.startswith("Here you go:")


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


# ── enrich_page (with mocked Ollama) ───────────────────────────────────────

class TestEnrichPageMocked:
    @pytest.mark.asyncio
    async def test_returns_parsed_products(self):
        raw = json.dumps({
            "products": [
                {"name": "Apex 100", "key_features": ["DLMS"]},
                {"name": "Prodigy"},
            ],
            "page_type": "product_listing",
        })
        with patch("engine.services.enrichment_service._call_ollama",
                   new_callable=AsyncMock, return_value=raw):
            products = await enrich_page("Apex 100 and Prodigy are great.")
        assert [p.name for p in products] == ["Apex 100", "Prodigy"]

    @pytest.mark.asyncio
    async def test_ollama_returns_none_yields_empty(self):
        # Connection refused / timeout / 5xx.
        with patch("engine.services.enrichment_service._call_ollama",
                   new_callable=AsyncMock, return_value=None):
            products = await enrich_page("any text")
        assert products == []

    @pytest.mark.asyncio
    async def test_ollama_returns_garbage_yields_empty(self):
        with patch("engine.services.enrichment_service._call_ollama",
                   new_callable=AsyncMock, return_value="not json {{{"):
            products = await enrich_page("any text")
        assert products == []

    @pytest.mark.asyncio
    async def test_empty_page_text_skips_call(self):
        # Don't even hit Ollama for empty input.
        with patch("engine.services.enrichment_service._call_ollama",
                   new_callable=AsyncMock) as mock:
            assert await enrich_page("") == []
            assert await enrich_page("   \n  ") == []
            mock.assert_not_called()

    @pytest.mark.asyncio
    async def test_ollama_raises_yields_empty(self):
        # If the call itself raises (e.g. unexpected httpx error), we
        # still get an empty list.  The HTTP layer catches most cases;
        # this is a last-line-of-defence test.
        async def _boom(_prompt: str):
            raise RuntimeError("kaboom")
        with patch("engine.services.enrichment_service._call_ollama",
                   new=_boom):
            products = await enrich_page("text")
        assert products == []


# ── enrich_pages (batch helper used by the /enrich endpoint) ───────────────

class TestEnrichPages:
    @pytest.mark.asyncio
    async def test_returns_same_page_count_even_on_failure(self):
        pages = [{"page": 1, "text": "x"}, {"page": 2, "text": "y"}]
        with patch("engine.services.enrichment_service._call_ollama",
                   new_callable=AsyncMock, return_value=None):
            results = await enrich_pages(pages)
        assert len(results) == 2
        assert all(r["products"] == [] for r in results)
        assert all(r["page_type"] == "other" for r in results)
        assert results[0]["page"] == 1
        assert results[1]["page"] == 2

    @pytest.mark.asyncio
    async def test_mixed_success_and_failure(self):
        page_results = [
            json.dumps({"products": [{"name": "A"}], "page_type": "overview"}),
            None,  # this page failed
        ]
        pages = [{"page": 1, "text": "a"}, {"page": 2, "text": "b"}]

        async def _mock_call(prompt: str) -> str | None:
            return page_results.pop(0) if page_results else None

        with patch("engine.services.enrichment_service._call_ollama",
                   new_callable=AsyncMock, side_effect=_mock_call):
            results = await enrich_pages(pages)
        assert results[0]["products"][0]["name"] == "A"
        assert results[0]["page_type"] == "overview"
        assert results[1]["products"] == []
        assert results[1]["page_type"] == "other"

    @pytest.mark.asyncio
    async def test_serializes_product_dicts_with_chunk_text(self):
        # enrich_pages must emit product dicts in the shape .NET expects
        # (i.e. as_dict() output, which includes chunk_text).
        raw = json.dumps({
            "products": [{"name": "Apex 100", "headline": "Class 0.2S"}],
            "page_type": "product_listing",
        })
        with patch("engine.services.enrichment_service._call_ollama",
                   new_callable=AsyncMock, return_value=raw):
            results = await enrich_pages([{"page": 1, "text": "..."}])
        prod = results[0]["products"][0]
        assert "name" in prod
        assert "chunk_text" in prod
        assert "Apex 100" in prod["chunk_text"]
        assert "Class 0.2S" in prod["chunk_text"]


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
