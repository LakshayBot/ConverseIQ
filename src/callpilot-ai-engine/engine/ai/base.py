"""Shared provider-agnostic types for the CallPilot AI layer."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional


# Provider identity

ProviderType = str

GROQ = "groq"
OPENAI = "openai"
ANTHROPIC = "anthropic"

_SUPPORTED = (GROQ, OPENAI, ANTHROPIC)


def supported_provider_types() -> tuple[str, ...]:
    return _SUPPORTED


def normalize_provider_type(raw: Any) -> str:
    """Coerce a user/API-supplied provider name to its canonical lowercase."""
    if not raw:
        return ""
    return str(raw).strip().lower().replace("-", "").replace("_", "").replace(" ", "")


# Shared outcome statuses (the contract the rest of CallPilot reads)

OUTCOME_OK = "ok"
OUTCOME_NO_PRODUCTS = "no_products"
OUTCOME_MISSING_KEY = "missing_key"
OUTCOME_HTTP_4XX = "http_4xx"
OUTCOME_HTTP_5XX = "http_5xx"
OUTCOME_TIMEOUT = "timeout"
OUTCOME_CONNECTION_ERROR = "connection_error"
OUTCOME_PARSE_ERROR = "parse_error"
OUTCOME_UNKNOWN = "unknown"


class AiErrorCode:
    OK = "ok"
    VALID = "valid"
    INVALID_KEY = "invalid_api_key"
    KEY_EXPIRED = "key_expired_or_revoked"
    INSUFFICIENT_CREDITS = "insufficient_credits"
    RATE_LIMIT = "rate_limit_reached"
    MODEL_UNAVAILABLE = "model_unavailable"
    PROVIDER_UNAVAILABLE = "provider_unavailable"
    REQUEST_FAILED = "request_failed"
    INVALID_RESPONSE = "invalid_response"
    UNKNOWN = "unknown"
    MISSING_KEY = "missing_key"


ERROR_CODE_FALLBACKS: dict[str, tuple[str, ...]] = {
    OUTCOME_HTTP_4XX: (AiErrorCode.INVALID_KEY, AiErrorCode.KEY_EXPIRED,
                       AiErrorCode.MODEL_UNAVAILABLE, AiErrorCode.REQUEST_FAILED),
    OUTCOME_HTTP_5XX: (AiErrorCode.PROVIDER_UNAVAILABLE, AiErrorCode.INSUFFICIENT_CREDITS),
    OUTCOME_TIMEOUT: (AiErrorCode.PROVIDER_UNAVAILABLE,),
    OUTCOME_CONNECTION_ERROR: (AiErrorCode.PROVIDER_UNAVAILABLE,),
    OUTCOME_MISSING_KEY: (AiErrorCode.MISSING_KEY,),
    OUTCOME_PARSE_ERROR: (AiErrorCode.INVALID_RESPONSE,),
    OUTCOME_UNKNOWN: (AiErrorCode.UNKNOWN,),
}


@dataclass(frozen=True)
class AiProviderConfig:
    """A fully-resolved provider+model+credential for one operation.

    Sent from the .NET server over the internal docker network after the
    user provider preference has been resolved and their stored API key
    decrypted. **Never logged.** A None endpoint means provider default.
    """
    provider_type: str
    model: str
    api_key: str
    endpoint: Optional[str] = None
    max_tokens: Optional[int] = None
    temperature: Optional[float] = None
    timeout_s: Optional[float] = None

    @property
    def normalized(self) -> str:
        return normalize_provider_type(self.provider_type)

    def __post_init__(self) -> None:
        object.__setattr__(self, "provider_type", normalize_provider_type(self.provider_type))


@dataclass(frozen=True)
class AiUsage:
    """Token usage reported by the provider for a single call (when available)."""
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    total_tokens: Optional[int] = None


@dataclass
class AiCompletionResult:
    """A normalized provider response.

    ``content`` is the raw text completion (possibly with markdown fences);
    the caller parses it with the shared defensive JSON path. ``usage`` is
    provider-reported token usage (None when the provider omits it).
    ``outcome_status`` and ``error_code`` drive the UI.
    """
    content: Optional[str]
    model: str
    provider_type: str
    outcome_status: str = OUTCOME_UNKNOWN
    error_code: str = AiErrorCode.UNKNOWN
    error_message: Optional[str] = None
    usage: Optional[AiUsage] = None
    duration_ms: int = 0
    retry_count: int = 0
    rate_limit: dict[str, Any] = field(default_factory=dict)

    def to_outcome(self) -> dict[str, Any]:
        """Expose the outcome dict the enrichment/UI layer expects."""
        return {
            "status": self.outcome_status,
            "model": self.model,
            "duration_ms": self.duration_ms,
            "error": (self.error_message or "")[:500] or None,
            "error_code": self.error_code,
            "retry_count": self.retry_count,
            "provider": self.provider_type,
            "usage": None if self.usage is None else {
                "input_tokens": self.usage.input_tokens,
                "output_tokens": self.usage.output_tokens,
                "total_tokens": self.usage.total_tokens,
            },
        },


class AiModelCapabilities:
    """Capability tags describing what a model can be used for."""
    JSON_OUTPUT = "json_output"
    CHAT = "chat"
    GENERAL = "general"
    VISION = "vision"
    LONG_CONTEXT = "long_context"


APPLICATION_CATALOG: dict[str, list[dict[str, Any]]] = {
    "groq": [
        {"id": "qwen/qwen3.6-27b", "name": "Qwen 3.6 27B", "capabilities": ["json_output", "chat", "general", "long_context"]},
        {"id": "openai/gpt-oss-20b", "name": "GPT-OSS 20B", "capabilities": ["json_output", "chat", "general", "long_context"]},
        {"id": "llama-3.3-70b-versatile", "name": "Llama 3.3 70B", "capabilities": ["json_output", "chat", "general", "long_context"]},
        {"id": "llama-3.1-8b-instant", "name": "Llama 3.1 8B", "capabilities": ["json_output", "chat"]},
        {"id": "llama-3.2-11b-vision-preview", "name": "Llama 3.2 11B Vision", "capabilities": ["json_output", "chat", "vision"]},
    ],
    "openai": [
        {"id": "gpt-4o", "name": "GPT-4o", "capabilities": ["json_output", "chat", "general", "vision", "long_context"]},
        {"id": "gpt-4o-mini", "name": "GPT-4o mini", "capabilities": ["json_output", "chat", "general", "long_context"]},
        {"id": "gpt-4.1", "name": "GPT-4.1", "capabilities": ["json_output", "chat", "general", "long_context"]},
        {"id": "gpt-4.1-mini", "name": "GPT-4.1 mini", "capabilities": ["json_output", "chat", "general", "long_context"]},
        {"id": "gpt-4.1-nano", "name": "GPT-4.1 nano", "capabilities": ["json_output", "chat"]},
        {"id": "o3-mini", "name": "o3-mini", "capabilities": ["json_output", "chat", "general"]},
        {"id": "o4-mini", "name": "o4-mini", "capabilities": ["json_output", "chat", "general"]},
    ],
    "anthropic": [
        {"id": "claude-sonnet-4-5", "name": "Claude Sonnet 4.5", "capabilities": ["json_output", "chat", "general", "long_context"]},
        {"id": "claude-sonnet-4-20250514", "name": "Claude Sonnet 4", "capabilities": ["json_output", "chat", "general", "long_context"]},
        {"id": "claude-3-5-haiku-20241022", "name": "Claude Haiku 3.5", "capabilities": ["json_output", "chat"]},
        {"id": "claude-3-7-sonnet-20250219", "name": "Claude Sonnet 3.7", "capabilities": ["json_output", "chat", "general", "long_context"]},
        {"id": "claude-opus-4-1", "name": "Claude Opus 4.1", "capabilities": ["json_output", "chat", "general", "long_context"]},
    ],
}

_VISION_MODEL_HINTS = ("vision", "-11b-vision", "gpt-4o", "claude-3-5-sonnet", "claude-3-7", "claude-opus")


def model_has_capability(model_id: str, capability: str, catalog_entry: Optional[dict] = None) -> bool:
    if catalog_entry:
        return capability in (catalog_entry.get("capabilities") or [])
    mid = model_id.lower()
    if capability == AiModelCapabilities.VISION:
        return any(h in mid for h in _VISION_MODEL_HINTS)
    if capability == AiModelCapabilities.JSON_OUTPUT:
        return True
    return True
