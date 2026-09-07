'use client';

// useActionItemExtraction - thin companion to useLocalSummarization for
// meetings recorded BEFORE the structured action-item schema shipped.
//
// Re-runs ONLY action-item extraction against the already-loaded transcript
// through the local llama-helper sidecar (Tauri `extract_action_items`) -
// the full summary is never regenerated and the transcript never leaves the
// device. On success the returned items are merged into the saved summary
// blob via the existing PUT /api/v1/meetings/{id}/summary endpoint:
//   - summary exists  → same blob with ONLY data.actionItems replaced
//   - no summary      → minimal blob { actionItems, actionItemState: {} }
// On error the saved blob is untouched.

import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { authedApiCall } from '@/lib/auth';
import { useConfig } from '@/contexts/ConfigContext';
import type { LocalSummary, StructuredActionItem } from '@/lib/llm';

export type ExtractionState = 'idle' | 'extracting' | 'done' | 'error';

export function useActionItemExtraction(
  meetingId: string | null,
  summary: LocalSummary | null,
) {
  const { summarizationModel } = useConfig();
  const [extractionState, setExtractionState] = useState<ExtractionState>('idle');
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const summaryRef = useRef(summary);
  summaryRef.current = summary;
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const extractActionItemsOnly = useCallback(
    async (transcriptText: string) => {
      if (!meetingId || !transcriptText.trim()) return;
      setExtractionState('extracting');
      setExtractionError(null);
      try {
        // Same model selection as summarization - no separate selector.
        const items = await invoke<StructuredActionItem[]>('extract_action_items', {
          transcript: transcriptText,
          model: summarizationModel,
        });

        const existing = summaryRef.current;
        const data: Record<string, unknown> = existing
          ? // PATCH semantics: only actionItems is replaced - every other
            // field of the LLM summary survives untouched.
            { ...existing, actionItems: items }
          : { actionItems: items, actionItemState: {} };

        await authedApiCall('PUT', `/api/v1/meetings/${meetingId}/summary`, {
          // 'completed' is the status the GET endpoint's UI gate surfaces.
          status: 'completed',
          data,
        });

        if (mountedRef.current) setExtractionState('done');
      } catch (e) {
        console.warn('[useActionItemExtraction] extraction failed:', e);
        // Saved blob untouched on error.
        if (mountedRef.current) {
          setExtractionError(e instanceof Error ? e.message : String(e));
          setExtractionState('error');
        }
      }
    },
    [meetingId, summarizationModel],
  );

  return { extractionState, extractionError, extractActionItemsOnly };
}
