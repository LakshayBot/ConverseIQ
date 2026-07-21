// Stub for the deleted onboarding-summary-model helpers. CallPilot model
// selection is handled locally (whisper/Parakeet) and the .NET Gateway
// handles provider selection for the intelligence cards.

export function getSummaryModelSizeMb(_model: string): number { return 0; }
export function getSummaryModelSizeLabel(_model: string): string { return '0 MB'; }
export function getDownloadTotalMb(_a?: any, _b?: any): number { return 0; }
export function formatSummaryModelSizeLabelFromMb(mb: number): string {
  return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}
export interface OnboardingSummaryModelStatus {
  status: 'available' | 'downloading' | 'missing';
  selectedSummaryModel: string;
  summaryModelDownloaded: boolean;
}

export function resolveOnboardingSummaryModelStatus(_input: string | {
  selectedModel?: string;
  recommendedModel?: string;
  selectedModelReady?: boolean;
}): OnboardingSummaryModelStatus {
  const modelName = typeof _input === 'string' ? _input : (_input?.selectedModel ?? '');
  return {
    status: 'available',
    selectedSummaryModel: modelName || 'ggml-base.en',
    summaryModelDownloaded: true,
  };
}
