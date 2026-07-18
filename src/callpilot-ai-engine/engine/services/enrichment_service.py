"""Async LLM enrichment for brochure pages.

Sits between Docling extraction and the embedding/GLiNER pass.  Brochure copy
is semantically thin ("enterprise-grade security", "blazing fast performance")
and RAG cannot work with it.  This service hands each page to a local Ollama
LLM (qwen2.5:3b by default), asks it to extract structured product
intelligence cards, and returns them so the .NET handler can replace the
thin Docling chunks with rich product-card chunks before embedding.

Fail-open design
────────────────
* If Ollama is unreachable, slow, or returns garbage, this function returns
  ``[]`` and the caller keeps the original Docling chunks.  The upload
  pipeline must NEVER block on a missing LLM.
* Per-page timeout: 60 s.  No retries — failed pages are simply unenriched.
* JSON parse failures: log a warning, return ``[]``.

The dataclass shape mirrors the prompt schema exactly so the .NET side can
``JsonSerializer.Deserialize<EnrichedProduct>(raw)`` straight from the prompt
output.
"""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass, field, asdict
from typing import Any, List, Optional

logger = logging.getLogger(__name__)


# ── Configuration ──────────────────────────────────────────────────────────
# Read at module load so tests can monkeypatch via env.  Not from a config
# module — keeping this self-contained so the service can be tested in
# isolation.

def _get_base_url() -> str:
    return os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")


def _get_model() -> str:
    return os.getenv("ENRICHMENT_MODEL", "qwen2.5:3b")


def _get_timeout_s() -> float:
    return float(os.getenv("ENRICHMENT_TIMEOUT_S", "60"))


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

# Strip leading/trailing markdown fences the LLM occasionally adds even
# after being told not to.  Handles ```json ... ```, ``` ... ```, and
# stray single backticks at the line edges.
_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.MULTILINE)


def _strip_markdown_fences(text: str) -> str:
    return _FENCE_RE.sub("", text).strip()


def _parse_enrichment_response(raw: str) -> list[EnrichedProduct]:
    """Parse the LLM response into a list of EnrichedProduct.

    Returns ``[]`` on any failure.  The caller logs the warning so the
    pipeline can keep going.
    """
    if not raw:
        return []

    cleaned = _strip_markdown_fences(raw)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        logger.warning("Enrichment JSON parse failed: %s; head=%r", exc, cleaned[:120])
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


# ── Ollama call ────────────────────────────────────────────────────────────

# Use a shared httpx client so connection pooling works across pages of the
# same document.  Lazy-instantiated.
_httpx_client: Any = None


def _get_httpx_client() -> Any:
    global _httpx_client
    if _httpx_client is None:
        import httpx
        _httpx_client = httpx.AsyncClient(timeout=_get_timeout_s())
    return _httpx_client


async def aclose() -> None:
    """Close the shared httpx client.  Call from FastAPI shutdown."""
    global _httpx_client
    if _httpx_client is not None:
        await _httpx_client.aclose()
        _httpx_client = None


async def _call_ollama(prompt: str) -> Optional[str]:
    """POST to Ollama's /api/chat.  Returns the response message content or
    ``None`` on any failure (timeout, connection error, non-2xx).

    Per spec: NO retries.  One shot per page.
    """
    import httpx
    client = _get_httpx_client()
    url = f"{_get_base_url()}/api/chat"
    payload = {
        "model": _get_model(),
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        # Constrain output — a 3B model will ramble if you don't.
        "options": {
            "temperature": 0.1,
            "num_predict": 2048,
        },
    }
    try:
        resp = await client.post(url, json=payload)
    except httpx.TimeoutException:
        logger.warning("Ollama enrichment timed out after %.0fs", _get_timeout_s())
        return None
    except httpx.HTTPError as exc:
        logger.warning("Ollama enrichment HTTP error: %s", exc)
        return None

    if resp.status_code != 200:
        logger.warning(
            "Ollama enrichment returned %d: %s",
            resp.status_code, resp.text[:200],
        )
        return None

    try:
        data = resp.json()
    except json.JSONDecodeError:
        logger.warning("Ollama enrichment: response is not JSON")
        return None

    msg = data.get("message") or {}
    content = msg.get("content")
    if not isinstance(content, str):
        logger.warning("Ollama enrichment: response has no message.content")
        return None
    return content


# ── Public API ─────────────────────────────────────────────────────────────

async def enrich_page(page_text: str) -> list[EnrichedProduct]:
    """Run the enrichment LLM pass on a single page of brochure text.

    Returns the parsed list of :class:`EnrichedProduct`.  Returns ``[]`` on
    any failure (Ollama down, parse error, empty content, unexpected
    exception) — the caller keeps the original Docling chunks and the
    pipeline continues.

    Per spec: 60 s timeout, no retries.  Fail-open: every code path lands
    in ``[]`` so a single broken page never breaks the document.
    """
    if not page_text or not page_text.strip():
        return []
    prompt = _build_prompt(page_text.strip())
    try:
        raw = await _call_ollama(prompt)
    except Exception as exc:  # noqa: BLE001 — fail-open, last line of defence
        logger.warning("enrich_page: unexpected exception in _call_ollama: %s", exc)
        return []
    if raw is None:
        return []  # already logged in _call_ollama
    return _parse_enrichment_response(raw)


# ── Bulk helper used by the /api/v1/documents/enrich endpoint ─────────────

async def enrich_pages(pages: list[dict]) -> list[dict]:
    """Enrich a batch of pages.  Each input dict: ``{"page": int, "text": str}``.

    Returns a list of dicts in the same shape as the input plus
    ``products`` (list of EnrichedProduct dicts) and ``page_type``.  Pages
    where enrichment failed or returned no products have ``products = []``
    and ``page_type = "other"`` — the .NET handler treats this as "keep
    original Docling chunks for this page".
    """
    out: list[dict] = []
    for p in pages:
        page_no = p.get("page", 0)
        text = p.get("text", "")
        try:
            products = await enrich_page(text)
        except Exception as exc:  # noqa: BLE001 — last-line-of-defence fail-open
            logger.exception("enrich_page raised on page %d: %s", page_no, exc)
            products = []
        out.append({
            "page": page_no,
            "products": [prod.to_dict() for prod in products],
            "page_type": products[0].page_type if products else "other",
        })
    return out
