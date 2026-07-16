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
"""

from __future__ import annotations

import logging
import time
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile

from engine.knowledge_engine.docling_service import get_docling_service

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
        chunks = await get_docling_service().ingest_pdf(pdf_bytes, filename=file.filename or "upload.pdf")
    except Exception as exc:
        logger.exception("Docling ingest failed for %s", file.filename)
        raise HTTPException(status_code=500, detail=f"Ingest failed: {exc}") from exc

    return {
        "filename": file.filename,
        "size_bytes": len(pdf_bytes),
        "chunk_count": len(chunks),
        "extraction_ms": int((time.time() - t0) * 1000),
        "chunks": [
            {
                "text": c.text,
                "section_heading": c.section_heading,
                "chunk_type": c.chunk_type,
                "page": c.page,
                "pages": c.pages,
                "metadata": c.metadata,
            }
            for c in chunks
        ],
    }
