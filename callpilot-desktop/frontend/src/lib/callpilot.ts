// CallPilot server URL configuration + helpers.
// Mirrors `callpilot-desktop/src-tauri/src/api/api.rs` defaults so the frontend
// stays in sync with the Rust backend.
//
// The settings store key is `callpilot_api_url` (REST) and `callpilot_ai_engine_url` (WS).
// Defaults match the CallPilot .NET Gateway (5000) and AI engine (8000) per the
// monorepo CONTEXT.md.

export const DEFAULT_CALLPILOT_API_URL = 'http://localhost:5001';
export const DEFAULT_CALLPILOT_AI_ENGINE_URL = 'ws://localhost:8001';

export const SETTINGS_KEY_API_URL = 'callpilot_api_url';
export const SETTINGS_KEY_AI_ENGINE_URL = 'callpilot_ai_engine_url';
export const SETTINGS_KEY_AUTO_START = 'callpilot_auto_start';
export const SETTINGS_KEY_SAVE_LOCAL = 'callpilot_save_local';
export const SETTINGS_KEY_SHOW_SPEAKER_LABELS = 'callpilot_show_speaker_labels';

export function normalizeWsBaseUrl(url: string): string {
  // Accept http(s) or ws(s) and return the ws variant.
  if (url.startsWith('ws://') || url.startsWith('wss://')) return url;
  if (url.startsWith('https://')) return 'wss://' + url.slice('https://'.length);
  if (url.startsWith('http://')) return 'ws://' + url.slice('http://'.length);
  return url;
}
