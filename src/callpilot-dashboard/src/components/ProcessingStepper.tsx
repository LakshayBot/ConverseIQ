'use client';

/**
 * ProcessingStepper
 *
 * Renders one row per ingest stage so the user can see exactly where
 * the document is in the pipeline.  Drives itself off the parent's
 * polled `DocumentStatus` — the parent owns the polling interval and
 * just hands fresh data in.  We intentionally don't fetch here so
 * multiple stepper instances (e.g. two docs uploading concurrently)
 * share the same polling cadence.
 *
 * The stepper is keyed off the new `stages[]` array returned by
 * GET /api/v1/knowledge/{id}/status.  The previous string-prefix
 * matching on `processingStatus` is gone — each row is explicit.
 *
 * Row states:
 *   done      → green check
 *   running   → blue pulse, or yellow pulse if "stuck" (>30s since
 *               lastUpdatedAt with no error)
 *   failed    → red X with the error message in the title and
 *               expanded on click
 *   skipped   → gray strike-through dot
 *   pending   → gray empty dot
 *
 * Click any row to expand and see the detail + (if failed) the
 * full error message.  Click again to collapse.
 *
 * The whole stepper hides itself once every stage is terminal
 * (done | skipped), matching the previous behaviour.
 */

import { useState } from 'react';
import { DocumentStatus, IngestStage, IngestStageError } from '@/lib/api';

interface Props {
  status: DocumentStatus;
  /** "fast" hides the LLM stage; "structured" shows it.  Defaults to structured. */
  mode?: 'fast' | 'structured';
}

const STUCK_THRESHOLD_MS = 30_000;

function isTerminal(s: IngestStage['status']): boolean {
  return s === 'done' || s === 'skipped';
}

function stuckSince(status: DocumentStatus, stage: IngestStage): number | null {
  if (stage.status !== 'running') return null;
  if (!status.lastUpdatedAt) return null;
  // A running stage is "stuck" if the document's last update is older
  // than the threshold AND there's no error to explain the silence.
  // (A stage that failed is "failed", not "stuck".)
  if (stage.error) return null;
  const ageMs = Date.now() - new Date(status.lastUpdatedAt).getTime();
  if (ageMs < STUCK_THRESHOLD_MS) return null;
  return ageMs;
}

export default function ProcessingStepper({ status, mode = 'structured' }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // The stepper normally hides once every stage is terminal
  // (done | skipped).  But if the LLM enrichment stage failed
  // (i.e. enrichmentStatus === 'enrichment_failed'), we keep it
  // visible so the user can see the failure reason and per-page
  // counts.  Same if the enrichment progress is populated (so
  // partial successes are still visible after the doc settles).
  const enrichingStage = status.stages.find(s => s.key === 'enriching');
  const enrichingFailed = enrichingStage?.status === 'failed';
  const hasEnrichmentProgress = status.enrichmentProgress != null
    && status.enrichmentProgress.total > 0;
  const keepVisible = enrichingFailed || hasEnrichmentProgress;

  // Build the row list in declared order.  Structured mode shows
  // the LLM enrichment stage; fast mode hides it.  Stages not
  // present in the server response are rendered as "pending" so the
  // pipeline shape is always visible.
  const stageOrder: Array<{ key: IngestStage['key']; label: string }> = [
    { key: 'uploaded', label: 'Uploaded' },
    { key: 'extracting', label: 'Extracting' },
    { key: 'chunking', label: 'Chunking' },
    { key: 'embedding', label: 'Embedding' },
    { key: 'indexed', label: 'Indexed' },
    { key: 'entityextraction', label: 'Entity extraction' },
  ];
  if (mode === 'structured') {
    stageOrder.push({ key: 'enriching', label: 'LLM enrichment' });
  }

  const rows = stageOrder.map(({ key, label }) => {
    const fromServer = status.stages?.find(s => s.key === key);
    return (
      fromServer ?? {
        key, label,
        status: 'pending' as const,
        startedAt: null, finishedAt: null, detail: null, error: null,
      }
    );
  });

  // Hide the stepper once every stage is terminal (and the LLM
  // stage, if shown, is also terminal).  This matches the previous
  // behaviour so the document list doesn't grow an empty stepper
  // forever.
  const allRowsTerminal = rows.every(r => isTerminal(r.status));
  if (allRowsTerminal && !keepVisible) return null;

  const toggle = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <ol className="space-y-1.5">
        {rows.map(stage => {
          const stuckMs = stuckSince(status, stage);
          const isExpanded = expanded.has(stage.key);
          const hasContent = stage.detail || stage.error;
          return (
            <li key={stage.key} className="text-sm">
              <button
                type="button"
                onClick={() => hasContent && toggle(stage.key)}
                className={`w-full flex items-start gap-2 text-left ${
                  hasContent ? 'cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5' : 'cursor-default'
                }`}
                title={stage.error?.message ?? stage.detail ?? undefined}
              >
                <StepIndicator stage={stage} stuckMs={stuckMs} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={
                      stage.status === 'running' ? 'text-blue-700 font-medium' :
                      stage.status === 'failed' ? 'text-red-700 font-medium' :
                      stage.status === 'done' ? 'text-green-700' :
                      stage.status === 'skipped' ? 'text-gray-400 line-through' :
                      'text-gray-500'
                    }>
                      {stage.label}
                    </span>
                    {stuckMs !== null && (
                      <span
                        className="text-xs px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-800 border border-yellow-200"
                        title={`no update in ${Math.round(stuckMs / 1000)}s`}
                      >
                        stuck? {Math.round(stuckMs / 1000)}s
                      </span>
                    )}
                    {stage.status === 'failed' && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-800 border border-red-200">
                        failed
                      </span>
                    )}
                    {stage.status === 'skipped' && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                        skipped
                      </span>
                    )}
                    {stage.key === 'enriching' && status.enrichmentProgress && (
                      <EnrichmentCounts progress={status.enrichmentProgress} />
                    )}
                    {stage.detail && stage.status !== 'running' && (
                      <span className="text-xs text-gray-500 truncate">
                        · {stage.detail}
                      </span>
                    )}
                  </div>
                  {isExpanded && hasContent && (
                    <ExpandedDetail stage={stage} />
                  )}
                </div>
                {hasContent && (
                  <span className="text-xs text-gray-400 shrink-0">
                    {isExpanded ? '▾' : '▸'}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function StepIndicator({ stage, stuckMs }: { stage: IngestStage; stuckMs: number | null }) {
  if (stage.status === 'done') {
    return (
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-100 shrink-0 mt-0.5">
        <svg className="w-3 h-3 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </span>
    );
  }
  if (stage.status === 'failed') {
    return (
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-100 shrink-0 mt-0.5">
        <svg className="w-3 h-3 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </span>
    );
  }
  if (stage.status === 'running') {
    // Stuck (no update in >30s, no error) gets a yellow pulse so the
    // user can see "this looks slow" without it reading as a
    // failure.
    const isStuck = stuckMs !== null;
    const bg = isStuck ? 'bg-yellow-100' : 'bg-blue-100';
    const dot = isStuck ? 'bg-yellow-600' : 'bg-blue-600';
    return (
      <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full ${bg} shrink-0 mt-0.5`}>
        <span className={`w-2 h-2 rounded-full ${dot} animate-pulse`} />
      </span>
    );
  }
  if (stage.status === 'skipped') {
    return (
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-100 shrink-0 mt-0.5">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-100 shrink-0 mt-0.5">
      <span className="w-1.5 h-1.5 rounded-full bg-gray-300" />
    </span>
  );
}

function ExpandedDetail({ stage }: { stage: IngestStage }) {
  return (
    <div className="mt-1.5 ml-1 p-2 bg-gray-50 rounded text-xs space-y-1">
      {stage.detail && (
        <div className="text-gray-700">
          <span className="font-medium text-gray-500">detail:</span> {stage.detail}
        </div>
      )}
      {stage.error && <ErrorBlock error={stage.error} />}
      {stage.startedAt && (
        <div className="text-gray-500 font-mono text-[11px]">
          started: {new Date(stage.startedAt).toLocaleTimeString()}
          {stage.finishedAt && (
            <> · finished: {new Date(stage.finishedAt).toLocaleTimeString()}</>
          )}
        </div>
      )}
    </div>
  );
}

function ErrorBlock({ error }: { error: IngestStageError }) {
  return (
    <div className="text-red-800">
      <div>
        <span className="font-medium text-red-900">source:</span> {error.source}
        {error.httpStatus != null && (
          <span className="ml-2"><span className="font-medium text-red-900">http:</span> {error.httpStatus}</span>
        )}
        {error.model && (
          <span className="ml-2"><span className="font-medium text-red-900">model:</span> {error.model}</span>
        )}
      </div>
      <div className="mt-1 break-words whitespace-pre-wrap font-mono text-[11px] bg-red-50 p-1.5 rounded border border-red-200">
        {error.message}
      </div>
    </div>
  );
}

// Compact live counts for the LLM enrichment stage.  Shows the
// running tally of "X enriched, Y failed" plus a tiny progress bar
// so the user can see at a glance whether enrichment is moving
// along or stuck.  Rendered inline next to the "LLM enrichment"
// label; click the row to expand the full per-page list (Pages tab).
function EnrichmentCounts({ progress }: { progress: NonNullable<DocumentStatus['enrichmentProgress']> }) {
  const pct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
  return (
    <span className="flex items-center gap-1.5 text-[10px]">
      <span className="text-green-700 font-medium">
        {progress.completed}/{progress.total}
      </span>
      {progress.failed > 0 && (
        <span className="text-red-700 font-medium">
          ({progress.failed} failed)
        </span>
      )}
      {progress.inFlight > 0 && (
        <span className="text-blue-600 animate-pulse">
          {progress.inFlight} in flight
        </span>
      )}
      <span
        className="inline-block h-1.5 w-12 bg-gray-200 rounded-full overflow-hidden"
        title={`${pct}% complete`}
      >
        <span
          className={`block h-full ${progress.failed > 0 ? 'bg-red-400' : 'bg-green-500'}`}
          style={{ width: `${pct}%` }}
        />
      </span>
    </span>
  );
}
