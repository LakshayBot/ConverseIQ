// Stub for the deleted summary-language helpers. CallPilot handles language
// preferences server-side via the .NET Gateway.

export function applyPinnedSummaryLanguageToMeeting(_meetingId?: string, _lang?: string): void {}
export function getPinnedSummaryLanguage(_meetingId?: string): string | null { return null; }
export function pinSummaryLanguage(_meetingId?: string, _lang?: string): void {}
export function unpinSummaryLanguage(_meetingId?: string): void {}
export const PINNED_LANGUAGE_STORAGE_KEY = 'callpilot_summary_lang_pinned';
export const SUMMARY_LANGUAGE_DEFAULT_KEY = 'callpilot_summary_lang_default';
export const SUMMARY_LANGUAGE_RECENTS_KEY = 'callpilot_summary_lang_recents';
export function readPinnedSummaryLanguageDefault(): string | null { return null; }
export function writePinnedSummaryLanguageDefault(_lang?: string | null): void {}

export async function detectAndCacheSummaryLanguage(_meetingId?: string, _transcripts?: string[]): Promise<string | null> {
  // CallPilot performs language detection server-side.
  return null;
}

