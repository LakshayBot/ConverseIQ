"""Concrete provider implementations behind the CallPilot AI abstraction.

Each provider class implements the same async completion contract and maps
its SDK exceptions to the shared outcome/error taxonomy.  The provider
layer is the ONLY place that imports provider SDKs - nothing else in the
knowledge pipeline knows Groq/OpenAI/Anthropic exist.

JSON strategy per provider:
  * Groq / OpenAI  - native JSON mode (response_format json_object).
  * Anthropic      - no native JSON mode; the prompt already demands JSON
                     and we pre-fill the assistant turn with an open brace
                     to bias the model toward emitting the object.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from typing import Any, Optional

from engine.ai.base import (
    ANTHROPIC,
    GROQ,
    OPENAI,
    AiCompletionResult,
    AiErrorCode,
    AiProviderConfig,
    AiUsage,
    ERROR_CODE_FALLBACKS,
    OUTCOME_CONNECTION_ERROR,
    OUTCOME_HTTP_4XX,
    OUTCOME_HTTP_5XX,
    OUTCOME_MISSING_KEY,
    OUTCOME_OK,
    OUTCOME_TIMEOUT,
    OUTCOME_UNKNOWN,
    normalize_provider_type,
)

logger = logging.getLogger(__name__)


class MissingProviderKeyError(RuntimeError):
    """Raised when a provider call is attempted without an API key."""


class BaseAiProvider:
    """Async completion contract shared by every provider."""

    provider_type = ""

    def __init__(self, config: AiProviderConfig):
        self.config = config
        if not config.api_key:
            raise MissingProviderKeyError(
                f"No API key for provider {self.provider_type or config.provider_type}"
            )

    async def complete(
        self,
        prompt: str,
        *,
        system: Optional[str] = None,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
        json_mode: bool = False,
    ) -> AiCompletionResult:
        raise NotImplementedError

    async def complete_with_images(
        self,
        prompt: str,
        image_data_urls: list[str],
        *,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
    ) -> AiCompletionResult:
        """Caption/describe images along with a text prompt (vision).

        Providers map image payloads to their own format; the result
        contract is identical to :meth:`complete`.  Default implementation
        is unimplemented for providers without vision support.
        """
        raise NotImplementedError

    def _maybe_close(self, client):
        """Best-effort async client close (swallows any error)."""
        import inspect as _inspect
        try:
            closer = getattr(client, "close", None)
            if closer is None:
                return
            if _inspect.iscoroutinefunction(closer):
                try:
                    import asyncio as _asyncio
                    _asyncio.get_event_loop().create_task(closer())
                except Exception:
                    pass
            else:
                closer()
        except Exception:
            pass

    def _ok(self, content: str, usage: Optional[AiUsage], duration_ms: int) -> AiCompletionResult:
        return AiCompletionResult(
            content=content, model=self.config.model, provider_type=self.provider_type,
            outcome_status=OUTCOME_OK, error_code=AiErrorCode.OK,
            usage=usage, duration_ms=duration_ms,
        )

    def _fail(
        self,
        outcome_status: str,
        error_message: str,
        duration_ms: int,
        error_code: Optional[str] = None,
    ) -> AiCompletionResult:
        code = error_code or (ERROR_CODE_FALLBACKS.get(outcome_status, (AiErrorCode.UNKNOWN,))[0])
        return AiCompletionResult(
            content=None, model=self.config.model, provider_type=self.provider_type,
            outcome_status=outcome_status, error_code=code,
            error_message=error_message, duration_ms=duration_ms,
        )

    def _timeout_s(self, fallback: float) -> float:
        return self.config.timeout_s if self.config.timeout_s and self.config.timeout_s > 0 else fallback


def _classify_rate_limit(raw: str) -> str:
    if not raw:
        return ""
    lower = raw.lower()
    if "insufficient" in lower or "quota" in lower or "credit" in lower or "billing" in lower:
        return AiErrorCode.INSUFFICIENT_CREDITS
    if "rate limit" in lower or "tokens per minute" in lower or "requests per minute" in lower:
        return AiErrorCode.RATE_LIMIT
    return ""


def _pick_4xx_code(status: int, message: str) -> str:
    msg = (message or "").lower()
    if status == 401:
        return AiErrorCode.INVALID_KEY
    if status == 403:
        return AiErrorCode.KEY_EXPIRED
    if status == 429:
        hint = _classify_rate_limit(message)
        return hint or AiErrorCode.RATE_LIMIT
    if status in (404, 400):
        if "model" in msg and ("not found" in msg or "does not exist" in msg or "not_found" in msg):
            return AiErrorCode.MODEL_UNAVAILABLE
        return AiErrorCode.REQUEST_FAILED
    return ERROR_CODE_FALLBACKS[OUTCOME_HTTP_4XX][0]


def _extract_error_message(exc: BaseException) -> str:
    """Best-effort human-safe error message from a provider SDK exception."""
    raw = str(exc or "").strip()
    if not raw:
        return type(exc).__name__ if exc else "unknown error"
    if "{" in raw and "}" in raw:
        m = re.search(r"[{].*?[}]", raw, re.DOTALL)
        if m:
            try:
                import json as _json
                data = _json.loads(m.group(0))
                err = data.get("error") if isinstance(data, dict) else None
                if isinstance(err, dict):
                    msg = err.get("message") or err.get("detail")
                    if msg:
                        return str(msg)[:500]
                elif isinstance(err, str) and err:
                    return err[:500]
                if isinstance(data, dict):
                    msg = data.get("message") or data.get("detail")
                    if msg:
                        return str(msg)[:500]
            except Exception:
                pass
    return raw[:500]


# Shared OpenAI-compatible transport (Groq / OpenAI)

class _OpenAiCompatProvider(BaseAiProvider):
    """Building block for providers whose API is OpenAI-compatible.

    Subclasses set `provider_type` and `_sdk_module` and implement the
    tiny `_to_result` hook if the SDK differs from openai-python.  Groq
    SDK returns the same shapes as openai-python, so both can share this.
    """

    _sdk_module = "openai"

    _async_client_class = "AsyncOpenAI"

    async def complete_with_images(
        self,
        prompt: str,
        image_data_urls: list[str],
        *,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
    ) -> AiCompletionResult:
        t0 = time.time()
        timeout = self._timeout_s(60.0)
        client = self._client()
        content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
        for data_url in (image_data_urls or []):
            if data_url and data_url.startswith("data:"):
                content.append({"type": "image_url", "image_url": {"url": data_url}})
        try:
            resp = await client.chat.completions.create(
                model=self.config.model,
                messages=[{"role": "user", "content": content}],
                max_tokens=max_tokens or 300,
                temperature=temperature if temperature is not None else 0.2,
                timeout=timeout,
            )
        except Exception as exc:
            return self._classify_exception(exc, t0)
        finally:
            self._maybe_close(client)
        try:
            text = (resp.choices[0].message.content or "").strip()
        except (AttributeError, IndexError, TypeError):
            text = ""
        if not text:
            return self._fail(OUTCOME_UNKNOWN, "empty vision response", _ms(t0))
        return self._ok(text, None, _ms(t0))

    def _client(self):
        try:
            mod = __import__(self._sdk_module, fromlist=[self._async_client_class])
            cls = getattr(mod, self._async_client_class)
        except ImportError as exc:
            raise RuntimeError(f"SDK for {self.provider_type} not installed: {exc}") from exc
        kwargs: dict[str, Any] = {"api_key": self.config.api_key}
        if self.config.endpoint:
            kwargs["base_url"] = self.config.endpoint
        return cls(**kwargs)

    async def complete(
        self,
        prompt: str,
        *,
        system: Optional[str] = None,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
        json_mode: bool = False,
    ) -> AiCompletionResult:
        t0 = time.time()
        timeout = self._timeout_s(60.0)
        client = self._client()
        messages: list[dict[str, Any]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        kwargs: dict[str, Any] = {
            "model": self.config.model,
            "messages": messages,
            "max_tokens": max_tokens or self.config.max_tokens or 2048,
            "temperature": temperature if temperature is not None else (self.config.temperature or 0.1),
            "timeout": timeout,
        }
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        try:
            resp = await client.chat.completions.create(**kwargs)
        except Exception as exc:
            return self._classify_exception(exc, t0)
        finally:
            try:
                if hasattr(client, "close") and asyncio.iscoroutinefunction(client.close):
                    await client.close()
            except Exception:
                pass

        try:
            content = resp.choices[0].message.content
        except (AttributeError, IndexError, TypeError):
            return self._fail(OUTCOME_UNKNOWN, "response has no message.content", _ms(t0))
        if not isinstance(content, str) or not content:
            return self._fail(OUTCOME_UNKNOWN, "empty content in response", _ms(t0))

        usage = None
        try:
            u = resp.usage
            if u is not None:
                usage = AiUsage(
                    input_tokens=getattr(u, "prompt_tokens", None),
                    output_tokens=getattr(u, "completion_tokens", None),
                    total_tokens=getattr(u, "total_tokens", None),
                )
        except Exception:
            usage = None
        return self._ok(content, usage, _ms(t0))

    def _classify_exception(self, exc: BaseException, t0: float) -> AiCompletionResult:
        status = getattr(exc, "status_code", None) or getattr(exc, "http_status", None)
        msg = _extract_error_message(exc)
        name = type(exc).__name__
        if name in ("APITimeoutError", "TimeoutError") or "timeout" in name.lower() or isinstance(exc, asyncio.TimeoutError):
            return self._fail(OUTCOME_TIMEOUT, msg, _ms(t0), error_code=AiErrorCode.PROVIDER_UNAVAILABLE)
        if name == "APIConnectionError" or "connection" in name.lower():
            return self._fail(OUTCOME_CONNECTION_ERROR, msg, _ms(t0), error_code=AiErrorCode.PROVIDER_UNAVAILABLE)
        if isinstance(status, int):
            if 200 <= status < 300:
                return self._fail(OUTCOME_UNKNOWN, msg, _ms(t0))
            if 400 <= status < 500:
                code = _pick_4xx_code(status, msg)
                outcome = OUTCOME_HTTP_5XX if status == 429 else OUTCOME_HTTP_4XX
                return self._fail(outcome, msg, _ms(t0), error_code=code)
            return self._fail(OUTCOME_HTTP_5XX, msg, _ms(t0), error_code=AiErrorCode.PROVIDER_UNAVAILABLE)
        # Status-less client-side SDK errors: guess from the type name.
        if name in ("AuthenticationError", "PermissionDeniedError"):
            return self._fail(OUTCOME_HTTP_4XX, msg, _ms(t0), error_code=AiErrorCode.INVALID_KEY)
        if name in ("BadRequestError", "NotFoundError"):
            code = AiErrorCode.MODEL_UNAVAILABLE if "NotFoundError" in name else AiErrorCode.REQUEST_FAILED
            return self._fail(OUTCOME_HTTP_4XX, msg, _ms(t0), error_code=code)
        if name in ("RateLimitError",):
            return self._fail(OUTCOME_HTTP_5XX, msg, _ms(t0), error_code=_classify_rate_limit(msg) or AiErrorCode.RATE_LIMIT)
        if name in ("InternalServerError", "APIError"):
            return self._fail(OUTCOME_HTTP_5XX, msg, _ms(t0), error_code=AiErrorCode.PROVIDER_UNAVAILABLE)
        return self._fail(OUTCOME_UNKNOWN, msg, _ms(t0))


class GroqProvider(_OpenAiCompatProvider):
    provider_type = GROQ
    _sdk_module = "groq"
    _async_client_class = "AsyncGroq"


class OpenAIProvider(_OpenAiCompatProvider):
    provider_type = OPENAI
    _sdk_module = "openai"


# Anthropic

class AnthropicProvider(BaseAiProvider):
    provider_type = ANTHROPIC

    def _client(self):
        try:
            mod = __import__("anthropic", fromlist=["AsyncAnthropic"])
            cls = getattr(mod, "AsyncAnthropic")
        except ImportError as exc:
            raise RuntimeError(f"SDK for anthropic not installed: {exc}") from exc
        kwargs: dict[str, Any] = {"api_key": self.config.api_key}
        if self.config.endpoint:
            kwargs["base_url"] = self.config.endpoint
        return cls(**kwargs)

    async def complete(
        self,
        prompt: str,
        *,
        system: Optional[str] = None,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
        json_mode: bool = False,
    ) -> AiCompletionResult:
        t0 = time.time()
        timeout = self._timeout_s(60.0)
        client = self._client()
        messages: list[dict[str, Any]] = [{"role": "user", "content": prompt}]
        if json_mode:
            messages.append({"role": "assistant", "content": "{"})
        kwargs: dict[str, Any] = {
            "model": self.config.model,
            "messages": messages,
            "max_tokens": max_tokens or self.config.max_tokens or 4096,
            "temperature": temperature if temperature is not None else (self.config.temperature or 0.1),
            "timeout": timeout,
        }
        if system:
            kwargs["system"] = system
        try:
            resp = await client.messages.create(**kwargs)
        except Exception as exc:
            return self._classify_exception(exc, t0)
        finally:
            try:
                if hasattr(client, "close") and asyncio.iscoroutinefunction(client.close):
                    await client.close()
            except Exception:
                pass

        content = ""
        try:
            for block in resp.content or []:
                if getattr(block, "type", "") in ("text", None):
                    content += getattr(block, "text", "") or ""
        except Exception:
            content = ""
        content = content.strip()

        # With the assistant prefill we receive the model continuation
        # (which does not include the leading "{" we pre-filled); restore it
        # so the shared parser sees a complete JSON object.
        if json_mode and content and not content.startswith("{"):
            content = "{" + content
        if not content:
            return self._fail(OUTCOME_UNKNOWN, "empty content in response", _ms(t0))

        usage = None
        try:
            u = getattr(resp, "usage", None)
            if u is not None:
                usage = AiUsage(
                    input_tokens=getattr(u, "input_tokens", None),
                    output_tokens=getattr(u, "output_tokens", None),
                    total_tokens=((getattr(u, "input_tokens", 0) or 0) + (getattr(u, "output_tokens", 0) or 0) or None),
                )
        except Exception:
            usage = None
        return self._ok(content, usage, _ms(t0))

    def _classify_exception(self, exc: BaseException, t0: float) -> AiCompletionResult:
        status = getattr(exc, "status_code", None)
        msg = _extract_error_message(exc)
        name = type(exc).__name__
        if name in ("APITimeoutError", "TimeoutError", "APIConnectionTimeoutError") or isinstance(exc, asyncio.TimeoutError):
            return self._fail(OUTCOME_TIMEOUT, msg, _ms(t0), error_code=AiErrorCode.PROVIDER_UNAVAILABLE)
        if name in ("APIConnectionError",):
            return self._fail(OUTCOME_CONNECTION_ERROR, msg, _ms(t0), error_code=AiErrorCode.PROVIDER_UNAVAILABLE)
        if isinstance(status, int):
            if 400 <= status < 500:
                code = _pick_4xx_code(status, msg)
                outcome = OUTCOME_HTTP_5XX if status == 429 else OUTCOME_HTTP_4XX
                return self._fail(outcome, msg, _ms(t0), error_code=code)
            if status >= 500:
                return self._fail(OUTCOME_HTTP_5XX, msg, _ms(t0), error_code=AiErrorCode.PROVIDER_UNAVAILABLE)
        if "authentication" in name.lower() or "permission" in name.lower():
            return self._fail(OUTCOME_HTTP_4XX, msg, _ms(t0), error_code=AiErrorCode.INVALID_KEY)
        if "rate" in name.lower():
            return self._fail(OUTCOME_HTTP_5XX, msg, _ms(t0), error_code=_classify_rate_limit(msg) or AiErrorCode.RATE_LIMIT)
        if "notfound" in name.lower() or "not_found" in name.lower():
            return self._fail(OUTCOME_HTTP_4XX, msg, _ms(t0), error_code=AiErrorCode.MODEL_UNAVAILABLE)
        return self._fail(OUTCOME_UNKNOWN, msg, _ms(t0))


def _ms(t0: float) -> int:
    return int((time.time() - t0) * 1000)


PROVIDER_CLASSES: dict[str, type] = {
    GROQ: GroqProvider,
    OPENAI: OpenAIProvider,
    ANTHROPIC: AnthropicProvider,
}


def get_provider(config: AiProviderConfig) -> BaseAiProvider:
    """Return the provider implementation for a resolved config."""
    ptype = normalize_provider_type(config.provider_type)
    cls = PROVIDER_CLASSES.get(ptype)
    if cls is None:
        raise ValueError(f"Unsupported provider: {config.provider_type}")
    return cls(config)


# Shared retry wrapper that any caller (enrichment, vision, product research)
# can use for the same transient-failure retry semantics.

DEFAULT_MAX_RETRIES = 3
DEFAULT_MIN_WAIT_S = 1.0
DEFAULT_MAX_WAIT_S = 90.0
RETRY_BUFFER_FACTOR = 1.2

_RETRY_HINT_RE = __import__("re").compile(r"Please try again in\s+([\d.]+)\s*s")


def parse_retry_after_seconds(error_message: Optional[str]) -> Optional[float]:
    """Extract a rate-limit wait hint from a provider error message."""
    if not error_message:
        return None
    try:
        return float(_RETRY_HINT_RE.search(error_message).group(1))
    except (AttributeError, ValueError, IndexError):
        return None


async def complete_with_retry(
    provider: BaseAiProvider,
    prompt: str,
    *args,
    max_retries: int = DEFAULT_MAX_RETRIES,
    **kwargs,
) -> AiCompletionResult:
    """Run ``provider.complete`` with rate-limit/5xx/timeout retries.

    Returns the first non-transient result, or the last failure after
    all retries are exhausted.  The returned result carries the final
    attempt so callers can surface ``retry_count`` to the UI.
    """
    import asyncio as _asyncio

    result = await provider.complete(prompt, *args, **kwargs)
    attempt = 0
    while result.outcome_status in (OUTCOME_HTTP_5XX, OUTCOME_TIMEOUT, OUTCOME_CONNECTION_ERROR) and attempt < max_retries:
        hint = parse_retry_after_seconds(result.error_message or "")
        wait = min(max(hint * RETRY_BUFFER_FACTOR, DEFAULT_MIN_WAIT_S), DEFAULT_MAX_WAIT_S) if hint else DEFAULT_MIN_WAIT_S
        logger.warning("Provider %s transient failure (%s), retrying in %.1fs: %s",
                       provider.provider_type, result.outcome_status, wait,
                       (result.error_message or "")[:200])
        await _asyncio.sleep(wait)
        result = await provider.complete(prompt, *args, **kwargs)
        attempt += 1
    result.retry_count = attempt
    return result
