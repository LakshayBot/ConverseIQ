"""Tests for the Phase 1 token-diet optimizations in enrichment_service.

Covers the four optimizations that reduce per-document LLM spend:

  * Local prefilter - blank / short / TOC / boilerplate pages never reach
    the LLM (status stays ``no_products`` so the .NET consumer treats it
    as success; ``skip_reason`` metadata is ignored by .NET).
  * Exact-duplicate page dedup - second occurrence of identical normalized
    text returns immediately without an LLM call.
  * Adaptive output budget - completion budget scales with page density
    instead of the flat GROQ_MAX_TOKENS ceiling.
  * Deterministic head+tail truncation of overlong pages.
  * Validation-flake retry shrink - halved budget + terseness note.
  * Compressed prompt template - renders, keeps every schema field name,
    and stays small (char bound instead of a tokenizer dependency).
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest

from engine.services import enrichment_service as es
from engine.services.enrichment_service import (
    _build_prompt,
    _dedup_key,
    _duplicate_page_result,
    _normalize_for_dedup,
    _output_budget,
    _prefilter_skip_reason,
    _PROMPT_TEMPLATE,
    _RETRY_SHRINK_NOTE,
    _truncate_page_text,
    _call_groq_with_retry,
    _GroqResult,
    enrich_page,
    enrich_pages,
    enrich_pages_streaming,
    GROQ_MAX_TOKENS,
    MAX_PAGE_CHARS,
)


def _product_page(words: int = 60) -> str:
    """A realistic product page above the prefilter floor."""
    body = (
        "The Apex 100 precision meter delivers class 0.2S accuracy for "
        "transmission substations with integrated DLMS COSEM communication "
        "and four-quadrant energy measurement. Built-in CT design removes "
        "external transformer wiring."
    )
    out = body
    while len(out.split()) < words:
        out += " " + body
    return out


# ── _prefilter_skip_reason ──────────────────────────────────────────────────

class TestPrefilter:
    def test_empty_text(self):
        assert _prefilter_skip_reason("") == "no_text_layer"
        assert _prefilter_skip_reason("   \n\t ") == "no_text_layer"

    def test_none_text(self):
        assert _prefilter_skip_reason(None) == "no_text_layer"

    def test_too_short(self):
        assert _prefilter_skip_reason("Apex 100 supports DLMS.") == "too_short"

    def test_normal_product_page_passes(self):
        assert _prefilter_skip_reason(_product_page()) is None

    def test_toc_detected(self):
        lines = ["Table of Contents", ""]
        for i, title in enumerate(
            ["Overview", "Specifications", "Features", "Pricing", "Contact"],
            start=1,
        ):
            lines.append(f"{title} {'.' * 30} {i}")
        assert _prefilter_skip_reason("\n".join(lines)) == "toc"

    def test_toc_needs_leader_lines(self):
        # "contents" word present but no dotted leaders -> enrich anyway.
        text = "Contents of this document describe the product line. " + (
            "The Apex 100 meter is accurate and reliable for substations. " * 4)
        assert _prefilter_skip_reason(text) is None

    def test_boilerplate_contact_page_detected(self):
        lines = [
            "Copyright 2026 Secure Meters Limited. All rights reserved.",
            "www.securemeters.com | https://example.com/support",
            "Phone: 1800-123-4567, Email: care@example.com",
            "Registered Office: Unit 12, Industrial Estate, Byewar Road, Durgapur",
            "GSTIN 08AAACS1234A1Z5 CIN U31909HR1997PLC042915",
        ]
        assert _prefilter_skip_reason("\n".join(lines)) == "boilerplate"

    def test_real_content_with_one_footer_line_passes(self):
        body = _product_page()
        text = body + "\nwww.example.com\nCopyright 2026 Example Corp"
        assert _prefilter_skip_reason(text) is None

    @pytest.mark.asyncio
    async def test_enrich_page_skips_llm_on_prefiltered_pages(self):
        mock = AsyncMock()
        with patch("engine.services.enrichment_service._call_groq", new=mock):
            result = await enrich_page("tiny")
        assert result.products == []
        assert result.outcome["status"] == "no_products"
        assert result.outcome["skip_reason"] == "too_short"
        mock.assert_not_called()


# ── _truncate_page_text ──────────────────────────────────────────────────────

class TestTruncation:
    def test_short_page_untouched(self):
        text = _product_page()
        assert _truncate_page_text(text) == text

    def test_long_page_head_and_tail_kept(self):
        head_marker = "HEADSTART "
        tail_marker = " TAILSEND"
        text = head_marker + ("filler sentence. " * 2000) + tail_marker
        truncated = _truncate_page_text(text)
        assert len(truncated) <= MAX_PAGE_CHARS + len(es._TRUNCATION_MARKER)
        assert truncated.startswith(head_marker)
        assert truncated.endswith(tail_marker)
        assert es._TRUNCATION_MARKER in truncated


# ── _output_budget ───────────────────────────────────────────────────────────

class TestAdaptiveBudget:
    def test_floor_for_small_pages(self):
        assert _output_budget("x" * 100) == 800

    def test_scales_with_page_density(self):
        small = _output_budget("x" * 800)
        medium = _output_budget("x" * 4000)
        large = _output_budget("x" * 12000)
        huge = _output_budget("x" * 50000)
        assert small < medium <= large <= huge
        assert huge == GROQ_MAX_TOKENS  # clamped ceiling

    def test_ceiling_respects_env_override(self, monkeypatch):
        monkeypatch.setattr(es, "GROQ_MAX_TOKENS", 2048)
        assert _output_budget("x" * 50000) == 2048

    def test_disabled_falls_back_to_flat_budget(self, monkeypatch):
        monkeypatch.setattr(es, "_ADAPTIVE_TOKENS", False)
        assert _output_budget("x" * 100) == GROQ_MAX_TOKENS
        assert _output_budget("x" * 50000) == GROQ_MAX_TOKENS

    @pytest.mark.asyncio
    async def test_enrich_page_passes_adaptive_budget_down(self):
        captured: dict = {}

        async def _capture(prompt: str, max_tokens=None):
            captured["max_tokens"] = max_tokens
            return _GroqResult(
                content=json.dumps({"products": [], "page_type": "other"}),
                outcome_status="ok", duration_ms=5)

        page = _product_page()
        with patch("engine.services.enrichment_service._call_groq_with_retry",
                   new=_capture):
            await enrich_page(page)
        assert captured["max_tokens"] == _output_budget(page)


# ── Page dedup ───────────────────────────────────────────────────────────────

class TestDedup:
    def test_normalize_collapses_case_punct_whitespace(self):
        a = "The Apex 100 Meter!"
        b = "  the apex 100 meter "
        assert _dedup_key(a) == _dedup_key(b)
        assert _normalize_for_dedup(a) == "the apex 100 meter"

    def test_different_pages_different_keys(self):
        assert _dedup_key("alpha page") != _dedup_key("beta page")

    @pytest.mark.asyncio
    async def test_bulk_duplicate_skips_second_call(self):
        ok = _GroqResult(
            content=json.dumps({"products": [{"name": "Apex 100"}],
                                "page_type": "product_listing"}),
            outcome_status="ok", duration_ms=10)
        mock = AsyncMock(return_value=ok)
        pages = [
            {"page": 1, "text": _product_page()},
            {"page": 2, "text": _product_page().upper().replace(".", "")},
        ]
        with patch("engine.services.enrichment_service._call_groq", new=mock), \
             patch.object(es, "MIN_PAGE_INTERVAL_S", 0.0):
            results = await enrich_pages(pages)
        assert mock.await_count == 1
        assert results[0]["outcome"]["status"] == "ok"
        dup = results[1]
        assert dup["page"] == 2
        assert dup["outcome"]["status"] == "no_products"
        assert dup["outcome"]["skip_reason"] == "duplicate"
        assert dup["outcome"]["duplicate_of"] == 1

    @pytest.mark.asyncio
    async def test_streaming_duplicate_skips_second_call(self):
        ok = _GroqResult(
            content=json.dumps({"products": [], "page_type": "other"}),
            outcome_status="ok", duration_ms=10)
        mock = AsyncMock(return_value=ok)
        pages = [
            {"page": 3, "text": _product_page()},
            {"page": 4, "text": _product_page()},
        ]
        with patch("engine.services.enrichment_service._call_groq", new=mock), \
             patch.object(es, "MIN_PAGE_INTERVAL_S", 0.0):
            results = [r async for r in enrich_pages_streaming(pages)]
        assert mock.await_count == 1
        dup = next(r for r in results if r["page"] == 4)
        assert dup["outcome"]["skip_reason"] == "duplicate"
        assert dup["outcome"]["duplicate_of"] == 3

    @pytest.mark.asyncio
    async def test_blank_pages_not_flagged_duplicates(self):
        ok = _GroqResult(content=json.dumps({"products": []}),
                         outcome_status="ok", duration_ms=5)
        mock = AsyncMock(return_value=ok)
        pages = [{"page": 1, "text": ""}, {"page": 2, "text": "   "}]
        with patch("engine.services.enrichment_service._call_groq", new=mock), \
             patch.object(es, "MIN_PAGE_INTERVAL_S", 0.0):
            results = await enrich_pages(pages)
        mock.assert_not_called()  # both prefiltered - no LLM work at all
        assert all(r["outcome"]["skip_reason"] in ("no_text_layer", "too_short")
                   for r in results)

    def test_duplicate_result_shape_matches_dotnet_vocabulary(self):
        d = _duplicate_page_result(7, 2, "model-x")
        assert d["page"] == 7
        assert d["products"] == []
        assert d["entities"] == []
        assert d["page_type"] == "other"
        assert d["outcome"]["status"] == "no_products"


# ── Validation-flake retry shrink ───────────────────────────────────────────

class TestValidationRetryShrink:
    @pytest.mark.asyncio
    async def test_retry_halves_budget_and_appends_note_once(self):
        flake = _GroqResult(content=None, outcome_status="http_4xx",
                            error_message="json_validate_failed", duration_ms=5)
        ok = _GroqResult(content="{}", outcome_status="ok", duration_ms=10)
        calls: list[dict] = []

        async def _fake(prompt: str, max_tokens=None):
            calls.append({"prompt": prompt, "max_tokens": max_tokens})
            return flake if len(calls) == 1 else ok

        with patch("engine.services.enrichment_service._call_groq", new=_fake), \
             patch("engine.services.enrichment_service.asyncio.sleep",
                   new_callable=AsyncMock):
            result = await _call_groq_with_retry("base-prompt", max_tokens=2400)

        assert result.outcome_status == "ok"
        assert result.retry_count == 1
        assert calls[0]["max_tokens"] == 2400
        assert calls[1]["max_tokens"] == 1200
        assert _RETRY_SHRINK_NOTE not in calls[0]["prompt"]
        assert calls[1]["prompt"].count(_RETRY_SHRINK_NOTE) == 1

    @pytest.mark.asyncio
    async def test_shrink_compounds_across_validation_retries(self):
        flake = lambda: _GroqResult(content=None, outcome_status="http_4xx",
                                    error_message="json_validate_failed",
                                    duration_ms=5)
        ok = _GroqResult(content="{}", outcome_status="ok", duration_ms=10)
        calls: list[int] = []

        async def _fake(prompt: str, max_tokens=None):
            calls.append(max_tokens)
            return flake() if len(calls) < 3 else ok

        with patch("engine.services.enrichment_service._call_groq", new=_fake), \
             patch("engine.services.enrichment_service.asyncio.sleep",
                   new_callable=AsyncMock):
            await _call_groq_with_retry("p", max_tokens=3200)
        assert calls == [3200, 1600, 800]

    @pytest.mark.asyncio
    async def test_rate_limit_retry_keeps_original_prompt_and_budget(self):
        limited = _GroqResult(content=None, outcome_status="http_5xx",
                              error_message="Error code: 429 - Please try again in 0.01s",
                              duration_ms=5)
        ok = _GroqResult(content="{}", outcome_status="ok", duration_ms=10)
        calls: list[dict] = []

        async def _fake(prompt: str, max_tokens=None):
            calls.append({"prompt": prompt, "max_tokens": max_tokens})
            return limited if len(calls) == 1 else ok

        with patch("engine.services.enrichment_service._call_groq", new=_fake), \
             patch("engine.services.enrichment_service.asyncio.sleep",
                   new_callable=AsyncMock):
            await _call_groq_with_retry("keep-me", max_tokens=1500)
        assert calls[0]["prompt"] == calls[1]["prompt"] == "keep-me"
        assert calls[1]["max_tokens"] == 1500

    @pytest.mark.asyncio
    async def test_legacy_no_budget_still_gets_default_and_shrink(self):
        flake = _GroqResult(content=None, outcome_status="http_4xx",
                            error_message="json_validate_failed", duration_ms=5)
        ok = _GroqResult(content="{}", outcome_status="ok", duration_ms=10)
        calls: list[int] = []

        async def _fake(prompt: str, max_tokens=None):
            calls.append(max_tokens)
            return flake if len(calls) == 1 else ok

        with patch("engine.services.enrichment_service._call_groq", new=_fake), \
             patch("engine.services.enrichment_service.asyncio.sleep",
                   new_callable=AsyncMock):
            await _call_groq_with_retry("p")
        assert calls == [GROQ_MAX_TOKENS, GROQ_MAX_TOKENS // 2]


# ── Compressed prompt template ──────────────────────────────────────────────

class TestCompressedPrompt:
    REQUIRED_PRODUCT_FIELDS = [
        '"name"', '"category"', '"headline"', '"key_features"', '"pricing"',
        '"best_for"', '"differentiators"', '"raw_claims"', '"entityType"',
        '"confidence"', '"aliases"', '"evidence"',
    ]

    def test_renders_with_placeholder(self):
        prompt = _build_prompt("PAGE BODY HERE")
        assert "PAGE BODY HERE" in prompt

    def test_all_schema_field_names_present(self):
        # The .NET deserializer and _parse_enrichment_response depend on
        # these exact names surviving the compression.
        for field in self.REQUIRED_PRODUCT_FIELDS:
            assert field in _PROMPT_TEMPLATE, f"missing {field}"
        for field in ['"canonical"', '"page_type"']:
            assert field in _PROMPT_TEMPLATE, f"missing {field}"
        for pt in ("product_listing", "comparison", "overview", "pricing",
                   "contact", "other"):
            assert pt in _PROMPT_TEMPLATE

    def test_output_limits_present(self):
        # Hard caps are what bound runaway output on dense pages.
        assert "max 3 products" in _PROMPT_TEMPLATE
        assert "max 12 entities" in _PROMPT_TEMPLATE
        assert "max 8 items" in _PROMPT_TEMPLATE

    def test_template_is_actually_compressed(self):
        instructions = _PROMPT_TEMPLATE.split("{page_text}")[0]
        # Original template was ~2,044 chars (~478 tokens); compressed must
        # stay under ~1,300 chars (~230 tokens). Char count avoids a
        # tiktoken dependency in CI.
        assert len(instructions) < 1300, (
            f"template regressed to {len(instructions)} chars")

    def test_format_survives_braces_in_page_text(self):
        # .format() must not choke on braces coming from page content.
        prompt = _build_prompt('json fragment {"key": 1}')
        assert '{"key": 1}' in prompt
