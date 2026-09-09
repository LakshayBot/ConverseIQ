'use client';

// IntegrationSettings - the "Integrations" settings tab. Currently Slack only.
//
// OAuth flow: the server builds the Slack authorize URL (GET
// /api/v1/integrations/slack/connect → {url}); we open it in the system
// browser via the existing `open_external_url` Tauri command (the same
// pattern About.tsx uses). Slack redirects back to the server callback, and
// because the desktop has no registered URL-scheme handler, this component
// POLLS the integration status after opening the browser and flips to the
// connected view as soon as the row appears.
//
// The bot token is never sent to the client — GET returns a masked display
// only (server-side SafeMask, same contract as the BYOK provider settings).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { Plug, Loader2, RefreshCw } from 'lucide-react';
import { authedApiCall } from '@/lib/auth';
import { Switch } from '@/components/ui/switch';
import { ConfirmationModal } from '@/components/ConfirmationModel/confirmation-modal';

interface SlackIntegrationStatus {
  connected: boolean;
  teamName: string | null;
  teamId: string | null;
  maskedToken: string | null;
  installedAt: string | null;
  defaultChannelId: string | null;
  notifyBattleCards: boolean;
  notifyLiveSignals: boolean;
  notifySummary: boolean;
  notifyActionItems: boolean;
}

const EMPTY: SlackIntegrationStatus = {
  connected: false,
  teamName: null,
  teamId: null,
  maskedToken: null,
  installedAt: null,
  defaultChannelId: null,
  notifyBattleCards: true,
  notifyLiveSignals: true,
  notifySummary: true,
  notifyActionItems: true,
};

const TOGGLES: Array<{ key: keyof SlackIntegrationStatus; label: string; description: string }> = [
  { key: 'notifyBattleCards', label: 'Battle cards', description: 'Battle card triggers and contextual matches during calls' },
  { key: 'notifyLiveSignals', label: 'Live signals', description: 'Objections and competitor mentions as they happen' },
  { key: 'notifySummary', label: 'Call summaries', description: 'Post-call summary pushed when it finishes generating' },
  { key: 'notifyActionItems', label: 'Action items', description: 'Structured action items pushed when saved' },
];

async function fetchStatus(): Promise<SlackIntegrationStatus> {
  return authedApiCall<SlackIntegrationStatus>('GET', '/api/v1/integrations/slack');
}

export const IntegrationSettings: React.FC = () => {
  const [status, setStatus] = useState<SlackIntegrationStatus>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  const refresh = useCallback(async () => {
    try {
      setStatus(await fetchStatus());
    } catch {
      // Keep the last known status; the server may be briefly unreachable.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, [refresh]);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      const resp = await authedApiCall<{ url: string | null; error?: string }>(
        'GET', '/api/v1/integrations/slack/connect');
      if (!resp?.url) {
        toast.error(resp?.error || 'Slack OAuth is not configured on this server.');
        setConnecting(false);
        return;
      }
      await invoke('open_external_url', { url: resp.url });
      // The browser redirect lands on the server callback (there is no
      // registered callpilot:// deep-link handler), so we poll the status
      // until the integration row appears (up to ~3 minutes).
      let elapsed = 0;
      pollTimer.current = setInterval(async () => {
        elapsed += 2;
        const before = status;
        await refresh();
        if (status.connected && !before.connected) {
          if (pollTimer.current) clearInterval(pollTimer.current);
          setConnecting(false);
          toast.success('Slack connected');
        }
        if (elapsed > 180 && pollTimer.current) {
          clearInterval(pollTimer.current);
          setConnecting(false);
        }
      }, 2000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setConnecting(false);
    }
  }, [refresh, status]);

  const pendingToggles = useRef<Partial<Record<keyof SlackIntegrationStatus, boolean>>>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateToggle = useCallback((key: keyof SlackIntegrationStatus, value: boolean) => {
    // Optimistic update + 500ms debounced PUT (rapid toggling hits the API once).
    setStatus((prev) => ({ ...prev, [key]: value }));
    pendingToggles.current[key] = value;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      saveTimer.current = null;
      const merged = { ...statusRef.current, ...pendingToggles.current };
      pendingToggles.current = {};
      try {
        await authedApiCall('PUT', '/api/v1/integrations/slack/settings', {
          notifyBattleCards: merged.notifyBattleCards,
          notifyLiveSignals: merged.notifyLiveSignals,
          notifySummary: merged.notifySummary,
          notifyActionItems: merged.notifyActionItems,
        });
      } catch {
        toast.error('Failed to save Slack settings');
        void refresh();
      }
    }, 500);
  }, [refresh]);

  const disconnect = useCallback(async () => {
    setDisconnectOpen(false);
    try {
      await authedApiCall('DELETE', '/api/v1/integrations/slack');
      setStatus(EMPTY);
      toast.success('Slack disconnected');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-[var(--opaline-on-surface-variant)]">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading integrations…
      </div>
    );
  }

  if (!status.connected) {
    return (
      <div className="rounded-xl border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] p-6 shadow-xs">
        <div className="flex items-center gap-3 mb-3">
          <span
            aria-hidden
            className="flex h-9 w-9 items-center justify-center rounded-lg text-white font-bold"
            style={{ background: '#4A154B' }} // Slack aubergine
          >
            #
          </span>
          <div>
            <h3 className="text-body-md font-medium text-[var(--opaline-on-surface)]">Slack</h3>
            <p className="text-caption text-[var(--opaline-on-surface-variant)]">
              Workspace integration
            </p>
          </div>
        </div>
        <p className="text-body-sm text-[var(--opaline-on-surface-variant)] max-w-md">
          Connect your Slack workspace to receive deal signals, battle cards, and
          summaries in your team channels.
        </p>
        <button
          type="button"
          data-testid="connect-slack"
          onClick={connect}
          disabled={connecting}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[var(--opaline-primary)] px-4 py-2 text-sm font-medium text-[var(--opaline-on-primary)] transition-colors hover:bg-[var(--opaline-primary-hover)] disabled:opacity-50"
        >
          {connecting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Waiting for Slack…
            </>
          ) : (
            <>
              <Plug className="h-4 w-4" /> Connect Slack
            </>
          )}
        </button>
        {connecting && (
          <p className="mt-2 text-caption text-[var(--opaline-outline)]">
            Complete the authorization in your browser — this screen updates automatically.
          </p>
        )}
      </div>
    );
  }

  const installedOn = status.installedAt
    ? new Date(status.installedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : null;

  return (
    <div className="rounded-xl border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] shadow-xs">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--hairline)] p-5">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex h-9 w-9 items-center justify-center rounded-lg text-white font-bold"
            style={{ background: '#4A154B' }}
          >
            #
          </span>
          <div>
            <h3 className="text-body-md font-medium text-[var(--opaline-on-surface)]" data-testid="slack-team-name">
              {status.teamName || 'Slack workspace'}
            </h3>
            <p className="text-caption text-[var(--opaline-on-surface-variant)]">
              {installedOn ? `Connected on ${installedOn}` : 'Connected'}
              {status.maskedToken ? ` · token ${status.maskedToken}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refresh}
            title="Refresh status"
            className="p-2 rounded-md text-[var(--opaline-on-surface-variant)] hover:bg-[var(--opaline-surface-container-low)]"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            type="button"
            data-testid="disconnect-slack"
            onClick={() => setDisconnectOpen(true)}
            className="rounded-lg border border-[var(--opaline-outline-variant)] px-3 py-1.5 text-xs font-medium text-[var(--opaline-danger)] hover:bg-[var(--opaline-surface-container-low)]"
          >
            Disconnect
          </button>
        </div>
      </div>

      {/* Per-notification-type toggles */}
      <ul>
        {TOGGLES.map((t, i) => (
          <li
            key={t.key}
            className={`flex items-center justify-between gap-4 px-5 py-3.5 ${i > 0 ? 'border-t border-dashed border-[var(--opaline-outline-variant)]' : ''}`}
          >
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-[var(--opaline-on-surface)]">{t.label}</p>
              <p className="text-caption text-[var(--opaline-on-surface-variant)]">{t.description}</p>
            </div>
            <Switch
              checked={Boolean(status[t.key])}
              onCheckedChange={(checked) => void updateToggle(t.key, checked)}
              aria-label={t.label}
            />
          </li>
        ))}
      </ul>

      <ConfirmationModal
        isOpen={disconnectOpen}
        text={`Disconnect ${status.teamName || 'your Slack workspace'}? Deal signals will stop posting to your channels.`}
        onConfirm={disconnect}
        onCancel={() => setDisconnectOpen(false)}
      />
    </div>
  );
};

export default IntegrationSettings;
