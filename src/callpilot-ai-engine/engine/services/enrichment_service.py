"""Async LLM enrichment for brochure pages.

Sits between Docling extraction and the embedding/GLiNER pass.  Brochure copy
is semantically thin ("enterprise-grade security", "blazing fast performance")
and RAG cannot work with it.  This service hands each page to Groq's
chat-completions API (openai/gpt-oss-20b by default) with
``response_format={"type": "json_object"}`` so we always get valid JSON back,
and asks the model to extract structured product intelligence cards.  The
.NET handler replaces the thin Docling chunks with rich product-card chunks
before embedding.

Why Groq, not local Ollama: a 1.5B–3B local model on a 16 GB-class dev box
takes 3–15 s per page, which is fine for one page but stacks into 10+ min
for a 20-page brochure.  Groq's free tier responds in ~1 s and returns
structured JSON reliably, so the same job finishes in a few seconds.

Fail-open design
────────────────
* If Groq is unreachable, returns garbage, or the API key is missing, this
  function returns ``[]`` and the caller keeps the original Docling chunks.
  The upload pipeline must NEVER block on a missing LLM.
* Per-page timeout: 30 s via :func:`asyncio.wait_for` (Groq is fast, 30 s is
  generous; the Groq client's own timeout is also 30 s).  No retries -
  failed pages are simply unenriched.  The whole job is wrapped in
  try/except so nothing escapes back to the .NET caller; the document
  keeps the original Docling chunks and the .NET side sets
  ``enrichment_failed``.
* Pages are processed concurrently - up to 3 in flight at any moment
  (``asyncio.gather`` + ``Semaphore(3)``) - so a 20-page document finishes
  in roughly a third of the wall time of a sequential loop, while
  bounding load on Groq's rate limiter.
* JSON parse failures: log a warning, return ``[]``.  In practice
  ``response_format={"type": "json_object"}`` makes this unreachable for
  well-formed responses; the parser is kept as a defensive layer.

The dataclass shape mirrors the prompt schema exactly so the .NET side can
``JsonSerializer.Deserialize<EnrichedProduct>(raw)`` straight from the prompt
output.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from dataclasses import dataclass, field, asdict
from typing import Any, List, Optional

logger = logging.getLogger(__name__)


# ── Configuration ──────────────────────────────────────────────────────────
# Read at module load so tests can monkeypatch via env.  Not from a config
# module - keeping this self-contained so the service can be tested in
# isolation.


class _MissingGroqKey(RuntimeError):
    """Raised when GROQ_API_KEY is not set in the environment.

    Treated as a recoverable error by the fail-open wrapper in
    :func:`enrich_page` - the page just gets an empty enrichment result
    and the .NET side sets ``enrichment_failed``.  Surfaced as a distinct
    type so the warning log makes the root cause obvious.
    """


def _get_groq_api_key() -> str:
    # No default - a missing key is a deployment misconfiguration.  We
    # raise a typed exception so the caller's fail-open wrapper can log
    # "GROQ_API_KEY missing" specifically instead of a generic
    # AuthenticationError, and so test setups that forget to set the
    # env var get a clear failure.
    key = os.getenv("GROQ_API_KEY")
    if not key:
        raise _MissingGroqKey(
            "GROQ_API_KEY is not set - get a free key at console.groq.com "
            "(no credit card required) and set it in the environment."
        )
    return key


def _get_model() -> str:
    # openai/gpt-oss-20b is the recommended default (llama-3.1-8b-instant
    # / llama-3.3-70b-versatile were deprecated - shutdown 2026).  It is
    # deterministic on the free tier; groq/compound-mini has a higher TPM
    # but currently routes to the retiring llama-3.3-70b-versatile backend,
    # which returns persistent 429s.  Override via ENRICHMENT_MODEL.
    return os.getenv("ENRICHMENT_MODEL", "openai/gpt-oss-20b")


# Explicit completion budget for the Groq call.  Groq's default max_tokens
# is far too small for a dense brochure page: the 13-field product schema
# plus the entity list routinely needs 3-8k tokens, and an over-budget
# completion gets truncated and rejected with HTTP 400 "json_validate_failed"
# (16/19 pages of secure.pdf failed this way with the default).  Override
# via ENRICHMENT_MAX_TOKENS.
GROQ_MAX_TOKENS = int(os.getenv("ENRICHMENT_MAX_TOKENS", "4608"))


# ── Data shape ─────────────────────────────────────────────────────────────

#: Allowed values for ``EnrichedProduct.page_type``.  The LLM is told to pick
#: one of these; anything else falls back to "other" on the client side.
PAGE_TYPES = (
    "product_listing",
    "comparison",
    "overview",
    "pricing",
    "contact",
    "other",
)


@dataclass
class _GroqResult:
    """Internal transport for the Groq call outcome.

    Carries the response content (if any) plus a classified status string
    so the dashboard can distinguish "no products found" (LLM was fine,
    just nothing to extract) from "enrichment failed" (LLM/auth/network
    problem).  ``error_message`` is the first 500 chars of the underlying
    exception text - useful for surfacing "Invalid API Key" in the UI
    without flooding logs.
    """
    content: Optional[str]
    outcome_status: str  # "ok" | "missing_key" | "http_4xx" | "http_5xx" | "timeout" | "connection_error" | "unknown"
    error_message: Optional[str] = None
    duration_ms: int = 0
    # How many retries this call needed (0 = succeeded or failed on
    # the first try, 1 = one retry, etc.).  Surfaced to the dashboard
    # so the user can see "this page needed a retry" without having
    # to read the server log.
    retry_count: int = 0


@dataclass
class EnrichedProduct:
    """A single structured product card extracted from a brochure page."""
    name: str
    category: Optional[str] = None
    headline: Optional[str] = None
    key_features: List[str] = field(default_factory=list)
    pricing: Optional[str] = None
    best_for: Optional[str] = None
    differentiators: List[str] = field(default_factory=list)
    raw_claims: List[str] = field(default_factory=list)
    page_type: str = "other"
    # ── Merged entity classification (previously a separate /internal/product-identify pass) ──
    entity_type: str = "product"
    confidence: float = 0.0
    aliases: List[str] = field(default_factory=list)
    evidence: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        # Pre-render the chunk text so the .NET handler can persist it
        # verbatim.  Keeps the format definition in one place (here) and
        # matches the Docling pattern where the Python service produces the
        # chunk text.
        d["chunk_text"] = self.to_chunk_text()
        return d

    def to_chunk_text(self) -> str:
        """Render this product card as a single rich text string for embedding.

        Format is stable - tests assert on it, and the .NET handler copies it
        verbatim into ``KnowledgeChunk.Text``.
        """
        def _join_or_none(label: str, items: List[str]) -> str:
            cleaned = [s.strip() for s in (items or []) if s and s.strip()]
            return f"{label}: {', '.join(cleaned)}." if cleaned else ""

        # "<name>. <headline>. Category: X. ..."  - the period after name
        # matters: it separates the entity from its tagline for the
        # embedding model and keeps retrieval-readable.
        parts: list[str] = [f"{self.name}."]
        if self.headline:
            parts.append(f"{self.headline}.")
        if self.category:
            parts.append(f"Category: {self.category}.")
        feat = _join_or_none("Key features", self.key_features)
        if feat:
            parts.append(feat)
        if self.pricing:
            parts.append(f"Pricing: {self.pricing}.")
        if self.best_for:
            parts.append(f"Best for: {self.best_for}.")
        diff = _join_or_none("Differentiators", self.differentiators)
        if diff:
            parts.append(diff)
        claims = _join_or_none("Claims", self.raw_claims)
        if claims:
            parts.append(claims)
        return " ".join(parts).strip()


@dataclass
class EnrichedEntity:
    """A non-product entity the merged LLM pass classified.

    Products live in :class:`EnrichedProduct` (with the same classification
    fields); this carries everything else the trie can use
    (integrations, features, pricing tiers, components, ...).
    """
    canonical: str
    aliases: List[str] = field(default_factory=list)
    entity_type: str = "other"
    confidence: float = 0.0
    evidence: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# ── Prompt ─────────────────────────────────────────────────────────────────

# Confidence thresholds for automatic product enrichment (precision > recall):
#   >= 0.7  → confident PRODUCT, auto-enrich at ingest
#   0.4-0.69 → possible PRODUCT, stored but NOT auto-enriched (user can Start)
#   < 0.4   → treated as non-product for Product Intelligence
AUTO_ENRICH_CONFIDENCE = 0.7
PRODUCT_CONFIDENCE_FLOOR = 0.4

_VALID_ENTITY_TYPES = {
    "product", "product_category", "feature", "component", "accessory",
    "application", "technical_specification", "other",
}

# Terms that routinely appear in product documentation but are NOT products.
# The LLM does the real filtering; this is a hard backstop so generic
# metering vocabulary never becomes a "product".
_GENERIC_TERMS = {
    "ami", "dlms", "dlms cosem", "cosem", "accuracy", "smart metering", "smart meter",
    "three phase", "three-phase", "three phase meter", "single phase", "single-phase",
    "communication", "meter", "electricity meter", "energy meter", "metering",
    "metering solution", "metering solutions", "technology", "solution", "solutions",
    "gprs", "gsm", "rf", "zigbee", "wifi", "bluetooth", "ct", "current transformer",
    "sensor", "sensors", "software", "app", "platform", "system", "product", "products",
    "feature", "features", "module", "modules", "communications module", "communication module",
    "connection", "connectivity", "reading", "billing", "tariff", "tariffs", "metering",
    "load", "supply", "voltage", "current", "power", "energy", "consumption",
}


def _is_generic(canonical: str) -> bool:
    c = canonical.strip().lower()
    if not c or len(c) < 3:
        return True
    if c in _GENERIC_TERMS:
        return True
    if len(c.split()) == 1 and len(c) <= 4:
        return True  # "meter", "lib", "api" style single short tokens
    return False


def _clamp_confidence(value: Any) -> float:
    try:
        c = float(value)
        return round(min(max(c, 0.0), 1.0), 2)
    except (TypeError, ValueError):
        return 0.0


def _normalize_entity_type(raw: Any) -> str:
    t = str(raw or "product").strip().lower()
    return t if t in _VALID_ENTITY_TYPES else "other"


_PROMPT_TEMPLATE = """You are a product intelligence extractor. Given text from a product brochure page, extract all products and their details, and classify EVERY notable entity on the page.

Return ONLY valid JSON. No preamble, no explanation, no markdown backticks.

Schema:
{{
  "products": [
    {{
      "name": string,
      "category": string or null,
      "headline": string or null,
      "key_features": [string],
      "pricing": string or null,
      "best_for": string or null,
      "differentiators": [string],
      "raw_claims": [string],
      "entityType": "product",
      "confidence": number (0.0-1.0, how confident you are it is a genuine named product),
      "aliases": [string],
      "evidence": string (short verbatim quote supporting the classification)
    }}
  ],
  "entities": [
    {{
      "canonical": string,
      "aliases": [string],
      "entityType": "product_category | feature | component | accessory | application | technical_specification | other",
      "confidence": number (0.0-1.0),
      "evidence": string
    }}
  ],
  "page_type": "product_listing | comparison | overview | pricing | contact | other"
}}

RULES:
- PRODUCT rules: only classify as a product if the page clearly presents it as a named, sellable offering of the company - not a component, feature, capability, industry, application, spec, or generic category. Be conservative.
- "Prodigy", "PRODIGY" and "Prodigy meter" are the SAME product - keep one canonical name in "name" and collect alternate spellings as "aliases".
- "canonical"/"name" is the clean primary name, title-cased, WITHOUT generic trailing words when the document brands it shorter (e.g. "Sprint 210" not "Sprint 210 modular meter").
- "entities" must include every notable NON-product entity (features like "DLMS support", components, accessories, applications, technical specs) so nothing is lost.
- "evidence" is a short verbatim quote from the text that supports the classification.

If no products found return: {{"products": [], "entities": [], "page_type": "other"}}

Page text:
{page_text}
"""


def _build_prompt(page_text: str) -> str:
    return _PROMPT_TEMPLATE.format(page_text=page_text)


# ── JSON extraction & parsing ──────────────────────────────────────────────

# Groq is called with response_format={"type": "json_object"} so the model
# is forced to return a single JSON object - no markdown fences, no
# preamble.  We still keep the defensive parser below in case the API
# contract changes or a future model misbehaves; the call to
# json.loads() should never fail in normal operation.


# Regex matches a leading markdown code fence with optional language tag
# (```json, ```JSON, ```) and the matching trailing ``` line.  Anything
# between the fences is preserved verbatim.  If a stray ``` appears
# inside the JSON body the regex will not match, which is the right
# outcome - json.loads will then fail and the caller can surface a
# parse_error in the UI.
_FENCE_RE = re.compile(
    r"^\s*```(?:json|JSON)?\s*\n?(.*?)\n?\s*```\s*$",
    re.DOTALL,
)


def _strip_markdown_fences(raw: str) -> str:
    """Return ``raw`` with a single outer markdown code fence removed.

    Returns the original string unchanged if no fence is present, or if
    the input is empty.  This is a defensive layer - Groq's
    ``response_format=json_object`` should never return fenced JSON, but
    a future model or a non-Groq fallback might.
    """
    if not raw:
        return raw
    m = _FENCE_RE.match(raw)
    return m.group(1) if m else raw


def _parse_enrichment_response(raw: str) -> list[EnrichedProduct]:
    """Parse the LLM response into a list of EnrichedProduct.

    Returns ``[]`` on any failure.  The caller logs the warning so the
    pipeline can keep going.
    """
    if not raw:
        return []

    stripped = _strip_markdown_fences(raw)
    try:
        data = json.loads(stripped)
    except json.JSONDecodeError as exc:
        logger.warning("Enrichment JSON parse failed: %s; head=%r", exc, raw[:120])
        return []

    if not isinstance(data, dict):
        logger.warning("Enrichment response is not an object: %r", type(data).__name__)
        return []

    # Pick out the page_type once at the top level - it's stamped on every
    # product in the return value so the caller can filter by it.
    raw_page_type = data.get("page_type", "other")
    page_type = raw_page_type if raw_page_type in PAGE_TYPES else "other"

    products = data.get("products") or []
    if not isinstance(products, list):
        return []

    out: list[EnrichedProduct] = []
    for item in products:
        if not isinstance(item, dict):
            continue
        name = (item.get("name") or "").strip()
        if not name:
            continue  # skip nameless entries - the LLM occasionally emits
                      # stray "no name" rows
        entity_type = _normalize_entity_type(item.get("entityType") or item.get("entity_type") or "product")
        confidence = _clamp_confidence(item.get("confidence"))
        # Hard backstop: generic metering vocabulary is never a product.
        if entity_type == "product" and _is_generic(name):
            entity_type = "other"
            confidence = min(confidence, 0.3)
        out.append(EnrichedProduct(
            name=name,
            category=(item.get("category") or None) or None,
            headline=(item.get("headline") or None) or None,
            key_features=_as_str_list(item.get("key_features")),
            pricing=(item.get("pricing") or None) or None,
            best_for=(item.get("best_for") or None) or None,
            differentiators=_as_str_list(item.get("differentiators")),
            raw_claims=_as_str_list(item.get("raw_claims")),
            page_type=page_type,
            entity_type=entity_type,
            confidence=confidence,
            aliases=_as_str_list(item.get("aliases")),
            evidence=(item.get("evidence") or None),
        ))
    return out


def _parse_entities(raw: str) -> list[EnrichedEntity]:
    """Parse the ``entities[]`` array of a merged enrichment response.

    Returns ``[]`` on any failure (missing field, malformed JSON, wrong
    shape).  The caller keeps going - entities are best-effort.
    """
    if not raw:
        return []

    stripped = _strip_markdown_fences(raw)
    try:
        data = json.loads(stripped)
    except json.JSONDecodeError:
        return []

    if not isinstance(data, dict):
        return []

    entities = data.get("entities") or []
    if not isinstance(entities, list):
        return []

    out: list[EnrichedEntity] = []
    for item in entities:
        if not isinstance(item, dict):
            continue
        canonical = (item.get("canonical") or item.get("name") or "").strip()
        if not canonical:
            continue
        entity_type = _normalize_entity_type(item.get("entityType") or item.get("entity_type") or "other")
        confidence = _clamp_confidence(item.get("confidence"))
        if entity_type == "product" and _is_generic(canonical):
            entity_type = "other"
            confidence = min(confidence, 0.3)
        out.append(EnrichedEntity(
            canonical=canonical,
            aliases=_as_str_list(item.get("aliases")),
            entity_type=entity_type,
            confidence=confidence,
            evidence=(item.get("evidence") or None),
        ))
    return out


def _as_str_list(value: Any) -> List[str]:
    """Coerce a JSON value into a list of strings.

    The LLM occasionally returns a single string instead of a one-element
    list.  Anything falsy → empty list.  Other types are stringified.
    """
    if value is None or value == "":
        return []
    if isinstance(value, list):
        return [str(x) for x in value if x]
    return [str(value)]


# ── Groq call ──────────────────────────────────────────────────────────────

# Use a shared AsyncGroq client so connection pooling works across pages of
# the same document.  Lazy-instantiated so the module can be imported
# without GROQ_API_KEY being set (the key is read at first call, not at
# import time - lets the FastAPI app boot in environments where the
# enrichment endpoint is disabled).
_groq_client: Any = None


def _get_groq_client() -> Any:
    global _groq_client
    if _groq_client is None:
        from groq import AsyncGroq
        _groq_client = AsyncGroq(api_key=_get_groq_api_key())
    return _groq_client


async def aclose() -> None:
    """Close the shared Groq client.  Call from FastAPI shutdown."""
    global _groq_client
    if _groq_client is not None:
        # AsyncGroq exposes an aclose() on its underlying httpx transport;
        # the wrapper doesn't guarantee a public aclose, so guard with
        # hasattr in case a future SDK version removes it.
        if hasattr(_groq_client, "aclose"):
            await _groq_client.aclose()
        _groq_client = None


async def _call_groq(prompt: str) -> "_GroqResult":
    """Call Groq's chat.completions API.  Returns a :class:`_GroqResult` with
    the response content and an outcome status so the caller can surface a
    useful error in the dashboard instead of silently dropping it.

    Outcome status values:
        ``ok``               - 2xx with parseable content
        ``missing_key``      - GROQ_API_KEY not set in the environment
        ``http_4xx``         - Groq returned 400/401/403/404 (bad model, bad key, etc.)
        ``http_5xx``         - Groq returned 5xx (their outage)
        ``timeout``          - asyncio.TimeoutError or client timeout
        ``connection_error`` - APIConnectionError / DNS / refused
        ``unknown``          - any other exception

    Per spec: NO retries.  One shot per page.  ``response_format=json_object``
    forces the model to return a single JSON object, so we don't need to
    strip markdown fences.
    """
    t0 = time.time()
    try:
        client = _get_groq_client()
    except _MissingGroqKey as exc:
        logger.warning("Groq enrichment: %s", exc)
        return _GroqResult(content=None, outcome_status="missing_key", error_message=str(exc), duration_ms=_elapsed_ms(t0))
    except Exception as exc:  # noqa: BLE001 - fail-open
        logger.warning("Groq client init failed: %s", exc)
        return _GroqResult(content=None, outcome_status="unknown", error_message=str(exc), duration_ms=_elapsed_ms(t0))

    try:
        response = await client.chat.completions.create(
            model=_get_model(),
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            response_format={"type": "json_object"},
            max_tokens=GROQ_MAX_TOKENS,
            timeout=60,
        )
    except Exception as exc:  # noqa: BLE001 - fail-open
        # Covers the full Groq exception hierarchy (APIError, APIConnectionError,
        # RateLimitError, APITimeoutError, BadRequestError on bad model name,
        # etc.) plus any unexpected transport error.  All are fail-open:
        # the page keeps its original Docling chunks.
        status = _classify_groq_exception(exc)
        logger.warning("Groq enrichment failed [%s]: %s", status, exc)
        return _GroqResult(content=None, outcome_status=status, error_message=str(exc), duration_ms=_elapsed_ms(t0))

    try:
        content = response.choices[0].message.content
    except (AttributeError, IndexError, TypeError):
        logger.warning("Groq enrichment: response has no message.content")
        return _GroqResult(content=None, outcome_status="unknown", error_message="response has no message.content", duration_ms=_elapsed_ms(t0))

    if not isinstance(content, str) or not content:
        logger.warning("Groq enrichment: empty content in response")
        return _GroqResult(content=None, outcome_status="unknown", error_message="empty content in response", duration_ms=_elapsed_ms(t0))

    return _GroqResult(content=content, outcome_status="ok", duration_ms=_elapsed_ms(t0))


def _classify_groq_exception(exc: BaseException) -> str:
    """Map a Groq exception to one of our outcome-status strings."""
    name = type(exc).__name__
    # Inspect the groq SDK exception hierarchy without hard-importing it
    # (lets unit tests pass without the SDK installed).  Names are stable
    # across groq-sdk >= 0.5.
    if name in ("APITimeoutError", "TimeoutError"):
        return "timeout"
    if name == "APIConnectionError":
        return "connection_error"
    if name in ("AuthenticationError", "PermissionDeniedError"):
        return "http_4xx"  # 401/403 - surfaces as "auth failed" in the UI
    if name in ("BadRequestError", "NotFoundError"):
        return "http_4xx"  # 400/404 - bad model name, malformed request
    if name in ("RateLimitError", "InternalServerError", "APIError"):
        # RateLimitError is 429; InternalServerError/APIError is 5xx-ish
        return "http_5xx" if name != "RateLimitError" else "http_5xx"
    if name == "asyncio.TimeoutError" or "TimeoutError" in name:
        return "timeout"
    return "unknown"


def _elapsed_ms(t0: float) -> int:
    return int((time.time() - t0) * 1000)


# How many times to retry a single page on a rate-limit (429 / token
# quota) failure.  After this many attempts we give up and return the
# last failure to the caller as the page's outcome.  3 retries is enough
# to absorb a normal Groq free-tier burst on a 20-page document.
MAX_RATE_LIMIT_RETRIES = 3

# How long to wait AFTER the "Please try again in Xs" hint before
# retrying, as a fraction of the hint.  1.2x = wait 20% longer than
# the server asked for, to avoid the same request arriving at the
# next rate-limit window boundary.
RETRY_BUFFER_FACTOR = 1.2

# Hard floor / ceiling for the wait so a bad hint doesn't make us
# sleep forever or retry instantly.
MIN_RETRY_WAIT_S = 1.0
MAX_RETRY_WAIT_S = 90.0


def _parse_retry_after_seconds(error_message: str) -> float | None:
    """Extract the wait hint from a Groq rate-limit error message.

    Groq's 429 body looks like::

        Error code: 429 - {'error': {'message': 'Rate limit reached for
        model `llama-3.1-8b-instant` in organization `org_xxx` service
        tier `on_demand` on tokens per minute (TPM): Limit 6000, Used
        5909, Requested 655. Please try again in 5.64s. ...', ...}}

    Returns the number of seconds the server asks us to wait, or
    ``None`` if the hint isn't found in the message.
    """
    if not error_message:
        return None
    m = re.search(r"Please try again in\s+([\d.]+)\s*s", error_message)
    if not m:
        return None
    try:
        return float(m.group(1))
    except (ValueError, IndexError):
        return None


def _is_retryable_failure(result: _GroqResult) -> bool:
    """Whether a Groq failure is worth retrying.

    Two failure families qualify:

    * Rate limits (429 / token quota): classified http_5xx with a
      "Please try again in Xs" hint - waiting helps.
    * json_validate_failed (HTTP 400, http_4xx): Groq's JSON-mode
      validation is flaky - the model sometimes emits a completion
      that fails validation even though the same page passes on a
      fresh attempt (observed on gpt-oss-20b; the error body carries
      an empty failed_generation).  A short pause and a retry usually
      succeeds.

    Everything else (auth, bad model) is returned immediately -
    retrying won't fix it.
    """
    if result.outcome_status == "http_5xx":
        # Rate limits (429 / token quota) and 5xx.  Calling the compound
        # router, 429s can come back WITHOUT a "Please try again" hint
        # (a routed backend's own quota exhausted) - still retry, the
        # baseline wait in _call_groq_with_retry paces us.
        return True
    if result.outcome_status in ("timeout", "connection_error"):
        # The compound router can take a while under load; a second
        # attempt usually lands on a faster route.
        return True
    if result.outcome_status == "http_4xx" and "json_validate_failed" in result.error_message:
        return True
    return False


async def _call_groq_with_retry(prompt: str) -> _GroqResult:
    """Wrap :func:`_call_groq` with retry for transient failures.

    Retries rate limits (429 / token quota) waiting the server's
    "Please try again in Xs" hint (+20% buffer, capped at
    MAX_RETRY_WAIT_S) and json_validate_failed validation flakes
    after a short pause, up to MAX_RATE_LIMIT_RETRIES times each.
    Other failure modes (auth, timeout, connection) are returned
    immediately without retry - they won't be fixed by waiting.

    Surfaces retry_count on the result so the dashboard can show
    the user which pages needed retries and how many.
    """
    result = await _call_groq(prompt)
    if not _is_retryable_failure(result):
        return result

    for attempt in range(1, MAX_RATE_LIMIT_RETRIES + 1):
        hint_s = _parse_retry_after_seconds(result.error_message or "")
        if hint_s is not None:
            wait_s = max(MIN_RETRY_WAIT_S, min(hint_s * RETRY_BUFFER_FACTOR, MAX_RETRY_WAIT_S))
        elif "json_validate_failed" in (result.error_message or ""):
            wait_s = 2.0  # validation flake: brief pause, no server hint
        elif result.outcome_status in ("timeout", "connection_error"):
            wait_s = 1.0  # transport blip: retry quickly
        else:
            wait_s = 5.0  # 429/5xx without a hint (compound router backend)
        logger.warning(
            "Groq %s on attempt %d, waiting %.1fs before retry: %s",
            result.outcome_status, attempt, wait_s, result.error_message[:200],
        )
        await asyncio.sleep(wait_s)
        result = await _call_groq(prompt)
        result.retry_count = attempt
        if not _is_retryable_failure(result):
            return result
    # All retries exhausted.  Return the last failure (with
    # retry_count populated) so the dashboard can show
    # "tried 3 times, still failing".
    return result


# ── Public API ─────────────────────────────────────────────────────────────

@dataclass
class _PageResult:
    """Internal transport from :func:`enrich_page` to :func:`enrich_pages`.

    Carries the parsed products + entities (possibly empty) plus the
    outcome metadata so the bulk helper can attach it to each per-page
    response without re-running the call.
    """
    products: list[EnrichedProduct]
    entities: list[EnrichedEntity] = field(default_factory=list)
    outcome: dict = field(default_factory=dict)


async def enrich_page(page_text: str) -> _PageResult:
    """Run the enrichment LLM pass on a single page of brochure text.

    Returns a :class:`_PageResult` with the parsed products (possibly empty)
    and an outcome dict the caller can attach to the per-page response so
    the dashboard can distinguish "no products found" (LLM was fine) from
    "enrichment failed" (auth / network / parse error).

    The merged pass also returns classified non-product entities
    (features, components, applications, ...) which the .NET handler
    persists as DocumentEntity rows for the live-call trie.

    Fail-open: every failure path returns an empty products list with a
    classified outcome status.  The caller keeps the original Docling
    chunks and the pipeline continues.

    Per spec: 30 s timeout, no retries.  The authoritative per-page cap is
    enforced at the ``enrich_pages`` level via :func:`asyncio.wait_for`;
    the Groq client's own 30 s timeout here is a redundant safety net.
    """
    if not page_text or not page_text.strip():
        return _PageResult(
            products=[],
            outcome={"status": "no_products", "model": _get_model(), "duration_ms": 0,
                     "error": "page text was empty"},
        )

    prompt = _build_prompt(page_text.strip())
    try:
        groq_result = await _call_groq_with_retry(prompt)
    except Exception as exc:  # noqa: BLE001 - fail-open, last line of defence
        logger.warning("enrich_page: unexpected exception in _call_groq: %s", exc)
        return _PageResult(
            products=[],
            outcome={"status": "unknown", "model": _get_model(), "duration_ms": 0,
                     "error": str(exc), "retry_count": 0},
        )

    if groq_result.outcome_status != "ok" or not groq_result.content:
        # Transport / auth / parse failure - the LLM never gave us parseable JSON.
        # Map parse-error specifically.
        status = groq_result.outcome_status
        if status == "ok" and not groq_result.content:
            status = "parse_error"
        return _PageResult(
            products=[],
            outcome={
                "status": status,
                "model": _get_model(),
                "duration_ms": groq_result.duration_ms,
                "error": (groq_result.error_message or "")[:500] or None,
                "retry_count": groq_result.retry_count,
            },
        )

    # Distinguish "parse error" (LLM returned garbage) from "no products"
    # (LLM returned a valid {{products: []}} response).  ``_parse_enrichment_response``
    # is fail-open and returns [] for both, so we sniff the JSON shape
    # first to set the right outcome.
    try:
        data = json.loads(_strip_markdown_fences(groq_result.content))
    except (json.JSONDecodeError, TypeError) as exc:
        logger.warning("enrich_page: parse failure: %s; head=%r", exc, groq_result.content[:120])
        return _PageResult(
            products=[],
            outcome={"status": "parse_error", "model": _get_model(),
                     "duration_ms": groq_result.duration_ms,
                     "error": f"JSON decode failed: {exc}"[:500],
                     "retry_count": groq_result.retry_count},
        )

    if not isinstance(data, dict):
        return _PageResult(
            products=[],
            outcome={"status": "parse_error", "model": _get_model(),
                     "duration_ms": groq_result.duration_ms,
                     "error": f"response root is {type(data).__name__}, not object"[:500],
                     "retry_count": groq_result.retry_count},
        )

    try:
        products = _parse_enrichment_response(groq_result.content)
        entities = _parse_entities(groq_result.content)
    except Exception as exc:  # noqa: BLE001 - fail-open
        logger.warning("enrich_page: parse failure: %s", exc)
        return _PageResult(
            products=[],
            outcome={"status": "parse_error", "model": _get_model(),
                     "duration_ms": groq_result.duration_ms, "error": str(exc)[:500],
                     "retry_count": groq_result.retry_count},
        )

    if not products and not entities:
        # Valid JSON, valid schema, but LLM said no products on this page.
        return _PageResult(
            products=[],
            outcome={"status": "no_products", "model": _get_model(),
                     "duration_ms": groq_result.duration_ms, "error": None,
                     "retry_count": groq_result.retry_count},
        )

    return _PageResult(
        products=products,
        entities=entities,
        outcome={"status": "ok", "model": _get_model(),
                 "duration_ms": groq_result.duration_ms, "error": None,
                 "retry_count": groq_result.retry_count},
    )


# ── Bulk helper used by the /api/v1/documents/enrich endpoint ─────────────

# Per-page ceiling.  Kept in sync with the Groq client's own timeout
# (also 60s in ``_call_groq``) so asyncio.wait_for() is the authoritative
# cap.  The compound router can be slow under load; 60 s covers the
# slow route plus a retry without failing pages that are just slow.
PAGE_TIMEOUT_S: float = 60.0

# Concurrency cap.  Three in-flight Groq requests keeps us well under
# the free-tier rate limit (~30 req/min for llama-3.1-8b-instant) while
# cutting wall time roughly 3x vs. a sequential loop.  Bump to 5 on a
# paid key if needed.
#
# 2026-07-29: forced to 1 + deliberate per-page pacing. Real-world test on
# `1779097554_Secure_Product-Booklet_India.pdf` (18 pages) hit Groq's 6000
# TPM limit mid-document with PAGE_CONCURRENCY=3: 3 pages in flight at
# once means ~6-15s of overlap and token usage far above the free-tier
# budget. The user explicitly chose reliability over wall time - the
# product booklet took 18 * 5s = 90s wall time at PAGE_CONCURRENCY=1 +
# 5s pacing, vs ~30s when 3 pages raced and half of them 429'd.
PAGE_CONCURRENCY: int = 1

# Deliberate pause between page starts. 5s is the safe floor for Groq
# free-tier (6000 TPM, llama-3.1-8b-instant ~1k tokens per request =
# ~12 req/min, so 5s/start = 12 req/min which is right at the ceiling).
# Lifted by env var so operators on a paid key can drop it.
import os as _os
MIN_PAGE_INTERVAL_S: float = float(_os.getenv("ENRICHMENT_PAGE_INTERVAL_S", "5.0"))


async def enrich_pages(pages: list[dict]) -> list[dict]:
    """Enrich a batch of pages.  Each input dict: ``{"page": int, "text": str}``.

    Returns a list of dicts in the same shape as the input plus
    ``products`` (list of EnrichedProduct dicts), ``page_type``, and an
    ``outcome`` object with ``status`` (one of
    ``ok | no_products | missing_key | http_4xx | http_5xx | timeout |
    connection_error | parse_error | unknown``), ``model`` name,
    ``duration_ms``, and an optional ``error`` message.

    Pages where enrichment failed, timed out, or returned no products have
    ``products = []`` and ``page_type = "other"`` - the .NET handler treats
    this as "keep original Docling chunks for this page".

    Fire-and-forget semantics: the whole job is wrapped in try/except so
    *nothing* propagates back to the .NET caller.  On any failure (catastrophic
    exception, closed event loop, etc.) we return a clean empty result and
    let the .NET side set ``enrichment_failed`` and exit.
    """
    semaphore = asyncio.Semaphore(PAGE_CONCURRENCY)

    async def _enrich_one(p: dict) -> dict:
        page_no = p.get("page", 0)
        text = p.get("text", "")
        async with semaphore:
            # Pace consecutive page starts so the per-minute request
            # rate stays below Groq's free-tier ceiling. PAGE_CONCURRENCY=1
            # already serializes the work via the semaphore, but a 5s gap
            # between consecutive requests is what actually keeps us under
            # the 6000 TPM limit. The first page in the batch starts
            # immediately - the pacing matters for pages 2..N.
            if MIN_PAGE_INTERVAL_S > 0 and p.get("page", 0) > 1:
                await asyncio.sleep(MIN_PAGE_INTERVAL_S)
            try:
                result = await asyncio.wait_for(
                    enrich_page(text), timeout=PAGE_TIMEOUT_S
                )
                products = result.products
                entities = result.entities
                outcome = result.outcome
            except asyncio.TimeoutError:
                # Per-page cap hit - skip just this page, keep the original
                # Docling chunks for it, and let the rest of the document
                # finish.  A single slow page must never kill the job.
                logger.warning(
                    "enrich_page timed out after %.0fs on page %d - "
                    "keeping original Docling chunks",
                    PAGE_TIMEOUT_S, page_no,
                )
                products = []
                entities = []
                outcome = {"status": "timeout", "model": _get_model(),
                           "duration_ms": int(PAGE_TIMEOUT_S * 1000),
                           "error": f"per-page timeout of {PAGE_TIMEOUT_S:.0f}s exceeded"}
            except Exception as exc:  # noqa: BLE001 - fail-open
                logger.exception(
                    "enrich_page raised on page %d: %s - "
                    "keeping original Docling chunks",
                    page_no, exc,
                )
                products = []
                entities = []
                outcome = {"status": "unknown", "model": _get_model(),
                           "duration_ms": 0, "error": str(exc)[:500]}
            return {
                "page": page_no,
                "products": [prod.to_dict() for prod in products],
                "entities": [ent.to_dict() for ent in entities],
                "page_type": products[0].page_type if products else "other",
                "outcome": outcome,
            }

    try:
        # Run all pages through the semaphore with up to PAGE_CONCURRENCY
        # in flight.  return_exceptions=True so one bad task can't break the
        # gather - we still coerce any stray exception into an empty result
        # below, matching the per-page fail-open contract.
        tasks = [_enrich_one(p) for p in pages]
        results = await asyncio.gather(*tasks, return_exceptions=True)
    except Exception as exc:  # noqa: BLE001 - last-line-of-defence
        # gather(return_exceptions=True) shouldn't raise, but if anything
        # catastrophic happens (event loop closed, CancelledError bubbling
        # out, etc.) we still want to return a clean empty result so the
        # .NET side can set enrichment_failed and exit.
        logger.exception("enrich_pages catastrophic failure: %s", exc)
        return [
            {
                "page": p.get("page", 0),
                "products": [],
                "page_type": "other",
                "outcome": {"status": "unknown", "model": _get_model(),
                            "duration_ms": 0, "error": f"enrich_pages catastrophic failure: {exc}"},
            }
            for p in pages
        ]

    out: list[dict] = []
    for p, r in zip(pages, results):
        if isinstance(r, BaseException):
            logger.exception(
                "Unexpected exception for page %d: %s",
                p.get("page", 0), r,
            )
            out.append({
                "page": p.get("page", 0),
                "products": [],
                "page_type": "other",
                "outcome": {"status": "unknown", "model": _get_model(),
                            "duration_ms": 0, "error": str(r)[:500]},
            })
        else:
            out.append(r)
    return out


# ── Streaming variant ───────────────────────────────────────────────────

async def enrich_pages_streaming(pages: list[dict]):
    """Async generator: yield a per-page result dict as each page finishes.

    Same input shape as :func:`enrich_pages`, same per-page dict shape
    in the output (``page``, ``products``, ``page_type``, ``outcome``).
    Uses :func:`asyncio.as_completed` so the caller sees each page the
    instant its LLM call returns - the .NET handler writes it to the
    DB right away so the dashboard polls reflect progress.

    Fire-and-forget semantics match :func:`enrich_pages` - a
    catastrophic exception in the loop yields a single ``unknown``
    outcome per page rather than propagating up.
    """
    semaphore = asyncio.Semaphore(PAGE_CONCURRENCY)

    async def _enrich_one(p: dict) -> dict:
        page_no = p.get("page", 0)
        text = p.get("text", "")
        async with semaphore:
            try:
                result = await asyncio.wait_for(
                    enrich_page(text), timeout=PAGE_TIMEOUT_S
                )
                products = result.products
                entities = result.entities
                outcome = result.outcome
            except asyncio.TimeoutError:
                logger.warning(
                    "enrich_page timed out after %.0fs on page %d - streaming",
                    PAGE_TIMEOUT_S, page_no,
                )
                products = []
                entities = []
                outcome = {"status": "timeout", "model": _get_model(),
                           "duration_ms": int(PAGE_TIMEOUT_S * 1000),
                           "error": f"per-page timeout of {PAGE_TIMEOUT_S:.0f}s exceeded"}
            except Exception as exc:  # noqa: BLE001 - fail-open
                logger.exception(
                    "enrich_page raised on page %d (streaming): %s",
                    page_no, exc,
                )
                products = []
                entities = []
                outcome = {"status": "unknown", "model": _get_model(),
                           "duration_ms": 0, "error": str(exc)[:500]}
            return {
                "page": page_no,
                "products": [prod.to_dict() for prod in products],
                "entities": [ent.to_dict() for ent in entities],
                "page_type": products[0].page_type if products else "other",
                "outcome": outcome,
            }

    pending: dict[asyncio.Task, dict] = {}
    for i, p in enumerate(pages):
        # Deliberate stagger between page STARTS so we never burst
        # >1 concurrent LLM call in the window. PAGE_CONCURRENCY=1 keeps
        # the in-flight count at 1; the MIN_PAGE_INTERVAL_S sleep on
        # top of that guarantees the gap between consecutive request
        # submissions stays above Groq's per-minute request ceiling.
        # Started only after the first page so the first page begins
        # immediately - the pacing matters once we're already in flight.
        if i > 0 and MIN_PAGE_INTERVAL_S > 0:
            await asyncio.sleep(MIN_PAGE_INTERVAL_S)
        task = asyncio.create_task(_enrich_one(p))
        pending[task] = p

    try:
        # Yield each result as it completes, regardless of order, so
        # the dashboard can render per-page status the moment the LLM
        # call returns (Groq free tier is rate-limited, so a slow page
        # 3 doesn't have to block pages 1, 2, 4, 5 from updating).
        for completed in asyncio.as_completed(list(pending.keys())):
            try:
                result = await completed
            except BaseException as exc:  # noqa: BLE001
                # _enrich_one swallows everything internally; this is
                # last-line-of-defence in case asyncio itself raises
                # (e.g. cancelled).  Yield an "unknown" outcome for
                # the affected page so the dashboard doesn't hang.
                p = pending.get(completed) or {}
                logger.exception(
                    "Unexpected exception for page %d: %s",
                    p.get("page", 0), exc,
                )
                yield {
                    "page": p.get("page", 0),
                    "products": [],
                    "page_type": "other",
                    "outcome": {"status": "unknown", "model": _get_model(),
                                "duration_ms": 0, "error": str(exc)[:500]},
                }
                continue
            yield result
    except Exception as exc:  # noqa: BLE001 - last-line-of-defence
        # Catastrophic loop failure (event loop closed, etc.).  Yield
        # "unknown" outcomes for any pages we haven't yet emitted so
        # the .NET side can mark them failed and stop polling.
        logger.exception("enrich_pages_streaming catastrophic failure: %s", exc)
        seen_pages = set()
        for task, p in pending.items():
            if task.done():
                continue
            page_no = p.get("page", 0)
            if page_no in seen_pages:
                continue
            seen_pages.add(page_no)
            yield {
                "page": page_no,
                "products": [],
                "page_type": "other",
                "outcome": {"status": "unknown", "model": _get_model(),
                            "duration_ms": 0, "error": f"streaming catastrophic failure: {exc}"},
            }
