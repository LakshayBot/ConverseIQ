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

import React, { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import {
  LoaderIcon,
  Upload as UploadIcon,
  Trash2,
  FileText,
  CheckCircle2,
  AlertCircle,
  X,
  Zap,
  Sparkles,
  Check,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { authedApiCall } from '@/lib/auth';

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
  fileName: string;
  contentType: string;
  fileSizeBytes: number;
  processingStatus: string;
  enrichmentStatus: string | null;
  createdAt: string;
  chunkCount: number;
  mode?: 'fast' | 'structured';
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
  return s === 'enriched' || s === 'enrichment_failed';
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Pill helpers
// ──────────────────────────────────────────────────────────────────────────────

const ProcessingPill: React.FC<{ value: string }> = ({ value }) => {
  const isError = String(value || '').startsWith(FAILURE_PREFIX);
  const isDone = value === 'Indexed';
  const bg = isError
    ? 'bg-[var(--opaline-error-container)] text-[var(--opaline-on-error-container)]'
    : isDone
      ? 'bg-[var(--opaline-primary)] text-[var(--opaline-on-primary)]'
      : 'bg-[var(--opaline-surface-container-high)] text-[var(--opaline-on-surface-variant)]';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${bg}`}>
      {value}
    </span>
  );
};

const EnrichmentPill: React.FC<{ value: string | null; mode?: string }> = ({ value, mode }) => {
  if (mode === 'fast' || value == null) return null;
  if (value === 'enriched') {
    return (
      <span className="inline-flex items-center rounded-full border border-[var(--opaline-secondary)] px-2 py-0.5 text-[10px] font-semibold text-[var(--opaline-secondary)]">
        enriched
      </span>
    );
  }
  if (value === 'enrichment_failed') {
    return (
      <span className="inline-flex items-center rounded-full bg-[var(--opaline-error-container)] text-[var(--opaline-on-error-container)] px-2 py-0.5 text-[10px] font-semibold">
        enrichment failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-[var(--opaline-surface-container-high)] text-[var(--opaline-on-surface-variant)] px-2 py-0.5 text-[10px] font-semibold">
      {value}
    </span>
  );
};

// ──────────────────────────────────────────────────────────────────────────────
// Stage row (one row per ingest stage)
// ──────────────────────────────────────────────────────────────────────────────

const StageRow: React.FC<{ stage: IngestStage; lastUpdatedAt: string | null }> = ({ stage, lastUpdatedAt }) => {
  const [expanded, setExpanded] = useState(false);
  const STUCK_THRESHOLD_MS = 30_000;
  const stuckMs =
    stage.status === 'running' && lastUpdatedAt && !stage.error
      ? Date.now() - new Date(lastUpdatedAt).getTime()
      : null;
  const isStuck = stuckMs !== null && stuckMs > STUCK_THRESHOLD_MS;
  const hasContent = stage.detail || stage.error;

  const dot = (() => {
    if (stage.status === 'done') {
      return <CheckCircle2 className="h-4 w-4 text-[var(--opaline-primary)]" />;
    }
    if (stage.status === 'failed') {
      return <AlertCircle className="h-4 w-4 text-[var(--opaline-error)]" />;
    }
    if (stage.status === 'running') {
      return (
        <span
          className={`h-2 w-2 rounded-full animate-pulse ${
            isStuck ? 'bg-[var(--opaline-on-surface-variant)]' : 'bg-[var(--opaline-primary)]'
          }`}
        />
      );
    }
    if (stage.status === 'skipped') {
      return <span className="h-1.5 w-1.5 rounded-full bg-[var(--opaline-outline)]" />;
    }
    return <span className="h-1.5 w-1.5 rounded-full bg-[var(--opaline-outline-variant)]" />;
  })();

  return (
    <li className="text-sm">
      <button
        type="button"
        onClick={() => hasContent && setExpanded((e) => !e)}
        className={`flex w-full items-start gap-2 text-left ${
          hasContent ? 'cursor-pointer rounded px-1 py-0.5 hover:bg-[var(--opaline-surface-container-low)]' : ''
        }`}
      >
        <span className="mt-0.5 flex h-4 w-4 items-center justify-center shrink-0">{dot}</span>
        <span
          className={
            stage.status === 'running'
              ? 'text-[var(--opaline-primary)] font-medium'
              : stage.status === 'failed'
                ? 'text-[var(--opaline-error)] font-medium'
                : stage.status === 'done'
                  ? 'text-[var(--opaline-on-surface)]'
                  : stage.status === 'skipped'
                    ? 'text-[var(--opaline-outline)] line-through'
                    : 'text-[var(--opaline-on-surface-variant)]'
          }
        >
          {stage.label}
        </span>
        {stage.detail && stage.status !== 'running' && (
          <span className="truncate text-xs text-[var(--opaline-on-surface-variant)]">· {stage.detail}</span>
        )}
        {hasContent && (
          <span className="ml-auto text-xs text-[var(--opaline-on-surface-variant)]">
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </span>
        )}
      </button>
      {expanded && hasContent && (
        <div className="ml-6 mt-1 rounded bg-[var(--opaline-surface-container-low)] p-2 text-xs space-y-1">
          {stage.detail && (
            <div className="text-[var(--opaline-on-surface-variant)]">
              <span className="font-medium">detail:</span> {stage.detail}
            </div>
          )}
          {stage.error && (
            <div className="text-[var(--opaline-on-error-container)]">
              <div>
                <span className="font-medium">source:</span> {stage.error.source}
                {stage.error.httpStatus != null && (
                  <span className="ml-2"><span className="font-medium">http:</span> {stage.error.httpStatus}</span>
                )}
                {stage.error.model && (
                  <span className="ml-2"><span className="font-medium">model:</span> {stage.error.model}</span>
                )}
              </div>
              <div className="mt-1 break-words whitespace-pre-wrap rounded border border-[var(--opaline-error-container)] bg-[var(--opaline-error-container)] p-1.5 font-mono text-[11px]">
                {stage.error.message}
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
};

// ──────────────────────────────────────────────────────────────────────────────
// Enrichment progress bar
// ──────────────────────────────────────────────────────────────────────────────

const EnrichmentProgressBar: React.FC<{ progress: EnrichmentProgress }> = ({ progress }) => {
  const pct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
  const barColor =
    progress.failed > 0 ? 'bg-[var(--opaline-error)]' : 'bg-[var(--opaline-primary)]';
  return (
    <div className="mt-3 rounded-md border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-low)] p-3">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-[var(--opaline-on-surface-variant)]">
          LLM enrichment
          <span className="ml-2 font-mono tabular-nums text-[var(--opaline-on-surface)]">
            {progress.completed}/{progress.total}
          </span>
          {progress.failed > 0 && (
            <span className="ml-2 font-medium text-[var(--opaline-error)]">
              ({progress.failed} failed)
            </span>
          )}
          {progress.inFlight > 0 && (
            <span className="ml-2 animate-pulse text-[var(--opaline-primary)]">
              {progress.inFlight} in flight
            </span>
          )}
        </span>
        <span className="font-mono text-[10px] tabular-nums text-[var(--opaline-on-surface-variant)]">
          {pct}%
        </span>
      </div>
      <div
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--opaline-surface-container-high)]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        title={`${pct}% complete`}
      >
        <div
          className={`h-full transition-all duration-300 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────────────
// Document row
// ──────────────────────────────────────────────────────────────────────────────

const DocumentRow: React.FC<{
  doc: KnowledgeDocument;
  live: DocumentStatus | null;
  onDelete: (id: string) => void;
  onView: (id: string) => void;
}> = ({ doc, live, onDelete, onView }) => {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const confirmTimerRef = useRef<number | null>(null);

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

  const processingStatus = live?.processingStatus ?? doc.processingStatus;
  const enrichmentStatus = live?.enrichmentStatus ?? doc.enrichmentStatus;
  const chunkCount = live?.chunkCount ?? doc.chunkCount;
  const entityCount = live?.entityCount ?? 0;
  const showStepper = live && !isDocTerminal({ ...doc, ...live });
  // Show the progress bar whenever the enrichment progress is populated,
  // even post-terminal - partial successes are still worth surfacing.
  const enrichmentProgress = live?.enrichmentProgress ?? null;
  const showProgressBar =
    !!enrichmentProgress &&
    (enrichmentProgress.total > 0) &&
    (enrichmentProgress.completed < enrichmentProgress.total ||
      enrichmentProgress.failed > 0 ||
      enrichmentStatus !== 'enriched');

  return (
    <div className="rounded-2xl border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="truncate text-sm font-semibold text-[var(--grain-ink-900)]">{doc.fileName}</p>
            <ProcessingPill value={processingStatus} />
            <EnrichmentPill value={enrichmentStatus} mode={doc.mode} />
          </div>
          <p className="mt-1 max-w-full truncate font-mono text-xs text-[var(--grain-ink-500)]">
            <span>{formatBytes(doc.fileSizeBytes)}</span>
            <span className="mx-1 opacity-60" aria-hidden>·</span>
            <span>{chunkCount} chunks</span>
            {entityCount > 0 && (
              <>
                <span className="mx-1 opacity-60" aria-hidden>·</span>
                <span>{entityCount} entities</span>
              </>
            )}
            <span className="mx-1 opacity-60" aria-hidden>·</span>
            <span>{new Date(doc.createdAt).toLocaleDateString()}</span>
            {doc.mode && (
              <>
                <span className="mx-1 opacity-60" aria-hidden>·</span>
                <span className="opacity-70">{doc.mode}</span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onView(doc.id)}
            className="rounded-md px-3 py-1 text-xs font-medium text-[var(--grain-ink-500)] transition-colors hover:bg-[var(--grain-paper-2)] hover:text-[var(--grain-ink-900)]"
          >
            View
          </button>
          <button
            type="button"
            onClick={handleDeleteClick}
            aria-label={confirmingDelete ? 'Confirm delete' : 'Delete document'}
            title={confirmingDelete ? 'Click again to confirm' : 'Delete document'}
            className={`rounded-md p-1.5 transition-colors ${
              confirmingDelete
                ? 'bg-[var(--opaline-error-container)] text-[var(--opaline-on-error-container)]'
                : 'text-[var(--grain-ink-500)] hover:bg-[var(--opaline-error-container)] hover:text-[var(--opaline-on-error-container)]'
            }`}
          >
            {confirmingDelete ? <Check className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      {showProgressBar && enrichmentProgress && (
        <EnrichmentProgressBar progress={enrichmentProgress} />
      )}
      {showStepper && live && (
        <div className="mt-3 border-t border-[var(--opaline-outline-variant)] pt-3">
          <ol className="space-y-1.5">
            {STAGE_ORDER.map(({ key, label }) => {
              const fromServer = live.stages.find((s) => s.key === key);
              const stage: IngestStage = fromServer ?? {
                key,
                label,
                status: 'pending',
                startedAt: null,
                finishedAt: null,
                detail: null,
                error: null,
              };
              return (
                <StageRow
                  key={key}
                  stage={stage}
                  lastUpdatedAt={live.lastUpdatedAt}
                />
              );
            })}
            {doc.mode === 'structured' && (
              <StageRow
                stage={
                  live.stages.find((s) => s.key === 'enriching') ?? {
                    key: 'enriching',
                    label: 'LLM enrichment',
                    status: 'pending',
                    startedAt: null,
                    finishedAt: null,
                    detail: null,
                    error: null,
                  }
                }
                lastUpdatedAt={live.lastUpdatedAt}
              />
            )}
          </ol>
        </div>
      )}
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────────────────────────────────────

export const KnowledgeUpload: React.FC = () => {
  const [docs, setDocs] = useState<KnowledgeDocument[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'fast' | 'structured'>('structured');
  const [liveStatuses, setLiveStatuses] = useState<Record<string, DocumentStatus>>({});
  const [viewDoc, setViewDoc] = useState<KnowledgeDocumentDetail | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'chunks' | 'entities'>('chunks');

  // Load docs on mount
  useEffect(() => {
    void loadDocs();
  }, []);

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
        return !isDocTerminal(live ?? d);
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
        path: `/api/v1/knowledge/upload?mode=${mode}`,
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

  return (
    <div className="space-y-6">
      {/* Upload card */}
      <section className="rounded-2xl border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold tracking-tight text-[var(--grain-ink-900)]">
              Knowledge documents
            </h2>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-[var(--grain-ink-500)]">
              Upload product docs, battle cards, objection guides - the AI extracts entities
              from them so live calls surface the right recommendations.
            </p>
          </div>

          {/* Upload button - opens the native OS file picker via the Tauri
              dialog plugin. <input type="file"> doesn't expose .path in the
              Tauri webview, so we go directly through the plugin. */}
          <button
            type="button"
            onClick={handleUpload}
            disabled={uploading}
            className={`group inline-flex items-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium shadow-sm ring-1 ring-black/5 transition-colors ${
              uploading
                ? 'cursor-not-allowed bg-[var(--grain-ink-300)] text-white'
                : 'bg-[var(--grain-ink-900)] text-white hover:bg-[var(--grain-ink-700)]'
            }`}
          >
            {uploading ? <LoaderIcon className="h-4 w-4 animate-spin" /> : <UploadIcon className="h-4 w-4" />}
            {uploading ? 'Uploading…' : 'Upload document'}
          </button>
        </div>

        {/* Ingest mode - selectable option cards instead of a segmented bar */}
        <div className="mt-5">
          <p className="font-display text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--grain-ink-500)]">
            Ingest mode
          </p>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setMode('fast')}
              aria-pressed={mode === 'fast'}
              className={`rounded-xl border p-4 text-left transition-colors ${
                mode === 'fast'
                  ? 'border-[var(--opaline-primary)] bg-[var(--opaline-tone-4)]'
                  : 'border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] hover:bg-[var(--opaline-surface-container-low)]'
              }`}
            >
              <div className="flex items-center gap-2">
                <Zap
                  strokeWidth={2}
                  className={`h-4 w-4 ${
                    mode === 'fast' ? 'text-[var(--opaline-primary)]' : 'text-[var(--grain-ink-500)]'
                  }`}
                />
                <span className="text-sm font-semibold text-[var(--grain-ink-900)]">Fast</span>
                {mode === 'fast' && (
                  <CheckCircle2 className="ml-auto h-4 w-4 text-[var(--opaline-primary)]" />
                )}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-[var(--grain-ink-500)]">
                In-process extraction. Sub-second, no LLM pass.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setMode('structured')}
              aria-pressed={mode === 'structured'}
              className={`rounded-xl border p-4 text-left transition-colors ${
                mode === 'structured'
                  ? 'border-[var(--opaline-primary)] bg-[var(--opaline-tone-4)]'
                  : 'border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] hover:bg-[var(--opaline-surface-container-low)]'
              }`}
            >
              <div className="flex items-center gap-2">
                <Sparkles
                  strokeWidth={2}
                  className={`h-4 w-4 ${
                    mode === 'structured' ? 'text-[var(--opaline-primary)]' : 'text-[var(--grain-ink-500)]'
                  }`}
                />
                <span className="text-sm font-semibold text-[var(--grain-ink-900)]">
                  Structured + LLM
                </span>
                {mode === 'structured' && (
                  <CheckCircle2 className="ml-auto h-4 w-4 text-[var(--opaline-primary)]" />
                )}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-[var(--grain-ink-500)]">
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
      {docsForRender.length === 0 ? (
        <div className="rounded-2xl border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] p-12 text-center">
          <FileText className="mx-auto h-8 w-8 text-[var(--opaline-on-surface-variant)] opacity-60" />
          <p className="mt-3 text-body-md text-[var(--opaline-on-surface-variant)]">No documents uploaded yet</p>
          <p className="mt-1 text-body-sm text-[var(--opaline-on-surface-variant)] opacity-80">
            Upload PDFs, DOCX, or Markdown files to build your knowledge base.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--grain-ink-500)]">
              Your documents
            </h2>
            <span className="text-[10px] font-medium text-[var(--grain-ink-500)] tabular-nums">
              {docsForRender.length}
            </span>
          </div>
          {docsForRender.map(({ doc, live }) => (
            <DocumentRow
              key={doc.id}
              doc={doc}
              live={live}
              onDelete={handleDelete}
              onView={handleView}
            />
          ))}
        </div>
      )}

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
            className="rounded-md p-1.5 text-[var(--opaline-on-surface-variant)] hover:bg-[var(--opaline-surface-container-low)]"
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
            <div className="flex items-center justify-center py-12 text-sm text-[var(--opaline-on-surface-variant)]">
              <LoaderIcon className="mr-2 h-4 w-4 animate-spin" />
              Loading…
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
