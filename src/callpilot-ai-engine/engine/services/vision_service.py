"""Vision-LLM captioning of brochure pictures (figures, product shots, tables-as-images).

Runs during structured ingest, right after Docling extraction.  Each
page's picture crops are sent to a Groq vision model which returns a
short caption; captions become `figure_caption` chunks (embedded like
any other chunk) AND are appended to the page text passed to the
product-card enrichment pass, so card extraction can cite image content.

Fail-open by design: any vision failure leaves captions empty and the
pipeline continues - never an exception that breaks ingest.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

# Groq vision model. llama-3.2-11b-vision-preview is the free-tier
# vision model; override via GROQ_VISION_MODEL for paid keys.
def _get_vision_model() -> str:
    return os.getenv("GROQ_VISION_MODEL", "llama-3.2-11b-vision-preview")


# How many pictures may be sent in ONE vision call (the model accepts
# multiple images per request; batching cuts request count).
IMAGES_PER_CALL = 3
VISION_TIMEOUT_S = 30.0

_CAPTION_PROMPT = (
    "You are analyzing figures extracted from a product brochure page for a "
    "sales-intelligence knowledge base.\n"
    "For the image(s) provided, write ONE short caption (max 40 words) that "
    "captures the factual content a sales rep could use: what product or "
    "component is shown, any visible specifications, model numbers, labels, "
    "or measurements.\n"
    "If the image is decorative (logo, generic stock photo, no readable "
    "information), respond with exactly: NO_INFO\n"
    "Respond with the caption only - no preamble, no quotes."
)

_groq_client: Any = None


def _get_groq_client() -> Any:
    global _groq_client
    if _groq_client is None:
        from engine.services.enrichment_service import _get_groq_client as _enrich_client
        # Reuse the same pooled AsyncGroq client (same API key requirement).
        _groq_client = _enrich_client()
    return _groq_client


async def aclose() -> None:
    """Close the shared Groq client.  Call from FastAPI shutdown."""
    global _groq_client
    if _groq_client is not None:
        if hasattr(_groq_client, "aclose"):
            await _groq_client.aclose()
        _groq_client = None


async def describe_pictures(
    pictures: list[dict],
    provider_config=None,
) -> dict[int, list[str]]:
    """Caption a list of picture descriptors.

    Input: list of dicts ``{"page": int, "data_url": str}`` (as produced by
    the Docling service).  Output: ``{page: [caption, ...]}`` - one entry
    per picture that produced usable information.  Fail-open: any error
    returns an empty dict.
    """
    if not pictures:
        return {}

    # Group by page, then chunk each page's pictures into IMAGES_PER_CALL.
    import os as _os
    from engine.ai.base import AiProviderConfig, GROQ
    from engine.ai.providers import get_provider

    resolved = provider_config
    if resolved is not None and not hasattr(resolved, "provider_type"):
        resolved = AiProviderConfig(
            provider_type=resolved.get("provider_type", ""),
            model=resolved.get("model", ""),
            api_key=resolved.get("api_key", ""),
            endpoint=resolved.get("endpoint") or None,
        )

    if resolved is None:
        # Legacy operator-default path: env key + vision model.
        try:
            from engine.services.enrichment_service import _get_groq_api_key
            _get_groq_api_key()
            resolved = AiProviderConfig(
                provider_type=GROQ,
                model=_get_vision_model(),
                api_key=_get_groq_api_key(),
                timeout_s=VISION_TIMEOUT_S,
            )
        except Exception:
            return {}
        try:
            provider = get_provider(resolved)
        except Exception:
            return {}
    else:
        try:
            provider = get_provider(resolved)
        except Exception as exc:
            logger.warning("vision: provider init failed: %s", exc)
            return {}

    out: dict[int, list[str]] = {}

    def _content_blocks(page_pics: list[dict]) -> list[dict]:
        blocks: list[dict] = [{"type": "text", "text": _CAPTION_PROMPT}]
        for pic in page_pics:
            data_url = pic.get("data_url") or ""
            if data_url.startswith("data:"):
                blocks.append({"type": "image_url", "image_url": {"url": data_url}})
        return blocks

    async def _caption_page(page: int, page_pics: list[dict]) -> None:
        try:
            data_urls = [p.get("data_url") for p in page_pics if p.get("data_url")]
            resp = await asyncio.wait_for(
                provider.complete_with_images(
                    _CAPTION_PROMPT,
                    data_urls,
                    max_tokens=200,
                    temperature=0.2,
                ),
                timeout=VISION_TIMEOUT_S,
            )
            text = ""
            if resp is not None and resp.content:
                text = resp.content.strip()
            if not text or "NO_INFO" in text.upper():
                return
            # One caption per picture in the batch; the model returns a
            # single combined caption for a multi-image batch.
            out.setdefault(page, []).append(text[:400])
        except asyncio.TimeoutError:
            logger.warning("vision: caption call timed out for page %d", page)
        except Exception as exc:  # noqa: BLE001 - fail-open
            logger.warning("vision: caption call failed for page %d: %s", page, exc)

    tasks = []
    for page, page_pics in _group_by_page(pictures).items():
        for i in range(0, len(page_pics), IMAGES_PER_CALL):
            tasks.append(_caption_page(page, page_pics[i : i + IMAGES_PER_CALL]))
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)

    return out


def _group_by_page(pictures: list[dict]) -> dict[int, list[dict]]:
    grouped: dict[int, list[dict]] = {}
    for pic in pictures:
        page = int(pic.get("page") or 0)
        grouped.setdefault(page, []).append(pic)
    return grouped


def caption_chunk_text(page: int, captions: list[str]) -> str:
    """Render a page's captions as a single retrievable chunk."""
    lines = [f"[figure caption, page {page}]"]
    for c in captions:
        lines.append(f"- {c}")
    return "\n".join(lines)
