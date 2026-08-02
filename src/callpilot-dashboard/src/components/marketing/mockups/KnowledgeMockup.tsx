// KnowledgeMockup — a static recreation of the Knowledge Documents
// settings tab (current post-fix state): upload card with ingest-mode
// option cards, solid "Indexed" pill, outline "enriched" tag, span-based
// metadata rows.

import { Zap, Sparkles, Upload, FileText, CheckCircle2 } from "lucide-react";

const DOCS = [
  {
    name: "Product-Battle-Card.pdf",
    size: "4.7 MB",
    chunks: 25,
    entities: 6,
    date: "Jul 29, 2026",
    mode: "structured",
    status: "Indexed",
    enriched: true,
  },
  {
    name: "Objection-Handling-Guide.md",
    size: "50 KB",
    chunks: 42,
    entities: 0,
    date: "Jul 28, 2026",
    mode: "structured",
    status: "Indexed",
    enriched: true,
  },
  {
    name: "Integration-Notes.txt",
    size: "12 KB",
    chunks: 8,
    entities: 0,
    date: "Jul 27, 2026",
    mode: "fast",
    status: "Indexed",
    enriched: false,
  },
];

export function KnowledgeMockup() {
  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden p-4">
      {/* Upload card */}
      <div className="rounded-2xl border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-display text-[15px] font-semibold tracking-tight text-[var(--opaline-on-surface)]">
              Knowledge documents
            </p>
            <p className="mt-0.5 text-xs text-[var(--opaline-on-surface-variant)]">
              Upload product docs, battle cards, objection guides.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-[var(--opaline-on-surface)] px-3 py-1.5 text-xs font-medium text-white">
            <Upload className="h-3.5 w-3.5" strokeWidth={2} />
            Upload document
          </span>
        </div>

        {/* Ingest mode cards */}
        <p className="mt-4 font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--opaline-on-surface-variant)]">
          Ingest mode
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] p-3">
            <div className="flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-[var(--opaline-on-surface-variant)]" strokeWidth={2} />
              <span className="text-xs font-semibold text-[var(--opaline-on-surface)]">Fast</span>
            </div>
            <p className="mt-0.5 text-[11px] text-[var(--opaline-on-surface-variant)]">In-process extraction.</p>
          </div>
          <div className="rounded-lg border border-[var(--opaline-primary)] bg-[var(--opaline-tone-4)] p-3">
            <div className="flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-[var(--opaline-primary)]" strokeWidth={2} />
              <span className="text-xs font-semibold text-[var(--opaline-on-surface)]">Structured + LLM</span>
              <CheckCircle2 className="ml-auto h-3.5 w-3.5 text-[var(--opaline-primary)]" strokeWidth={2} />
            </div>
            <p className="mt-0.5 text-[11px] text-[var(--opaline-on-surface-variant)]">Docling + LLM enrichment.</p>
          </div>
        </div>
      </div>

      {/* Document list */}
      <div className="flex flex-col gap-2">
        <p className="font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--opaline-on-surface-variant)]">
          Your documents
        </p>
        {DOCS.map((doc) => (
          <div key={doc.name} className="rounded-2xl border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <FileText className="h-3.5 w-3.5 text-[var(--opaline-on-surface-variant)]" strokeWidth={2} />
              <p className="truncate text-sm font-semibold text-[var(--opaline-on-surface)]">{doc.name}</p>
              {doc.status === "Indexed" && (
                <span className="inline-flex items-center rounded-full bg-[var(--opaline-primary)] px-2 py-0.5 text-[10px] font-semibold text-[var(--opaline-on-primary)]">
                  Indexed
                </span>
              )}
              {doc.enriched && (
                <span className="inline-flex items-center rounded-full border border-[var(--opaline-secondary)] px-2 py-0.5 text-[10px] font-semibold text-[var(--opaline-secondary)]">
                  enriched
                </span>
              )}
            </div>
            <p className="mt-1 max-w-full truncate font-mono text-[11px] text-[var(--opaline-on-surface-variant)]">
              <span>{doc.size}</span>
              <span className="mx-1 opacity-60" aria-hidden>·</span>
              <span>{doc.chunks} chunks</span>
              {doc.entities > 0 && (
                <>
                  <span className="mx-1 opacity-60" aria-hidden>·</span>
                  <span>{doc.entities} entities</span>
                </>
              )}
              <span className="mx-1 opacity-60" aria-hidden>·</span>
              <span>{doc.date}</span>
              <span className="mx-1 opacity-60" aria-hidden>·</span>
              <span>{doc.mode}</span>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
