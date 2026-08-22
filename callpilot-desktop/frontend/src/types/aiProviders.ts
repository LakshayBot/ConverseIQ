
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

export interface ListProvidersResponse {
  providers: AiProviderDto[];
  features: string[];
}

export interface CreateProviderRequest {
  providerType: AiProviderType;
  model: string | null;
  endpoint: string | null;
  apiKey: string;
  temperature?: number | null;
  maxTokens?: number | null;
  timeoutSeconds?: number | null;
}

export interface DeleteProviderResponse {
  id: string;
  deleted: boolean;
}

export type TestErrorCode =
  | 'invalid_api_key'
  | 'key_expired_or_revoked'
  | 'insufficient_credits'
  | 'rate_limit_reached'
  | 'model_unavailable'
  | 'provider_unavailable'
  | 'request_failed'
  | 'invalid_response'
  | 'ok'
  | 'unknown';

export interface TestProviderResponse {
  valid: boolean;
  errorCode: TestErrorCode;
  error?: string | null;
}

export type ModelCapability = 'json_output' | 'chat' | 'long_context';

export interface AiModel {
  id: string;
  name: string;
  capabilities: ModelCapability[];
  supportsJsonOutput: boolean;
  fromFallback: boolean;
}

export interface ListModelsResponse {
  models: AiModel[];
}

export interface ProviderPreference {
  feature: string;
  providerConfigurationId: string | null;
  model: string | null;
}

export interface CallPilotUsageByProvider {
  providerType: AiProviderType;
  requestCount: number;
  successCount: number;
  failedCount: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export interface CallPilotUsage {
  totalRequests: number;
  successful: number;
  failed: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  byProvider: CallPilotUsageByProvider[];
}

export interface ProviderLimitSnapshot {
  capturedAt: string;
  snapshotJson: string;
}

export interface ProviderLimitsResponse {
  limits: ProviderLimitSnapshot[];
  note: string;
}
