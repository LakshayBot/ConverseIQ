// CallPilot REST client - routes EVERYTHING through Tauri invoke() so the
// Rust side (reqwest, NO CORS) talks to the .NET Gateway. The browser/webview
// can't do fetch() to Docker-localhost because Tauri's webview origin doesn't
// match the .NET server's CORS allowlist ("localhost:3000" only).
//
// For every endpoint that has no matching CallPilot route yet, we return empty
// or mock data and log a console warning - keeping the UI intact per the
// adaptation brief ("stub rather than remove UI").

import { invoke } from '@tauri-apps/api/core';
import { DEFAULT_CALLPILOT_API_URL, SETTINGS_KEY_API_URL } from './callpilot';
import { authedApiCall as authedApiCallImpl } from './auth';

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
 * bypassing CORS entirely. No Authorization header - use `authedApiCall` for
 * protected endpoints.
 */
async function apiCall(
  method: string,
  path: string,
  body?: unknown,
): Promise<any> {
  const json = body ? JSON.stringify(body) : undefined;
  const result = await invoke<any>('callpilot_api_request', {
    method,
    path,
    body: json ?? null,
    authToken: null,
  });
  // The Rust command returns the parsed JSON body on 2xx, or throws on error.
  return result;
}

/**
 * Re-export the auth-aware variant from `./auth`. Protected endpoints (anything
 * beyond `/api/v1/auth/*`) go through this so the bearer header is attached.
 */
async function authedApiCall<T = any>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  return authedApiCallImpl<T>(method, path, body);
}

function warnStub(name: string): void {
  console.warn(`[callpilot] ${name} not yet wired to CallPilot backend - returning empty data`);
}

// ===== Auth (matches .NET /api/v1/auth/*) =====
//
// Login / register / logout live in `./auth.ts` (which also persists tokens
// and handles session restoration). Re-export the raw response shape here
// for callers that already import from this module.

export type { AuthSession } from './auth';

export { login, register, logout } from './auth';

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
    // The .NET POST /api/v1/meetings endpoint historically returned
    // `{ meetingId, status }` - a different shape than the GET endpoint
    // (`{ id, status, createdAt, ... }`). Normalize both into `MeetingSummary`
    // so callers can rely on `.id` without crashing the live intelligence
    // WebSocket (which is keyed off the meeting id).
    const raw = await authedApiCall<Record<string, any>>('POST', '/api/v1/meetings', { title: title ?? '' });
    const id = raw.id ?? raw.meetingId;
    if (!id) {
      throw new Error('createMeeting response missing both id and meetingId');
    }
    return {
      id: String(id),
      title: raw.title ?? title ?? 'Untitled session',
      status: raw.status ?? 'Created',
      createdAt: raw.createdAt ?? new Date().toISOString(),
    };
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
    return await authedApiCall<MeetingSummary[]>('GET', '/api/v1/meetings');
  } catch (e) {
    warnStub('listMeetings');
    return [];
  }
}

export async function deleteMeeting(meetingId: string): Promise<void> {
  try {
    await authedApiCall('DELETE', `/api/v1/meetings/${meetingId}`);
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
    return await authedApiCall<TranscriptSegment[]>('GET', `/api/v1/meetings/${meetingId}/transcripts`);
  } catch (e) {
    warnStub('getTranscripts');
    return [];
  }
}

export async function postTranscriptText(meetingId: string, text: string): Promise<void> {
  try {
    await authedApiCall('POST', `/api/v1/meetings/${meetingId}/process`, { text });
  } catch (e) {
    warnStub('postTranscriptText');
  }
}

// ===== Intelligence cards =====
//
// Pure mapping from detection data to IntelligenceCards lives in
// ./intelligenceCards (no Tauri deps, unit-testable). Re-exported here
// for back-compat with the rest of the app.

import type {
  IntelligenceCard,
  PastConversationEvent,
  PastRecommendation,
} from './intelligenceCards';
export type {
  IntelligenceCard,
  PastConversationEvent,
  PastRecommendation,
} from './intelligenceCards';
export { entityDisplayName, buildPastIntelligenceCards } from './intelligenceCards';

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

/** Fetch a past meeting's persisted conversation events (oldest first). */
export async function getEventsForMeeting(meetingId: string): Promise<PastConversationEvent[]> {
  return authedApiCall<PastConversationEvent[]>('GET', `/api/v1/meetings/${meetingId}/events`);
}

/** Fetch a past meeting's persisted recommendations (newest first). */
export async function getRecommendationsForMeeting(meetingId: string): Promise<PastRecommendation[]> {
  return authedApiCall<PastRecommendation[]>('GET', `/api/v1/meetings/${meetingId}/recommendations`);
}

// ===== Product Intelligence (global, canonical product profiles) =====

export interface ProductIntelligenceProfile {
  name: string;
  canonicalName: string;
  manufacturer?: string | null;
  category?: string | null;
  description?: string | null;
  whatItDoes?: string | null;
  useCases: string[];
  targetIndustries: string[];
  keyFeatures: string[];
  keySpecifications: string[];
  standoutPoints: string[];
  variants: string[];
  limitations: string[];
  searchQuery?: string | null;
  searchStatus: string;
  enrichmentStatus: string;
  confidenceScore: number;
  sourceCount: number;
  lastEnrichedAt?: string | null;
  lastError?: string | null;
}

export interface ProductSourceInfo {
  title: string;
  url: string;
  domain?: string | null;
  sourceType: string;
  snippet?: string | null;
  relevanceScore: number;
}

/** Reads the cached product profile. The server creates the row + kicks off
 *  background research when the product has never been enriched, so the
 *  returned `enrichmentStatus` drives the loading/ready/failed UI states. */
export async function getProductIntelligence(productName: string): Promise<ProductIntelligenceProfile | null> {
  try {
    return await authedApiCall<ProductIntelligenceProfile>('GET', `/api/v1/products/intelligence/${encodeURIComponent(productName)}`);
  } catch (e) {
    warnStub('getProductIntelligence');
    return null;
  }
}

/** Lazily fetches the researched sources behind a product profile. */
export async function getProductSources(productName: string): Promise<ProductSourceInfo[]> {
  try {
    const resp = await authedApiCall<{ sources: ProductSourceInfo[] }>('GET', `/api/v1/products/intelligence/${encodeURIComponent(productName)}/sources`);
    return resp?.sources ?? [];
  } catch (e) {
    warnStub('getProductSources');
    return [];
  }
}

/** Forces a fresh research run for a product (retry after failure). */
export async function enrichProduct(productName: string): Promise<void> {
  try {
    await authedApiCall('POST', `/api/v1/products/intelligence/${encodeURIComponent(productName)}/enrich`);
  } catch (e) {
    warnStub('enrichProduct');
  }
}

/** Explicit, document-scoped enrichment (drawer Start / Reprocess / Retry).
 *  Marks this document's own product entity + the shared profile Enriching. */
export async function enrichDocumentProduct(documentId: string, productName: string): Promise<void> {
  try {
    await authedApiCall('POST', `/api/v1/knowledge/${documentId}/products/${encodeURIComponent(productName)}/enrich`);
  } catch (e) {
    warnStub('enrichDocumentProduct');
  }
}

/** Bulk enrichment for a document's selected product entity IDs. Reuses the
 *  same pipeline as the individual action; already-Processing products are
 *  left untouched. Throws on failure so the caller can surface a real error
 *  (never silently report "0 queued"). */
export async function bulkEnrichDocumentProducts(
  documentId: string,
  productIds: string[],
): Promise<{ queued: number; processing: number; skipped: number }> {
  return authedApiCall('POST', `/api/v1/knowledge/${documentId}/products/bulk-enrich`, { ids: productIds });
}

/** Bulk delete for a document's selected product entity IDs. Scoped to the
 *  document; never removes the source document or other docs' products.
 *  Throws on failure so the caller can surface a real error. */
export async function bulkDeleteDocumentProducts(
  documentId: string,
  productIds: string[],
): Promise<{ deleted: number }> {
  return authedApiCall('POST', `/api/v1/knowledge/${documentId}/products/bulk-delete`, { ids: productIds });
}

/** Removes a product from a document's product intelligence (not the PDF). */
export async function deleteDocumentProduct(documentId: string, productName: string): Promise<void> {
  await authedApiCall('DELETE', `/api/v1/knowledge/${documentId}/products/${encodeURIComponent(productName)}`);
}
