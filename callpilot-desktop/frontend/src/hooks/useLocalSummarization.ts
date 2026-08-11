'use client';

// useLocalSummarization - runs local LLM meeting summarization and persists
// the result to the backend.
//
// The transcript is summarized entirely on the user's machine (Ollama) - it
// is never sent to a server LLM. Only the finished structured summary is PUT
// to the backend. If the save fails the generated summary is retained locally
// (keyed by meeting id) so it can be retried without re-running inference.

import { useCallback, useEffect, useState } from 'react';
import { authedApiCall } from '@/lib/auth';
import {
  generateLocalSummary,
  listenLlmSummaryProgress,
  SUMMARIZATION_MODEL_NAMES,
  type SummaryProgressEvent,
} from '@/lib/llm';
import { useConfig } from '@/contexts/ConfigContext';

export type LocalSummaryState =
  | 'idle'
  | 'summarizing'
  | 'saving'
  | 'done'
  | 'failed'
  | 'pending-save';

export interface PendingSummaryPayload {
  meetingId: string;
  payload: Record<string, unknown>;
  at: number;
}

function pendingKey(meetingId: string) {
  return `callpilot-pending-summary-${meetingId}`;
}

function loadPending(meetingId: string): PendingSummaryPayload | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(pendingKey(meetingId));
    return raw ? (JSON.parse(raw) as PendingSummaryPayload) : null;
  } catch {
    return null;
  }
}

/** PUTs the generated summary; on failure retains it locally for retry. */
export async function saveSummary(meetingId: string, payload: Record<string, unknown>): Promise<boolean> {
  try {
    await authedApiCall('PUT', `/api/v1/meetings/${meetingId}/summary`, {
      status: 'completed',
      data: payload,
    });
    if (typeof window !== 'undefined') localStorage.removeItem(pendingKey(meetingId));
    return true;
  } catch {
    try {
      localStorage.setItem(pendingKey(meetingId), JSON.stringify({ meetingId, payload, at: Date.now() }));
    } catch {
      // localStorage full - nothing more we can do
    }
    return false;
  }
}

export function useLocalSummarization(meetingId: string | null) {
  const { summarizationModel } = useConfig();
  const [state, setState] = useState<LocalSummaryState>('idle');
  const [progress, setProgress] = useState<SummaryProgressEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A previous inference succeeded but its save failed - offer a retry.
  useEffect(() => {
    if (meetingId && loadPending(meetingId)) {
      setState('pending-save');
    }
  }, [meetingId]);

  const generate = useCallback(
    async (transcriptText: string) => {
      if (!meetingId || !transcriptText.trim()) return;
      setState('summarizing');
      setError(null);
      setProgress({ stage: 'preparing', percent: 2 });

      let unlisten: (() => void) | undefined;
      try {
        unlisten = await listenLlmSummaryProgress((e) => setProgress(e)).catch(() => undefined);
      } catch {
        unlisten = undefined;
      }

      try {
        // The Rust side uses the selected Ollama model when available and
        // otherwise falls back to the built-in extractive summarizer - a
        // useful summary is always produced with zero setup.
        const summary = await generateLocalSummary(transcriptText, summarizationModel);
        const payload: Record<string, unknown> = {
          ...summary,
          model: summarizationModel ?? 'builtin',
          modelName: summarizationModel
            ? SUMMARIZATION_MODEL_NAMES[summarizationModel] ?? summarizationModel
            : 'Built-in summary',
          generatedLocally: true,
          generatedAt: new Date().toISOString(),
        };
        setState('saving');
        setProgress({ stage: 'saving', percent: 95 });
        const saved = await saveSummary(meetingId, payload);
        setState(saved ? 'done' : 'pending-save');
        setProgress(null);
      } catch (e) {
        setState('failed');
        setError(e instanceof Error ? e.message : String(e));
        setProgress(null);
      } finally {
        unlisten?.();
      }
    },
    [meetingId, summarizationModel],
  );

  /** Retries saving a previously-generated summary without re-running inference. */
  const retrySave = useCallback(async () => {
    if (!meetingId) return;
    const pending = loadPending(meetingId);
    if (!pending) return;
    setState('saving');
    const saved = await saveSummary(meetingId, pending.payload);
    setState(saved ? 'done' : 'pending-save');
  }, [meetingId]);

  return { state, progress, error, generate, retrySave };
}
