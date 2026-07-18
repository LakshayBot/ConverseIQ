'use client';

/**
 * ProcessingStepper
 *
 * Inline horizontal stepper for a document that's mid-processing.
 * Drives itself off the parent's polled `DocumentStatus` — the parent
 * owns the polling interval and just hands fresh data in.  We intentionally
 * don't fetch here so multiple stepper instances (e.g. two docs uploading
 * concurrently) share the same polling cadence.
 *
 * Steps shown:
 *   1. Uploading     — covers the POST /upload round trip
 *   2. Extracting    — Docling / Docnet pass
 *   3. Chunking      — paragraph / Docling chunker
 *   4. Embedding     — embedding model pass
 *   5. Indexed       — main pipeline done, queryable
 *   6. LLM Enriched  — only shown in structured mode; reflects EnrichmentStatus
 *
 * The stepper hides itself once both pipelines are terminal (Indexed +
 * (enriched | enrichment_failed | null-for-fast-mode)).
 */

import { DocumentStatus } from '@/lib/api';

interface Props {
  status: DocumentStatus;
  /** "fast" hides the LLM step; "structured" shows it.  Defaults to structured. */
  mode?: 'fast' | 'structured';
}

type StepState = 'done' | 'active' | 'pending' | 'skipped';

interface Step {
  key: string;
  label: string;
  state: StepState;
}

const TERMINAL_PROCESSING = new Set(['Indexed', 'No extractable text found']);
const FAILURE_PREFIX = 'Error:';

function stepState(current: string, target: string, isActive: (s: string) => boolean): StepState {
  if (isActive(target)) return 'active';
  // A step is "done" if processingStatus has progressed past it.
  // We model progression as: Uploaded → Extracting* → Chunking → Embedding → Indexed.
  // "Extracting (structured)" also counts as past "Extracting".
  const order: Array<{ match: (s: string) => boolean }> = [
    { match: s => s === 'Uploaded' },
    { match: s => s.startsWith('Extracting') },
    { match: s => s === 'Chunking' },
    { match: s => s === 'Embedding' },
    { match: s => TERMINAL_PROCESSING.has(s) || s.startsWith(FAILURE_PREFIX) },
  ];
  const currentIdx = order.findIndex(o => o.match(current));
  const targetIdx = order.findIndex(o => o.match(target));
  if (currentIdx === -1 || targetIdx === -1) return 'pending';
  return targetIdx < currentIdx ? 'done' : 'pending';
}

function llmStepState(enrichment: string | null, processing: string): StepState {
  // LLM enrichment only starts after the main pipeline is done.
  if (!TERMINAL_PROCESSING.has(processing) && !processing.startsWith(FAILURE_PREFIX)) {
    return 'pending';
  }
  // Main pipeline failed → LLM never runs.
  if (processing.startsWith(FAILURE_PREFIX) || processing === 'No extractable text found') {
    return 'skipped';
  }
  if (enrichment === 'enriching') return 'active';
  if (enrichment === 'enriched') return 'done';
  if (enrichment === 'enrichment_failed') return 'skipped'; // show as ended, with a red dot
  return 'pending';
}

export default function ProcessingStepper({ status, mode = 'structured' }: Props) {
  const processing = status.processingStatus;
  const enrichment = status.enrichmentStatus;

  const isActive = (target: string): boolean => {
    if (target === 'Uploaded') return processing === 'Uploaded';
    if (target === 'Extracting') return processing.startsWith('Extracting');
    if (target === 'Chunking') return processing === 'Chunking';
    if (target === 'Embedding') return processing === 'Embedding';
    if (target === 'Indexed') return TERMINAL_PROCESSING.has(processing);
    return false;
  };

  const steps: Step[] = [
    { key: 'uploaded', label: 'Uploaded', state: stepState(processing, 'Uploaded', isActive) },
    { key: 'extracting', label: 'Extracting', state: stepState(processing, 'Extracting', isActive) },
    { key: 'chunking', label: 'Chunking', state: stepState(processing, 'Chunking', isActive) },
    { key: 'embedding', label: 'Embedding', state: stepState(processing, 'Embedding', isActive) },
    { key: 'indexed', label: 'Indexed', state: stepState(processing, 'Indexed', isActive) },
  ];
  if (mode === 'structured') {
    steps.push({ key: 'enriched', label: 'LLM Enriched', state: llmStepState(enrichment, processing) });
  }

  // Hide the stepper once everything is in a terminal state.
  const mainDone = TERMINAL_PROCESSING.has(processing) || processing.startsWith(FAILURE_PREFIX);
  const llmDone = mode === 'fast'
    || enrichment === 'enriched'
    || enrichment === 'enrichment_failed';
  if (mainDone && llmDone) return null;

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <ol className="flex items-center gap-1 overflow-x-auto pb-1">
        {steps.map((step, i) => (
          <li key={step.key} className="flex items-center gap-1 shrink-0">
            <StepIndicator step={step} />
            <span className={`text-xs ${
              step.state === 'active' ? 'text-blue-600 font-medium' :
              step.state === 'done' ? 'text-green-600' :
              step.state === 'skipped' ? 'text-gray-400' :
              'text-gray-400'
            }`}>
              {step.label}
            </span>
            {i < steps.length - 1 && (
              <span className={`mx-1 h-px w-6 ${
                step.state === 'done' ? 'bg-green-300' : 'bg-gray-200'
              }`} />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function StepIndicator({ step }: { step: Step }) {
  if (step.state === 'done') {
    return (
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-100">
        <svg className="w-3 h-3 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </span>
    );
  }
  if (step.state === 'active') {
    return (
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-100">
        <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse" />
      </span>
    );
  }
  if (step.state === 'skipped') {
    return (
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-100">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-100">
      <span className="w-1.5 h-1.5 rounded-full bg-gray-300" />
    </span>
  );
}
