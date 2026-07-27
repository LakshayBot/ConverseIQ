/**
 * Configuration Service
 *
 * Frontend-side replacement for the old Tauri SQLite-backed
 * `api_get_model_config` / `api_save_model_config` / etc. shortcuts.
 * Settings now live in two places:
 *
 *   - Server-side (provider config, summary LLM config): .NET Gateway
 *     via /api/v1/providers (Postgres-backed ProviderConfigurations).
 *   - Desktop-local (STT provider preference, auto-generate toggle):
 *     tauri-plugin-store (a small JSON file in the OS app-data dir).
 *
 * The previous Tauri command names (`api_get_model_config`, etc.) are
 * removed entirely once the SQLite module is deleted from the Rust side.
 */

import { Store } from '@tauri-apps/plugin-store';
import { authedApiCall } from '@/lib/auth';
import { TranscriptModelProps } from '@/components/TranscriptSettings';

export type ProviderType =
  | 'ollama'
  | 'groq'
  | 'claude'
  | 'openrouter'
  | 'openai'
  | 'builtin-ai'
  | 'custom-openai';

export interface ModelConfig {
  provider: ProviderType;
  model: string;
  whisperModel: string;
  /** @deprecated Use providerApiKeys from ConfigContext instead. */
  apiKey?: string | null;
  ollamaEndpoint?: string | null;
  // Custom OpenAI fields (only populated when provider is 'custom-openai')
  customOpenAIEndpoint?: string | null;
  customOpenAIModel?: string | null;
  customOpenAIApiKey?: string | null;
  maxTokens?: number | null;
  temperature?: number | null;
  topP?: number | null;
}

export interface CustomOpenAIConfig {
  endpoint: string;
  apiKey: string | null;
  model: string;
  maxTokens: number | null;
  temperature: number | null;
  topP: number | null;
}

export interface RecordingPreferences {
  preferred_mic_device: string | null;
  preferred_system_device: string | null;
}

/** Shape returned by .NET /api/v1/providers. */
interface ProviderConfigDto {
  id: string;
  providerType: string;
  model: string;
  endpoint: string | null;
  temperature: number;
  maxTokens: number;
  timeoutSeconds: number;
}

// ── tauri-plugin-store helpers for desktop-local preferences ──────────────
//
// Two small JSON files in the OS app-data dir. Avoids the round trip
// to the .NET server for settings that are pure UI choices.

async function loadDesktopStore<T>(file: string, key: string, fallback: T): Promise<T> {
  try {
    const store = await Store.load(file);
    const v = await store.get<T>(key);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

async function saveDesktopStore<T>(file: string, key: string, value: T): Promise<void> {
  try {
    const store = await Store.load(file);
    await store.set(key, value);
    await store.save();
  } catch (e) {
    console.warn(`[configService] failed to save ${file}/${key}:`, e);
  }
}

/**
 * Configuration Service
 * Singleton service for managing app configuration
 */
export class ConfigService {
  /**
   * Desktop-local STT provider preference (parakeet / whisper / etc.).
   * Persisted in tauri-plugin-store so it survives an app restart without
   * needing a server round-trip.
   */
  async getTranscriptConfig(): Promise<TranscriptModelProps> {
    const fallback: TranscriptModelProps = {
      provider: 'parakeet',
      model: 'parakeet-tdt-0.6b-v3-int8',
      apiKey: null,
    };
    return loadDesktopStore<TranscriptModelProps>(
      'transcript-config.json',
      'config',
      fallback,
    );
  }

  async saveTranscriptConfig(config: TranscriptModelProps): Promise<void> {
    await saveDesktopStore<TranscriptModelProps>(
      'transcript-config.json',
      'config',
      config,
    );
  }

  /**
   * Summary LLM configuration — lives on the .NET side as a
   * ProviderConfiguration row, keyed by ProviderType.
   */
  async getModelConfig(): Promise<ModelConfig> {
    const providers = await authedApiCall<ProviderConfigDto[]>('GET', '/api/v1/providers');
    const summary = pickSummaryProvider(providers);
    if (!summary) {
      return defaultModelConfig();
    }

    if (summary.providerType === 'custom-openai') {
      return {
        provider: 'custom-openai',
        model: summary.model,
        whisperModel: 'large-v3',
        apiKey: null,
        ollamaEndpoint: null,
        customOpenAIEndpoint: summary.endpoint,
        customOpenAIModel: summary.model,
        customOpenAIApiKey: null,
        maxTokens: summary.maxTokens,
        temperature: summary.temperature,
        topP: null,
      };
    }

    return {
      provider: summary.providerType as ProviderType,
      model: summary.model,
      whisperModel: 'large-v3',
      apiKey: null,
      ollamaEndpoint: summary.endpoint,
      customOpenAIEndpoint: null,
      customOpenAIModel: null,
      customOpenAIApiKey: null,
      maxTokens: summary.maxTokens,
      temperature: summary.temperature,
      topP: null,
    };
  }

  async saveModelConfig(config: ModelConfig): Promise<{ status: string; message: string }> {
    if (config.provider === 'custom-openai') {
      return this.saveCustomOpenAIConfig({
        endpoint: config.customOpenAIEndpoint ?? '',
        apiKey: config.customOpenAIApiKey ?? null,
        model: config.customOpenAIModel ?? config.model,
        maxTokens: config.maxTokens ?? null,
        temperature: config.temperature ?? null,
        topP: config.topP ?? null,
      });
    }

    await authedApiCall('POST', '/api/v1/providers', {
      providerType: config.provider,
      model: config.model,
      endpoint: config.ollamaEndpoint ?? null,
      apiKey: '', // API key set separately via apiKey endpoint if needed
      temperature: config.temperature ?? 0.7,
      maxTokens: config.maxTokens ?? 4096,
      timeoutSeconds: 120,
    });

    return { status: 'success', message: 'Model configuration saved successfully' };
  }

  /** Decrypt + return the API key for a given provider id. */
  async getApiKeyForProvider(providerId: string): Promise<string> {
    try {
      const { apiKey } = await authedApiCall<{ apiKey: string }>(
        'GET',
        `/api/v1/providers/${providerId}/api-key`,
      );
      return apiKey;
    } catch {
      return '';
    }
  }

  /**
   * Audio device preferences — desktop-local (recorded by the audio
   * pipeline, not a server concern). Persisted via tauri-plugin-store.
   */
  async getRecordingPreferences(): Promise<RecordingPreferences> {
    return loadDesktopStore<RecordingPreferences>(
      'recording-preferences.json',
      'prefs',
      { preferred_mic_device: null, preferred_system_device: null },
    );
  }

  async setRecordingPreferences(prefs: RecordingPreferences): Promise<void> {
    await saveDesktopStore<RecordingPreferences>(
      'recording-preferences.json',
      'prefs',
      prefs,
    );
  }

  /**
   * Custom OpenAI configuration — provider row with
   * providerType='custom-openai'.
   */
  async getCustomOpenAIConfig(): Promise<CustomOpenAIConfig | null> {
    const providers = await authedApiCall<ProviderConfigDto[]>('GET', '/api/v1/providers');
    const custom = providers.find((p) => p.providerType === 'custom-openai');
    if (!custom) return null;
    return {
      endpoint: custom.endpoint ?? '',
      apiKey: null,
      model: custom.model,
      maxTokens: custom.maxTokens,
      temperature: custom.temperature,
      topP: null,
    };
  }

  async saveCustomOpenAIConfig(config: CustomOpenAIConfig): Promise<{ status: string; message: string }> {
    await authedApiCall('POST', '/api/v1/providers', {
      providerType: 'custom-openai',
      model: config.model,
      endpoint: config.endpoint,
      apiKey: config.apiKey ?? '',
      temperature: config.temperature ?? 1.0,
      maxTokens: config.maxTokens ?? 4096,
      timeoutSeconds: 120,
    });
    return { status: 'success', message: 'Custom OpenAI configuration saved successfully' };
  }

  /**
   * Test custom OpenAI connection. No DB involved — pure HTTP test, so we
   * keep this in Tauri to avoid bouncing through the .NET server.
   */
  async testCustomOpenAIConnection(
    endpoint: string,
    apiKey: string | null,
    model: string
  ): Promise<{ status: string; message: string; http_status?: number }> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('api_test_custom_openai_connection', { endpoint, apiKey, model });
  }

  /**
   * Auto-generate summary on recording-stop — desktop-local UI preference.
   */
  async getAutoGenerateSetting(): Promise<boolean> {
    return loadDesktopStore<boolean>('ui-preferences.json', 'autoGenerateSummary', true);
  }

  async setAutoGenerateSetting(enabled: boolean): Promise<void> {
    await saveDesktopStore<boolean>('ui-preferences.json', 'autoGenerateSummary', enabled);
  }
}

function defaultModelConfig(): ModelConfig {
  return {
    provider: 'ollama',
    model: '',
    whisperModel: 'large-v3',
    apiKey: null,
    ollamaEndpoint: null,
  };
}

/**
 * Picks the "summary LLM" provider — the .NET side stores multiple
 * ProviderConfigurations per user, but the desktop historically only
 * managed one summary model. For backwards-compat we return the first
 * enabled provider; UI can later be extended to pick among multiple.
 */
function pickSummaryProvider(providers: ProviderConfigDto[]): ProviderConfigDto | null {
  return providers[0] ?? null;
}

// Export singleton instance
export const configService = new ConfigService();