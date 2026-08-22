const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001';

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export async function apiRequest<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {} } = options;

  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  };

  if (accessToken) {
    requestHeaders['Authorization'] = `Bearer ${accessToken}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers: requestHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || `HTTP ${response.status}`);
  }

  if (response.status === 204) return undefined as T;
  return response.json();
}

export async function apiLogin(email: string, password: string) {
  return apiRequest<LoginResponse>('/api/v1/auth/login', {
    method: 'POST',
    body: { email, password },
  });
}

export async function apiRegister(email: string, password: string) {
  return apiRequest<RegisterResponse>('/api/v1/auth/register', {
    method: 'POST',
    body: { email, password, confirmPassword: password },
  });
}

export async function apiCreateMeeting() {
  return apiRequest<{ meetingId: string; status: string }>('/api/v1/meetings', {
    method: 'POST',
  });
}

export async function apiGetMeetings() {
  return apiRequest<Meeting[]>(`/api/v1/meetings`);
}

export async function apiGetTranscripts(meetingId: string) {
  return apiRequest<TranscriptEntry[]>(`/api/v1/meetings/${meetingId}/transcripts`);
}

export async function apiGetProviders() {
  return apiRequest<Provider[]>('/api/v1/providers');
}

export async function apiCreateProvider(provider: CreateProviderRequest) {
  return apiRequest<Provider>('/api/v1/providers', {
    method: 'POST',
    body: provider,
  });
}

export async function apiDeleteProvider(id: string) {
  return apiRequest<void>(`/api/v1/providers/${id}`, { method: 'DELETE' });
}

export async function apiUploadKnowledge(file: File, mode: 'fast' | 'structured' = 'fast') {
  const formData = new FormData();
  formData.append('file', file);

  const headers: Record<string, string> = {};
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  const response = await fetch(`${API_BASE}/api/v1/knowledge/upload?mode=${mode}`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<KnowledgeDocument>;
}

export async function apiGetKnowledgeDocuments() {
  return apiRequest<KnowledgeDocument[]>('/api/v1/knowledge');
}

export async function apiDeleteKnowledgeDocument(id: string) {
  return apiRequest<void>(`/api/v1/knowledge/${id}`, { method: 'DELETE' });
}

export async function apiGetKnowledgeDocument(id: string) {
  return apiRequest<KnowledgeDocumentDetail>(`/api/v1/knowledge/${id}`);
}

/**
 * Lightweight status poller - returns just the two status fields and
 * cheap counts.  Used by the ProcessingStepper to refresh every ~1.5s
 * without pulling the full chunk/entity payload.  Resolves to null if
 * the document was deleted between polls.
 */
export async function apiGetDocumentStatus(id: string): Promise<DocumentStatus | null> {
  try {
    return await apiRequest<DocumentStatus>(`/api/v1/knowledge/${id}/status`);
  } catch {
    return null;
  }
}

/**
 * Fetch the raw AI-engine output (Docling metadata + LLM enrichment
 * response) for the dashboard's "View raw" tab.  Returned by
 * GET /api/v1/knowledge/{id}/raw-output.  Null on 404 / auth failure.
 */
export async function apiGetDocumentRawOutput(id: string): Promise<DocumentRawOutput | null> {
  try {
    return await apiRequest<DocumentRawOutput>(`/api/v1/knowledge/${id}/raw-output`);
  } catch {
    return null;
  }
}

export interface ProductDetailsDocument {
  id: string;
  fileName: string;
  pageHint: number;
  sectionHeading: string | null;
  snippet: string | null;
}

export interface ProductDetails {
  name: string;
  type: string;
  confidence?: number;
  description: string | null;
  documents: ProductDetailsDocument[];
  isSeed: boolean;
  notFound: boolean;
}

/** Fetch product details for the live-meeting product card. */
export async function apiGetProductDetails(name: string): Promise<ProductDetails> {
  return apiRequest<ProductDetails>(
    `/api/v1/knowledge/entities/${encodeURIComponent(name)}/details`,
  );
}

export interface KnowledgeDocument {
  id: string;
  fileName: string;
  contentType: string;
  fileSizeBytes: number;
  processingStatus: string;
  /** LLM enrichment state - null in fast mode, otherwise "enriching" | "enriched" | "enrichment_failed" */
  enrichmentStatus: string | null;
  createdAt: string;
  chunkCount: number;
  /** Which ingest path was used.  Fast = in-process Docnet; structured = Python AI Engine (Docling + optional LLM enrichment). */
  mode?: 'fast' | 'structured';
}

/**
 * Per-stage entry in the document ingest log.  The dashboard's
 * ProcessingStepper renders one row per stage, so the user can see
 * exactly where the pipeline is (or where it failed) without a
 * server-log round-trip.
 */
export interface IngestStageError {
  stage: string;
  source: 'ai-engine' | 'groq' | 'gliner' | 'dotnet' | 'unknown';
  httpStatus: number | null;
  message: string;
  model: string | null;
  at: string;
}

export interface IngestStage {
  key: 'uploaded' | 'extracting' | 'chunking' | 'embedding' | 'indexed' | 'entityextraction' | 'enriching';
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  startedAt: string | null;
  finishedAt: string | null;
  detail: string | null;
  error: IngestStageError | null;
}

/**
 * Live progress of the LLM enrichment pass.  Populated as each page
 * completes (the .NET handler writes a new row to the
 * EnrichmentProgressJson jsonb column on every page result), so the
 * dashboard polls (every ~1.5s) see real-time counts and per-page
 * status during a long enrichment run.
 */
export interface EnrichmentPageStatus {
  page: number;
  status:
    | 'pending'
    | 'ok'
    | 'no_products'
    | 'missing_key'
    | 'http_4xx'
    | 'http_5xx'
    | 'timeout'
    | 'connection_error'
    | 'parse_error'
    | 'unknown';
  model: string | null;
  durationMs: number;
  error: string | null;
  finishedAt: string | null;
  /** 0 = clean first-try. 1+ = at least one rate-limit retry was needed. */
  retryCount: number;
}

export interface EnrichmentProgress {
  total: number;
  completed: number;     // pages with status ok | no_products
  failed: number;        // pages with any other status
  inFlight: number;      // pages still being processed by the AI engine
  pages: EnrichmentPageStatus[];
}

/**
 * Document status snapshot.  Returned by GET /api/v1/knowledge/{id}/status
 * for the ProcessingStepper to poll without re-fetching chunks/entities.
 *
 * The dashboard polls every 1.5s during processing; the server returns
 * stages[] + lastError + enrichmentProgress as in-row jsonb on the same
 * SELECT, so the cost is one row + a jsonb read.
 */
export interface DocumentStatus {
  id: string;
  mode: 'fast' | 'structured';
  processingStatus: string;
  enrichmentStatus: string | null;
  chunkCount: number;
  entityCount: number;
  /** UTC timestamp of the most recent stage transition.  Used by the
   *  dashboard to distinguish "stuck" (>30s since last update) from
   *  "still running".  null for legacy rows. */
  lastUpdatedAt: string | null;
  stages: IngestStage[];
  lastError: IngestStageError | null;
  /** Live LLM enrichment progress.  null until enrichment starts. */
  enrichmentProgress: EnrichmentProgress | null;
}

/**
 * Raw AI-engine output for a document.  Returned by
 * GET /api/v1/knowledge/{id}/raw-output.  Powers the dashboard's
 * "View raw" tab so the user can see what Docling produced and what
 * the LLM generated without re-running anything.
 */
export interface DocumentRawOutput {
  id: string;
  fileName: string;
  mode: 'fast' | 'structured';
  rawOutput: {
    docling?: {
      page_count: number;
      convert_ms: number;
      chunk_ms: number;
      model_load_ms: number | null;
      warnings: string[];
    };
    enrichment?: {
      document_id: string;
      page_count: number;
      enrichment_ms: number;
      products_total: number;
      failure_count: number;
      model: string | null;
      pages: Array<{
        page: number;
        page_type: string;
        products: Array<{
          name: string;
          category: string | null;
          headline: string | null;
          key_features: string[];
          pricing: string | null;
          best_for: string | null;
          differentiators: string[];
          raw_claims: string[];
          chunk_text: string;
        }>;
        outcome: {
          status: 'ok' | 'no_products' | 'missing_key' | 'http_4xx' | 'http_5xx' | 'timeout' | 'connection_error' | 'parse_error' | 'unknown';
          model: string | null;
          duration_ms: number;
          error: string | null;
        } | null;
      }>;
      stage_outcomes: Array<{
        page: number;
        outcome: {
          status: string;
          model: string | null;
          duration_ms: number;
          error: string | null;
        } | null;
      }>;
    };
  } | null;
}

export interface KnowledgeChunkDetail {
  id: string;
  chunkIndex: number;
  text: string;
  tokenCount: number;
  /** "fast" | "structured" | "enriched".  Used by the chunks tab to
   *  group rows by source. */
  source?: 'fast' | 'structured' | 'enriched';
  sectionHeading: string | null;
  chunkType: string;
  pageHint: number;
  /** Raw MetadataJson from the server (string-encoded jsonb).  Null
   *  for fast-mode chunks. */
  metadata: string | null;
}

export interface KnowledgeDocumentDetail extends KnowledgeDocument {
  chunks: KnowledgeChunkDetail[];
  entities: { id: string; entityText: string; entityType: string; confidence: number }[];
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
}

export interface RegisterResponse {
  id: string;
  email: string;
  createdAt: string;
}

export interface Meeting {
  id: string;
  status: string;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface TranscriptEntry {
  speaker: string;
  text: string;
  confidence: number;
  isFinal: boolean;
  sequence: number;
  createdAt: string;
}

export interface Provider {
  id: string;
  providerType: string;
  model: string;
  endpoint: string | null;
  temperature: number;
  maxTokens: number;
  timeoutSeconds: number;
  isEnabled: boolean;
  createdAt: string;
}

export interface CreateProviderRequest {
  providerType: string;
  model: string;
  endpoint: string | null;
  apiKey: string;
  temperature: number;
  maxTokens: number;
  timeoutSeconds: number;
}
/* ─────────────────────────────────────────────────────────────
   AI Providers (BYOK) — /api/v1/ai/*
   Mirrors the desktop contract; used by the Providers page.
   ───────────────────────────────────────────────────────────── */

export type AiProviderType = 'groq' | 'openai' | 'anthropic';

export interface AiProviderDto {
  id: string;
  providerType: AiProviderType;
  model: string | null;
  endpoint: string | null;
  hasKey: boolean;
  maskedKey: string | null;
  isEnabled: boolean;
  createdAt: string;
  usedForFeatures: string[];
}

export interface ListAiProvidersResponse {
  providers: AiProviderDto[];
  features: string[];
}

export interface CreateAiProviderRequest {
  providerType: AiProviderType;
  model: string | null;
  endpoint: string | null;
  apiKey: string;
  temperature?: number | null;
  maxTokens?: number | null;
  timeoutSeconds?: number | null;
}

export type AiTestErrorCode =
  | 'invalid_api_key' | 'key_expired_or_revoked' | 'insufficient_credits'
  | 'rate_limit_reached' | 'model_unavailable' | 'provider_unavailable'
  | 'request_failed' | 'invalid_response' | 'ok' | 'unknown';

export interface AiTestResult {
  valid: boolean;
  errorCode: AiTestErrorCode;
  error?: string | null;
}

export interface AiModel {
  id: string;
  name: string;
  capabilities: string[];
  supportsJsonOutput: boolean;
  fromFallback: boolean;
}

export interface AiPreference {
  feature: string;
  providerConfigurationId: string | null;
  model: string | null;
}

export interface AiUsageRow {
  providerType: AiProviderType;
  requestCount: number;
  successCount: number;
  failedCount: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export interface AiUsage {
  totalRequests: number;
  successful: number;
  failed: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  byProvider: AiUsageRow[];
}

export interface AiLimitSnapshot {
  capturedAt: string;
  snapshotJson: string;
}

export interface AiLimits {
  limits: AiLimitSnapshot[];
  note: string;
}

export async function apiGetAiProviders() {
  return apiRequest<ListAiProvidersResponse>('/api/v1/ai/providers');
}

export async function apiUpsertAiProvider(body: CreateAiProviderRequest) {
  return apiRequest<AiProviderDto>('/api/v1/ai/providers', { method: 'POST', body });
}

export async function apiDeleteAiProvider(id: string) {
  return apiRequest<{ id: string; deleted: boolean }>('/api/v1/ai/providers/' + encodeURIComponent(id), { method: 'DELETE' });
}

export async function apiTestAiProviderStored(providerId: string) {
  return apiRequest<AiTestResult>('/api/v1/ai/providers/' + encodeURIComponent(providerId) + '/test', { method: 'POST' });
}

export async function apiTestAiProvider(body: { providerType: string; apiKey: string; endpoint?: string | null }) {
  return apiRequest<AiTestResult>('/api/v1/ai/providers/test', { method: 'POST', body });
}

export async function apiGetAiModels(body: { providerType: string; apiKey: string; endpoint?: string | null }) {
  const resp = await apiRequest<{ models: AiModel[] }>('/api/v1/ai/providers/models', { method: 'POST', body });
  return (resp && resp.models) || [];
}

export async function apiGetAiModelsForProvider(providerId: string) {
  // Connected provider: server decrypts the stored key and lists models.
  const resp = await apiRequest<{ models: AiModel[] }>(`/api/v1/ai/providers/${encodeURIComponent(providerId)}/models`);
  return (resp && resp.models) || [];
}

export async function apiGetAiPreference(feature: string) {
  return apiRequest<AiPreference>('/api/v1/ai/preferences/' + encodeURIComponent(feature));
}

export async function apiSetAiPreference(feature: string, body: { providerConfigurationId: string | null; model: string | null }) {
  return apiRequest<AiPreference>('/api/v1/ai/preferences/' + encodeURIComponent(feature), { method: 'PUT', body });
}

export async function apiGetAiUsage(providerId?: string | null) {
  const qs = providerId ? '?providerId=' + encodeURIComponent(providerId) : '';
  return apiRequest<AiUsage>('/api/v1/ai/usage' + qs);
}

export async function apiGetAiLimits(id: string) {
  return apiRequest<AiLimits>('/api/v1/ai/providers/' + encodeURIComponent(id) + '/limits');
}

