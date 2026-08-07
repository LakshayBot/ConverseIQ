'use client';

import React, { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Loader2, Save, LogOut } from 'lucide-react';
import {
  DEFAULT_CALLPILOT_API_URL,
  SETTINGS_KEY_API_URL,
  SETTINGS_KEY_AUTO_START,
  SETTINGS_KEY_SAVE_LOCAL,
  SETTINGS_KEY_SHOW_SPEAKER_LABELS,
} from '@/lib/callpilot';
import { persistApiUrl, setCallPilotApiBaseUrl, testConnection } from '@/lib/callpilotApi';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

function readStored(key: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

function readBool(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    return v === 'true';
  } catch { return fallback; }
}

export const CallPilotServerSettings: React.FC = () => {
  const [apiUrl, setApiUrl] = useState(DEFAULT_CALLPILOT_API_URL);
  const [autoStart, setAutoStart] = useState(false);
  const [saveLocal, setSaveLocal] = useState(true);
  const [showSpeakerLabels, setShowSpeakerLabels] = useState(true);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<null | { ok: boolean; message: string }>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saved'>('idle');
  const [signingOut, setSigningOut] = useState(false);

  const { session, logout } = useAuth();

  useEffect(() => {
    setApiUrl(readStored(SETTINGS_KEY_API_URL, DEFAULT_CALLPILOT_API_URL));
    setAutoStart(readBool(SETTINGS_KEY_AUTO_START, false));
    setSaveLocal(readBool(SETTINGS_KEY_SAVE_LOCAL, true));
    setShowSpeakerLabels(readBool(SETTINGS_KEY_SHOW_SPEAKER_LABELS, true));
  }, []);

  const onTest = async () => {
    setTesting(true);
    setTestResult(null);
    setCallPilotApiBaseUrl(apiUrl);
    const result = await testConnection();
    setTesting(false);
    if (result.ok) {
      setTestResult({ ok: true, message: `Connected (HTTP ${result.status})` });
    } else {
      setTestResult({ ok: false, message: result.error ?? `HTTP ${result.status ?? '-'}` });
    }
  };

  const onSave = async () => {
    try {
      localStorage.setItem(SETTINGS_KEY_API_URL, apiUrl);
      localStorage.setItem(SETTINGS_KEY_AUTO_START, autoStart ? 'true' : 'false');
      localStorage.setItem(SETTINGS_KEY_SAVE_LOCAL, saveLocal ? 'true' : 'false');
      localStorage.setItem(SETTINGS_KEY_SHOW_SPEAKER_LABELS, showSpeakerLabels ? 'true' : 'false');
    } catch {}
    setCallPilotApiBaseUrl(apiUrl);
    await persistApiUrl(apiUrl);
    setSaveState('saved');
    setTimeout(() => setSaveState('idle'), 1500);
  };

  const onSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await logout();
      toast.success('Signed out');
      // AuthGate will unmount the shell on the next render - no router needed.
    } catch (e) {
      console.error('[settings] sign out failed:', e);
      toast.error('Could not sign out', {
        description: 'The local session was cleared. Try again if the issue persists.',
      });
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-8">
      {/* CallPilot Server */}
      <section>
        <h2 className="text-headline-md text-[var(--opaline-on-surface)]">CallPilot Server</h2>
        <p className="text-body-sm text-[var(--opaline-outline)] mt-1">
          Point the desktop agent at your CallPilot .NET Gateway. The
          intelligence stream and meeting sync use this endpoint.
        </p>

        <div className="mt-4 space-y-4">
          <div>
            <label className="field-label">CallPilot API URL</label>
            <input
              type="url"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder={DEFAULT_CALLPILOT_API_URL}
              className="mt-1 block w-full rounded-md border border-[var(--opaline-outline-variant)] px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <p className="mt-1 field-hint text-[var(--opaline-outline)]">Used for /api/v1/auth/*, /api/v1/meetings/*, /api/v1/knowledge/*</p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onTest}
              disabled={testing}
              className="inline-flex items-center gap-2 rounded-md border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] px-3 py-1.5 text-sm font-medium text-[var(--opaline-on-surface-variant)] hover:bg-[var(--opaline-surface-container-low)] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--opaline-primary)]"
            >
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Test Connection
            </button>
            {testResult && (
              <span className={`chip ${testResult.ok ? 'chip-success' : 'chip-danger'}`}>
                {testResult.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                {testResult.message}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Session */}
      <section>
        <h2 className="text-headline-md text-[var(--opaline-on-surface)]">Session</h2>
        <div className="mt-4 space-y-4">
          <SettingRow
            label="Auto-start on launch"
            description="Resume the last recording session when the app opens."
          >
            <Switch checked={autoStart} onCheckedChange={setAutoStart} />
          </SettingRow>
          <SettingRow
            label="Save transcripts locally"
            description="Keep a local SQLite cache of transcripts (recommended)."
          >
            <Switch checked={saveLocal} onCheckedChange={setSaveLocal} />
          </SettingRow>
          <SettingRow
            label="Show REP / PROSPECT labels"
            description="Tag each transcript segment with the speaker inferred from the audio source."
          >
            <Switch checked={showSpeakerLabels} onCheckedChange={setShowSpeakerLabels} />
          </SettingRow>
        </div>
      </section>

      {/* Account */}
      <section>
        <h2 className="text-headline-md text-[var(--opaline-on-surface)]">Account</h2>
        <div className="mt-4 flex items-center justify-between gap-4 panel px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-[var(--opaline-on-surface)]">Signed in as</div>
            <div className="text-xs text-[var(--opaline-outline)] truncate">
              {session?.email ?? 'Not signed in'}
            </div>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            disabled={!session || signingOut}
            className="inline-flex items-center gap-2 rounded-md border border-[var(--opaline-danger-border)] bg-[var(--opaline-surface-container-lowest)] px-3 py-1.5 text-sm font-medium text-danger hover:bg-[var(--opaline-danger-soft)] disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--opaline-danger)]"
          >
            {signingOut ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <LogOut className="w-4 h-4" />
            )}
            Sign out
          </button>
        </div>
      </section>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={onSave}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-[var(--opaline-on-primary)] hover:bg-[var(--opaline-primary-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--opaline-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Save className="w-4 h-4" />
          Save
        </button>
        {saveState === 'saved' && (
          <span className="chip chip-success">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Saved
          </span>
        )}
      </div>
    </div>
  );
};

const SettingRow: React.FC<{ label: string; description: string; children: React.ReactNode }> = ({ label, description, children }) => (
  <div className="flex items-start justify-between gap-4">
    <div>
      <div className="text-sm font-medium text-[var(--opaline-on-surface)]">{label}</div>
      <div className="text-xs text-[var(--opaline-outline)]">{description}</div>
    </div>
    <div className="flex-shrink-0">{children}</div>
  </div>
);
