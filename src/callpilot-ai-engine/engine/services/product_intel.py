"""Product Intelligence research - Tavily discovery + LLM structured extraction.

Mirrors the competitive-intel pipeline (competitor_intel.py) but produces a
structured, reusable product profile rather than a free-text summary. The
result is returned to .NET which persists it as the canonical
ProductIntelligence row (the database is the cache - research happens once).

Fail-open by design: every external dependency (Tavily, LLM) degrades to a
partial result or a structured "failed" status - never an exception that can
break the caller.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Optional

from engine.services.competitor_intel import _tavily_search

logger = logging.getLogger(__name__)

MAX_SOURCES = 6
SNIPPET_CHARS = 400

_SOURCE_TYPE_HINTS: list[tuple[str, list[str]]] = [
    ("datasheet", ["datasheet", "data sheet", "spec sheet", "technical sheet"]),
    ("documentation", ["manual", "specification", "specs", "product spec", "user guide", ".pdf", "pdf"]),
    ("publication", ["wikipedia", "news", "press", "magazine", "journal", "review", "blog"]),
    ("distributor", ["distributor", "supplier", "retailer", "reseller", "alibaba", "amazon", "mouser", "digikey", "rs-online", "elektronik"]),
]

_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL | re.IGNORECASE)

FALLBACK_MODELS: list[str] = ["qwen/qwen3.8-27b", "allam-2-7b", "openai/gpt-oss-20b"]


def _is_tpd_error(error_message: str) -> bool:
    if not error_message:
        return False
    low = error_message.lower()
    return "tokens per day" in low or "tpd" in low


def _is_retriable_model_error(error_message: str) -> bool:
    if not error_message:
        return False
    low = error_message.lower()
    return (
        "tokens per day" in low
        or "tpd" in low
        or "model_not_found" in low
        or "does not exist" in low
    )


def _is_tpd_error(error_message: str) -> bool:
    """Whether an error signals Groq TPD (tokens per day) quota exhaustion."""
    if not error_message:
        return False
    low = error_message.lower()
    return "tokens per day" in low or "tpd" in low


def _clamp_confidence(value) -> float:
    try:
        c = float(value)
        return round(min(max(c, 0.0), 1.0), 2)
    except (TypeError, ValueError):
        return 0.0


def _classify_source_type(title: str, url: str) -> str:
    """Keyword-based source classification. Official/manufacturer wins only
    when the source is actually the manufacturer's own domain."""
    blob = f"{title} {url}".lower()
    for source_type, keywords in _SOURCE_TYPE_HINTS:
        if any(kw in blob for kw in keywords):
            return source_type
    return "search"


def _domain_of(url: str) -> str:
    match = re.search(r"https?://(?:www\.)?([^/]+)", url or "")
    return match.group(1).lower() if match else ""


def _looks_official(url: str, manufacturer: str) -> bool:
    if not manufacturer or not url:
        return False
    domain = _domain_of(url)
    if not domain:
        return False
    tokens = [t for t in re.split(r"[^a-z0-9]+", manufacturer.lower()) if len(t) >= 3]
    return any(t in domain for t in tokens)


def _build_search_query(name: str, manufacturer: str, category: str, boost: str = "", company: str = "") -> str:
    """Contextual query. The owning company leads the query when known so
    generic product names ("Prodigy") resolve to the right vendor, not a
    same-named game/audio product. `boost` carries distinctive domain terms
    (e.g. from knowledge-base descriptions) that further disambiguate."""
    parts: list[str] = []
    org = company or manufacturer
    if org:
        parts.append(org)
    parts.append(name)
    if boost:
        parts.append(boost)
    if category:
        parts.append(category)
    parts.append("product specifications datasheet")
    return " ".join(dict.fromkeys(p for p in parts if p))


def _tokens(text: str) -> list[str]:
    return [t for t in re.split(r"[^a-z0-9]+", text.lower()) if len(t) >= 3]


def _website_host(website: str) -> str:
    match = re.search(r"https?://(?:www\.)?([^/]+)", website or "")
    return match.group(1).lower() if match else ""


def _filter_relevant(results: list[dict], name: str, manufacturer: str, website: str = "") -> list[dict]:
    """Keep only sources plausibly about the product. With a known org
    (manufacturer/company/website), a source must reference it (domain,
    title, or content) - which kills same-name noise like "Prodigy" the
    video game. Without one, a product-name mention in title/content is
    enough."""
    name_tokens = set(_tokens(name))
    org_tokens = set(_tokens(manufacturer))
    website_tokens = set(_tokens(_website_host(website)))
    relevant: list[dict] = []
    for r in results:
        title = (r.get("title") or "")
        content = (r.get("content") or "")
        domain = _domain_of(r.get("url") or "")
        blob = f"{title} {content}".lower()
        org_referenced = (
            any(t in domain for t in org_tokens)
            or any(t in domain for t in website_tokens)
            or any(t in blob for t in org_tokens)
        )
        name_mentioned = any(t in blob for t in name_tokens)
        if org_tokens or website_tokens:
            if org_referenced:
                relevant.append(r)
        elif name_mentioned:
            relevant.append(r)
    return relevant or results[:2]


def _sanitize_sources(results: list[dict], manufacturer: str, website: str = "") -> list[dict]:
    """Convert raw Tavily results into product-source descriptors, ranked by
    relevance (official/manufacturer sources first)."""
    website_host = _website_host(website)
    sources: list[dict] = []
    for r in results:
        url = (r.get("url") or "").strip()
        title = (r.get("title") or "").strip()
        if not url:
            continue
        content = (r.get("content") or "").strip()[:SNIPPET_CHARS]
        source_type = _classify_source_type(title, url)
        if source_type != "official" and (_looks_official(url, manufacturer) or (website_host and website_host in _domain_of(url))):
            source_type = "official"
        relevance = 1.0 if source_type == "official" else 0.6
        sources.append({
            "title": title or _domain_of(url),
            "url": url,
            "domain": _domain_of(url),
            "source_type": source_type,
            "snippet": content,
            "relevance_score": relevance,
        })
    # Official/manufacturer sources first, then by relevance.
    sources.sort(key=lambda s: (s["source_type"] == "official", s["relevance_score"]), reverse=True)
    return sources[:MAX_SOURCES]


def _strip_json_fence(text: str) -> str:
    fence = _JSON_FENCE_RE.search(text)
    if fence:
        return fence.group(1).strip()
    start, end = text.find("{"), text.rfind("}")
    if start >= 0 and end > start:
        return text[start : end + 1].strip()
    return text.strip()


def _as_str_list(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    return []


def _as_str_map(value) -> list[str]:
    """Normalize keySpecifications: accept a dict {name: value} or a list."""
    if isinstance(value, dict):
        return [f"{str(k)}: {str(v)}" for k, v in value.items() if v is not None and str(v).strip()]
    return _as_str_list(value)


def _sanitize_product(raw: dict) -> dict:
    """Coerce LLM output to the expected shape; every field is a best-effort
    sanitize so a malformed payload still yields a usable profile."""
    return {
        "canonicalName": (raw.get("canonicalName") or raw.get("name") or "").strip(),
        "manufacturer": (raw.get("manufacturer") or "").strip() or None,
        "category": (raw.get("category") or "").strip() or None,
        "description": (raw.get("description") or raw.get("shortDescription") or "").strip() or None,
        "whatItDoes": (raw.get("whatItDoes") or "").strip() or None,
        "useCases": _as_str_list(raw.get("useCases")),
        "targetIndustries": _as_str_list(raw.get("targetIndustries")),
        "keyFeatures": _as_str_list(raw.get("keyFeatures")),
        "keySpecifications": _as_str_map(raw.get("keySpecifications")),
        "standoutPoints": _as_str_list(raw.get("standoutPoints")),
        "variants": _as_str_list(raw.get("variants")),
        "limitations": _as_str_list(raw.get("limitations")),
    }


def _compute_confidence(product: dict, source_count: int) -> float:
    """Deterministic confidence: grounded in how many verified sources and
    populated fields exist - never inflated by the LLM."""
    score = 0.0
    if source_count >= 1:
        score += 0.35
    if source_count >= 2:
        score += 0.15
    if source_count >= 3:
        score += 0.1
    if product.get("manufacturer"):
        score += 0.1
    if product.get("description") or product.get("whatItDoes"):
        score += 0.1
    if any(product.get(k) for k in ("keyFeatures", "keySpecifications", "useCases")):
        score += 0.1
    return round(min(score, 1.0), 2)


_EXTRACTION_PROMPT = """You are a product intelligence extractor. Analyze the web research
snippets below about the product "__NAME__".

Extract a structured product profile. CRITICAL RULES:
- Extract ONLY facts supported by the provided sources.
- If a field is NOT supported by the sources, use null for strings and [] for lists.
- NEVER invent specifications, technical ratings, certifications, features,
  pricing, compatibility, or use cases.
- "description" should be a 1-2 sentence factual summary of what the product
  is, grounded in the source text (do not leave it null if the sources
  describe the product).
- "manufacturer" is the full company name that makes the product, taken
  verbatim from the sources when visible (e.g. "Secure Meters").
- "keySpecifications" is an object mapping a spec name to its value
  (e.g. {"Phase": "Three-phase", "Accuracy class": "0.2s"}).
- Keep list items short and factual.
- "canonicalName" should be the clean product name (e.g. "Prodigy").

Return ONLY valid JSON with this exact schema (no preamble, no markdown):
{{
  "canonicalName": string,
  "manufacturer": string or null,
  "category": string or null,
  "description": string or null,
  "whatItDoes": string or null,
  "useCases": [string],
  "targetIndustries": [string],
  "keyFeatures": [string],
  "keySpecifications": {{string: string}},
  "standoutPoints": [string],
  "variants": [string],
  "limitations": [string]
}}

Known identity hints (use as grounding, but only include if supported by the sources):
__HINTS__

Sources:
__SNIPPETS__"""


async def _extract_with_llm(
    name: str,
    sources: list[dict],
    llm_client=None,
    hints: dict | None = None,
    provider_config=None,
) -> dict:
    if not sources:
        return {}

    hint_lines = []
    if hints:
        if hints.get("manufacturer"):
            hint_lines.append(f"- Manufacturer: {hints['manufacturer']}")
        if hints.get("category"):
            hint_lines.append(f"- Category: {hints['category']}")
    hint_text = "\n".join(hint_lines) if hint_lines else "- None provided"

    snippets = "\n".join(
        f"- {s['title']} | {s['url']}\n  {s['snippet']}" for s in sources
    )
    prompt = (
        _EXTRACTION_PROMPT
        .replace("__NAME__", name)
        .replace("__HINTS__", hint_text)
        .replace("__SNIPPETS__", snippets)
    )

    # 1) BYOK proxy (the user's configured provider, via .NET LlmService).
    #    This is the clean path: .NET resolves the user provider/model and
    #    generates the response.  Preferred when supplied.
    if llm_client is not None:
        try:
            raw = await llm_client(prompt)
            if raw:
                payload = _parse_json_object(raw)
                if payload:
                    return payload
        except Exception as exc:
            logger.warning("Product extraction BYOK call failed: %s", exc)

    # 2) Provider abstraction path: a resolved provider config was passed in
    #    (new BYOK).  We call the same engine ai/ layer the enrichment pass
    #    uses so there is no Groq-vs-OpenAI-vs-Anthropic branching here.
    if provider_config is not None:
        try:
            from engine.services.enrichment_service import _call_provider_with_retry
            result = await _call_provider_with_retry(provider_config, prompt)
            if result and getattr(result, "content", None) and result.outcome_status == "ok":
                payload = _parse_json_object(result.content)
                if payload:
                    return payload
            # TPD / model-removed fallback - same models as enrichment_service.
            err_msg = getattr(result, "error_message", None) or "" if result else ""
            if _is_retriable_model_error(err_msg):
                logger.warning("Product extraction TPD hit on %s, trying fallbacks %s", provider_config.model, FALLBACK_MODELS)
                for fb_model in FALLBACK_MODELS:
                    if fb_model == provider_config.model:
                        continue
                    try:
                        from engine.ai.base import AiProviderConfig
                        fb_config = AiProviderConfig(
                            provider_type=provider_config.provider_type,
                            model=fb_model,
                            api_key=provider_config.api_key,
                            endpoint=getattr(provider_config, "endpoint", None),
                            max_tokens=getattr(provider_config, "max_tokens", None),
                            temperature=getattr(provider_config, "temperature", None),
                            timeout_s=getattr(provider_config, "timeout_s", None),
                        )
                        fb_result = await _call_provider_with_retry(fb_config, prompt)
                        if fb_result and getattr(fb_result, "content", None) and fb_result.outcome_status == "ok":
                            payload = _parse_json_object(fb_result.content)
                            if payload:
                                logger.info("Product extraction fallback %s succeeded after TPD on %s", fb_model, provider_config.model)
                                return payload
                        fb_err = getattr(fb_result, "error_message", None) or "" if fb_result else ""
                        if not _is_retriable_model_error(fb_err):
                            break
                        logger.warning("Product extraction fallback %s also hit retriable error, trying next", fb_model)
                    except Exception as fb_exc:
                        logger.warning("Product extraction fallback %s failed: %s", fb_model, fb_exc)
                        continue
        except Exception as exc:
            logger.warning("Product extraction provider call failed: %s", exc)

    # 3) Legacy operator-default Groq fallback (env GROQ_API_KEY) so
    #    research keeps working when no user provider is configured yet.
    try:
        from engine.services.enrichment_service import _call_groq_with_retry
        result = await _call_groq_with_retry(prompt)
        if result and getattr(result, "content", None):
            payload = _parse_json_object(result.content)
            if payload:
                return payload
    except Exception as exc:
        logger.warning("Product extraction Groq fallback failed: %s", exc)

    return {}


def _parse_json_object(raw: str):
    """Parse strict-JSON (fence-tolerant). Returns None on any malformation
    so the caller can fall through to the next LLM path."""
    try:
        payload = json.loads(_strip_json_fence(raw))
        return payload if isinstance(payload, dict) else None
    except (json.JSONDecodeError, ValueError):
        return None


async def research_product(
    name: str,
    manufacturer: str = "",
    category: str = "",
    context: str = "",
    llm_client=None,
    boost: str = "",
    company: str = "",
    website: str = "",
    provider_config=None,
) -> dict:
    """Run the full product research pipeline and return a result dict.

    Returns a stable shape:
      {status: "ok"|"partial"|"failed", search_query, product, sources, error}
    """
    display_name = (name or "").strip() or "unknown"
    query = _build_search_query(display_name, manufacturer, category, boost, company)

    raw_results = await _tavily_search(query, max_results=MAX_SOURCES, search_depth="advanced")
    if not raw_results:
        return {
            "status": "failed",
            "search_query": query,
            "product": {},
            "sources": [],
            "error": "no search results",
        }

    results = _filter_relevant(raw_results, display_name, manufacturer, website)
    if not results:
        return {
            "status": "failed",
            "search_query": query,
            "product": {},
            "sources": [],
            "error": "no relevant sources found",
        }

    sources = _sanitize_sources(results, manufacturer, website)
    extracted = await _extract_with_llm(
        display_name, sources, llm_client,
        hints={"manufacturer": manufacturer or company, "category": category},
        provider_config=provider_config,
    )

    if not extracted:
        return {
            "status": "failed",
            "search_query": query,
            "product": {},
            "sources": [],
            "error": "llm extraction returned no usable data",
        }

    product = _sanitize_product(extracted)
    product["confidenceScore"] = _compute_confidence(product, len(sources))
    filled = [k for k in ("description", "whatItDoes", "keyFeatures", "keySpecifications") if product.get(k)]
    status = "ok" if len(filled) >= 2 and len(sources) >= 1 else "partial"

    return {
        "status": status,
        "search_query": query,
        "product": product,
        "sources": sources,
        "error": None,
    }
