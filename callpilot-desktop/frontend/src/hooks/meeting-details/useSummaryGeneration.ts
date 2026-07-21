'use client';

// Stub for the deleted useSummaryGeneration hook. Returns no-ops so the
// meeting-details page still compiles after the summary screen was removed.

import { useCallback } from 'react';

export interface SummaryGenerationOptions {
  meetingId?: string;
  meeting?: any;
  transcripts?: any[];
  modelConfig?: any;
  isModelConfigLoading?: boolean;
  selectedTemplate?: any;
  onMeetingUpdated?: () => void;
  updateMeetingTitle?: (title: string) => void;
  setAiSummary?: (summary: any) => void;
  onOpenModelSettings?: () => void;
  onComplete?: () => void;
  onError?: (err: Error) => void;
  [key: string]: any;
}

export function useSummaryGeneration(_opts: SummaryGenerationOptions) {
  const generate = useCallback(async (..._args: any[]) => {
    // CallPilot: summary generation happens server-side via the .NET Gateway.
  }, []);
  return {
    generateSummary: generate,
    handleGenerateSummary: generate,
    isGenerating: false,
    error: null,
  };
}
