"""Async LLM enrichment for brochure pages.

Sits between Docling extraction and the embedding/GLiNER pass.  Brochure copy
is semantically thin ("enterprise-grade security", "blazing fast performance")
and RAG cannot work with it.  This service hands each page to Groq's
chat-completions API (llama-3.1-8b-instant by default) with
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
  generous; the Groq client's own timeout is also 30 s).  No retries —
  failed pages are simply unenriched.  The whole job is wrapped in
  try/except so nothing escapes back to the .NET caller; the document
  keeps the original Docling chunks and the .NET side sets
  ``enrichment_failed``.
* Pages are processed concurrently — up to 3 in flight at any moment
  (``asyncio.gather`` + ``Semaphore(3)``) — so a 20-page document finishes
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
from dataclasses import dataclass, field, asdict
from typing import Any, List, Optional

logger = logging.getLogger(__name__)


# ── Configuration ──────────────────────────────────────────────────────────
# Read at module load so tests can monkeypatch via env.  Not from a config
# module — keeping this self-contained so the service can be tested in
# isolation.


class _MissingGroqKey(RuntimeError):
    """Raised when GROQ_API_KEY is not set in the environment.

    Treated as a recoverable error by the fail-open wrapper in
    :func:`enrich_page` — the page just gets an empty enrichment result
    and the .NET side sets ``enrichment_failed``.  Surfaced as a distinct
    type so the warning log makes the root cause obvious.
    """


def _get_groq_api_key() -> str:
    # No default — a missing key is a deployment misconfiguration.  We
    # raise a typed exception so the caller's fail-open wrapper can log
    # "GROQ_API_KEY missing" specifically instead of a generic
    # AuthenticationError, and so test setups that forget to set the
    # env var get a clear failure.
    key = os.getenv("GROQ_API_KEY")
    if not key:
        raise _MissingGroqKey(
            "GROQ_API_KEY is not set — get a free key at console.groq.com "
            "(no credit card required) and set it in the environment."
        )
    return key


def _get_model() -> str:
    # llama-3.1-8b-instant is Groq's free-tier default; fast, supports
    # response_format={"type": "json_object"}, and good enough for the
    # product-card extraction prompt.  Override via ENRICHMENT_MODEL
    # (e.g. llama-3.3-70b-versatile for higher quality on dev keys).
    return os.getenv("ENRICHMENT_MODEL", "llama-3.1-8b-instant")


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

        Format is stable — tests assert on it, and the .NET handler copies it
        verbatim into ``KnowledgeChunk.Text``.
        """
        def _join_or_none(label: str, items: List[str]) -> str:
            cleaned = [s.strip() for s in (items or []) if s and s.strip()]
            return f"{label}: {', '.join(cleaned)}." if cleaned else ""

        # "<name>. <headline>. Category: X. ..."  — the period after name
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


# ── Prompt ─────────────────────────────────────────────────────────────────

_PROMPT_TEMPLATE = """You are a product intelligence extractor. Given text from a product brochure page, extract all products and their details.

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
      "raw_claims": [string]
    }}
  ],
  "page_type": "product_listing | comparison | overview | pricing | contact | other"
}}

If no products found return: {{"products": [], "page_type": "other"}}

Page text:
{page_text}
"""


def _build_prompt(page_text: str) -> str:
    return _PROMPT_TEMPLATE.format(page_text=page_text)


# ── JSON extraction & parsing ──────────────────────────────────────────────

# Groq is called with response_format={"type": "json_object"} so the model
# is forced to return a single JSON object — no markdown fences, no
# preamble.  We still keep the defensive parser below in case the API
# contract changes or a future model misbehaves; the call to
# json.loads() should never fail in normal operation.


def _parse_enrichment_response(raw: str) -> list[EnrichedProduct]:
    """Parse the LLM response into a list of EnrichedProduct.

    Returns ``[]`` on any failure.  The caller logs the warning so the
    pipeline can keep going.
    """
    if not raw:
        return []

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        logger.warning("Enrichment JSON parse failed: %s; head=%r", exc, raw[:120])
        return []

    if not isinstance(data, dict):
        logger.warning("Enrichment response is not an object: %r", type(data).__name__)
        return []

    # Pick out the page_type once at the top level — it's stamped on every
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
            continue  # skip nameless entries — the LLM occasionally emits
                      # stray "no name" rows
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
# import time — lets the FastAPI app boot in environments where the
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


async def _call_groq(prompt: str) -> Optional[str]:
    """Call Groq's chat.completions API.  Returns the response content or
    ``None`` on any failure (missing key, timeout, rate limit, non-2xx,
    unexpected response shape).

    Per spec: NO retries.  One shot per page.  ``response_format=json_object``
    forces the model to return a single JSON object, so we don't need to
    strip markdown fences.
    """
    try:
        client = _get_groq_client()
    except _MissingGroqKey as exc:
        logger.warning("Groq enrichment: %s", exc)
        return None
    except Exception as exc:  # noqa: BLE001 — fail-open
        logger.warning("Groq client init failed: %s", exc)
        return None

    try:
        response = await client.chat.completions.create(
            model=_get_model(),
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            response_format={"type": "json_object"},
            timeout=30,
        )
    except Exception as exc:  # noqa: BLE001 — fail-open
        # Covers the full Groq exception hierarchy (APIError, APIConnectionError,
        # RateLimitError, APITimeoutError, BadRequestError on bad model name,
        # etc.) plus any unexpected transport error.  All are fail-open:
        # the page keeps its original Docling chunks.
        logger.warning("Groq enrichment failed: %s", exc)
        return None

    try:
        content = response.choices[0].message.content
    except (AttributeError, IndexError, TypeError):
        logger.warning("Groq enrichment: response has no message.content")
        return None

    if not isinstance(content, str) or not content:
        logger.warning("Groq enrichment: empty content in response")
        return None

    return content


# ── Public API ─────────────────────────────────────────────────────────────

async def enrich_page(page_text: str) -> list[EnrichedProduct]:
    """Run the enrichment LLM pass on a single page of brochure text.

    Returns the parsed list of :class:`EnrichedProduct`.  Returns ``[]`` on
    any failure (Groq down, missing API key, parse error, empty content,
    unexpected exception) — the caller keeps the original Docling chunks
    and the pipeline continues.

    Per spec: 30 s timeout, no retries.  Fail-open: every code path lands
    in ``[]`` so a single broken page never breaks the document.  The
    authoritative per-page cap is enforced at the ``enrich_pages`` level
    via :func:`asyncio.wait_for`; the Groq client's own 30 s timeout here
    is a redundant safety net.
    """
    if not page_text or not page_text.strip():
        return []
    prompt = _build_prompt(page_text.strip())
    try:
        raw = await _call_groq(prompt)
    except Exception as exc:  # noqa: BLE001 — fail-open, last line of defence
        logger.warning("enrich_page: unexpected exception in _call_groq: %s", exc)
        return []
    if raw is None:
        return []  # already logged in _call_groq
    return _parse_enrichment_response(raw)


# ── Bulk helper used by the /api/v1/documents/enrich endpoint ─────────────

# Per-page ceiling.  Kept in sync with the Groq client's own timeout
# (also 30s in ``_call_groq``) so asyncio.wait_for() is the authoritative
# cap.  Groq is fast — typical page completes in ~1 s; 30 s is generous
# headroom for rate-limit backoff or transient network blips.
PAGE_TIMEOUT_S: float = 30.0

# Concurrency cap.  Three in-flight Groq requests keeps us well under
# the free-tier rate limit (~30 req/min for llama-3.1-8b-instant) while
# cutting wall time roughly 3x vs. a sequential loop.  Bump to 5 on a
# paid key if needed.
PAGE_CONCURRENCY: int = 3


async def enrich_pages(pages: list[dict]) -> list[dict]:
    """Enrich a batch of pages.  Each input dict: ``{"page": int, "text": str}``.

    Returns a list of dicts in the same shape as the input plus
    ``products`` (list of EnrichedProduct dicts) and ``page_type``.  Pages
    where enrichment failed, timed out, or returned no products have
    ``products = []`` and ``page_type = "other"`` — the .NET handler treats
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
            try:
                products = await asyncio.wait_for(
                    enrich_page(text), timeout=PAGE_TIMEOUT_S
                )
            except asyncio.TimeoutError:
                # Per-page cap hit — skip just this page, keep the original
                # Docling chunks for it, and let the rest of the document
                # finish.  A single slow page must never kill the job.
                logger.warning(
                    "enrich_page timed out after %.0fs on page %d — "
                    "keeping original Docling chunks",
                    PAGE_TIMEOUT_S, page_no,
                )
                products = []
            except Exception as exc:  # noqa: BLE001 — fail-open
                logger.exception(
                    "enrich_page raised on page %d: %s — "
                    "keeping original Docling chunks",
                    page_no, exc,
                )
                products = []
            return {
                "page": page_no,
                "products": [prod.to_dict() for prod in products],
                "page_type": products[0].page_type if products else "other",
            }

    try:
        # Run all pages through the semaphore with up to PAGE_CONCURRENCY
        # in flight.  return_exceptions=True so one bad task can't break the
        # gather — we still coerce any stray exception into an empty result
        # below, matching the per-page fail-open contract.
        tasks = [_enrich_one(p) for p in pages]
        results = await asyncio.gather(*tasks, return_exceptions=True)
    except Exception as exc:  # noqa: BLE001 — last-line-of-defence
        # gather(return_exceptions=True) shouldn't raise, but if anything
        # catastrophic happens (event loop closed, CancelledError bubbling
        # out, etc.) we still want to return a clean empty result so the
        # .NET side can set enrichment_failed and exit.
        logger.exception("enrich_pages catastrophic failure: %s", exc)
        return [
            {"page": p.get("page", 0), "products": [], "page_type": "other"}
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
            })
        else:
            out.append(r)
    return out
