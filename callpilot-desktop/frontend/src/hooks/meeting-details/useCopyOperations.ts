'use client';

// Stub for the deleted useCopyOperations hook.

import { useCallback } from 'react';

interface CopyOperationsOptions {
  meeting?: any;
  summaryData?: any;
  transcripts?: any[];
  meetingTitle?: string;
  aiSummary?: any;
  blockNoteSummaryRef?: any;
  [key: string]: any;
}

export function useCopyOperations(_opts: CopyOperationsOptions) {
  const copy = useCallback(async (_format?: 'markdown' | 'plain' | 'json') => {
    // no-op stub
  }, []);
  return {
    copyTranscript: copy,
    handleCopyTranscript: copy,
    isCopying: false,
  };
}
