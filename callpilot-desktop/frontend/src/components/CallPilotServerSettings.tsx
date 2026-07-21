'use client';

import React, { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Loader2, Save } from 'lucide-react';
import {
  DEFAULT_CALLPILOT_API_URL,
  DEFAULT_CALLPILOT_AI_ENGINE_URL,
  SETTINGS_KEY_API_URL,
  SETTINGS_KEY_AI_ENGINE_URL,
  SETTINGS_KEY_AUTO_START,
  SETTINGS_KEY_SAVE_LOCAL,
  SETTINGS_KEY_SHOW_SPEAKER_LABELS,
  normalizeWsBaseUrl,
} from '@/lib/callpilot';
import { persistApiUrl, persistAiEngineUrl, setCallPilotApiBaseUrl, testConnection } from '@/lib/callpilotApi';
import { Switch } from '@/components/ui/switch';

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
  const [aiEngineUrl, setAiEngineUrl] = useState(DEFAULT_CALLPILOT_AI_ENGINE_URL);
  const [autoStart, setAutoStart] = useState(false);
  const [saveLocal, setSaveLocal] = useState(true);
  const [showSpeakerLabels, setShowSpeakerLabels] = useState(true);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<null | { ok: boolean; message: string }>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saved'>('idle');

  useEffect(() => {
    setApiUrl(readStored(SETTINGS_KEY_API_URL, DEFAULT_CALLPILOT_API_URL));
    setAiEngineUrl(readStored(SETTINGS_KEY_AI_ENGINE_URL, DEFAULT_CALLPILOT_AI_ENGINE_URL));
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
      setTestResult({ ok: false, message: result.error ?? `HTTP ${result.status ?? '—'}` });
    }
  };

  const onSave = async () => {
    try {
      localStorage.setItem(SETTINGS_KEY_API_URL, apiUrl);
      localStorage.setItem(SETTINGS_KEY_AI_ENGINE_URL, aiEngineUrl);
      localStorage.setItem(SETTINGS_KEY_AUTO_START, autoStart ? 'true' : 'false');
      localStorage.setItem(SETTINGS_KEY_SAVE_LOCAL, saveLocal ? 'true' : 'false');
      localStorage.setItem(SETTINGS_KEY_SHOW_SPEAKER_LABELS, showSpeakerLabels ? 'true' : 'false');
    } catch {}
    setCallPilotApiBaseUrl(apiUrl);
    await persistApiUrl(apiUrl);
    await persistAiEngineUrl(aiEngineUrl);
    setSaveState('saved');
    setTimeout(() => setSaveState('idle'), 1500);
  };

  const wsPreview = `${normalizeWsBaseUrl(aiEngineUrl).replace(/\/+$/, '')}/ws/intelligence/{session_id}`;

  return (
    <div className="max-w-2xl space-y-8">
      {/* CallPilot Server */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900">CallPilot Server</h2>
        <p className="text-sm text-gray-500 mt-1">
          Point the desktop agent at your CallPilot .NET Gateway and AI engine.
          The intelligence stream and meeting sync use these endpoints.
        </p>

        <div className="mt-4 space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700">CallPilot API URL</label>
            <input
              type="url"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder={DEFAULT_CALLPILOT_API_URL}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">Used for /api/v1/auth/*, /api/v1/meetings/*, /api/v1/knowledge/*</p>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700">CallPilot AI Engine URL</label>
            <input
              type="text"
              value={aiEngineUrl}
              onChange={(e) => setAiEngineUrl(e.target.value)}
              placeholder={DEFAULT_CALLPILOT_AI_ENGINE_URL}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">
              WebSocket endpoint. Cards stream in at <code className="bg-gray-100 px-1 rounded">{wsPreview}</code>
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onTest}
              disabled={testing}
              className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Test Connection
            </button>
            {testResult && (
              <span className={`inline-flex items-center gap-1 text-sm ${testResult.ok ? 'text-emerald-600' : 'text-red-600'}`}>
                {testResult.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                {testResult.message}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Session */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900">Session</h2>
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

      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={onSave}
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Save className="w-4 h-4" />
          Save
        </button>
        {saveState === 'saved' && (
          <span className="inline-flex items-center gap-1 text-sm text-emerald-600">
            <CheckCircle2 className="w-4 h-4" />
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
      <div className="text-sm font-medium text-gray-800">{label}</div>
      <div className="text-xs text-gray-500">{description}</div>
    </div>
    <div className="flex-shrink-0">{children}</div>
  </div>
);
