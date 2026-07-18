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
 * Lightweight status poller — returns just the two status fields and
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
  /** LLM enrichment state — null in fast mode, otherwise "enriching" | "enriched" | "enrichment_failed" */
  enrichmentStatus: string | null;
  createdAt: string;
  chunkCount: number;
  /** Which ingest path was used.  Fast = in-process Docnet; structured = Python AI Engine (Docling + optional LLM enrichment). */
  mode?: 'fast' | 'structured';
}

/**
 * Minimal document status snapshot.  Returned by GET /api/v1/knowledge/{id}/status
 * for the ProcessingStepper to poll without re-fetching chunks/entities.
 */
export interface DocumentStatus {
  id: string;
  processingStatus: string;
  enrichmentStatus: string | null;
  chunkCount: number;
  entityCount: number;
}

export interface KnowledgeDocumentDetail extends KnowledgeDocument {
  chunks: { id: string; chunkIndex: number; text: string; tokenCount: number }[];
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
