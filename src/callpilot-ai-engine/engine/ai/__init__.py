"""CallPilot AI provider abstraction.

Normalizes chat-completion providers (Groq / OpenAI / Anthropic) behind a
single async interface so the knowledge-bank pipeline can ask for *a model
capable of a task* without caring which provider or SDK answers it.
"""

from engine.ai.base import (
    AiCompletionResult,
    AiErrorCode,
    AiModelCapabilities,
    AiProviderConfig,
    AiUsage,
    ProviderType,
    normalize_provider_type,
    supported_provider_types,
)
from engine.ai.model_catalog import (
    ModelInfo,
    ModelCatalog,
    provider_fallback_models,
)
from engine.ai.providers import (
    BaseAiProvider,
    MissingProviderKeyError,
    get_provider,
)

__all__ = [
    "AiCompletionResult",
    "AiErrorCode",
    "AiModelCapabilities",
    "AiProviderConfig",
    "AiUsage",
    "BaseAiProvider",
    "MissingProviderKeyError",
    "ModelCatalog",
    "ModelInfo",
    "ProviderType",
    "get_provider",
    "normalize_provider_type",
    "provider_fallback_models",
    "supported_provider_types",
]
