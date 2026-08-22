'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import {
  KeyRound, Zap, Sparkles, Bot, Plus, Trash2, RefreshCw, Plug, Save,
  CheckCircle2, XCircle, Loader2, ChevronDown, HelpCircle, ExternalLink,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  apiGetAiProviders, apiUpsertAiProvider, apiDeleteAiProvider, apiTestAiProvider,
  apiGetAiModels, apiGetAiModelsForProvider, apiGetAiPreference, apiSetAiPreference, apiGetAiUsage, apiGetAiLimits,
  apiTestAiProviderStored,
} from '@/lib/api';
import type {
  AiProviderDto, AiProviderType, AiModel, AiPreference, AiUsage, AiLimits,
} from '@/lib/api';

const TYPES: AiProviderType[] = ['groq', 'openai', 'anthropic'];
const META: Record<AiProviderType, { label: string; icon: LucideIcon; desc: string; helpUrl: string }> = {
  groq: { label: 'Groq', icon: Zap, desc: 'Fast LPU inference.', helpUrl: 'https://console.groq.com/keys' },
  openai: { label: 'OpenAI', icon: Sparkles, desc: 'GPT models.', helpUrl: 'https://platform.openai.com/api-keys' },
  anthropic: { label: 'Anthropic', icon: Bot, desc: 'Claude models.', helpUrl: 'https://console.anthropic.com/settings/keys' },
};
const FEATURES = ['knowledge_processing', 'document_extraction', 'product_extraction'];
const FEATURE_LABELS: Record<string, string> = {
  knowledge_processing: 'Knowledge Processing',
  document_extraction: 'Document extraction',
  product_extraction: 'Product extraction',
};
const TEST_TEXT: Record<string, string> = {
  invalid_api_key: 'Invalid API key', key_expired_or_revoked: 'Key expired or revoked',
  insufficient_credits: 'Insufficient credits', rate_limit_reached: 'Rate limit reached',
  model_unavailable: 'Selected model unavailable', provider_unavailable: 'Provider temporarily unavailable',
  request_failed: 'Request failed', invalid_response: 'Provider returned an invalid response',
  ok: 'Connection successful', unknown: 'Unknown error',
};

export default function ProvidersPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [providers, setProviders] = useState<AiProviderDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modelsMap, setModelsMap] = useState<Record<string, AiModel[]>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [tests, setTests] = useState<Record<string, { testing: boolean; result: { ok: boolean; message: string } | null }>>({});
  const [prefs, setPrefs] = useState<Record<string, AiPreference>>({});
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [limits, setLimits] = useState<Record<string, AiLimits | null>>({});

  const loadAll = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiGetAiProviders();
      setProviders((data && data.providers) || []);
      const connected = (data && data.providers) || [];
      const mm: Record<string, AiModel[]> = {};
      for (const p of connected) {
        if (p.hasKey) {
          try {
            mm[p.id] = await apiGetAiModelsForProvider(p.id);
          } catch { mm[p.id] = []; }
        }
      }
      setModelsMap(mm);
      const pp: Record<string, AiPreference> = {};
      for (const f of FEATURES) {
        try { pp[f] = await apiGetAiPreference(f); } catch { /* ignore */ }
      }
      setPrefs(pp);
      try { setUsage(await apiGetAiUsage()); } catch { /* ignore */ }
      const lim: Record<string, AiLimits | null> = {};
      for (const p of connected) {
        if (p.hasKey) {
          try { lim[p.id] = await apiGetAiLimits(p.id); } catch { lim[p.id] = null; }
        }
      }
      setLimits(lim);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load providers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isLoading && !user) { router.push('/login'); return; }
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isLoading]);
  const providerOf = (t: AiProviderType) => providers.find((x) => x.providerType === t) || null;

  const onConnect = async (t: AiProviderType) => {
    const key = (keys[t] || '').trim();
    if (!key) return;
    try {
      await apiUpsertAiProvider({ providerType: t, model: null, endpoint: null, apiKey: key });
      setKeys((prev) => ({ ...prev, [t]: '' }));
      setOpen((prev) => ({ ...prev, [t]: false }));
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save API key');
    }
  };

  const onRemove = async (t: AiProviderType) => {
    const p = providerOf(t);
    if (!p) return;
    try {
      await apiDeleteAiProvider(p.id);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove provider');
    }
  };

  const onTest = async (t: AiProviderType) => {
    const p = providerOf(t);
    const key = (keys[t] || '').trim();
    setTests((prev) => ({ ...prev, [t]: { testing: true, result: null } }));
    try {
      // Connected provider: probe the STORED key server-side.  A freshly typed
      // key is sent once for validation before being saved.
      const resp = p && p.hasKey && !key
        ? await apiTestAiProviderStored(p.id)
        : await apiTestAiProvider({ providerType: t, apiKey: key || (p?.maskedKey ?? ''), endpoint: p ? p.endpoint : null });
      const message = resp.valid ? TEST_TEXT.ok : (resp.error || TEST_TEXT[resp.errorCode] || TEST_TEXT.unknown);
      setTests((prev) => ({ ...prev, [t]: { testing: false, result: { ok: resp.valid, message } } }));
    } catch (e) {
      setTests((prev) => ({ ...prev, [t]: { testing: false, result: { ok: false, message: e instanceof Error ? e.message : 'Test failed' } } }));
    }
  };

  const onRefreshModels = async (t: AiProviderType) => {
    const p = providerOf(t);
    if (!p) return;
    try {
      const mm = await apiGetAiModelsForProvider(p.id);
      setModelsMap((prev) => ({ ...prev, [p.id]: mm }));
    } catch { /* ignore */ }
  };

  const onPrefChange = (f: string, patch: Partial<AiPreference>) => {
    setPrefs((prev) => ({ ...prev, [f]: { ...(prev[f] || { feature: f, providerConfigurationId: null, model: null }), ...patch } }));
  };

  const onPrefSave = async (f: string) => {
    const pref = prefs[f];
    if (!pref) return;
    try {
      const updated = await apiSetAiPreference(f, { providerConfigurationId: pref.providerConfigurationId, model: pref.model });
      setPrefs((prev) => ({ ...prev, [f]: updated }));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save preference');
    }
  };

  const connected = providers.filter((x) => x.hasKey);
  const anyConnected = connected.length > 0;

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-screen text-gray-500">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-4">
          <button onClick={() => router.push('/dashboard')} className="text-gray-500 hover:text-gray-700">← Back</button>
          <h1 className="text-lg font-semibold text-gray-900">AI Providers & API Keys</h1>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-8">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
        )}
        {loading ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-500">Loading providers…</div>
        ) : (
          <>
            {!anyConnected && (
              <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
                <KeyRound className="mx-auto h-8 w-8 text-blue-600" />
                <p className="mt-3 text-gray-700 font-medium">Bring your own key — Groq, OpenAI, or Anthropic</p>
                <p className="mt-1 text-sm text-gray-500">Connect a provider so the dashboard uses your own API key for document intelligence.</p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 items-start gap-4">
              {TYPES.map((t) => {
                const p = providerOf(t);
                const m = META[t];
                const Icon = m.icon;
                const pm = p ? modelsMap[p.id] : undefined;
                return (
                  <ProviderCard
                    key={t}
                    type={t}
                    meta={m}
                    Icon={Icon}
                    provider={p}
                    models={pm}
                    open={!!open[t]}
                    toggle={() => setOpen((prev) => ({ ...prev, [t]: !prev[t] }))}
                    keyValue={keys[t] || ''}
                    setKeyValue={(v) => setKeys((prev) => ({ ...prev, [t]: v }))}
                    test={tests[t] || { testing: false, result: null }}
                    onConnect={() => onConnect(t)}
                    onRemove={() => onRemove(t)}
                    onTest={() => onTest(t)}
                    onRefreshModels={() => onRefreshModels(t)}
                  />
                );
              })}
            </div>
            {anyConnected && (
              <section>
                <h2 className="text-xl font-bold text-gray-900">Models & defaults</h2>
                <p className="text-sm text-gray-500 mt-1 mb-4">Choose which provider and model is used per capability.</p>
                <div className="space-y-3">
                  {FEATURES.map((f) => {
                    const pref = prefs[f];
                    const pid = (pref && pref.providerConfigurationId) || '';
                    const selProv = connected.find((x) => x.id === pid);
                    const models = selProv ? modelsMap[selProv.id] || [] : [];
                    return (
                      <div key={f} className="bg-white rounded-xl border border-gray-200 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <h3 className="font-semibold text-gray-900">{FEATURE_LABELS[f] || f}</h3>
                          <button
                            onClick={() => onPrefSave(f)}
                            disabled={!pref || !pref.providerConfigurationId}
                            className="inline-flex items-center gap-1.5 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
                          ><Save className="h-4 w-4" /> Save</button>
                        </div>
                        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-sm font-medium mb-1">Provider</label>
                            <select
                              value={pid}
                              onChange={(e) => onPrefChange(f, { providerConfigurationId: e.target.value || null, model: null })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                            >
                              <option value="">Select provider</option>
                              {connected.map((x) => <option key={x.id} value={x.id}>{META[x.providerType]?.label || x.providerType}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-1">Model</label>
                            <select
                              value={(pref && pref.model) || ''}
                              onChange={(e) => onPrefChange(f, { model: e.target.value || null })}
                              disabled={!selProv}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white disabled:bg-gray-50"
                            >
                              <option value="">{selProv ? 'Select model' : 'Select a provider first'}</option>
                              {models.filter((m) => m.supportsJsonOutput || (m.capabilities || []).indexOf('chat') >= 0).map((m) => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}
                            </select>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {anyConnected && (
              <section>
                <h2 className="text-xl font-bold text-gray-900">Usage</h2>
                <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <h3 className="font-semibold text-gray-900">Provider account</h3>
                    <p className="text-xs text-gray-400 mt-0.5">Provider-reported limits snapshot — may change.</p>
                    {connected.map((p) => {
                      const lim = limits[p.id];
                      const snap = lim && lim.limits && lim.limits.length ? lim.limits[lim.limits.length - 1] : null;
                      return (
                        <div key={p.id} className="mt-3 border-t border-gray-100 pt-3">
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-medium capitalize text-gray-800">{p.providerType}</span>
                            <span className={p.hasKey ? 'text-green-600' : 'text-gray-500'}>{p.hasKey ? 'Connected' : 'Not connected'}</span>
                          </div>
                          <div className="text-sm text-gray-500 mt-1">Model: {p.model || '—'} · Key: {p.maskedKey || '—'}</div>
                          {snap ? (
                            <pre className="mt-2 text-xs bg-gray-50 border border-gray-200 rounded-lg p-2 overflow-auto text-gray-600 whitespace-pre-wrap">{pretty(snap.snapshotJson)}</pre>
                          ) : (
                            <div className="mt-1 text-xs text-gray-400">Unavailable — provider does not expose this.</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <h3 className="font-semibold text-gray-900">CallPilot usage</h3>
                    <p className="text-xs text-gray-400 mt-0.5">Locally tracked requests, tokens, and cost estimate.</p>
                    {usage ? (
                      <div className="mt-3 space-y-2 text-sm text-gray-700">
                        <div className="grid grid-cols-2 gap-2">
                          <div className="bg-gray-50 rounded-lg p-2"><div className="text-xs text-gray-400">Total requests</div><div className="font-semibold">{usage.totalRequests.toLocaleString()}</div></div>
                          <div className="bg-gray-50 rounded-lg p-2"><div className="text-xs text-gray-400">Successful</div><div className="font-semibold">{usage.successful.toLocaleString()}</div></div>
                          <div className="bg-gray-50 rounded-lg p-2"><div className="text-xs text-gray-400">Failed</div><div className="font-semibold">{usage.failed.toLocaleString()}</div></div>
                          <div className="bg-gray-50 rounded-lg p-2"><div className="text-xs text-gray-400">Total tokens</div><div className="font-semibold">{usage.totalTokens.toLocaleString()}</div></div>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-gray-500">Estimated cost</span>
                          <span className="font-semibold text-green-700">≈ ${usage.estimatedCostUsd.toFixed(4)} (estimate)</span>
                        </div>
                        {usage.byProvider && usage.byProvider.length > 0 && (
                          <div className="border-t border-gray-100 pt-2">
                            <div className="text-xs text-gray-400 mb-1">By provider</div>
                            {usage.byProvider.map((r) => (
                              <div key={r.providerType} className="flex items-center justify-between text-sm">
                                <span className="capitalize">{r.providerType}</span>
                                <span className="text-gray-500">{r.requestCount} req · {r.totalTokens.toLocaleString()} tok · ≈ ${r.estimatedCostUsd.toFixed(4)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="mt-3 text-sm text-gray-400">No usage data available yet.</div>
                    )}
                  </div>
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

/* ── ProviderCard ────────────────────────────────────────────────── */
interface PCardProps {
  type: AiProviderType;
  meta: { label: string; icon: LucideIcon; desc: string; helpUrl: string };
  Icon: LucideIcon;
  provider: AiProviderDto | null;
  models: AiModel[] | undefined;
  open: boolean;
  toggle: () => void;
  keyValue: string;
  setKeyValue: (v: string) => void;
  test: { testing: boolean; result: { ok: boolean; message: string } | null };
  onConnect: () => void;
  onRemove: () => void;
  onTest: () => void;
  onRefreshModels: () => void;
}

function ProviderCard({ type, meta, Icon, provider, models, open, toggle, keyValue, setKeyValue, test, onConnect, onRemove, onTest, onRefreshModels }: PCardProps) {
  const connected = !!provider && provider.hasKey;
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center">
        <button onClick={toggle} className="flex flex-1 min-w-0 items-center gap-3 p-4 text-left hover:bg-gray-50">
          <span className={"h-9 w-9 flex items-center justify-center rounded-lg " + (connected ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500')}><Icon className="h-5 w-5" /></span>
          <span className="flex-1 min-w-0">
            <span className="flex items-center gap-2">
              <span className="font-medium text-gray-900">{meta.label}</span>
              <span className={"px-2 py-0.5 rounded-full text-xs font-medium " + (connected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600')}>{connected ? 'Connected' : 'Not connected'}</span>
            </span>
            <span className="block truncate text-sm text-gray-500">{connected ? (provider ? provider.maskedKey : 'Key saved') : meta.desc}</span>
          </span>
          <ChevronDown className={"h-4 w-4 text-gray-400 transition-transform " + (open ? 'rotate-180' : '')} />
        </button>
        <a href={meta.helpUrl} target="_blank" rel="noopener noreferrer" title={`Get a ${meta.label} API key`} aria-label={`Get a ${meta.label} API key`} className="mr-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-blue-600">
          <HelpCircle className="h-4 w-4" />
        </a>
      </div>

      {open && (
        <div className="border-t border-gray-100 p-4 space-y-4">
          {connected ? (
            <>
              <div className="bg-gray-50 rounded-lg p-3 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-gray-400">Key</span><span className="font-mono text-gray-700">{provider ? provider.maskedKey : 'saved'}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Model</span><span className="font-mono text-gray-700">{provider ? provider.model || '—' : '—'}</span></div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={onTest} disabled={test.testing} className="inline-flex items-center gap-1.5 border border-gray-300 px-3 py-1.5 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">{test.testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />} Test</button>
                <button onClick={() => { setKeyValue(''); toggle(); }} className="inline-flex items-center gap-1.5 border border-gray-300 px-3 py-1.5 rounded-lg text-sm text-gray-700 hover:bg-gray-50"><RefreshCw className="h-4 w-4" /> Replace</button>
                <button onClick={onRemove} className="inline-flex items-center gap-1.5 border border-red-200 text-red-600 px-3 py-1.5 rounded-lg text-sm hover:bg-red-50"><Trash2 className="h-4 w-4" /> Remove</button>
              </div>
              {test.result && (
                <div className={"inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium " + (test.result.ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>
                  {test.result.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}{test.result.message}
                </div>
              )}
            </>
          ) : (
            <>
              <label className="block text-sm font-medium">{meta.label} API key</label>
              <input
                type="password"
                autoComplete="off"
                value={keyValue}
                onChange={(e) => setKeyValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') onConnect(); }}
                placeholder="gsk_••••••••••"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
              <div className="flex items-center gap-3">
                <button onClick={onConnect} disabled={!keyValue.trim()} className="inline-flex items-center gap-1.5 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"><Plus className="h-4 w-4" /> Connect</button>
                <a href={meta.helpUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"><HelpCircle className="h-3.5 w-3.5" /> Where do I get a {meta.label} API key?</a>
              </div>
            </>
          )}

          {connected && (
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-400 uppercase">Models</span>
                <button onClick={onRefreshModels} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"><RefreshCw className="h-3 w-3" /> Refresh</button>
              </div>
              {models && models.length > 0 ? (
                <div className="mt-2 max-h-40 overflow-y-auto space-y-1.5">
                  {models.map((m) => (
                    <div key={m.id} className="bg-gray-50 rounded-lg px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-gray-800 truncate">{m.name || m.id}</span>
                        {m.fromFallback && <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-blue-100 text-blue-700 font-medium">curated</span>}
                      </div>
                      {m.capabilities && m.capabilities.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">{m.capabilities.map((c) => <CapTag key={c} c={c} />)}</div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-2 text-sm text-gray-400">No models returned.</div>
              )}
              {type === 'anthropic' && <p className="mt-2 text-xs text-gray-400">Model list is a curated fallback — Anthropic does not expose a model list API.</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CapTag({ c }: { c: string }) {
  const label = c === 'json_output' ? 'json output' : c === 'long_context' ? 'long context' : c;
  return <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-gray-100 text-gray-600">{label}</span>;
}

function pretty(raw: string): string {
  if (!raw) return '';
  try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
}