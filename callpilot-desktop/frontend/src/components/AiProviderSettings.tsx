'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2, CheckCircle2, XCircle, Sparkles, Trash2, RefreshCw,
  Plus, ChevronDown, Save, AlertTriangle, Plug, HelpCircle,
  ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { AnthropicMark, GroqMark, OpenAIMark } from '@/components/provider-logos';
import type {
  AiProviderDto,
  AiProviderType,
  AiModel,
  ProviderPreference,
  TestErrorCode,
} from '@/types/aiProviders';
import {
  getAiProviders, upsertAiProvider, deleteAiProvider, testAiProvider, testStoredAiProvider,
  getAiModels, getAiModelsForProvider, getAiPreference, setAiPreference, describeAiError,
} from '@/services/aiProviders';
import { AiProviderUsagePanel } from '@/components/AiProviderUsagePanel';

const PROVIDER_TYPES: AiProviderType[] = ['groq', 'openai', 'anthropic'];

const PROVIDER_META: Record<AiProviderType, { label: string; logo: React.FC<{ className?: string }>; brandToken: string; description: string; helpUrl: string; keyPrefix: string }> = {
  groq: { label: 'Groq', logo: GroqMark, brandToken: '--brand-groq', description: 'Fast inference on LPU hardware.', helpUrl: 'https://console.groq.com/keys', keyPrefix: 'gsk_' },
  openai: { label: 'OpenAI', logo: OpenAIMark, brandToken: '--brand-openai', description: 'GPT models via the OpenAI API.', helpUrl: 'https://platform.openai.com/api-keys', keyPrefix: 'sk-' },
  anthropic: { label: 'Anthropic', logo: AnthropicMark, brandToken: '--brand-anthropic', description: 'Claude models via the Anthropic API.', helpUrl: 'https://console.anthropic.com/settings/keys', keyPrefix: 'sk-ant-' },
};

const TEST_ERROR_TEXT: Record<TestErrorCode, string> = {
  invalid_api_key: 'Invalid API key',
  key_expired_or_revoked: 'Key expired or revoked',
  insufficient_credits: 'Insufficient credits',
  rate_limit_reached: 'Rate limit reached',
  model_unavailable: 'Selected model unavailable',
  provider_unavailable: 'Provider temporarily unavailable',
  request_failed: 'Request failed',
  invalid_response: 'Provider returned an invalid response',
  ok: 'Connection successful',
  unknown: 'Unknown error',
};

const FEATURE_KEYS = ['knowledge_processing', 'document_extraction', 'product_extraction'];

const FEATURE_LABELS: Record<string, string> = {
  knowledge_processing: 'Knowledge Processing',
  document_extraction: 'Document extraction',
  product_extraction: 'Product extraction',
};

const EXTRA_NOTE = 'Model list is a curated fallback — Anthropic does not expose a model list API.';

interface ConnectedModels {
  providerId: string;
  models: AiModel[];
  loading: boolean;
  error: string | null;
}

export const AiProviderSettings: React.FC = () => {
  const [providers, setProviders] = useState<AiProviderDto[]>([]);
  const [features, setFeatures] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, ConnectedModels>>({});
  const [openForm, setOpenForm] = useState<Record<string, boolean>>({});
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [tests, setTests] = useState<Record<string, { testing: boolean; result: { ok: boolean; message: string } | null }>>({});
  const [prefs, setPrefs] = useState<Record<string, ProviderPreference>>({});
  const [prefsDirty, setPrefsDirty] = useState<Record<string, boolean>>({});
  const [prefsSaving, setPrefsSaving] = useState<Record<string, boolean>>({});
  const [prefsSaved, setPrefsSaved] = useState<Record<string, boolean>>({});
  const [usageProviderId, setUsageProviderId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await getAiProviders();
      setProviders((data && data.providers) || []);
      const feats = (data && data.features) || [];
      setFeatures(Array.from(new Set([...FEATURE_KEYS, ...feats])));
    } catch (e) {
      const d = describeAiError(e);
      setLoadError(d.indexOf('Not signed in') >= 0 ? 'Not signed in' : 'Could not load AI providers: ' + d);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const discoverModels = useCallback(async (p: AiProviderDto) => {
    setModelsByProvider((prev) => ({ ...prev, [p.id]: { providerId: p.id, models: [], loading: true, error: null } }));
    try {
      // Connected provider: the server decrypts the stored key and lists
      // models - the client never touches the plaintext key.  (The separate
      // getAiModels POST path is only used for a fresh typed key before save.)
      const models = p.hasKey
        ? await getAiModelsForProvider(p.id)
        : await getAiModels({ providerType: p.providerType, apiKey: keyInputs[p.providerType] ?? '', endpoint: p.endpoint });
      setModelsByProvider((prev) => ({
        ...prev,
        [p.id]: { providerId: p.id, models: models || [], loading: false, error: models && models.length === 0 ? 'No models returned.' : null },
      }));
    } catch (e) {
      setModelsByProvider((prev) => ({ ...prev, [p.id]: { providerId: p.id, models: [], loading: false, error: 'Could not load models.' } }));
    }
  }, [keyInputs]);

  useEffect(() => {
    for (const p of providers) {
      if (p.hasKey && !(p.id in modelsByProvider)) discoverModels(p);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers]);

  useEffect(() => {
    if (features.length === 0) return;
    let cancelled = false;
    (async () => {
      const next: Record<string, ProviderPreference> = {};
      for (const f of features) {
        try {
          const pref = await getAiPreference(f);
          if (!cancelled) next[f] = pref;
        } catch {
          // ignore per-feature load failures
        }
      }
      if (!cancelled) setPrefs((prev) => ({ ...prev, ...next }));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features]);

  const provider = (type: AiProviderType) => providers.find((x) => x.providerType === type) ?? null;

  const onConnect = async (type: AiProviderType) => {
    const key = (keyInputs[type] ?? '').trim();
    if (!key) return;
    setOpenForm((prev) => ({ ...prev, [type]: false }));
    try {
      const created = await upsertAiProvider({ providerType: type, model: null, endpoint: null, apiKey: key });
      setKeyInputs((prev) => ({ ...prev, [type]: '' }));
      await reload();
      if (created && created.id) {
        await discoverModels(created);
      } else {
        const fresh = await getAiProviders();
        const found = fresh && fresh.providers ? fresh.providers.find((x) => x.providerType === type) : undefined;
        if (found) await discoverModels(found);
      }
    } catch (e) {
      setLoadError('Could not save the API key: ' + describeAiError(e));
    }
  };

  const onRemove = async (type: AiProviderType) => {
    const p = provider(type);
    if (!p) return;
    try {
      await deleteAiProvider(p.id);
      setModelsByProvider((prev) => { const next = { ...prev }; delete next[p.id]; return next; });
      await reload();
    } catch (e) {
      setLoadError('Could not remove provider: ' + describeAiError(e));
    }
  };

  const onTest = async (type: AiProviderType) => {
    const p = provider(type);
    const key = (keyInputs[type] ?? '').trim();
    setTests((prev) => ({ ...prev, [type]: { testing: true, result: null } }));
    try {
      // Connected provider: probe the STORED key server-side.  A freshly typed
      // key is sent once for validation before being saved.
      const resp = p && p.hasKey && !key
        ? await testStoredAiProvider(p.id)
        : await testAiProvider({ providerType: type, apiKey: key || (p?.maskedKey ?? ''), endpoint: p ? p.endpoint : null });
      const message = resp.valid ? TEST_ERROR_TEXT.ok : (resp.error || TEST_ERROR_TEXT[resp.errorCode] || TEST_ERROR_TEXT.unknown);
      setTests((prev) => ({ ...prev, [type]: { testing: false, result: { ok: resp.valid, message } } }));
    } catch (e) {
      setTests((prev) => ({ ...prev, [type]: { testing: false, result: { ok: false, message: 'Could not reach the provider: ' + describeAiError(e) } } }));
    }
  };

  const onPreferenceChange = (feature: string, patch: Partial<ProviderPreference>) => {
    setPrefs((prev) => {
      const cur = prev[feature] || { feature, providerConfigurationId: null, model: null };
      return { ...prev, [feature]: { ...cur, ...patch } };
    });
    setPrefsDirty((prev) => ({ ...prev, [feature]: true }));
    setPrefsSaved((prev) => ({ ...prev, [feature]: false }));
  };

  const savePreference = async (feature: string) => {
    const pref = prefs[feature];
    if (!pref) return;
    setPrefsSaving((prev) => ({ ...prev, [feature]: true }));
    try {
      const updated = await setAiPreference(feature, {
        providerConfigurationId: pref.providerConfigurationId,
        model: pref.model,
      });
      setPrefs((prev) => ({ ...prev, [feature]: updated }));
      setPrefsDirty((prev) => ({ ...prev, [feature]: false }));
      setPrefsSaved((prev) => ({ ...prev, [feature]: true }));
      window.setTimeout(() => setPrefsSaved((prev) => ({ ...prev, [feature]: false })), 2000);
    } catch (e) {
      setLoadError('Could not save preference: ' + describeAiError(e));
    } finally {
      setPrefsSaving((prev) => ({ ...prev, [feature]: false }));
    }
  };

  const connectedProviders = providers.filter((x) => x.hasKey);
  const anyConnected = connectedProviders.length > 0;
  const selectedUsageProvider = usageProviderId ? connectedProviders.find((x) => x.id === usageProviderId) ?? null : null;

  if (loading) {
    return (
      <div className="max-w-4xl space-y-6 py-4">
        <SectionHeading title="AI Providers & API Keys" subtitle="Bring your own key (Groq, OpenAI, or Anthropic) so CallPilot uses it for document intelligence." />
        <div className="flex items-center gap-3 rounded-lg border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] px-4 py-8 text-sm text-[var(--opaline-on-surface-variant)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading AI providers…
        </div>
      </div>
    );
  }

  if (loadError === 'Not signed in') {
    return (
      <div className="max-w-4xl space-y-6 py-4">
        <SectionHeading title="AI Providers & API Keys" subtitle="Bring your own key (Groq, OpenAI, or Anthropic) so CallPilot uses it for document intelligence." />
        <div className="panel flex items-center gap-3 px-4 py-8 text-sm text-[var(--opaline-on-surface-variant)]">
          <AlertTriangle className="h-4 w-4 text-[var(--opaline-warning)]" /> Not signed in. Please sign in to manage AI providers.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-8 py-4">
      <SectionHeading title="AI Providers & API Keys" subtitle="Bring your own key (Groq, OpenAI, or Anthropic) so CallPilot uses it for document intelligence." />

      {loadError && (
        <div className="panel flex items-start gap-3 border-[var(--opaline-danger-border)] px-4 py-3 text-sm text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4" />
          <span>{loadError}</span>
        </div>
      )}

      {/* One unified accounts list — rows expand in place, so the section
          never develops ragged multi-card heights. */}
      <div className="panel divide-y divide-[var(--opaline-outline-variant)] overflow-hidden">
        {PROVIDER_TYPES.map((type) => {
          const p = provider(type);
          const meta = PROVIDER_META[type];
          const models = p ? modelsByProvider[p.id] : undefined;
          return (
            <ProviderCard
              key={type}
              type={type}
              meta={meta}
              provider={p}
              inputKey={keyInputs[type] ?? ''}
              setInputKey={(v) => setKeyInputs((prev) => ({ ...prev, [type]: v }))}
              formOpen={!!openForm[type]}
              setFormOpen={(v) => setOpenForm((prev) => ({ ...prev, [type]: v }))}
              test={tests[type] || { testing: false, result: null }}
              models={models}
              onConnect={() => onConnect(type)}
              onRemove={() => onRemove(type)}
              onTest={() => onTest(type)}
              onRefreshModels={p ? () => discoverModels(p) : undefined}
            />
          );
        })}
      </div>

      {anyConnected && (
        <section className="space-y-3">
          <div>
            <h3 className="text-headline-sm text-[var(--opaline-on-surface)]">Models & defaults</h3>
            <p className="text-caption mt-1">Choose which provider and model CallPilot uses for each capability.</p>
          </div>
          {features.length === 0 ? (
            <div className="panel px-4 py-6 text-sm text-[var(--opaline-on-surface-variant)]">No preferences available.</div>
          ) : (
            <div className="panel overflow-hidden divide-y divide-[var(--opaline-outline-variant)]">
              {features.map((feature) => (
                <FeaturePreference
                  key={feature}
                  feature={feature}
                  label={FEATURE_LABELS[feature] || humanize(feature)}
                  preference={prefs[feature]}
                  providers={connectedProviders}
                  modelsByProvider={modelsByProvider}
                  dirty={!!prefsDirty[feature]}
                  saving={!!prefsSaving[feature]}
                  saved={!!prefsSaved[feature]}
                  onChange={onPreferenceChange}
                  onSave={() => savePreference(feature)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {anyConnected && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-headline-md text-[var(--opaline-on-surface)]">Usage</h3>
              <p className="text-caption mt-1">Provider-reported account snapshot and CallPilot usage are kept separate.</p>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-caption" htmlFor="usage-provider-filter">Provider</label>
              <select
                id="usage-provider-filter"
                value={usageProviderId ?? ''}
                onChange={(e) => setUsageProviderId(e.target.value || null)}
                className="rounded-md border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] px-3 py-1.5 text-sm text-[var(--opaline-on-surface)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--opaline-primary)]"
              >
                <option value="">All providers</option>
                {connectedProviders.map((x) => (
                  <option key={x.id} value={x.id}>{PROVIDER_META[x.providerType]?.label || x.providerType}</option>
                ))}
              </select>
            </div>
          </div>
          <AiProviderUsagePanel provider={selectedUsageProvider} />
        </section>
      )}
    </div>
  );
};
/* ── Section heading ─────────────────────────────────────────────── */
const SectionHeading: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => (
  <div>
    <h2 className="text-headline-md text-[var(--opaline-on-surface)]">{title}</h2>
    <p className="text-caption mt-1">{subtitle}</p>
  </div>
);

/* ── Provider row (accordion inside the shared accounts panel) ──── */
interface ProviderCardProps {
  type: AiProviderType;
  meta: { label: string; logo: React.FC<{ className?: string }>; brandToken: string; description: string; helpUrl: string; keyPrefix: string };
  provider: AiProviderDto | null;
  inputKey: string;
  setInputKey: (v: string) => void;
  formOpen: boolean;
  setFormOpen: (v: boolean) => void;
  test: { testing: boolean; result: { ok: boolean; message: string } | null };
  models: ConnectedModels | undefined;
  onConnect: () => void;
  onRemove: () => void;
  onTest: () => void;
  onRefreshModels?: (() => void) | undefined;
}

const ProviderCard: React.FC<ProviderCardProps> = ({
  type, meta, provider, inputKey, setInputKey, formOpen, setFormOpen,
  test, models, onConnect, onRemove, onTest, onRefreshModels,
}) => {
  const connected = !!provider && provider.hasKey;
  const Logo = meta.logo;
  return (
    <motion.div layout={false} className="flex flex-col">
      {/* Row header — one generous hit target; brand mark carries its own hue
          when the key is live, and the trailing status reads at a glance. */}
      <button
        type="button"
        onClick={() => setFormOpen(!formOpen)}
        aria-expanded={formOpen}
        aria-label={`${meta.label} — ${connected ? 'connected' : 'not connected'}`}
        className="flex w-full items-center gap-4 px-4 py-4 text-left transition-colors duration-150 hover:bg-[var(--opaline-tone-4)] focus-visible:bg-[var(--opaline-tone-4)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--opaline-primary)] active:bg-[var(--opaline-tone-8)] disabled:pointer-events-none disabled:opacity-60"
      >
        <span
          aria-hidden
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border',
            connected
              ? 'border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)]'
              : 'border-[var(--opaline-outline-variant)] bg-transparent',
          )}
          style={connected ? { color: `var(${meta.brandToken})` } : undefined}
        >
          <Logo className={cn('h-5 w-5', !connected && 'text-[var(--opaline-on-surface-variant)] opacity-50')} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold leading-5 tracking-tight text-[var(--opaline-on-surface)]">
            {meta.label}
          </span>
          <span
            className="mt-0.5 block truncate text-xs leading-4 text-[var(--opaline-on-surface-variant)]"
            title={connected ? `Connected · ${provider?.maskedKey || 'key saved'}` : meta.description}
          >
            {connected ? (provider ? provider.maskedKey || 'Key saved' : 'Key saved') : meta.description}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2.5">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 text-[11px] font-medium leading-none',
              connected ? 'text-[var(--opaline-success)]' : 'text-[var(--opaline-on-surface-variant)]',
            )}
          >
            <span
              aria-hidden
              className={cn('h-1.5 w-1.5 rounded-full', connected && 'dot-pulse')}
              style={{
                background: connected ? 'var(--opaline-success)' : 'var(--opaline-outline)',
                opacity: connected ? 1 : 0.6,
              }}
            />
            {connected ? 'Connected' : 'Not connected'}
          </span>
          <ChevronDown
            className={cn(
              'h-4 w-4 text-[var(--opaline-outline)] transition-transform duration-200 ease-out',
              formOpen && 'rotate-180',
            )}
          />
        </span>
      </button>

      <AnimatePresence initial={false}>
        {formOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-4 border-t border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-low)] px-5 py-4">
              {connected ? (
                <>
                  <div className="panel-inset space-y-1.5 px-3 py-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-caption">Key</span>
                      <span className="text-data text-[var(--opaline-on-surface)]">{provider ? provider.maskedKey || 'saved' : 'saved'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-caption">Model</span>
                      <span className="text-data text-[var(--opaline-on-surface)]">{provider ? provider.model || '—' : '—'}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <ActionButton onClick={onTest} disabled={test.testing} tone="outline">
                      {test.testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
                      Test
                    </ActionButton>
                    <ActionButton onClick={() => setFormOpen(false)} tone="outline"><RefreshCw className="h-4 w-4" /> Replace</ActionButton>
                    <ActionButton onClick={onRemove} tone="danger"><Trash2 className="h-4 w-4" /> Remove</ActionButton>
                  </div>

                  {test.result && (
                    <div className={cn('chip', test.result.ok ? 'chip-success' : 'chip-danger')}>
                      {test.result.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                      {test.result.message}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <p className="text-caption">Enter your {meta.label} API key to connect.</p>
                  <KeyEntry
                    type={type}
                    value={inputKey}
                    onChange={setInputKey}
                    onSubmit={onConnect}
                    label={meta.label + ' API key'}
                  />
                  <div className="flex flex-wrap gap-2">
                    <ActionButton onClick={onConnect} disabled={!inputKey.trim()} tone="primary"><Plus className="h-4 w-4" /> Connect</ActionButton>
                  </div>
                  <KeyHelpLink label={meta.label} helpUrl={meta.helpUrl} />
                </>
              )}

              {connected && <ModelsSection type={type} models={models} onRefresh={onRefreshModels} />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
/* ── Key help link ──────────────────────────────────────────────── */
const KeyHelpLink: React.FC<{ label: string; helpUrl: string }> = ({ label, helpUrl }) => {
  const open = async (e: React.MouseEvent) => {
    e.preventDefault();
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_external_url', { url: helpUrl });
    } catch {
      window.open(helpUrl, '_blank', 'noopener,noreferrer');
    }
  };
  return (
    <button type="button" onClick={open} className="inline-flex items-center gap-1.5 text-xs text-[var(--opaline-primary)] hover:underline">
      <HelpCircle className="h-3.5 w-3.5" /> Where do I get a {label} API key?
    </button>
  );
};

/* ── Key entry ──────────────────────────────────────────────────── */
const KeyEntry: React.FC<{
  type: AiProviderType;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  label: string;
}> = ({ type, value, onChange, onSubmit, label }) => (
  <div className="space-y-1.5">
    <label className="field-label" htmlFor={"ai-key-" + type}>{label}</label>
    <input
      id={"ai-key-" + type}
      type="password"
      autoComplete="off"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(); }}
      placeholder="gsk_••••••••••"
      className="block w-full rounded-md border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] px-3 py-2 text-sm text-[var(--opaline-on-surface)] placeholder:text-[var(--opaline-on-surface-variant)] focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
    />
    <p className="text-caption">Sent to CallPilot only when you save. Never shown or stored in plaintext.</p>
  </div>
);

/* ── Models section ──────────────────────────────────────────────── */
const ModelsSection: React.FC<{
  type: AiProviderType;
  models: ConnectedModels | undefined;
  onRefresh?: (() => void) | undefined;
}> = ({ type, models, onRefresh }) => (
  <div>
    <div className="flex items-center justify-between">
      <span className="text-overline">Models</span>
      <button
        type="button"
        onClick={onRefresh}
        disabled={!onRefresh || models?.loading}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-[var(--opaline-on-surface-variant)] hover:bg-[var(--opaline-surface-container-low)] hover:text-[var(--opaline-on-surface)] disabled:opacity-50"
      >
        {models?.loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        Refresh
      </button>
    </div>

    {models?.loading ? (
      <div className="mt-2 flex items-center gap-2 text-sm text-[var(--opaline-on-surface-variant)]">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading models…
      </div>
    ) : models?.error ? (
      <div className="mt-2 flex items-start gap-2 text-sm text-[var(--opaline-on-surface-variant)]">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 text-[var(--opaline-warning)]" />
        <span>{models.error}</span>
      </div>
    ) : models?.models && models.models.length > 0 ? (
      <>
        <div className="mt-2 max-h-48 space-y-1.5 overflow-y-auto pr-1">
          {models.models.map((m) => (
            <div key={m.id} className="panel-inset px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-[var(--opaline-on-surface)]">{m.name || m.id}</span>
                {m.fromFallback && (
                  <span className="chip chip-primary shrink-0"><Sparkles className="h-3 w-3" /> curated</span>
                )}
              </div>
              {m.capabilities && m.capabilities.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {m.capabilities.map((c) => <CapabilityTag key={c} c={c} />)}
                </div>
              )}
            </div>
          ))}
        </div>
        {type === 'anthropic' && <p className="mt-2 text-caption">{EXTRA_NOTE}</p>}
      </>
    ) : (
      <div className="mt-2 flex items-start gap-2 text-sm text-[var(--opaline-on-surface-variant)]">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 text-[var(--opaline-warning)]" />
        <span>No models returned.</span>
      </div>
    )}
  </div>
);

const CapabilityTag: React.FC<{ c: string }> = ({ c }) => {
  const label = c === 'json_output' ? 'json output' : c === 'long_context' ? 'long context' : c;
  return <span className="chip chip-neutral">{label}</span>;
};

const ActionButton: React.FC<{
  onClick: () => void;
  disabled?: boolean;
  tone: 'primary' | 'outline' | 'danger';
  children: React.ReactNode;
}> = ({ onClick, disabled, tone, children }) => {
  const base = 'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--opaline-primary)] disabled:opacity-50 disabled:cursor-not-allowed';
  const tones: Record<string, string> = {
    primary: 'bg-primary text-[var(--opaline-on-primary)] hover:bg-[var(--opaline-primary-hover)]',
    outline: 'border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] text-[var(--opaline-on-surface-variant)] hover:bg-[var(--opaline-surface-container-low)] hover:text-[var(--opaline-on-surface)]',
    danger: 'border border-[var(--opaline-danger-border)] bg-[var(--opaline-surface-container-lowest)] text-danger hover:bg-[var(--opaline-danger-soft)]',
  };
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cn(base, tones[tone])}>{children}</button>
  );
};

/* ── Feature preference editor ─────────────────────────────────────
   Rendered as a row inside a single grouped panel (divide-y). No per-row
   panel border/shadow — that was the "wall of cards" heaviness in the
   screenshot. Save is co-located with the selects so the header stays
   quiet and the action is where the edit happens. */
const FeaturePreference: React.FC<{
  feature: string;
  label: string;
  preference: ProviderPreference | undefined;
  providers: AiProviderDto[];
  modelsByProvider: Record<string, ConnectedModels>;
  dirty: boolean;
  saving: boolean;
  saved: boolean;
  onChange: (feature: string, patch: Partial<ProviderPreference>) => void;
  onSave: () => void;
}> = ({ feature, label, preference, providers, modelsByProvider, dirty, saving, saved, onChange, onSave }) => {
  const providerId = (preference && preference.providerConfigurationId) ?? '';
  const selectedProvider = providers.find((x) => x.id === providerId);
  const connectedModels = selectedProvider ? modelsByProvider[selectedProvider.id] : undefined;

  useEffect(() => {
    if (providers.length > 0 && (!preference || !preference.providerConfigurationId)) {
      onChange(feature, { providerConfigurationId: providers[0].id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feature, providers.length]);

  return (
    <div className="px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold leading-none tracking-tight text-[var(--opaline-on-surface)]">{label}</h4>
          <p className="mt-1 text-[11px] leading-4 text-[var(--opaline-on-surface-variant)]">Provider + model for {label.toLowerCase()}.</p>
        </div>
        {saved && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--opaline-success-border)] bg-[var(--opaline-success-soft)] px-2 py-0.5 text-[10px] font-medium leading-none text-[var(--opaline-success)]">
            <CheckCircle2 className="h-3 w-3" /> Saved
          </span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium tracking-wide text-[var(--opaline-on-surface-variant)]">Provider</label>
          <SelectField
            value={providerId}
            onChange={(v) => onChange(feature, { providerConfigurationId: v || null, model: null })}
            placeholder="Select provider"
            options={providers.map((x) => ({ value: x.id, label: PROVIDER_META[x.providerType]?.label || x.providerType }))}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium tracking-wide text-[var(--opaline-on-surface-variant)]">Model</label>
          <SelectField
            value={(preference && preference.model) ?? ''}
            onChange={(v) => onChange(feature, { model: v || null })}
            placeholder={selectedProvider ? 'Select model' : 'Select a provider first'}
            disabled={!selectedProvider}
            options={((connectedModels && connectedModels.models) || [])
              .filter((m) => m.supportsJsonOutput || (m.capabilities || []).indexOf('chat') >= 0)
              .map((m) => ({ value: m.id, label: m.name || m.id }))}
          />
        </div>
        <div className="flex shrink-0 items-center pt-1 sm:pt-0">
          {dirty && !saving && (
            <button
              type="button"
              onClick={onSave}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--opaline-primary)] px-3.5 text-xs font-medium text-[var(--opaline-on-primary)] shadow-xs transition-colors hover:bg-[var(--opaline-primary-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--opaline-primary)]"
            >
              <Save className="h-3.5 w-3.5" /> Save
            </button>
          )}
          {saving && (
            <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-low)] px-3.5 text-xs font-medium text-[var(--opaline-on-surface-variant)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
            </span>
          )}
          {!dirty && !saving && !saved && <span className="hidden h-9 sm:block" aria-hidden />}
        </div>
      </div>
    </div>
  );
};

const SelectField: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  disabled?: boolean;
  options: { value: string; label: string }[];
}> = ({ value, onChange, placeholder, disabled, options }) => (
  <div className="relative">
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="block h-9 w-full appearance-none rounded-lg border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] px-3 pr-8 text-sm text-[var(--opaline-on-surface)] placeholder:text-[var(--opaline-outline)] disabled:cursor-not-allowed disabled:opacity-50 focus:border-[var(--opaline-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--opaline-primary)]"
    >
      <option value="" disabled>{placeholder}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--opaline-outline)]" />
  </div>
);

function humanize(s: string): string {
  return s.split('_').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}