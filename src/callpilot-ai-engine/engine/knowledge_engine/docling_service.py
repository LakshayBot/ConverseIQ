"""
Structure-aware PDF ingestion via Docling.

Used by the .NET `KnowledgeUploadHandler` when the upload (or reindex) is
explicitly marked `mode=structured`. Produces JSON-friendly chunks with section
headings, page numbers, and chunk-type labels that the .NET chunker (used in
fast mode) cannot recover from flat text extraction.

Cost (one-time, on first call): ~30-60s for layout model download/load.
Cost (per PDF): ~1-3s per page on CPU. The AI Engine keeps a single
`DocumentConverter` instance and reuses it.

Lazy-loaded: importing this module does NOT pay the model-load cost. The
converter is built on the first call to `ingest_pdf`.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Iterable

logger = logging.getLogger(__name__)


@dataclass
class StructuredChunk:
    """JSON-friendly chunk consumed by the .NET upload handler."""
    text: str
    section_heading: str | None
    chunk_type: str                # "paragraph" | "bullet_group" | "list_item" | "table" | "heading" | "figure_caption"
    page: int                       # 1-based; 0 if unknown
    pages: list[int] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class PagePicture:
    """A product/table image crop from a page, ready for the vision LLM.

    ``data_url`` is a data:image/jpeg;base64,... URL the Groq vision model
    can consume directly.  ``caption`` is filled in by the vision pass
    (empty if the pass failed or was skipped).
    """
    page: int
    index: int
    data_url: str
    caption: str = ""


@dataclass
class DoclingResult:
    """Output of :meth:`DoclingIngestService.ingest_pdf`.

    Carries the structured chunks plus a small metadata block the
    dashboard uses to show "Docling: 12 pages, 42310ms model load,
    1230ms convert" instead of a frozen stepper during the first
    request after a fresh container start.
    """
    chunks: list[StructuredChunk]
    page_count: int
    convert_ms: int
    chunk_ms: int
    model_load_ms: int | None     # None after the first call has been made
    warnings: list[str] = field(default_factory=list)
    pictures: list[PagePicture] = field(default_factory=list)

    def to_meta_dict(self) -> dict[str, Any]:
        return {
            "page_count": self.page_count,
            "convert_ms": self.convert_ms,
            "chunk_ms": self.chunk_ms,
            "model_load_ms": self.model_load_ms,
            "warnings": list(self.warnings),
        }


class DoclingIngestService:
    """Wraps a Docling DocumentConverter + HybridChunker behind a small, stable API."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._converter = None
        self._chunker = None
        # One-time model load time (None until first call). Surfaced in
        # the /ingest-structured response so the dashboard can show
        # "Docling model load: 42s" instead of a frozen stepper.
        self._model_load_ms: int | None = None

    def _ensure_loaded(self) -> None:
        # Imported lazily so a deployment that never calls /ingest-structured
        # doesn't pay the model-load cost on AI Engine startup.
        if self._converter is not None:
            return
        with self._lock:
            if self._converter is not None:
                return
            from docling.document_converter import DocumentConverter
            from docling.chunking import HybridChunker
            logger.info("Loading Docling DocumentConverter (first call)...")
            t0 = time.time()
            self._converter = DocumentConverter()
            self._chunker = HybridChunker()
            self._model_load_ms = int((time.time() - t0) * 1000)
            logger.info("Docling loaded in %.1fs", time.time() - t0)

    async def ingest_pdf(self, pdf_bytes: bytes, filename: str = "upload.pdf") -> "DoclingResult":
        """Convert a PDF byte stream into structure-aware chunks + a
        metadata block (page count, convert/chunk/model-load timings,
        warnings) the .NET handler can persist for the dashboard.
        """
        # Docling is CPU-bound and synchronous. Run it in a thread so the
        # FastAPI event loop stays responsive (the endpoint can take 30-90s
        # for a 20-page brochure on CPU).
        import asyncio
        return await asyncio.to_thread(self._ingest_sync, pdf_bytes, filename)

    # ── internals ──────────────────────────────────────────────────────────

    def _ingest_sync(self, pdf_bytes: bytes, filename: str) -> "DoclingResult":
        self._ensure_loaded()

        from docling.datamodel.base_models import InputFormat
        from docling.datamodel.document import DocumentStream
        from docling.datamodel.pipeline_options import PdfPipelineOptions
        from docling.document_converter import DocumentConverter, PdfFormatOption

        # Quality-first extraction: complex brochures contain scanned pages
        # and image-only spec sheets.  OCR is ON so scanned text enters the
        # pipeline; table structure + figure structure keep layout-aware
        # chunks; picture crops feed the vision-LLM caption pass.
        #
        # docling's pipeline options drifted across 2.x releases:
        # `do_figure_structure` and `do_reading_order` were removed in newer
        # versions (2.120+) in favour of picture classification/description.
        # Guard every optional flag so a docling upgrade never breaks ingest.
        #
        # OCR backend: the container ships rapidocr (onnxruntime) - docling's
        # TesseractOcrOptions needs the tesserocr C binding + system
        # Tesseract, which are NOT installed here, so it raises ImportError
        # on every conversion. Fall back to no-OCR only if rapidocr is also
        # unavailable.
        opts = PdfPipelineOptions()
        opts.do_ocr = True
        try:
            from docling.datamodel.pipeline_options import RapidOcrOptions

            opts.ocr_options = RapidOcrOptions(lang=["en"])
        except Exception:  # noqa: BLE001 - no OCR backend available
            opts.do_ocr = False
        opts.do_table_structure = True
        if hasattr(opts, "do_figure_structure"):
            opts.do_figure_structure = True
        if hasattr(opts, "do_picture_classification"):
            opts.do_picture_classification = True
        if hasattr(opts, "do_reading_order"):
            opts.do_reading_order = True
        converter = DocumentConverter(
            format_options={
                InputFormat.PDF: PdfFormatOption(pipeline_options=opts),
            }
        )

        t0 = time.time()
        from io import BytesIO
        doc_stream = DocumentStream(name=filename, stream=BytesIO(pdf_bytes))
        result = converter.convert(doc_stream)
        convert_ms = int((time.time() - t0) * 1000)
        logger.info("Docling converted %s (%d bytes) in %.0fms", filename, len(pdf_bytes), convert_ms)

        t0 = time.time()
        chunks_raw = list(self._chunker.chunk(result.document))
        chunk_ms = int((time.time() - t0) * 1000)
        logger.info("Docling chunker produced %d chunks in %.0fms", len(chunks_raw), chunk_ms)

        # Page count: best-effort from the first page that surfaced. If the
        # PDF has no extractable pages Docling returns a doc with no
        # `pages`, so we fall back to 0 rather than crashing.
        page_count = 0
        try:
            page_count = len(getattr(result.document, "pages", []) or [])
        except Exception:  # noqa: BLE001
            page_count = 0

        warnings: list[str] = []
        # Docling raises on per-page failures but produces output; surface
        # anything that came out as a non-empty page that nonetheless
        # yielded zero chunks.
        if page_count > 0 and len(chunks_raw) == 0:
            warnings.append("PDF had pages but no chunks were produced")

        pictures = self._extract_pictures(result.document)

        return DoclingResult(
            chunks=[self._to_structured(c) for c in chunks_raw],
            page_count=page_count,
            convert_ms=convert_ms,
            chunk_ms=chunk_ms,
            model_load_ms=self._model_load_ms,
            warnings=warnings,
            pictures=pictures,
        )

    # Cap on pictures per page (and per document) that go to the vision
    # LLM.  Decorative graphics and tiny icons are filtered by size; this
    # caps the LLM spend on a single brochure.
    MAX_PICTURES_PER_PAGE = 3
    MAX_PICTURES_TOTAL = 24
    # Min rendered width/height in px for a picture to count as content.
    MIN_PICTURE_SIDE_PX = 96
    # Max long side for the JPEG sent to the vision model (keeps payloads
    # small; vision models don't need more than ~1k px).
    PICTURE_MAX_SIDE_PX = 1024

    def _extract_pictures(self, document) -> list[PagePicture]:
        """Harvest picture crops from the Docling doc as compact base64 JPEGs.

        Pictures are attributed to the page of their first provenance item.
        Returns at most ``MAX_PICTURES_PER_PAGE`` per page and
        ``MAX_PICTURES_TOTAL`` overall, sorted by area (biggest first).
        """
        try:
            import base64
            from io import BytesIO
        except Exception:  # noqa: BLE001
            return []

        pictures = document.pictures if hasattr(document, "pictures") else []
        if not pictures:
            return []

        per_page: dict[int, list[PagePicture]] = {}
        for pic in pictures:
            try:
                image = getattr(pic, "image", None)
                if image is None:
                    continue
                width, height = image.size
                if width < self.MIN_PICTURE_SIDE_PX or height < self.MIN_PICTURE_SIDE_PX:
                    continue

                page = 0
                for p in (getattr(pic, "prov", None) or []):
                    pn = getattr(p, "page_no", None)
                    if isinstance(pn, int) and pn > 0:
                        page = pn
                        break

                # Downscale + JPEG-encode so the payload stays small.
                scale = min(1.0, self.PICTURE_MAX_SIDE_PX / max(width, height))
                if scale < 1.0:
                    image = image.resize((max(1, int(width * scale)), max(1, int(height * scale))))
                if image.mode != "RGB":
                    image = image.convert("RGB")
                buf = BytesIO()
                image.save(buf, format="JPEG", quality=70)
                data_url = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")

                per_page.setdefault(page, []).append(PagePicture(
                    page=page,
                    index=len(per_page.get(page, [])),
                    data_url=data_url,
                ))
            except Exception:  # noqa: BLE001 - a bad picture never kills ingest
                continue

        out: list[PagePicture] = []
        for page_no in sorted(per_page):
            # Largest first within a page (the hero product shot > a logo).
            page_pics = sorted(
                per_page[page_no], key=lambda p: len(p.data_url), reverse=True
            )[: self.MAX_PICTURES_PER_PAGE]
            for pic in page_pics:
                if len(out) >= self.MAX_PICTURES_TOTAL:
                    break
                out.append(pic)
            if len(out) >= self.MAX_PICTURES_TOTAL:
                break
        return out

    def _to_structured(self, c) -> StructuredChunk:
        # Headings (most recent first) - the last one in the list is the
        # nearest enclosing section, which is what we want to attach to the
        # chunk for retrieval filtering.
        headings: list[str] = list(c.meta.headings or []) if getattr(c.meta, "headings", None) else []
        section_heading = headings[-1] if headings else None

        # Chunk type from the first doc_item's label. Most chunks are mixed
        # (a heading followed by a list) so we pick a dominant type.
        chunk_type = "paragraph"
        items: Iterable = getattr(c.meta, "doc_items", None) or []
        labels = [getattr(item, "label", None) for item in items]
        labels = [l for l in labels if l is not None]
        if labels:
            from docling_core.types.doc import DocItemLabel
            if DocItemLabel.LIST_ITEM in labels:
                chunk_type = "bullet_group"
            elif DocItemLabel.TABLE in labels:
                chunk_type = "table"
            elif DocItemLabel.SECTION_HEADER in labels or DocItemLabel.TITLE in labels:
                chunk_type = "heading"

        # Page number. Docling exposes `prov` (a list of ProvenanceItem) on each
        # doc_item; each entry has a 1-based `page_no` plus a bounding box.
        page = 0
        pages: list[int] = []
        for item in items:
            prov = getattr(item, "prov", None) or []
            for p in prov:
                pn = getattr(p, "page_no", None)
                if isinstance(pn, int) and pn > 0:
                    pages.append(pn)
        if pages:
            page = pages[0]
            pages = sorted(set(pages))

        # Free-form metadata for retrieval-time filters.
        metadata: dict[str, Any] = {
            "source_mode": "structured",
            "headings": headings,
            "doc_item_labels": [str(l) for l in labels],
        }

        return StructuredChunk(
            text=c.text,
            section_heading=section_heading,
            chunk_type=chunk_type,
            page=page,
            pages=pages,
            metadata=metadata,
        )


# Module-level singleton, lazily populated on first call.
_service: DoclingIngestService | None = None


def get_docling_service() -> DoclingIngestService:
    global _service
    if _service is None:
        _service = DoclingIngestService()
    return _service
