// Stub for the deleted summary-languages helpers. CallPilot handles language
// detection server-side via the .NET Gateway / AI engine.

export interface SummaryLanguageOption {
  code: string;
  label: string;
}

export const SUMMARY_LANGUAGE_OPTIONS: SummaryLanguageOption[] = [
  { code: 'auto', label: 'Auto-detect' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'it', label: 'Italian' },
  { code: 'ja', label: 'Japanese' },
  { code: 'zh', label: 'Chinese' },
];

// Compatibility alias for callers that previously imported LANGUAGE_OPTIONS.
export const LANGUAGE_OPTIONS = SUMMARY_LANGUAGE_OPTIONS;

export function normaliseLanguageCode(input: string): string {
  if (!input) return 'auto';
  const lower = input.toLowerCase();
  return SUMMARY_LANGUAGE_OPTIONS.some((o) => o.code === lower) ? lower : 'auto';
}
