'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Loader2, Database, BarChart3, AlertTriangle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AiProviderDto, CallPilotUsage, ProviderLimitsResponse } from '@/types/aiProviders';
import { getAiProviderLimits, getAiUsage } from '@/services/aiProviders';

interface AiProviderUsagePanelProps {
  provider: AiProviderDto | null;
}

/**
 * The usage area for the AI Providers settings. Deliberately splits the
 * two very different kinds of data into separate sub-panels so they are
 * never conflated:
 *
 *  1. "Provider account" — limits/connection/model snapshot as reported by
 *     the provider itself. Rendered as a snapshot, labeled "may change".
 *     If the provider doesn't expose a value, we show "Unavailable" — we
 *     never invent numbers.
 *
 *  2. "CallPilot usage" — locally tracked requests/tokens/cost estimate
 *     from our own usage logs.
 */
export const AiProviderUsagePanel: React.FC<AiProviderUsagePanelProps> = ({ provider }) => {
  const [usage, setUsage] = useState<CallPilotUsage | null>(null);
  const [usageLoading, setUsageLoading] = useState(true);
  const [usageError, setUsageError] = useState<string | null>(null);

  const [limits, setLimits] = useState<ProviderLimitsResponse | null>(null);
  const [limitsLoading, setLimitsLoading] = useState(false);
  const [limitsError, setLimitsError] = useState<string | null>(null);

  const loadUsage = useCallback(async () => {
    setUsageLoading(true);
    setUsageError(null);
    try {
      const data = await getAiUsage(provider?.id ?? null);
      setUsage(data);
    } catch (e) {
      setUsageError('Could not load CallPilot usage.');
      setUsage(null);
    } finally {
      setUsageLoading(false);
    }
  }, [provider?.id]);

  const loadLimits = useCallback(async () => {
    if (!provider) {
      setLimits(null);
      return;
    }
    setLimitsLoading(true);
    setLimitsError(null);
    try {
      const data = await getAiProviderLimits(provider.id);
      setLimits(data);
    } catch (e) {
      setLimitsError('Provider does not expose limits for this account.');
      setLimits(null);
    } finally {
      setLimitsLoading(false);
    }
  }, [provider]);

  useEffect(() => {
    loadUsage();
  }, [loadUsage]);

  useEffect(() => {
    if (provider) loadLimits();
    else setLimits(null);
  }, [provider, loadLimits]);

  const snapshot = limits && limits.limits && limits.limits.length > 0
    ? limits.limits[limits.limits.length - 1]
    : null;

  return (
    <div className="space-y-6">
      {/* ── Provider account ───────────────────────────────────────── */}
      <section className="panel p-5">
        <div className="flex items-start gap-2">
          <Database className="mt-0.5 h-4 w-4 text-[var(--opaline-info)]" />
          <div>
            <h3 className="text-[15px] font-semibold text-[var(--opaline-on-surface)]">Provider account</h3>
            <p className="text-caption mt-0.5">
              What the provider reports about this account, and its connection/model status.
            </p>
          </div>
        </div>

        {!provider ? (
          <p className="text-caption mt-4">Connect a provider to see its account snapshot.</p>
        ) : (
          <div className="mt-4 space-y-4">
            {/* Connection / model summary */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <SummaryCell label="Provider" value={provider.providerType} monospace={false} />
              <SummaryCell label="Status" value={provider.hasKey ? 'Connected' : 'Not connected'} />
              <SummaryCell label="Model" value={provider.model || '—'} monospace />
              <SummaryCell label="Key" value={provider.maskedKey || '—'} monospace />
            </div>

            {/* Limits snapshot */}
            <div>
              <div className="flex items-center gap-2">
                <span className="text-overline">Provider limits</span>
                <span className="chip chip-info">
                  <Info className="h-3 w-3" />
                  Snapshot — may change
                </span>
              </div>

              {limitsLoading ? (
                <div className="panel-inset mt-2 flex items-center gap-2 px-3 py-4 text-sm text-[var(--opaline-on-surface-variant)]">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading provider snapshot…
                </div>
              ) : limitsError ? (
                <div className="panel-inset mt-2 flex items-start gap-2 px-3 py-4 text-sm text-[var(--opaline-on-surface-variant)]">
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-[var(--opaline-warning)]" />
                  <span>Unavailable — provider does not expose this.</span>
                </div>
              ) : snapshot ? (
                <div className="panel-inset mt-2 px-4 py-3">
                  <div className="flex items-center justify-between">
                    <span className="text-caption">As reported by {provider.providerType}</span>
                    <span className="text-caption">
                      {new Date(snapshot.capturedAt).toLocaleString()}
                    </span>
                  </div>
                  <pre className="text-data mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--opaline-surface-container-low)] p-3 text-[var(--opaline-on-surface-variant)]">
                    {prettyJson(snapshot.snapshotJson)}
                  </pre>
                </div>
              ) : (
                <div className="panel-inset mt-2 px-4 py-4 text-sm text-[var(--opaline-on-surface-variant)]">
                  Unavailable — provider does not expose this.
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ── CallPilot usage ────────────────────────────────────────── */}
      <section className="panel p-5">
        <div className="flex items-start gap-2">
          <BarChart3 className="mt-0.5 h-4 w-4 text-[var(--opaline-primary)]" />
          <div>
            <h3 className="text-[15px] font-semibold text-[var(--opaline-on-surface)]">CallPilot usage</h3>
            <p className="text-caption mt-0.5">
              Requests, tokens, and cost tracked locally by CallPilot{provider ? ` for ${provider.providerType}` : ''}.
            </p>
          </div>
        </div>

        {usageLoading ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-[var(--opaline-on-surface-variant)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading usage…
          </div>
        ) : usageError || !usage ? (
          <div className="panel-inset mt-4 flex items-start gap-2 px-3 py-4 text-sm text-[var(--opaline-on-surface-variant)]">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-[var(--opaline-warning)]" />
            <span>{usageError ?? 'No usage data available yet.'}</span>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <MetricCell label="Total requests" value={usage.totalRequests.toLocaleString()} />
              <MetricCell label="Successful" value={usage.successful.toLocaleString()} />
              <MetricCell label="Failed" value={usage.failed.toLocaleString()} />
              <MetricCell label="Total tokens" value={usage.totalTokens.toLocaleString()} />
              <MetricCell label="Input tokens" value={usage.inputTokens.toLocaleString()} />
              <MetricCell label="Output tokens" value={usage.outputTokens.toLocaleString()} />
            </div>

            <div className="panel-inset flex items-center justify-between px-4 py-3">
              <span className="text-caption">Estimated cost</span>
              <span className="chip chip-success">≈ ${usage.estimatedCostUsd.toFixed(4)} (estimate)</span>
            </div>

            {usage.byProvider && usage.byProvider.length > 0 && (
              <div>
                <span className="text-overline">By provider</span>
                <div className="mt-2 divide-y divide-[var(--opaline-outline-variant)] rounded-md border border-[var(--opaline-outline-variant)]">
                  {usage.byProvider.map((row) => (
                    <div key={row.providerType} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span className="font-medium capitalize text-[var(--opaline-on-surface)]">{row.providerType}</span>
                      <span className="text-caption">
                        {row.requestCount} req · {row.totalTokens.toLocaleString()} tokens · ≈ ${row.estimatedCostUsd.toFixed(4)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
};

const SummaryCell: React.FC<{ label: string; value: string; monospace?: boolean }> = ({ label, value, monospace }) => (
  <div className="panel-inset px-3 py-2">
    <div className="text-caption">{label}</div>
    <div className={cn('mt-0.5 text-sm text-[var(--opaline-on-surface)]', monospace && 'text-data')}>{value}</div>
  </div>
);

const MetricCell: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="panel-inset px-3 py-2">
    <div className="text-caption">{label}</div>
    <div className="text-data mt-0.5 text-[var(--opaline-on-surface)]">{value}</div>
  </div>
);

function prettyJson(raw: string): string {
  if (typeof raw !== 'string' || !raw) return '';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
