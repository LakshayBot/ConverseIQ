"""Model discovery + provider-aware fallback catalog.

Groq and OpenAI both expose an OpenAI-compatible ``GET /models`` endpoint
that lists the models available to the API key - we use that as the live
source of truth when connected.  Anthropic has NO public list-models
endpoint (as of this writing), so for Anthropic (and as a graceful
fallback whenever discovery fails or times out) we serve the curated
capability-tagged catalog from :mod:`engine.ai.base`.

The catalog is a *fallback*, never an exclusive list - a live discovery
result takes precedence and unknown models are still shown so the user
is never blocked by our static data being outdated.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any, Optional

from engine.ai.base import (
    ANTHROPIC,
    GROQ,
    OPENAI,
    APPLICATION_CATALOG,
    AiErrorCode,
    normalize_provider_type,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ModelInfo:
    """A single model offered by a provider, with capability tags."""
    id: str
    name: str
    capabilities: tuple[str, ...] = ()
    # True when this entry came from the fallback catalog rather than a
    # live provider discovery (the UI can show "curated" vs "discovered").
    from_fallback: bool = False

    def has(self, capability: str) -> bool:
        return capability in self.capabilities

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "capabilities": list(self.capabilities),
            "supports_json_output": self.has("json_output"),
        }


class ModelCatalog:
    """Resolves the models available to a provider API key.

    Live discovery for Groq/OpenAI; curated fallback for Anthropic and for
    any provider whose discovery endpoint is unreachable.  ``discover``
    NEVER raises: any failure degrades to the fallback list so the UI
    always has models to offer.
    """

    def __init__(self, timeout_s: float = 8.0):
        self.timeout_s = timeout_s

    async def discover(
        self,
        provider_type: str,
        api_key: str,
        endpoint: Optional[str] = None,
    ) -> list[ModelInfo]:
        ptype = normalize_provider_type(provider_type)
        if not api_key:
            return []
        if ptype == ANTHROPIC:
            # No public list-models API - curated fallback only.
            return self._fallback(ptype)
        models = await self._discover_openai_compatible(ptype, api_key, endpoint)
        if models:
            return models
        return self._fallback(ptype)

    async def _discover_openai_compatible(
        self,
        ptype: str,
        api_key: str,
        endpoint: Optional[str],
    ) -> list[ModelInfo]:
        import httpx

        base = endpoint or (
            "https://api.groq.com/openai/v1" if ptype == GROQ else "https://api.openai.com/v1"
        )
        url = base.rstrip("/") + "/models"
        headers = {"Authorization": f"Bearer {api_key}"}
        try:
            async with httpx.AsyncClient(timeout=self.timeout_s, follow_redirects=True) as client:
                resp = await client.get(url, headers=headers)
            if resp.status_code != 200:
                logger.warning("Model discovery for %s returned %s", ptype, resp.status_code)
                return []
            body = resp.json()
        except Exception as exc:
            logger.warning("Model discovery for %s failed: %s", ptype, exc)
            return []

        items = body.get("data") or []
        out: list[ModelInfo] = []
        for item in items:
            model_id = item.get("id") if isinstance(item, dict) else None
            if not model_id:
                continue
            out.append(ModelInfo(
                id=str(model_id),
                name=_friendly_name(ptype, str(model_id)),
                capabilities=_capabilities_for(ptype, str(model_id)),
                from_fallback=False,
            ))
        return out[:200]

    def _fallback(self, ptype: str) -> list[ModelInfo]:
        out: list[ModelInfo] = []
        for entry in APPLICATION_CATALOG.get(ptype, []):
            out.append(ModelInfo(
                id=entry["id"],
                name=entry.get("name") or entry["id"],
                capabilities=tuple(entry.get("capabilities") or []),
                from_fallback=True,
            ))
        return out


def provider_fallback_models(provider_type: str) -> list[ModelInfo]:
    """Curated capability-tagged models for a provider (no network)."""
    return ModelCatalog()._fallback(normalize_provider_type(provider_type))


# Model families that are NOT chat-capable (transcription, embedding, reranking,
# prompt-safety, audio).  Discovery returns every model a key can see, including
# these - they must never appear as product-extraction model options.
_NON_CHAT_HINTS = (
    "whisper",
    "wav2vec",
    "parakeet",
    "orpheus",
    "embed",
    "rerank",
    "prompt-guard",
    "llama-guard",
    "dino",
    "detr",
    "mamba",
)


def _capabilities_for(ptype: str, model_id: str) -> tuple[str, ...]:
    # Start from the curated entry when we know it, then extend with
    # heuristics for the parts discovery does not tell us.
    known = next(
        (entry for entry in APPLICATION_CATALOG.get(ptype, []) if entry.get("id") == model_id),
        None,
    )
    caps = set(known.get("capabilities") or []) if known else set()
    mid = model_id.lower()
    non_chat = any(h in mid for h in _NON_CHAT_HINTS)
    if non_chat:
        # Known non-chat families: even if they come from a curated entry, do
        # not let them masquerade as chat capable.
        caps.discard("chat")
        caps.discard("json_output")
        return tuple(sorted(caps))
    if not caps:
        caps.add("json_output")  # chat models take the JSON prompt; validated downstream
        caps.add("chat")
    if any(h in mid for h in ("4o", "vision", "llama-3.2", "opus", "sonnet")):
        caps.add("vision")
    if any(h in mid for h in ("4o", "4.1", "qwen3", "gpt-oss", "opus", "sonnet", "70b", "27b")):
        caps.add("general")
        caps.add("long_context")
    if caps and "json_output" in caps and "chat" not in caps:
        caps.add("chat")
    return tuple(sorted(caps))


def _friendly_name(ptype: str, model_id: str) -> str:
    known = next(
        (entry for entry in APPLICATION_CATALOG.get(ptype, []) if entry.get("id") == model_id),
        None,
    )
    if known and known.get("name"):
        return known["name"]
    return model_id
