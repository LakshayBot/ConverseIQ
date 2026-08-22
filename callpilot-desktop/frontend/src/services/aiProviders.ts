import { authedApiCall } from '@/lib/auth';
import type {
  AiProviderDto,
  AiModel,
  CallPilotUsage,
  CreateProviderRequest,
  DeleteProviderResponse,
  ListModelsResponse,
  ListProvidersResponse,
  ProviderLimitsResponse,
  ProviderPreference,
  TestProviderResponse,
} from '@/types/aiProviders';

const BASE = '/api/v1/ai';

/** Friendly, key-safe message for an AI provider error. */
export function describeAiError(raw: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const text = typeof raw === 'string' ? raw : String(raw ?? '');
  const statusMatch = text.match(/^HTTP[ ]+([0-9]{3})[ ]*:/);
  if (statusMatch) {
    const status = Number(statusMatch[1]);
    if (status === 401) return 'Not signed in. Please sign in again.';
    if (status === 404) return 'The requested resource was not found.';
    if (status === 429) return 'Rate limited by the server. Please try again shortly.';
    if (status >= 500) return 'The CallPilot server hit an error. Please try again shortly.';
  }
  if (text.includes('timed out') || text.includes('Timeout')) {
    return 'The CallPilot server took too long to respond. Check Settings → Server.';
  }
  if (text.includes('Could not connect') || text.includes('Could not reach')) {
    return "Couldn't reach the CallPilot server. Check Settings → Server.";
  }
  return text || fallback;
}

export async function getAiProviders(): Promise<ListProvidersResponse> {
  return authedApiCall<ListProvidersResponse>('GET', BASE + '/providers');
}

export async function upsertAiProvider(body: CreateProviderRequest): Promise<AiProviderDto> {
  return authedApiCall<AiProviderDto>('POST', BASE + '/providers', body);
}

export async function deleteAiProvider(id: string): Promise<DeleteProviderResponse> {
  return authedApiCall<DeleteProviderResponse>('DELETE', BASE + '/providers/' + encodeURIComponent(id));
}

export async function testAiProvider(body: {
  providerType: string;
  apiKey: string;
  endpoint?: string | null;
}): Promise<TestProviderResponse> {
  return authedApiCall<TestProviderResponse>('POST', BASE + '/providers/test', body);
}

export async function getAiModels(body: {
  providerType: string;
  apiKey: string;
  endpoint?: string | null;
}): Promise<AiModel[]> {
  // Discovery for a NEW/typed key (client sends the key once during connect).
  const resp = await authedApiCall<ListModelsResponse>('POST', BASE + '/providers/models', body);
  return (resp && resp.models) || [];
}

export async function getAiModelsForProvider(providerId: string): Promise<AiModel[]> {
  // Discovery for an ALREADY-CONNECTED provider: the server decrypts the
  // stored key and lists models - the client never sees the plaintext key.
  const resp = await authedApiCall<ListModelsResponse>('GET', BASE + '/providers/' + encodeURIComponent(providerId) + '/models');
  return (resp && resp.models) || [];
}

export async function testStoredAiProvider(providerId: string): Promise<TestProviderResponse> {
  // Test an ALREADY-CONNECTED provider using its stored key (server-side).
  return authedApiCall<TestProviderResponse>('POST', BASE + '/providers/' + encodeURIComponent(providerId) + '/test');
}

export async function getAiPreference(feature: string): Promise<ProviderPreference> {
  return authedApiCall<ProviderPreference>('GET', BASE + '/preferences/' + encodeURIComponent(feature));
}

export async function setAiPreference(
  feature: string,
  body: { providerConfigurationId: string | null; model: string | null },
): Promise<ProviderPreference> {
  return authedApiCall<ProviderPreference>('PUT', BASE + '/preferences/' + encodeURIComponent(feature), body);
}

export async function getAiUsage(providerId?: string | null): Promise<CallPilotUsage> {
  const qs = providerId ? '?providerId=' + encodeURIComponent(providerId) : '';
  return authedApiCall<CallPilotUsage>('GET', BASE + '/usage' + qs);
}

export async function getAiProviderLimits(id: string): Promise<ProviderLimitsResponse> {
  return authedApiCall<ProviderLimitsResponse>('GET', BASE + '/providers/' + encodeURIComponent(id) + '/limits');
}
