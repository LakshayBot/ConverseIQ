'use client';

// KnowledgeUpload - desktop-friendly mirror of the web app's knowledge
// page. Lives as a tab inside the Settings shell so users can:
//   1. Pick a PDF / DOCX / Markdown / TXT file from the OS file dialog
//   2. Choose fast (in-process PDF/MD extraction) or structured (Docling + LLM)
//   3. Watch the ingest pipeline progress per document
//   4. Read the extracted chunks, surfaced entities, or raw AI-engine output
//   5. Delete documents they no longer need
//
// Wire-up notes (so the adapter can extend later without re-doing all of this):
//   - File picker uses the native <input type="file">. Tauri extends the
//     standard File object with a `.path` so we can read the file via the
//     existing `read_audio_file` Tauri command (passes file bytes + filename +
//     content type to the new `callpilot_api_upload` command, which builds
//     a multipart request - the .NET endpoint requires multipart).
//   - All other endpoints (GET /knowledge, GET /knowledge/{id},
//     DELETE /knowledge/{id}, GET /knowledge/{id}/status,
//     GET /knowledge/{id}/raw-output) go through the standard
//     `authedApiCall` JSON proxy.
//   - Polling mirrors the web app's 1.5s cadence; only docs that aren't
//     in a terminal state are polled. The polling effect is self-cleaning:
//     when nothing is in flight, it stops.

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import {
  LoaderIcon,
  Upload as UploadIcon,
  Trash2,
  FileText,
  FileCode2,
  Search,
  CheckCircle2,
  AlertCircle,
  X,
  Zap,
  Sparkles,
  Check,
  ChevronDown,
  ChevronRight,
  KeyRound,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { authedApiCall } from '@/lib/auth';
import { bulkEnrichDocumentProducts, bulkDeleteDocumentProducts } from '@/lib/callpilotApi';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { productStatusMeta, productStatusChipClass } from '@/lib/productStatus';
import { ProductDetailDrawer, type DrawerProduct } from '@/components/ProductDetailDrawer';

// ──────────────────────────────────────────────────────────────────────────────
// Types - mirror src/callpilot-dashboard/src/lib/api.ts so the two
// surfaces stay field-for-field compatible.
// ──────────────────────────────────────────────────────────────────────────────

type IngestStageKey =
  | 'uploaded'
  | 'extracting'
  | 'chunking'
  | 'embedding'
  | 'indexed'
  | 'entityextraction'
  | 'enriching';

type IngestStageStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

interface IngestStageError {
  stage: string;
  source: 'ai-engine' | 'groq' | 'gliner' | 'dotnet' | 'unknown';
  httpStatus: number | null;
  message: string;
  model: string | null;
  at: string;
}

interface IngestStage {
  key: IngestStageKey;
  label: string;
  status: IngestStageStatus;
  startedAt: string | null;
  finishedAt: string | null;
  detail: string | null;
  error: IngestStageError | null;
}

interface EnrichmentPageStatus {
  page: number;
  status: string;
  model: string | null;
  durationMs: number;
  error: string | null;
  finishedAt: string | null;
  retryCount: number;
}

interface EnrichmentProgress {
  total: number;
  completed: number;
  failed: number;
  inFlight: number;
  pages: EnrichmentPageStatus[];
}

interface KnowledgeDocument {
  id: string;
  knowledgeBaseId: string | null;
  fileName: string;
  contentType: string;
  fileSizeBytes: number;
  processingStatus: string;
  enrichmentStatus: string | null;
  createdAt: string;
  chunkCount: number;
  mode?: 'fast' | 'structured';
}

interface KnowledgeBase {
  id: string;
  name: string;
  companyName: string;
  website: string | null;
  description: string | null;
  createdAt: string;
  productsTotal: number;
  productsEnriched: number;
}

interface DocumentProduct {
  id: string;
  name: string;
  canonical: string;
  displayName?: string;
  enrichmentStatus: string;
  lastEnrichedAt: string | null;
  sourcePage?: number | null;
  sourceChunk?: number | null;
}

interface DocumentStatus {
  id: string;
  mode: 'fast' | 'structured';
  processingStatus: string;
  enrichmentStatus: string | null;
  chunkCount: number;
  entityCount: number;
  lastUpdatedAt: string | null;
  stages: IngestStage[];
  lastError: IngestStageError | null;
  enrichmentProgress: EnrichmentProgress | null;
  products?: DocumentProduct[];
  productsTotal?: number;
  productsEnriched?: number;
}

interface KnowledgeChunkDetail {
  id: string;
  chunkIndex: number;
  text: string;
  tokenCount: number;
  source?: 'fast' | 'structured' | 'enriched';
  sectionHeading: string | null;
  chunkType: string;
  pageHint: number;
  metadata: string | null;
}

interface KnowledgeDocumentDetail extends KnowledgeDocument {
  chunks: KnowledgeChunkDetail[];
  entities: { id: string; entityText: string; entityType: string; confidence: number }[];
}

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 1500;

const TERMINAL_PROCESSING = new Set(['Indexed', 'No extractable text found']);
const FAILURE_PREFIX = 'Error:';

const STAGE_ORDER: Array<{ key: IngestStageKey; label: string }> = [
  { key: 'uploaded', label: 'Uploaded' },
  { key: 'extracting', label: 'Extracting' },
  { key: 'chunking', label: 'Chunking' },
  { key: 'embedding', label: 'Embedding' },
  { key: 'indexed', label: 'Indexed' },
  { key: 'entityextraction', label: 'Entity extraction' },
];

function isLlmTerminal(s: string | null | undefined): boolean {
  return s === 'enriched' || s === 'enrichment_failed' || s === 'provider_required';
}

// Terminal means "nothing left to poll for".  Fast-mode docs are done as
// soon as processing finishes.  Structured docs have an async enrichment
// pass that starts AFTER processing is Indexed - so they only become
// terminal once enrichment has settled, otherwise the poll can stop in
// the Indexed + enrichmentStatus=null window and freeze the progress bar
// just before enrichment begins.  A structured doc whose enrichment
// never started (legacy rows) is treated as done after a 10-minute
// idle window so the poll doesn't run forever.
function isDocTerminal(d: DocumentStatus | KnowledgeDocument): boolean {
  const processing = (d as any).processingStatus;
  const enrichment = (d as any).enrichmentStatus;
  const mode = (d as any).mode;
  const mainDone =
    TERMINAL_PROCESSING.has(processing) ||
    String(processing || '').startsWith(FAILURE_PREFIX);
  if (!mainDone) return false;
  if (mode !== 'structured') return true;
  if (isLlmTerminal(enrichment)) return true;
  if (enrichment == null) {
    const ts = (d as any).lastUpdatedAt
      ? new Date((d as any).lastUpdatedAt).getTime()
      : 0;
    if (ts > 0 && Date.now() - ts > 10 * 60 * 1000) return true;
  }
  return false;
}

// ──────────────────────────────────────────────────────────────────────────────
// Status chip - one combined chip per document row mapping processing +
// enrichment state onto the semantic chip classes.
// ──────────────────────────────────────────────────────────────────────────────

const StatusChip: React.FC<{ doc: KnowledgeDocument; live: DocumentStatus | null }> = ({ doc, live }) => {
  const processingStatus = live?.processingStatus ?? doc.processingStatus;
  const enrichmentStatus = live?.enrichmentStatus ?? doc.enrichmentStatus;
  const isProcessingError = String(processingStatus || '').startsWith(FAILURE_PREFIX);
  const isNoText = processingStatus === 'No extractable text found';
  const isIndexed = processingStatus === 'Indexed';
  const isEnrichmentFailed = enrichmentStatus === 'enrichment_failed';
  const isProviderRequired = enrichmentStatus === 'provider_required';
  const isEnriching =
    isIndexed && doc.mode === 'structured' && enrichmentStatus != null && !isLlmTerminal(enrichmentStatus);

  let chipClass = 'chip-info';
  let label = 'Indexing…';
  let title: string | undefined;
  if (isProcessingError) {
    chipClass = 'chip-danger';
    label = 'Failed';
    title = processingStatus;
  } else if (isNoText) {
    chipClass = 'chip-warning';
    label = 'No text found';
  } else if (isProviderRequired) {
    chipClass = 'chip-warning';
    label = 'Provider needed';
    title = 'Connect an AI provider in Settings > AI & Keys to enable product extraction.';
  } else if (isEnrichmentFailed) {
    chipClass = 'chip-danger';
    label = 'Enrichment failed';
  } else if (isEnriching) {
    chipClass = 'chip-info';
    label = 'Enriching…';
    title = enrichmentStatus ?? undefined;
  } else if (isIndexed) {
    chipClass = 'chip-success';
    label = 'Enriched';
  }
  return (
    <span className={`chip ${chipClass}`} title={title}>
      {label}
    </span>
  );
};

// ──────────────────────────────────────────────────────────────────────────────
// Pipeline stepper — single-row, connector-based progress
// Replaces the dense wrap of 7 equally-weighted chips with a linear rail.
// Done steps are muted (no bright green wash), only the running/failed step
// carries saturated color. Labels are normalized to Title Case to remove the
// casing jitter seen in the screenshot (chunking/indexed/enriching vs etc).
// ──────────────────────────────────────────────────────────────────────────────

const STEP_LABELS: Record<IngestStageKey, string> = {
  uploaded: 'Uploaded',
  extracting: 'Extracting',
  chunking: 'Chunking',
  embedding: 'Embedding',
  indexed: 'Indexed',
  entityextraction: 'Entities',
  enriching: 'Enriching',
};

const StepDot: React.FC<{ status: IngestStageStatus; isStuck?: boolean }> = ({ status, isStuck }) => {
  if (status === 'done') {
    return (
      <span className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-[var(--opaline-success-border)] bg-[var(--opaline-success-soft)]">
        <Check className="h-3 w-3 text-[var(--opaline-success)]" strokeWidth={2.5} />
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-[var(--opaline-danger-border)] bg-[var(--opaline-danger-soft)]">
        <X className="h-3 w-3 text-[var(--opaline-danger)]" strokeWidth={2.5} />
      </span>
    );
  }
  if (status === 'running') {
    return (
      <span
        className={`inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border ${
          isStuck
            ? 'border-[var(--opaline-warning-border)] bg-[var(--opaline-warning-soft)]'
            : 'border-[var(--opaline-info-border)] bg-[var(--opaline-info-soft)]'
        }`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full animate-pulse ${isStuck ? 'bg-[var(--opaline-warning)]' : 'bg-[var(--opaline-info)]'}`}
        />
      </span>
    );
  }
  if (status === 'skipped') {
    return (
      <span className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container)]">
        <span className="h-1 w-1 rounded-full bg-[var(--opaline-outline)] opacity-60" />
      </span>
    );
  }
  return (
    <span className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-low)]">
      <span className="h-1 w-1 rounded-full bg-[var(--opaline-outline)] opacity-30" />
    </span>
  );
};

const PipelineStepper: React.FC<{
  stages: IngestStage[];
  mode: 'fast' | 'structured';
  lastUpdatedAt: string | null;
  enrichmentProgress: EnrichmentProgress | null;
}> = ({ stages, mode, lastUpdatedAt, enrichmentProgress }) => {
  const STUCK_MS = 30_000;
  const byKey = new Map(stages.map((s) => [s.key, s] as const));
  const order: IngestStageKey[] =
    mode === 'structured'
      ? ['uploaded', 'extracting', 'chunking', 'embedding', 'indexed', 'entityextraction', 'enriching']
      : ['uploaded', 'extracting', 'chunking', 'embedding', 'indexed', 'entityextraction'];

  const items = order.map((key) => {
    const server = byKey.get(key);
    return (
      server ?? {
        key,
        label: STEP_LABELS[key],
        status: 'pending' as IngestStageStatus,
        startedAt: null,
        finishedAt: null,
        detail: null,
        error: null,
      }
    );
  });

  // Normalize label to short Title Case; keep detail as tooltip/meta.
  const enrichedPct =
    enrichmentProgress && enrichmentProgress.total > 0
      ? Math.round((enrichmentProgress.completed / enrichmentProgress.total) * 100)
      : 0;

  const [expandedKey, setExpandedKey] = useState<IngestStageKey | null>(null);

  // ── TPD detection for prominent banner ─────────────────────────────────
  const isTpdLike = (msg: string | null | undefined): boolean => {
    if (!msg) return false;
    const low = msg.toLowerCase();
    return low.includes("tokens per day") || low.includes("tpd") || low.includes("rate limit") || msg.includes("200000");
  };
  const tpdStage = items.find((s) => (s.error && isTpdLike(s.error.message)) || (s.detail && isTpdLike(s.detail)));
  // Also surface TPD when enrichmentProgress shows failures and any page error looks like TPD
  const enrichingFailedWithTpd = (() => {
    const enriching = items.find((s) => s.key === "enriching");
    if (enriching?.error && isTpdLike(enriching.error.message)) return true;
    if (enriching?.detail && isTpdLike(enriching.detail)) return true;
    if (tpdStage) return true;
    return false;
  })();

  return (
    <div className="border-t border-[var(--opaline-outline-variant)]/40 bg-[var(--opaline-surface-container-low)]/30">
      {/* TPD prominent banner — shown automatically, not just in collapsible detail.
          The original bug showed "0/19 pages enriched, 14 failed" with no clear reason
          in the UI detail (only the truncated raw error). This banner surfaces the
          daily quota explanation and fix directly. */}
      {enrichingFailedWithTpd && tpdStage && (
        <div className="mx-3 mt-2 rounded-lg border border-[var(--opaline-warning-border)] bg-[var(--opaline-warning-soft)] px-3 py-2.5">
          <div className="flex gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--opaline-warning)]" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-xs font-semibold text-[var(--opaline-on-surface)]">
                Daily Groq quota exhausted — enrichment hit the tokens-per-day limit
              </p>
              <p className="break-words whitespace-pre-wrap text-xs leading-relaxed text-[var(--opaline-on-surface-variant)]">
                {tpdStage.error?.message ?? tpdStage.detail}
              </p>
              <p className="text-xs leading-relaxed text-[var(--opaline-on-surface-variant)]">
                Fix: Switch to a higher-limit model like <span className="font-medium">llama-3.1-8b-instant</span> (500k TPD) in Settings &gt; AI &amp; Keys, or connect OpenAI/Anthropic. The quota resets daily at midnight UTC — the “try again in 3m42s” hint is for the per-minute bucket, not the daily quota.
              </p>
            </div>
          </div>
        </div>
      )}
      {/* Fallback banner when enrichmentProgress shows TPD-like detail but no single tpdStage was found (e.g. detail only) */}
      {enrichingFailedWithTpd && !tpdStage && enrichmentProgress && enrichmentProgress.failed > 0 && (
        <div className="mx-3 mt-2 rounded-lg border border-[var(--opaline-warning-border)] bg-[var(--opaline-warning-soft)] px-3 py-2.5">
          <div className="flex gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--opaline-warning)]" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-xs font-semibold text-[var(--opaline-on-surface)]">Daily quota exhausted — enrichment failed</p>
              <p className="text-xs leading-relaxed text-[var(--opaline-on-surface-variant)]">
                Daily Groq quota exhausted (200k tokens/day for qwen/qwen3.6-27b). Used 199k today. The free tier resets daily. Fix: Switch to a higher-limit model like llama-3.1-8b-instant (500k TPD) in Settings &gt; AI &amp; Keys, or connect OpenAI/Anthropic, or wait until tomorrow. The 3m42s hint is for tokens-per-minute, not the daily quota.
              </p>
            </div>
          </div>
        </div>
      )}
      {/* hairline progress for enriching — single thin track, no duplicate text block */}
      {enrichmentProgress && enrichmentProgress.total > 0 && (
        <div
          className="h-0.5 w-full overflow-hidden bg-[var(--opaline-surface-container-high)]/60"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={enrichedPct}
        >
          <div
            className="h-full bg-[var(--opaline-primary)] transition-all duration-500"
            style={{ width: `${enrichedPct}%` }}
          />
        </div>
      )}
      <ol className="flex items-center gap-0 px-3.5 py-2.5 overflow-x-auto custom-scrollbar">
        {items.map((stage, idx) => {
          const isLast = idx === items.length - 1;
          const isStuck =
            stage.status === 'running' &&
            lastUpdatedAt != null &&
            !stage.error &&
            Date.now() - new Date(lastUpdatedAt).getTime() > STUCK_MS;
          const hasContent = !!(stage.detail || stage.error);
          const isExpanded = expandedKey === stage.key;

          // Color decisions — muted for done/pending, saturated only for active/failed
          const labelClass =
            stage.status === 'done'
              ? 'text-[var(--opaline-on-surface-variant)]'
              : stage.status === 'running'
                ? isStuck
                  ? 'text-[var(--opaline-warning)] font-medium'
                  : 'text-[var(--opaline-info)] font-medium'
                : stage.status === 'failed'
                  ? 'text-[var(--opaline-danger)] font-medium'
                  : stage.status === 'skipped'
                    ? 'text-[var(--opaline-outline)] line-through decoration-[var(--opaline-outline-variant)]'
                    : 'text-[var(--opaline-outline)]';

          // Connector inherits color of the preceding step's outcome
          const connectorClass =
            stage.status === 'done' || (idx > 0 && items[idx - 1].status === 'done')
              ? 'bg-[var(--opaline-success-border)]/60'
              : 'bg-[var(--opaline-outline-variant)]/70';

          // Short label overrides verbose server label (e.g. "Extracting (Docling)" → "Extracting")
          const shortLabel = STEP_LABELS[stage.key] ?? stage.label;
          // Inline meta only for the actively interesting steps to avoid per-chip noise
          const showEmbeddingDetail =
            stage.key === 'embedding' && stage.detail && stage.status !== 'pending';
          const showEnrichingCounts =
            stage.key === 'enriching' && enrichmentProgress && enrichmentProgress.total > 0;

          return (
            <li key={stage.key} className="flex items-center gap-0 shrink-0">
              {/* connector before every item except first */}
              {idx !== 0 && (
                <span
                  aria-hidden
                  className={`mx-1.5 h-px w-4 shrink-0 ${connectorClass}`}
                />
              )}
              <button
                type="button"
                onClick={() => hasContent && setExpandedKey(isExpanded ? null : stage.key)}
                disabled={!hasContent}
                title={stage.error?.message ?? stage.detail ?? shortLabel}
                className={`inline-flex items-center gap-1.5 rounded-full px-1 py-0.5 -my-0.5 transition-colors ${
                  hasContent ? 'cursor-pointer hover:bg-[var(--opaline-surface-container)]/70' : 'cursor-default'
                } ${isExpanded ? 'bg-[var(--opaline-surface-container)]' : ''} focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--opaline-primary)]`}
              >
                <StepDot status={stage.status} isStuck={!!isStuck} />
                <span className={`whitespace-nowrap text-[11px] leading-none tracking-[0.01em] ${labelClass}`}>
                  {shortLabel}
                </span>
                {/* inline detail — single tiny muted token, not a separate chip */}
                {showEmbeddingDetail && (
                  <span className="whitespace-nowrap text-[10px] font-mono tabular-nums text-[var(--opaline-outline)]">
                    · {stage.detail}
                  </span>
                )}
                {showEnrichingCounts && (
                  <span className="inline-flex items-center gap-1 whitespace-nowrap">
                    <span className="text-[10px] font-mono tabular-nums text-[var(--opaline-on-surface-variant)]">
                      {enrichmentProgress!.completed}/{enrichmentProgress!.total}
                    </span>
                    {enrichmentProgress!.inFlight > 0 && (
                      <span className="text-[10px] font-medium tabular-nums text-[var(--opaline-info)] animate-pulse">
                        · {enrichmentProgress!.inFlight} in flight
                      </span>
                    )}
                    {enrichmentProgress!.failed > 0 && (
                      <span className="text-[10px] font-medium text-[var(--opaline-danger)]">
                        · {enrichmentProgress!.failed} failed
                      </span>
                    )}
                  </span>
                )}
                {isStuck && (
                  <span className="rounded-full bg-[var(--opaline-warning-soft)] px-1 py-0 text-[9px] font-medium leading-none text-[var(--opaline-warning)]">
                    stuck
                  </span>
                )}
                {hasContent && (
                  <span className="ml-0.5 text-[var(--opaline-outline)]">
                    {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  </span>
                )}
              </button>
              {/* keep spacing balanced — connector after is rendered by next item's before */}
              {isLast && <span aria-hidden className="w-1 shrink-0" />}
            </li>
          );
        })}
      </ol>
      {/* single expanded detail slot — not per-chip popover stack */}
      {(() => {
        const active = expandedKey ? items.find((s) => s.key === expandedKey) : null;
        if (!active || (!active.detail && !active.error)) return null;
        return (
          <div className="mx-3 mb-2.5 rounded-lg border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] px-2.5 py-2 text-xs">
            {active.detail && (
              <div className="text-[var(--opaline-on-surface-variant)]">
                <span className="font-medium">detail:</span> {active.detail}
              </div>
            )}
            {active.error && (
              <div className="mt-1 text-[var(--opaline-on-error-container)]">
                <div>
                  <span className="font-medium">source:</span> {active.error.source}
                  {active.error.httpStatus != null && (
                    <span className="ml-2">
                      <span className="font-medium">http:</span> {active.error.httpStatus}
                    </span>
                  )}
                  {active.error.model && (
                    <span className="ml-2">
                      <span className="font-medium">model:</span> {active.error.model}
                    </span>
                  )}
                </div>
                <div className="mt-1 break-words whitespace-pre-wrap rounded border border-[var(--opaline-error-container)] bg-[var(--opaline-error-container)] p-1.5 font-mono text-[11px]">
                  {active.error.message}
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────────────
// Document row
// ──────────────────────────────────────────────────────────────────────────────

const DocTypeIcon: React.FC<{ contentType?: string }> = ({ contentType }) => {
  const type = (contentType || '').toLowerCase();
  if (type.includes('markdown')) return <FileCode2 className="h-4 w-4" />;
  return <FileText className="h-4 w-4" />;
};

// ──────────────────────────────────────────────────────────────────────────────
// Product enrichment - per-product intelligence status discovered from this
// document. Mirrors the ProductIntelligenceCard lifecycle so the Knowledge
// Bank shows the same vocabulary (Ready / Researching / Pending / No info).
// Status vocabulary is shared via lib/productStatus.ts.
// ──────────────────────────────────────────────────────────────────────────────

const ProductStatusChip: React.FC<{ status: string }> = ({ status }) => {
  const meta = productStatusMeta(status);
  return (
    <span className={`chip ${productStatusChipClass(meta.tone)} !px-1.5 !py-0 !text-[10px]`}>
      {meta.label}
    </span>
  );
};

const ProductProgressList: React.FC<{
  products: DocumentProduct[];
  documentId: string;
  sourceDocument: string;
  onOpenProduct: (product: DrawerProduct, documentId: string) => void;
  onProductsDeleted: (ids: string[]) => void;
}> = ({ products, documentId, sourceDocument, onOpenProduct, onProductsDeleted }) => {
  const enriched = products.filter((p) => p.enrichmentStatus === 'Completed').length;
  const processing = products.filter((p) => p.enrichmentStatus === 'Enriching').length;
  const failed = products.filter((p) => p.enrichmentStatus === 'Failed').length;

  // Selection is per-document frontend state (each ProductProgressList is a
  // separate component instance per document, so selection never leaks between
  // documents). Keyed by the stable per-document product/entity id.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const allSelected = products.length > 0 && selected.size === products.length;
  const someSelected = selected.size > 0 && !allSelected;
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  // Drop selection for products that no longer exist (e.g. deleted, or the
  // doc's product list was refreshed).
  useEffect(() => {
    const valid = new Set(products.map((p) => p.id));
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [products]);

  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(products.map((p) => p.id)));
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const clear = () => setSelected(new Set());

  const handleBulkProcess = async () => {
    if (selected.size === 0 || busy) return;
    setBusy(true);
    try {
      const res = await bulkEnrichDocumentProducts(documentId, [...selected]);
      const parts = [`${res.queued} product${res.queued === 1 ? '' : 's'} queued for enrichment`];
      if (res.processing > 0) parts.push(`${res.processing} already processing`);
      if (res.skipped > 0) parts.push(`${res.skipped} skipped`);
      toast.success(parts.join(' · '));
      clear();
    } catch (e) {
      toast.error('Could not start enrichment. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selected.size === 0 || busy) return;
    setBusy(true);
    try {
      const ids = [...selected];
      const res = await bulkDeleteDocumentProducts(documentId, ids);
      onProductsDeleted(ids);
      toast.success(`${res.deleted} product${res.deleted === 1 ? '' : 's'} removed from product intelligence`);
      clear();
      setConfirmDelete(false);
    } catch (e) {
      toast.error('Could not delete the products. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1 bg-[var(--opaline-surface-container-low)]/40 px-4 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <input
            ref={selectAllRef}
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            aria-label="Select all products in this document"
            className="h-3.5 w-3.5 cursor-pointer accent-[var(--opaline-primary)]"
          />
          <p className="text-overline text-[var(--opaline-on-surface-variant)]">Product intelligence</p>
        </div>
        <div className="flex items-center gap-3">
          {selected.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-caption tabular-nums text-[var(--opaline-on-surface-variant)]">
                {selected.size} selected
              </span>
              <button
                type="button"
                onClick={handleBulkProcess}
                disabled={busy}
                className="rounded-md border border-[var(--opaline-outline-variant)] px-2 py-0.5 text-[11px] font-medium text-[var(--opaline-on-surface)] transition-colors hover:bg-[var(--opaline-surface-container-low)] disabled:opacity-50"
              >
                Process selected
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
                className="rounded-md border border-[var(--opaline-outline-variant)] px-2 py-0.5 text-[11px] font-medium text-[var(--opaline-on-surface)] transition-colors hover:bg-[var(--opaline-error-container)] hover:text-[var(--opaline-on-error-container)] disabled:opacity-50"
              >
                Delete selected
              </button>
              <button
                type="button"
                onClick={clear}
                className="text-[11px] font-medium text-[var(--opaline-on-surface-variant)] transition-colors hover:text-[var(--opaline-on-surface)]"
              >
                Clear
              </button>
            </div>
          )}
          <span className="text-caption tabular-nums text-[var(--opaline-outline)]">
            {enriched} / {products.length} enriched
            {processing > 0 && ` · ${processing} processing`}
            {failed > 0 && ` · ${failed} failed`}
          </span>
        </div>
      </div>

      {confirmDelete && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] px-3 py-2">
          <p className="min-w-0 text-[12px] text-[var(--opaline-on-surface-variant)]">
            Delete {selected.size} product{selected.size === 1 ? '' : 's'}? This removes their stored product
            intelligence and enrichment data. The source document is not affected.
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              disabled={busy}
              className="rounded-md px-2 py-1 text-[11px] font-medium text-[var(--opaline-on-surface-variant)] transition-colors hover:bg-[var(--opaline-surface-container-low)] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleBulkDelete}
              disabled={busy}
              className="rounded-md bg-[var(--opaline-danger)] px-2 py-1 text-[11px] font-medium text-[var(--opaline-on-danger)] transition-colors hover:opacity-90 disabled:opacity-50"
            >
              {busy && <LoaderIcon className="mr-1 inline h-2.5 w-2.5 animate-spin" />}
              Delete
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {products.map((p) => {
          const label = p.displayName ?? p.name;
          const meta = productStatusMeta(p.enrichmentStatus);
          const isSelected = selected.has(p.id);
          return (
            <div
              key={p.id}
              className={cn(
                'inline-flex items-center rounded-md border bg-[var(--opaline-surface-container-lowest)] transition-colors',
                isSelected
                  ? 'border-[var(--opaline-primary)]/60'
                  : 'border-[var(--opaline-outline-variant)]',
              )}
            >
              <button
                type="button"
                aria-pressed={isSelected}
                aria-label={`Select ${label}`}
                onClick={() => toggleOne(p.id)}
                className="pl-1.5 py-1 pr-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--opaline-primary)]"
              >
                <span
                  className={cn(
                    'flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border',
                    isSelected
                      ? 'border-[var(--opaline-primary)] bg-[var(--opaline-primary)]'
                      : 'border-[var(--opaline-outline)] bg-transparent',
                  )}
                >
                  {isSelected && <Check className="h-2.5 w-2.5 text-[var(--opaline-on-primary)]" aria-hidden />}
                </span>
              </button>
              <button
                type="button"
                title={`${label} · ${meta.label}`}
                onClick={() => onOpenProduct(
                  {
                    name: p.name,
                    canonical: p.canonical,
                    displayName: p.displayName,
                    enrichmentStatus: p.enrichmentStatus,
                    lastEnrichedAt: p.lastEnrichedAt,
                    sourcePage: p.sourcePage,
                    sourceChunk: p.sourceChunk,
                  },
                  documentId,
                )}
                className="inline-flex min-w-0 max-w-[190px] items-center gap-1.5 py-1 pr-2 pl-0.5 text-left transition-colors hover:text-[var(--opaline-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--opaline-primary)]"
              >
                <span className="min-w-0 truncate text-[11px] font-medium text-[var(--opaline-on-surface)]">
                  {label}
                </span>
                <ProductStatusChip status={p.enrichmentStatus} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const DocumentRow: React.FC<{
  doc: KnowledgeDocument;
  live: DocumentStatus | null;
  onDelete: (id: string) => void;
  onView: (id: string) => void;
  onOpenProduct: (product: DrawerProduct, documentId: string) => void;
  onProductsDeleted: (documentId: string, ids: string[]) => void;
  onRetry?: (id: string) => void;
}> = ({ doc, live, onDelete, onView, onOpenProduct, onProductsDeleted, onRetry }) => {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const confirmTimerRef = useRef<number | null>(null);

  const isEnrichmentFailed = (() => {
    if (live?.enrichmentStatus === 'enrichment_failed') return true;
    const enriching = live?.stages.find((s) => s.key === 'enriching');
    return enriching?.status === 'failed';
  })();
  const isTpdFailure = (() => {
    if (!live) return false;
    const enriching = live.stages.find((s) => s.key === 'enriching');
    const candidates: (string | null | undefined)[] = [
      enriching?.error?.message,
      enriching?.detail,
      ...live.stages.map((s) => s.error?.message),
      ...live.stages.map((s) => s.detail),
    ];
    const combined = candidates.filter(Boolean).join(' ');
    const low = combined.toLowerCase();
    return low.includes('tokens per day') || low.includes('tpd') || combined.includes('200000') || low.includes('rate limit');
  })();

  const handleRetry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await authedApiCall('POST', `/api/v1/knowledge/${doc.id}/reindex?mode=structured`);
      toast.success('Re-enrichment started — watch the pipeline below.');
      if (onRetry) onRetry(doc.id);
    } catch (e) {
      toast.error(`Retry failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRetrying(false);
    }
  };

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current !== null) window.clearTimeout(confirmTimerRef.current);
    };
  }, []);

  const handleDeleteClick = () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      if (confirmTimerRef.current !== null) window.clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = window.setTimeout(() => setConfirmingDelete(false), 3000);
      return;
    }
    if (confirmTimerRef.current !== null) window.clearTimeout(confirmTimerRef.current);
    setConfirmingDelete(false);
    onDelete(doc.id);
  };

  const chunkCount = live?.chunkCount ?? doc.chunkCount;
  const enrichmentProgress = live?.enrichmentProgress ?? null;
  // Pipeline shows while ingest is active OR while enrichment counts are
  // still meaningful (partial failure) OR when a stage has failed. Once
  // everything is terminal and quiet we hide the rail so the row collapses
  // to just the header + product list (maximizes density after completion).
  const showPipeline = (() => {
    if (!live) return false;
    if (!isDocTerminal({ ...doc, ...live })) return true;
    if (enrichmentProgress && enrichmentProgress.total > 0) {
      const active = enrichmentProgress.completed < enrichmentProgress.total || enrichmentProgress.failed > 0;
      if (active) return true;
    }
    if (live.stages.some((s) => s.status === 'failed' || s.status === 'running')) return true;
    return false;
  })();

  return (
    <React.Fragment>
      <div className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--opaline-surface-container-low)]">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--opaline-surface-container-low)] text-[var(--opaline-on-surface-variant)]">
          <DocTypeIcon contentType={doc.contentType} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-[var(--opaline-on-surface)]">{doc.fileName}</p>
          <p className="mt-0.5 truncate text-data text-[var(--opaline-outline)]">
            <span>{new Date(doc.createdAt).toLocaleDateString()}</span>
            <span className="mx-1" aria-hidden>·</span>
            <span>{chunkCount} chunks</span>
            {doc.mode && (
              <>
                <span className="mx-1" aria-hidden>·</span>
                <span>{doc.mode}</span>
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <StatusChip doc={doc} live={live} />
          {isEnrichmentFailed && (
            <button
              type="button"
              onClick={handleRetry}
              disabled={retrying}
              title={isTpdFailure ? 'Retry enrichment (quota may have reset)' : 'Retry enrichment'}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] px-2.5 py-1 text-xs font-medium text-[var(--opaline-on-surface)] transition-colors hover:bg-[var(--opaline-surface-container-high)] hover:text-[var(--opaline-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--opaline-primary)] disabled:opacity-50"
            >
              {retrying ? <LoaderIcon className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              Retry enrichment
            </button>
          )}
          <button
            type="button"
            onClick={() => onView(doc.id)}
            className="rounded-md px-3 py-1 text-xs font-medium text-[var(--opaline-on-surface-variant)] transition-colors hover:bg-[var(--opaline-surface-container-high)] hover:text-[var(--opaline-on-surface)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--opaline-primary)]"
          >
            View
          </button>
          <button
            type="button"
            onClick={handleDeleteClick}
            aria-label={confirmingDelete ? 'Confirm delete' : 'Delete document'}
            title={confirmingDelete ? 'Click again to confirm' : 'Delete document'}
            className={`rounded-md p-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--opaline-danger)] ${
              confirmingDelete
                ? 'bg-[var(--opaline-error-container)] text-[var(--opaline-on-error-container)]'
                : 'text-[var(--opaline-on-surface-variant)] hover:bg-[var(--opaline-error-container)] hover:text-[var(--opaline-on-error-container)]'
            }`}
          >
            {confirmingDelete ? <Check className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      {showPipeline && live && (
        <PipelineStepper
          stages={live.stages}
          mode={(live.mode as 'fast' | 'structured') ?? (doc.mode as 'fast' | 'structured') ?? 'structured'}
          lastUpdatedAt={live.lastUpdatedAt}
          enrichmentProgress={enrichmentProgress}
        />
      )}
      {/* Warning box below the stepper when enriching failed due to TPD — prominent so
          "0/19 pages enriched, 14 failed" is never shown without the quota explanation. */}
      {isEnrichmentFailed && isTpdFailure && live && (
        <div className="mx-3 mb-2 rounded-lg border border-[var(--opaline-warning-border)] bg-[var(--opaline-warning-soft)] px-3 py-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--opaline-warning)]" />
              <div className="space-y-1">
                <p className="text-xs font-semibold text-[var(--opaline-on-surface)]">Daily quota hit — enrichment needs a retry</p>
                <p className="text-xs leading-relaxed text-[var(--opaline-on-surface-variant)]">
                  This document failed because the Groq daily token limit was exhausted. The quota resets at midnight UTC. You can retry now with a higher-limit model or wait until tomorrow.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleRetry}
              disabled={retrying}
              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[var(--opaline-primary)] px-3 py-1.5 text-xs font-medium text-[var(--opaline-on-primary)] transition-colors hover:bg-[var(--opaline-primary-hover)] disabled:opacity-50"
            >
              {retrying ? <LoaderIcon className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              Retry enrichment
            </button>
          </div>
        </div>
      )}
      {/* Non-TPD enrichment failure — still offer retry but without the quota explanation */}
      {isEnrichmentFailed && !isTpdFailure && live && (
        <div className="mx-3 mb-2 flex items-center justify-between gap-3 rounded-lg border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-low)] px-3 py-2">
          <p className="text-xs text-[var(--opaline-on-surface-variant)]">Enrichment failed — you can retry.</p>
          <button
            type="button"
            onClick={handleRetry}
            disabled={retrying}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] px-2.5 py-1 text-xs font-medium text-[var(--opaline-on-surface)] transition-colors hover:bg-[var(--opaline-surface-container-high)] disabled:opacity-50"
          >
            {retrying ? <LoaderIcon className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Retry enrichment
          </button>
        </div>
      )}
      {live?.products && live.products.length > 0 && (
        <ProductProgressList
          products={live.products}
          documentId={doc.id}
          sourceDocument={doc.fileName}
          onOpenProduct={onOpenProduct}
          onProductsDeleted={(ids) => onProductsDeleted(doc.id, ids)}
        />
      )}
      {/* Empty state: only once product research has settled and truly found
          nothing - never while identification is still running. */}
      {live && live.products && live.products.length === 0 && (
        (() => {
          const research = live.stages.find((s: any) => s.key === 'productresearch');
          const settled = research && (research.status === 'done' || research.status === 'failed');
          const processed = isDocTerminal({ ...doc, ...live });
          if (!settled && !processed) return null;
          return (
            <div className="space-y-0.5 bg-[var(--opaline-surface-container-low)]/40 px-4 py-2.5">
              <p className="text-overline text-[var(--opaline-on-surface-variant)]">Product intelligence</p>
              <p className="text-caption text-[var(--opaline-on-surface-variant)]">
                No products detected in this document.
              </p>
            </div>
          );
        })()
      )}
    </React.Fragment>
  );
};

// ──────────────────────────────────────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────────────────────────────────────

export const KnowledgeUpload: React.FC = () => {
  const router = useRouter();
  const [docs, setDocs] = useState<KnowledgeDocument[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'fast' | 'structured'>('structured');
  const [liveStatuses, setLiveStatuses] = useState<Record<string, DocumentStatus>>({});
  const [viewDoc, setViewDoc] = useState<KnowledgeDocumentDetail | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'chunks' | 'entities'>('chunks');
  const [search, setSearch] = useState('');
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [selectedKbId, setSelectedKbId] = useState<string | null>(null);
  const [showKbForm, setShowKbForm] = useState(false);
  const [creatingKb, setCreatingKb] = useState(false);
  const [kbForm, setKbForm] = useState({ name: '', companyName: '', website: '', description: '' });
  const [drawer, setDrawer] = useState<{ product: DrawerProduct; documentId: string; sourceDocument: string } | null>(null);
  // BYOK: whether this user has any AI provider connected (for the
  // "connect a provider to enable product extraction" prompt).
  const [hasProvider, setHasProvider] = useState<boolean | null>(null);

  // Load docs + knowledge bases on mount
  useEffect(() => {
    void loadDocs();
    void loadKnowledgeBases();
    void loadProviderStatus();
  }, []);

  const loadProviderStatus = async () => {
    try {
      const resp = await authedApiCall<{ providers: { hasKey: boolean }[] }>('GET', '/api/v1/ai/providers');
      setHasProvider((resp?.providers ?? []).some((p) => p.hasKey));
    } catch {
      setHasProvider(null);
    }
  };

  const loadKnowledgeBases = async () => {
    try {
      const resp = await authedApiCall<{ knowledgeBases: KnowledgeBase[] }>('GET', '/api/v1/knowledge-bases');
      const kbs = resp?.knowledgeBases ?? [];
      setKnowledgeBases(kbs);
      setSelectedKbId((prev) => prev ?? kbs[0]?.id ?? null);
    } catch (e) {
      console.warn('[KnowledgeUpload] failed to load knowledge bases:', e);
    }
  };

  const handleCreateKb = async () => {
    if (!kbForm.companyName.trim() || !kbForm.name.trim()) return;
    setCreatingKb(true);
    try {
      const kb = await authedApiCall<KnowledgeBase>('POST', '/api/v1/knowledge-bases', {
        name: kbForm.name,
        companyName: kbForm.companyName,
        website: kbForm.website,
        description: kbForm.description,
      });
      setKnowledgeBases((prev) => [kb, ...prev]);
      setSelectedKbId(kb.id);
      setShowKbForm(false);
      setKbForm({ name: '', companyName: '', website: '', description: '' });
    } catch (e) {
      console.warn('[KnowledgeUpload] failed to create knowledge base:', e);
    } finally {
      setCreatingKb(false);
    }
  };

  const loadDocs = async () => {
    try {
      const items = await authedApiCall<KnowledgeDocument[]>('GET', '/api/v1/knowledge');
      setDocs(items);
    } catch (e) {
      console.warn('[KnowledgeUpload] failed to load docs:', e);
      setDocs([]);
    }
  };

  // Poll in-flight docs at a steady 1.5s interval (matches the web app
  // cadence).  Docs/statuses are read through refs so the interval is
  // created ONCE - previously the effect depended on `liveStatuses`,
  // which restarted it on every status update (and re-fired `tick()`
  // immediately each time, turning the 1.5s poll into a busy loop of
  // back-to-back requests).
  const docsRef = useRef(docs);
  useEffect(() => {
    docsRef.current = docs;
  }, [docs]);
  const liveStatusesRef = useRef(liveStatuses);
  useEffect(() => {
    liveStatusesRef.current = liveStatuses;
  }, [liveStatuses]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const currentDocs = docsRef.current;
      const inFlight = currentDocs.filter((d) => {
        const live = liveStatusesRef.current[d.id];
        // Keep polling while the ingest pipeline is running…
        if (!isDocTerminal(live ?? d)) return true;
        // …and give every terminal doc at least one status snapshot so the
        // per-document product intelligence list can render. Then keep
        // polling only while a product is still being researched.
        if (!live) return true;
        if (live.products && live.products.length > 0) {
          return live.products.some(
            (p) => p.enrichmentStatus === 'Pending' || p.enrichmentStatus === 'Enriching',
          );
        }
        return false;
      });
      if (inFlight.length === 0) return;

      const results = await Promise.all(
        inFlight.map(async (d) => {
          try {
            const s = await authedApiCall<DocumentStatus>(
              'GET',
              `/api/v1/knowledge/${d.id}/status`,
            );
            return [d.id, s] as [string, DocumentStatus];
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      const updates: Record<string, DocumentStatus> = {};
      results.forEach((r) => {
        if (r) updates[r[0]] = r[1];
      });
      setLiveStatuses((prev) =>
        Object.keys(updates).length > 0 ? { ...prev, ...updates } : prev,
      );
    };
    void tick();
    const interval = setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // ─── Upload handling ──────────────────────────────────────────────────────
  // The desktop uses the native OS file picker via @tauri-apps/plugin-dialog
  // (Tauri's webview does NOT expose .path on files from <input type="file">,
  // so we can't use that route). The plugin returns the absolute path
  // directly, which we then read via the existing read_audio_file Tauri
  // command and submit through the new multipart-aware callpilot_api_upload.
  const handleUpload = async () => {
    setError(null);
    let picked: string | null = null;
    try {
      // With multiple: false, the plugin returns a single absolute path
      // (string | null). The user-cancel case is null.
      const selection = await open({
        multiple: false,
        directory: false,
        filters: [
          { name: 'Knowledge documents', extensions: ['pdf', 'docx', 'md', 'txt'] },
        ],
      });
      if (!selection) return; // User cancelled.
      picked = selection as string;
    } catch (e) {
      setError(`Could not open file picker: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (!picked) return;

    // BYOK gate: structured mode needs an LLM provider.  If this user has
    // not connected one, stop with a clear prompt instead of silently
    // failing enrichment in the background.
    if (mode === 'structured') {
      if (hasProvider === false) {
        setError('Connect an AI provider first — open Settings > AI & Keys and add a Groq, OpenAI, or Anthropic API key to enable product extraction.');
        return;
      }
      if (hasProvider === null) {
        try { const p = await authedApiCall<{ providers: { hasKey: boolean }[] }>('GET', '/api/v1/ai/providers'); setHasProvider((p?.providers ?? []).some((x) => x.hasKey)); } catch { /* keep going */ }
      }
    }

    const fileName = picked.split(/[/\\]/).pop() || 'document';
    setUploading(true);
    try {
      // Read the file bytes (read_audio_file works for any binary blob, not
      // just audio - the name is historical from the import flow).
      const bytes = await invoke<number[]>('read_audio_file', { filePath: picked });
      const fileBytes = new Uint8Array(bytes);

      // Best-effort MIME type inference from the extension; the .NET endpoint
      // accepts any content type, so this is just for nicer payloads.
      const ext = (fileName.split('.').pop() || '').toLowerCase();
      const contentType =
        ext === 'pdf' ? 'application/pdf' :
        ext === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' :
        ext === 'md' ? 'text/markdown' :
        ext === 'txt' ? 'text/plain' :
        'application/octet-stream';

      // Auth token is fetched server-side (no token in the webview after the call).
      let token: string | null = null;
      try {
        token = (await invoke<string | null>('get_auth_access_token')) ?? null;
      } catch {
        // No session - let the server reject with 401.
      }

      const result = await invoke<KnowledgeDocument>('callpilot_api_upload', {
        path: `/api/v1/knowledge/upload?mode=${mode}${selectedKbId ? `&knowledgeBaseId=${encodeURIComponent(selectedKbId)}` : ''}`,
        fileName,
        contentType,
        fileBytes: Array.from(fileBytes),
        authToken: token ?? null,
      });

      // Pre-seed polled status so the stepper has something to render on
      // the first tick (matches the web app's pre-seed behaviour).
      setLiveStatuses((prev) => ({
        ...prev,
        [result.id]: {
          id: result.id,
          mode: result.mode === 'structured' ? 'structured' : 'fast',
          processingStatus: result.processingStatus,
          enrichmentStatus: result.enrichmentStatus,
          chunkCount: result.chunkCount,
          entityCount: 0,
          lastUpdatedAt: result.createdAt,
          stages: [],
          lastError: null,
          enrichmentProgress: null,
        },
      }));
      setDocs((prev) => [result, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  // ─── View + delete ────────────────────────────────────────────────────────
  const handleView = async (id: string) => {
    setViewLoading(true);
    setViewDoc(null);
    setActiveTab('chunks');
    try {
      const detail = await authedApiCall<KnowledgeDocumentDetail>(
        'GET',
        `/api/v1/knowledge/${id}`,
      );
      setViewDoc(detail);
    } catch (e) {
      console.warn('[KnowledgeUpload] failed to load doc detail:', e);
    } finally {
      setViewLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await authedApiCall<void>('DELETE', `/api/v1/knowledge/${id}`);
      setDocs((prev) => prev.filter((d) => d.id !== id));
      setLiveStatuses((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (viewDoc?.id === id) setViewDoc(null);
    } catch (e) {
      console.warn('[KnowledgeUpload] failed to delete doc:', e);
    }
  };

  const handleRetryEnrichment = (id: string) => {
    // Optimistically reset the enriching stage to running so polling
    // resumes immediately and the stepper flips from failed → running.
    setLiveStatuses((prev) => {
      const live = prev[id];
      if (!live) return prev;
      return {
        ...prev,
        [id]: {
          ...live,
          enrichmentStatus: 'enriching',
          lastUpdatedAt: new Date().toISOString(),
          stages: live.stages.map((s) =>
            s.key === 'enriching' ? { ...s, status: 'running' as const, error: null, detail: 'Retrying…' } : s,
          ),
          enrichmentProgress: live.enrichmentProgress
            ? { ...live.enrichmentProgress, failed: 0, inFlight: live.enrichmentProgress.total }
            : live.enrichmentProgress,
        },
      };
    });
    // Fetch the fresh status shortly after the server has restarted the pipeline
    setTimeout(async () => {
      try {
        const s = await authedApiCall<DocumentStatus>('GET', `/api/v1/knowledge/${id}/status`);
        setLiveStatuses((prev) => ({ ...prev, [id]: s }));
      } catch {}
    }, 1200);
  };

  // A product was deleted from its detail drawer - drop it from the
  // document's local product list so the chip + counter update immediately
  // (the next status poll confirms from the backend).
  const handleProductDeleted = (canonical: string) => {
    if (!drawer) return;
    const { documentId } = drawer;
    setLiveStatuses((prev) => {
      const live = prev[documentId];
      if (!live) return prev;
      return {
        ...prev,
        [documentId]: {
          ...live,
          products: (live.products ?? []).filter((p) => p.canonical !== canonical),
        },
      };
    });
    setDrawer(null);
  };

  // Bulk delete: remove the selected products (by entity id) from THIS
  // document's local list immediately; the poll confirms from the backend.
  const handleProductsDeleted = (documentId: string, ids: string[]) => {
    setLiveStatuses((prev) => {
      const live = prev[documentId];
      if (!live) return prev;
      return {
        ...prev,
        [documentId]: {
          ...live,
          products: (live.products ?? []).filter((p) => !ids.includes(p.id)),
        },
      };
    });
  };

  const handleOpenProduct = (product: DrawerProduct, documentId: string) => {
    const doc = docsRef.current.find((d) => d.id === documentId);
    setDrawer({ product, documentId, sourceDocument: doc?.fileName ?? 'Document' });
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  const docsForRender = docs.map((d) => {
    const live = liveStatuses[d.id];
    if (!live) return { doc: d, live: null };
    return {
      doc: {
        ...d,
        processingStatus: live.processingStatus,
        enrichmentStatus: live.enrichmentStatus,
        chunkCount: live.chunkCount,
      } as KnowledgeDocument,
      live,
    };
  });

  const filteredDocs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return docsForRender;
    return docsForRender.filter(({ doc }) => doc.fileName.toLowerCase().includes(q));
  }, [docsForRender, search]);

  const selectedKb = knowledgeBases.find((k) => k.id === selectedKbId) ?? null;

  return (
    <div className="space-y-6">
      {/* BYOK: user has not connected an AI provider → guide them before they\n          upload structured documents. */}
      {hasProvider === false && (
        <div className="panel-raised flex flex-wrap items-center justify-between gap-3 border-[var(--opaline-warning-border)] px-4 py-3">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 shrink-0 text-[var(--opaline-warning)]" />
            <div>
              <p className="text-sm font-medium text-[var(--opaline-on-surface)]">No AI provider connected</p>
              <p className="text-caption mt-0.5">Connect Groq, OpenAI, or Anthropic with your own API key to enable product extraction (structured brochures).</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => router.push('/settings?tab=ai')}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-[var(--opaline-on-primary)] transition-colors hover:bg-[var(--opaline-primary-hover)]"
          >
            <KeyRound className="h-4 w-4" /> Go to AI & Keys
          </button>
        </div>
      )}

      {/* Knowledge base (company context) - scopes product intelligence.
          Products discovered in uploaded documents are researched once
          under this company and reused live - no web search during calls. */}
      <section className="space-y-3">
        <h2 className="text-overline">Knowledge base</h2>

        {knowledgeBases.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {knowledgeBases.map((kb) => (
              <button
                key={kb.id}
                type="button"
                onClick={() => setSelectedKbId(kb.id)}
                className={cn(
                  'chip !px-2 !py-1 !text-xs',
                  selectedKbId === kb.id ? 'chip-primary' : 'chip-neutral',
                )}
              >
                {kb.companyName}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setShowKbForm((s) => !s)}
              className="chip chip-neutral !px-2 !py-1 !text-xs"
            >
              + New knowledge base
            </button>
          </div>
        )}

        {selectedKb && (
          <p className="text-caption text-[var(--opaline-on-surface-variant)]">
            <span className="font-medium text-[var(--opaline-on-surface)]">{selectedKb.name}</span>
            {selectedKb.companyName ? ` · ${selectedKb.companyName}` : ''}
            {selectedKb.productsTotal > 0
              ? ` · ${selectedKb.productsEnriched}/${selectedKb.productsTotal} products enriched`
              : ''}
          </p>
        )}

        {(showKbForm || knowledgeBases.length === 0) && (
          <div className="space-y-2.5 rounded-xl border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] p-3">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div>
                <label className="field-label" htmlFor="kb-company">Company</label>
                <Input
                  id="kb-company"
                  value={kbForm.companyName}
                  onChange={(e) => setKbForm((f) => ({ ...f, companyName: e.target.value }))}
                  placeholder="Secure Meters"
                />
              </div>
              <div>
                <label className="field-label" htmlFor="kb-name">Knowledge base name</label>
                <Input
                  id="kb-name"
                  value={kbForm.name}
                  onChange={(e) => setKbForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Secure Meters Products"
                />
              </div>
            </div>
            <div>
              <label className="field-label" htmlFor="kb-website">Website (optional)</label>
              <Input
                id="kb-website"
                value={kbForm.website}
                onChange={(e) => setKbForm((f) => ({ ...f, website: e.target.value }))}
                placeholder="https://…"
              />
            </div>
            <div>
              <label className="field-label" htmlFor="kb-desc">Description (optional)</label>
              <textarea
                id="kb-desc"
                value={kbForm.description}
                onChange={(e) => setKbForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Product knowledge used during sales conversations."
                className="min-h-[64px] w-full resize-y rounded-lg border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] px-3 py-2 text-sm text-[var(--opaline-on-surface)] placeholder:text-[var(--opaline-outline)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--opaline-primary)]"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCreateKb}
                disabled={creatingKb || !kbForm.companyName.trim() || !kbForm.name.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--opaline-primary)] px-3 py-1.5 text-xs font-medium text-[var(--opaline-on-primary)] transition-colors hover:bg-[var(--opaline-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creatingKb && <LoaderIcon className="h-3 w-3 animate-spin" />}
                Create knowledge base
              </button>
              {knowledgeBases.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowKbForm(false)}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--opaline-on-surface-variant)] transition-colors hover:bg-[var(--opaline-surface-container-low)]"
                >
                  Cancel
                </button>
              )}
            </div>
            <p className="text-caption text-[var(--opaline-on-surface-variant)]">
              Products discovered in uploaded documents are researched and saved under this company — during calls their intelligence is shown instantly, no web search needed.
            </p>
          </div>
        )}
      </section>

      {/* Upload dropzone */}
      <section className="space-y-3">
        <h2 className="text-overline">Upload</h2>
        {/* Dropzone - opens the native OS file picker via the Tauri dialog
            plugin. <input type="file"> doesn't expose .path in the Tauri
            webview, so we go directly through the plugin. */}
        <button
          type="button"
          onClick={handleUpload}
          disabled={uploading}
          className="group flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-low)]/50 px-6 py-8 text-center transition-colors hover:border-[var(--opaline-primary)] hover:bg-[var(--opaline-primary-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--opaline-primary)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--opaline-primary-soft)] text-[var(--opaline-primary)]">
            {uploading ? <LoaderIcon className="h-4 w-4 animate-spin" /> : <UploadIcon className="h-4 w-4" />}
          </span>
          <span className="text-label-md text-[var(--opaline-on-surface)]">
            {uploading ? 'Uploading…' : 'Upload document'}
          </span>
          <span className="max-w-md text-caption">
            Upload product docs, battle cards, objection guides - the AI extracts entities
            from them so live calls surface the right recommendations.
          </span>
        </button>

        {/* Ingest mode - selectable option cards instead of a segmented bar */}
        <div className="mt-4">
          <p className="text-overline">
            Ingest mode
          </p>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setMode('fast')}
              aria-pressed={mode === 'fast'}
              className={`rounded-xl border p-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--opaline-primary)] ${
                mode === 'fast'
                  ? 'border-[var(--opaline-primary)] bg-[var(--opaline-primary-soft)]'
                  : 'border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] hover:bg-[var(--opaline-surface-container-low)]'
              }`}
            >
              <div className="flex items-center gap-2">
                <Zap
                  strokeWidth={2}
                  className={`h-4 w-4 ${
                    mode === 'fast' ? 'text-[var(--opaline-primary)]' : 'text-[var(--opaline-on-surface-variant)]'
                  }`}
                />
                <span className="text-sm font-semibold text-[var(--opaline-on-surface)]">Fast</span>
                {mode === 'fast' && (
                  <CheckCircle2 className="ml-auto h-4 w-4 text-[var(--opaline-primary)]" />
                )}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-[var(--opaline-on-surface-variant)]">
                In-process extraction. Sub-second, no LLM pass.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setMode('structured')}
              aria-pressed={mode === 'structured'}
              className={`rounded-xl border p-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--opaline-primary)] ${
                mode === 'structured'
                  ? 'border-[var(--opaline-primary)] bg-[var(--opaline-primary-soft)]'
                  : 'border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] hover:bg-[var(--opaline-surface-container-low)]'
              }`}
            >
              <div className="flex items-center gap-2">
                <Sparkles
                  strokeWidth={2}
                  className={`h-4 w-4 ${
                    mode === 'structured' ? 'text-[var(--opaline-primary)]' : 'text-[var(--opaline-on-surface-variant)]'
                  }`}
                />
                <span className="text-sm font-semibold text-[var(--opaline-on-surface)]">
                  Structured + LLM
                </span>
                {mode === 'structured' && (
                  <CheckCircle2 className="ml-auto h-4 w-4 text-[var(--opaline-primary)]" />
                )}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-[var(--opaline-on-surface-variant)]">
                Docling + async LLM enrichment. Slower but richer product cards.
              </p>
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-[var(--opaline-error-container)] bg-[var(--opaline-error-container)] px-3 py-2 text-sm text-[var(--opaline-on-error-container)]">
          {error}
        </div>
      )}

      {/* Document list */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-overline">
            Documents
          </h2>
          <span className="text-caption tabular-nums text-[var(--opaline-outline)]">
            {filteredDocs.length}
          </span>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--opaline-outline)]" />
          <Input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search documents…"
            className="bg-[var(--opaline-surface-container-lowest)] pl-9 text-[var(--opaline-on-surface)] placeholder:text-[var(--opaline-outline)]"
          />
        </div>
        {docsForRender.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--opaline-outline-variant)] px-6 py-12 text-center">
            <FileText className="mx-auto h-8 w-8 text-[var(--opaline-outline)]" />
            <p className="mt-3 text-body-md text-[var(--opaline-on-surface-variant)]">No documents uploaded yet</p>
            <p className="mt-1 text-caption">
              Upload PDFs, DOCX, or Markdown files to build your knowledge base.
            </p>
          </div>
        ) : filteredDocs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--opaline-outline-variant)] px-6 py-10 text-center">
            <Search className="mx-auto h-6 w-6 text-[var(--opaline-outline)]" />
            <p className="mt-3 text-body-md text-[var(--opaline-on-surface-variant)]">No documents match</p>
            <p className="mt-1 text-caption">
              Nothing matches “{search}”. Try a different file name.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] shadow-xs">
            <div className="divide-y divide-[var(--opaline-outline-variant)]">
              {filteredDocs.map(({ doc, live }) => (
                <DocumentRow
                  key={doc.id}
                  doc={doc}
                  live={live}
                  onDelete={handleDelete}
                  onView={handleView}
                  onOpenProduct={handleOpenProduct}
                  onProductsDeleted={handleProductsDeleted}
                  onRetry={handleRetryEnrichment}
                />
              ))}
            </div>
          </div>
        )}
      </section>

      {/* View modal */}
      {(viewDoc || viewLoading) && (
        <ViewModal
          doc={viewDoc}
          loading={viewLoading}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onClose={() => setViewDoc(null)}
        />
      )}

      {/* Product detail drawer */}
      <ProductDetailDrawer
        open={!!drawer}
        onClose={() => setDrawer(null)}
        documentId={drawer?.documentId ?? ''}
        sourceDocument={drawer?.sourceDocument ?? ''}
        product={drawer?.product ?? null}
        onDeleted={handleProductDeleted}
      />
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────────────
// View modal (chunks / entities)
// ──────────────────────────────────────────────────────────────────────────────

const ViewModal: React.FC<{
  doc: KnowledgeDocumentDetail | null;
  loading: boolean;
  activeTab: 'chunks' | 'entities';
  setActiveTab: (t: 'chunks' | 'entities') => void;
  onClose: () => void;
}> = ({ doc, loading, activeTab, setActiveTab, onClose }) => {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--opaline-inverse-surface)]/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="opaline-glass max-h-[80vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--opaline-outline-variant)] px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-label-md text-[var(--opaline-on-surface)]">
              {doc?.fileName || 'Loading…'}
            </p>
            {doc && (
              <p className="mt-0.5 text-xs text-[var(--opaline-on-surface-variant)]">
                {doc.chunks.length} chunks · {doc.entities.length} entities
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-[var(--opaline-on-surface-variant)] hover:bg-[var(--opaline-surface-container-low)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--opaline-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex border-b border-[var(--opaline-outline-variant)]">
          {(['chunks', 'entities'] as const).map((key) => {
            const isActive = activeTab === key;
            const label = key === 'chunks' ? 'Chunks' : 'Entities';
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'text-[var(--opaline-on-surface)]'
                    : 'text-[var(--opaline-on-surface-variant)] hover:text-[var(--opaline-on-surface)]'
                }`}
              >
                {label}
                {isActive && (
                  <span
                    aria-hidden
                    className="absolute inset-x-0 bottom-0 h-0.5"
                    style={{ backgroundColor: 'var(--opaline-primary)' }}
                  />
                )}
              </button>
            );
          })}
        </div>

        <div className="max-h-[55vh] overflow-y-auto p-5">
          {loading && (
            <div className="space-y-2">
              <div className="animate-shimmer h-9 rounded-lg" />
              <div className="animate-shimmer h-9 rounded-lg" />
              <div className="animate-shimmer h-9 rounded-lg" />
              <div className="animate-shimmer h-9 rounded-lg" />
            </div>
          )}
          {!loading && doc && activeTab === 'chunks' && (
            <div className="space-y-3">
              {doc.chunks.length === 0 && (
                <p className="text-body-sm text-[var(--opaline-on-surface-variant)]">No chunks extracted yet.</p>
              )}
              {doc.chunks.map((chunk) => (
                <div
                  key={chunk.id}
                  className="rounded-xl border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-low)] p-3"
                >
                  <div className="flex items-center gap-2 text-xs text-[var(--opaline-on-surface-variant)]">
                    <span className="font-mono text-[10px]">#{chunk.chunkIndex}</span>
                    {chunk.sectionHeading && (
                      <span className="font-medium text-[var(--opaline-on-surface)]">{chunk.sectionHeading}</span>
                    )}
                    <span className="ml-auto text-[10px]">{chunk.tokenCount} tokens</span>
                  </div>
                  <p className="mt-2 text-body-sm text-[var(--opaline-on-surface)] whitespace-pre-wrap">
                    {chunk.text}
                  </p>
                </div>
              ))}
            </div>
          )}
          {!loading && doc && activeTab === 'entities' && (
            <div className="space-y-2">
              {doc.entities.length === 0 && (
                <p className="text-body-sm text-[var(--opaline-on-surface-variant)]">No entities extracted yet.</p>
              )}
              {doc.entities.map((entity) => (
                <div
                  key={entity.id}
                  className="flex items-center justify-between rounded-xl border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-low)] px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-medium text-[var(--opaline-on-surface)]">{entity.entityText}</p>
                    <p className="text-xs text-[var(--opaline-on-surface-variant)]">{entity.entityType}</p>
                  </div>
                  <span className="text-xs text-[var(--opaline-on-surface-variant)] tabular-nums">
                    {Math.round(entity.confidence * 100)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default KnowledgeUpload;
