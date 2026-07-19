"""
Structure-aware document ingest endpoint.

POST /api/v1/documents/ingest-structured
  Content-Type: multipart/form-data
  Body: file=<PDF>

Returns the document as a list of structured chunks with section headings,
page numbers, and chunk-type labels. Consumed by the .NET
`KnowledgeUploadHandler` when the upload (or reindex) is marked
`mode=structured`.

This endpoint is intentionally slow (5-60s on CPU) — Docling runs layout
analysis, table recognition, and (optionally) OCR on the input. The .NET
client uses a long timeout when calling it.

POST /api/v1/documents/enrich
  Content-Type: application/json
  Body: {"document_id": "...", "pages": [{"page": 1, "text": "..."}, ...]}

Runs the LLM enrichment pass (Ollama / qwen2.5:3b by default) on each page
and returns a list of structured product cards.  Per-page failure is
non-blocking: a page whose LLM call times out or returns garbage comes
back with ``products: []`` and ``page_type: "other"``, which the .NET
handler interprets as "keep the original Docling chunks for this page".
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

from fastapi import APIRouter, Body, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from engine.knowledge_engine.docling_service import get_docling_service
from engine.services.enrichment_service import (
    enrich_pages,
    enrich_pages_streaming,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/documents", tags=["ingest"])


# 50 MB cap — same as the .NET upload limit. Larger files should be processed
# out-of-band, not through the interactive upload path.
MAX_BYTES = 50 * 1024 * 1024


@router.post("/ingest-structured")
async def ingest_structured(file: UploadFile = File(...)) -> dict[str, Any]:
    if file.content_type not in ("application/pdf", "application/octet-stream", None):
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported content type: {file.content_type}. Only application/pdf is accepted.",
        )

    t0 = time.time()
    pdf_bytes = await file.read()
    read_ms = (time.time() - t0) * 1000
    if len(pdf_bytes) > MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"File too large ({len(pdf_bytes)} bytes; max {MAX_BYTES})")
    if len(pdf_bytes) == 0:
        raise HTTPException(status_code=400, detail="Empty file")

    logger.info("ingest-structured: %s (%d bytes, read in %.0fms)", file.filename, len(pdf_bytes), read_ms)

    try:
        result = await get_docling_service().ingest_pdf(pdf_bytes, filename=file.filename or "upload.pdf")
    except Exception as exc:
        logger.exception("Docling ingest failed for %s", file.filename)
        raise HTTPException(status_code=500, detail=f"Ingest failed: {exc}") from exc

    return {
        "filename": file.filename,
        "size_bytes": len(pdf_bytes),
        "chunk_count": len(result.chunks),
        "extraction_ms": int((time.time() - t0) * 1000),
        "docling": result.to_meta_dict(),
        "chunks": [
            {
                "text": c.text,
                "section_heading": c.section_heading,
                "chunk_type": c.chunk_type,
                "page": c.page,
                "pages": c.pages,
                "metadata": c.metadata,
            }
            for c in result.chunks
        ],
    }


@router.post("/enrich")
async def enrich_document(payload: dict = Body(...)) -> StreamingResponse:
    """Run the LLM enrichment pass over a list of brochure pages, streaming
    per-page results as they complete (NDJSON over HTTP).

    Body::

        {
          "document_id": "<guid>",     # for logging only
          "pages": [
            {"page": 1, "text": "..."},
            {"page": 2, "text": "..."}
          ]
        }

    Response (newline-delimited JSON, one object per line)::

        {"kind": "page", "page": 1, "products": [...], "page_type": "...",
         "outcome": {"status": "ok", "model": "...", "duration_ms": 1234}}
        {"kind": "page", "page": 2, "products": [], "page_type": "other",
         "outcome": {"status": "no_products", ...}}
        ...
        {"kind": "summary", "page_count": N, "products_total": M,
         "failure_count": K, "enrichment_ms": 12345}

    Per-page failures (Groq auth, rate limit, timeout, parse error) are
    surfaced in the per-page ``outcome.status`` field; the response
    stream never breaks.  The .NET handler consumes one line at a time
    and writes each page's result to the DB so the dashboard polls
    reflect progress as pages complete.
    """
    pages = payload.get("pages") or []
    if not isinstance(pages, list):
        raise HTTPException(status_code=400, detail="pages must be a list")
    document_id = payload.get("document_id", "unknown")
    t0 = time.time()
    logger.info(
        "enrich: document_id=%s, %d page(s) [streaming]", document_id, len(pages),
    )

    async def generate():
        products_total = 0
        failure_count = 0
        emitted = 0
        try:
            async for result in enrich_pages_streaming(pages):
                page_products = len(result.get("products", []))
                outcome = result.get("outcome") or {}
                status = outcome.get("status", "unknown")
                if status in ("ok", "no_products"):
                    pass
                else:
                    failure_count += 1
                products_total += page_products
                emitted += 1
                yield (json.dumps({"kind": "page", **result}) + "\n").encode("utf-8")
        except Exception as exc:  # noqa: BLE001 — last-line-of-defence
            logger.exception("enrich stream generator crashed: %s", exc)
            yield (json.dumps({"kind": "error", "error": str(exc)}) + "\n").encode("utf-8")

        elapsed_ms = int((time.time() - t0) * 1000)
        logger.info(
            "enrich: document_id=%s done in %dms, %d product(s) across %d page(s), %d failure(s) [streaming]",
            document_id, elapsed_ms, products_total, emitted, failure_count,
        )
        yield (json.dumps({
            "kind": "summary",
            "page_count": emitted,
            "products_total": products_total,
            "failure_count": failure_count,
            "enrichment_ms": elapsed_ms,
        }) + "\n").encode("utf-8")

    return StreamingResponse(generate(), media_type="application/x-ndjson")

