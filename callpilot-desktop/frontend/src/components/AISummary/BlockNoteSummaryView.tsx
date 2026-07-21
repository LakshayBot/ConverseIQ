'use client';

// Stub for the deleted BlockNoteSummaryViewRef type — preserves the original
// method shape (getMarkdown, saveSummary, isDirty) so call sites in
// useMeetingData keep type-checking.

export interface BlockNoteSummaryViewRef {
  getMarkdown?: () => string;
  saveSummary?: () => Promise<void>;
  isDirty?: boolean;
}
