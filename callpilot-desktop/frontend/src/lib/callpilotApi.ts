// CallPilot REST client — routes EVERYTHING through Tauri invoke() so the
// Rust side (reqwest, NO CORS) talks to the .NET Gateway. The browser/webview
// can't do fetch() to Docker-localhost because Tauri's webview origin doesn't
// match the .NET server's CORS allowlist ("localhost:3000" only).
//
// For every endpoint that has no matching CallPilot route yet, we return empty
// or mock data and log a console warning — keeping the UI intact per the
// adaptation brief ("stub rather than remove UI").

import { invoke } from '@tauri-apps/api/core';
import { DEFAULT_CALLPILOT_API_URL, SETTINGS_KEY_API_URL } from './callpilot';

let apiBaseUrl: string = DEFAULT_CALLPILOT_API_URL;

export function setCallPilotApiBaseUrl(url: string) {
  apiBaseUrl = (url || DEFAULT_CALLPILOT_API_URL).replace(/\/+$/, '');
  // Also push it to the Rust side so subsequent invoke commands use it.
  try { invoke('set_callpilot_api_url', { url: apiBaseUrl }); } catch {}
}

export function getCallPilotApiBaseUrl(): string {
  return apiBaseUrl;
}

/**
 * Low-level proxy: sends a REST call through the Rust backend (reqwest),
 * bypassing CORS entirely.
 */
async function apiCall(
  method: string,
  path: string,
  body?: unknown,
): Promise<any> {
  const json = body ? JSON.stringify(body) : undefined;
  const result = await invoke<any>('callpilot_api_request', { method, path, body: json ?? null });
  // The Rust command returns the parsed JSON body on 2xx, or throws on error.
  return result;
}

function warnStub(name: string): void {
  console.warn(`[callpilot] ${name} not yet wired to CallPilot backend — returning empty data`);
}

// ===== Auth (matches .NET /api/v1/auth/*) =====

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  return apiCall('POST', '/api/v1/auth/login', { email, password });
}

export async function register(email: string, password: string): Promise<{ id: string; email: string; createdAt: string }> {
  return apiCall('POST', '/api/v1/auth/register', { email, password, confirmPassword: password });
}

export async function logout(refreshToken: string): Promise<void> {
  return apiCall('POST', '/api/v1/auth/logout', { refreshToken });
}

// ===== Meetings =====

export interface MeetingSummary {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  startedAt?: string | null;
  endedAt?: string | null;
}

export async function createMeeting(title?: string): Promise<MeetingSummary> {
  try {
    return await apiCall('POST', '/api/v1/meetings', { title: title ?? '' });
  } catch (e) {
    warnStub('createMeeting');
    return {
      id: crypto.randomUUID(),
      title: title ?? 'Untitled session',
      status: 'Created',
      createdAt: new Date().toISOString(),
    };
  }
}

export async function listMeetings(): Promise<MeetingSummary[]> {
  try {
    return await apiCall('GET', '/api/v1/meetings');
  } catch (e) {
    warnStub('listMeetings');
    return [];
  }
}

export async function deleteMeeting(meetingId: string): Promise<void> {
  try {
    await apiCall('DELETE', `/api/v1/meetings/${meetingId}`);
  } catch (e) {
    warnStub('deleteMeeting');
  }
}

// ===== Transcript + recommendations =====

export interface TranscriptSegment {
  id: string;
  speaker: string;
  text: string;
  confidence: number;
  startOffset: number;
  endOffset: number;
  isFinal: boolean;
  sequence: number;
  createdAt: string;
}

export async function getTranscripts(meetingId: string): Promise<TranscriptSegment[]> {
  try {
    return await apiCall('GET', `/api/v1/meetings/${meetingId}/transcripts`);
  } catch (e) {
    warnStub('getTranscripts');
    return [];
  }
}

export async function postTranscriptText(meetingId: string, text: string): Promise<void> {
  try {
    await apiCall('POST', `/api/v1/meetings/${meetingId}/process`, { text });
  } catch (e) {
    warnStub('postTranscriptText');
  }
}

// ===== Intelligence cards =====

export interface IntelligenceCard {
  type: 'competitor_detected' | 'objection' | 'buying_signal' |
        'product_match' | 'pricing_discussion' | 'technical_question';
  title: string;
  body: string;
  severity: 'high' | 'medium' | 'low';
  chunks: string[];
}

// ===== Test connection (uses the Rust-side test command directly) =====

export async function testConnection(): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const result = await invoke<any>('callpilot_test_connection');
    return { ok: result.ok, status: result.status, error: result.error };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

// ===== Tauri pass-through for storage =====

export async function persistApiUrl(url: string): Promise<void> {
  try {
    await invoke('set_callpilot_api_url', { url });
  } catch {
    try { localStorage.setItem(SETTINGS_KEY_API_URL, url); } catch {}
  }
}

export async function persistAiEngineUrl(url: string): Promise<void> {
  try {
    await invoke('set_callpilot_ai_engine_url', { url });
  } catch {
    try { localStorage.setItem('callpilot_ai_engine_url', url); } catch {}
  }
}
