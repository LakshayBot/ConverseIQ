"""Tests for the provider-agnostic AI abstraction (engine/ai).

Mock the SDK clients so no network is needed; lock in the shared
outcome/error taxonomy and the model-catalog fallback behaviour.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest

from engine.ai.base import (
    ANTHROPIC,
    GROQ,
    OPENAI,
    AiProviderConfig,
    OUTCOME_HTTP_4XX,
    OUTCOME_HTTP_5XX,
    OUTCOME_OK,
    OUTCOME_TIMEOUT,
    normalize_provider_type,
    supported_provider_types,
)
from engine.ai.model_catalog import ModelCatalog, provider_fallback_models
from engine.ai.providers import (
    get_provider,
)


class TestProviderIdentity:
    def test_normalize(self):
        assert normalize_provider_type("Groq") == "groq"
        assert normalize_provider_type("open-ai") == "openai"
        assert normalize_provider_type("  Anthropic ") == "anthropic"
        assert supported_provider_types() == (GROQ, OPENAI, ANTHROPIC)

    def test_unknown_provider_raises(self):
        cfg = AiProviderConfig(provider_type="mystery", model="x", api_key="k")
        with pytest.raises(ValueError):
            get_provider(cfg)

    def test_missing_key_raises(self):
        cfg = AiProviderConfig(provider_type=GROQ, model="m", api_key="")
        with pytest.raises(Exception):
            get_provider(cfg)


def _fake_openai_ok_response(content: str):
    choices = [type("C", (), {"message": type("M", (), {"content": content})()})()]
    usage = type("U", (), {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15})()
    return type("R", (), {"choices": choices, "usage": usage})()


class TestOpenAiCompatProviding:
    @pytest.mark.asyncio
    async def test_groq_ok_json(self):
        content = json.dumps({"products": [{"name": "Apex 100"}], "page_type": "overview"})
        fake = _fake_openai_ok_response(content)
        client = type("Client", (), {"chat": type("C", (), {"completions": type("P", (), {"create": AsyncMock(return_value=fake)})()})()})()
        mod = type("mod", (), {"AsyncGroq": lambda **kw: client})
        cfg = AiProviderConfig(provider_type=GROQ, model="qwen/qwen3.6-27b", api_key="gsk_x")
        provider = get_provider(cfg)
        provider._client = lambda: client
        res = await provider.complete("extract", json_mode=True)
        assert res.outcome_status == OUTCOME_OK
        assert res.content == content
        assert res.usage.input_tokens == 10
        assert res.usage.output_tokens == 5
        assert res.usage.total_tokens == 15

    @pytest.mark.asyncio
    async def test_auth_error_4xx(self):
        class AuthError(Exception):
            status_code = 401
        client = type("Client", (), {"chat": type("C", (), {"completions": type("P", (), {"create": AsyncMock(side_effect=AuthError("Invalid API key"))})()})()})()
        cfg = AiProviderConfig(provider_type=OPENAI, model="gpt-4o", api_key="sk_x")
        provider = get_provider(cfg)
        provider._client = lambda: client
        res = await provider.complete("x")
        assert res.outcome_status == OUTCOME_HTTP_4XX
        assert res.error_code == "invalid_api_key"

    @pytest.mark.asyncio
    async def test_rate_limit_429_5xx(self):
        class RateError(Exception):
            status_code = 429
        client = type("Client", (), {"chat": type("C", (), {"completions": type("P", (), {"create": AsyncMock(side_effect=RateError("Rate limit reached for model"))})()})()})()
        cfg = AiProviderConfig(provider_type=GROQ, model="m", api_key="k")
        provider = get_provider(cfg)
        provider._client = lambda: client
        res = await provider.complete("x")
        assert res.outcome_status == OUTCOME_HTTP_5XX
        assert res.error_code == "rate_limit_reached"

    @pytest.mark.asyncio
    async def test_timeout(self):
        class TimeoutError_(Exception):
            status_code = None
        client = type("Client", (), {"chat": type("C", (), {"completions": type("P", (), {"create": AsyncMock(side_effect=TimeoutError_("timed out"))})()})()})()
        cfg = AiProviderConfig(provider_type=OPENAI, model="m", api_key="k")
        provider = get_provider(cfg)
        provider._client = lambda: client
        # name check: our classifier keys on the exception type name containing "timeout"
        res = await provider.complete("x")
        assert res.outcome_status == OUTCOME_TIMEOUT


class TestModelCatalog:
    @pytest.mark.asyncio
    async def test_anthropic_uses_curated_fallback(self):
        catalog = ModelCatalog()
        models = await catalog.discover(ANTHROPIC, "sk-ant-x")
        assert len(models) > 0
        assert all(m.from_fallback for m in models)
        assert any(m.has("json_output") for m in models)

    @pytest.mark.asyncio
    async def test_groq_discovery_failure_falls_back(self):
        catalog = ModelCatalog(timeout_s=0.01)
        with patch("httpx.AsyncClient") as mock:
            mock.return_value.__aenter__ = AsyncMock(return_value=mock.return_value)
            mock.return_value.get = AsyncMock(side_effect=Exception("boom"))
            models = await catalog.discover(GROQ, "gsk_x")
        assert len(models) > 0
        assert all(m.from_fallback for m in models)

    def test_fallback_models_has_product_extraction_models(self):
        for ptype in (GROQ, OPENAI, ANTHROPIC):
            models = provider_fallback_models(ptype)
            assert any(m.has("json_output") for m in models), ptype
