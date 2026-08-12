'use client';

// SummarizationModelSettings - local LLM model management for meeting
// summarization. Mirrors the speech-model manager cards: each model shows
// name, size, download/readiness status, and selection. Inference happens on
// the user's machine via the bundled llama-helper (llama.cpp) against
// downloaded GGUF models - no API key, no transcript ever leaves the device.

import { useCallback, useEffect, useState } from 'react';
import { Download, Trash2, Check, LoaderIcon, ServerOff, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  cancelLlmDownload,
  deleteLlmModel,
  getLlmModels,
  listenLlmDownloadProgress,
  pullLlmModel,
  type LlmModelInfo,
} from '@/lib/llm';
import { useConfig } from '@/contexts/ConfigContext';
import { cn } from '@/lib/utils';

export const SummarizationModelSettings: React.FC = () => {
  const { summarizationModel, setSummarizationModel } = useConfig();
  const [models, setModels] = useState<LlmModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setModels(await getLlmModels());
    } catch (e) {
      console.warn('[summarization] failed to load models:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const unlisten = listenLlmDownloadProgress((e) => {
      setDownloading((prev) => ({ ...prev, [e.modelName]: e.progress }));
    }).catch(() => () => {});
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [refresh]);

  const handleDownload = async (name: string) => {
    setBusy(name);
    try {
      await pullLlmModel(name);
      toast.success(`${name} installed`);
      await refresh();
    } catch (e) {
      toast.error(`Download failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
      setDownloading((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
      void refresh();
    }
  };

  const handleCancelDownload = async (name: string) => {
    setBusy(name);
    try {
      await cancelLlmDownload(name);
    } catch {
      // The download may already have finished - the next refresh shows it.
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (name: string) => {
    setBusy(name);
    try {
      await deleteLlmModel(name);
      toast.success(`${name} removed`);
      if (models.find((m) => m.id === name)?.selected) setSummarizationModel(null);
      await refresh();
    } catch (e) {
      toast.error(`Could not remove model: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const helperMissing = models.length > 0 && models.every((m) => !m.helperAvailable);

  return (
    <div className="space-y-3 rounded-xl border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] p-4">
      <div>
        <h3 className="text-body-md font-medium text-[var(--opaline-on-surface)]">Meeting summarization</h3>
        <p className="mt-0.5 text-caption text-[var(--opaline-on-surface-variant)]">
          A local model summarizes each completed meeting on your machine — the transcript never leaves your device.
        </p>
      </div>

      {helperMissing && (
        <div className="flex flex-col gap-2 rounded-md border border-[var(--opaline-warning-border)] bg-[var(--opaline-warning-soft)] px-3 py-2.5">
          <div className="flex items-start gap-2 text-caption text-[var(--opaline-on-surface-variant)]">
            <ServerOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--opaline-warning)]" aria-hidden />
            <span>
              The bundled local inference engine (llama-helper) is unavailable, so LLM summaries are not possible
              in this build. Reinstall or rebuild the application to restore them.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={refresh}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--opaline-outline-variant)] px-2.5 py-1 text-[11px] font-medium text-[var(--opaline-on-surface)] transition-colors hover:bg-[var(--opaline-surface-container-low)]"
            >
              Check again
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-2 text-caption text-[var(--opaline-on-surface-variant)]">
          <LoaderIcon className="h-3.5 w-3.5 animate-spin" /> Checking local models…
        </div>
      ) : (
        <div className="space-y-2">
          {models.map((m) => {
            const progress = downloading[m.id] ?? (m.status === 'downloading' ? m.progress ?? 0 : undefined);
            const isSelected = summarizationModel === m.id;
            const isBusy = busy === m.id;
            const ready = m.status === 'ready';
            const corrupt = m.status === 'corrupted';
            return (
              <div
                key={m.id}
                className={cn(
                  'flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                  isSelected
                    ? 'border-[var(--opaline-primary)]/50 bg-[var(--opaline-surface-container-low)]'
                    : 'border-[var(--opaline-outline-variant)]',
                )}
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  disabled={!ready}
                  onClick={() => ready && setSummarizationModel(m.id)}
                  className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--opaline-primary)]"
                  title={ready ? 'Select model' : 'Not installed'}
                >
                  {isSelected && <span className="h-2 w-2 rounded-full bg-[var(--opaline-primary)]" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium text-[var(--opaline-on-surface)]">{m.name}</span>
                    {ready && <span className="chip chip-success !px-1.5 !py-0 !text-[10px]">Ready</span>}
                    {corrupt && <span className="chip chip-danger !px-1.5 !py-0 !text-[10px]">Corrupted</span>}
                    {m.status === 'missing' && <span className="chip chip-neutral !px-1.5 !py-0 !text-[10px]">Not installed</span>}
                  </div>
                  <p className="mt-0.5 text-caption text-[var(--opaline-on-surface-variant)]">{m.description}</p>
                  <p className="mt-0.5 text-data text-[10px] text-[var(--opaline-outline)]">
                    ~{(m.sizeMb / 1024).toFixed(1)} GB · {Math.round(m.contextSize / 1000)}k context
                  </p>

                  {progress !== undefined && (
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--opaline-surface-container-low)]">
                      <div
                        className="h-full rounded-full bg-[var(--opaline-primary)] transition-[width] duration-200"
                        style={{ width: `${Math.max(2, progress)}%` }}
                      />
                    </div>
                  )}
                  {progress !== undefined && (
                    <p className="mt-0.5 text-caption tabular-nums text-[var(--opaline-on-surface-variant)]">
                      Downloading {Math.min(100, progress)}%
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {ready ? (
                    <>
                      {isSelected ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--opaline-success)]">
                          <Check className="h-3 w-3" aria-hidden /> Selected
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setSummarizationModel(m.id)}
                          className="rounded-md px-2 py-1 text-[11px] font-medium text-[var(--opaline-on-surface)] transition-colors hover:bg-[var(--opaline-surface-container-low)]"
                        >
                          Use
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDelete(m.id)}
                        disabled={isBusy}
                        aria-label={`Delete ${m.name}`}
                        title="Delete model"
                        className="rounded-md p-1.5 text-[var(--opaline-on-surface-variant)] transition-colors hover:bg-[var(--opaline-error-container)] hover:text-[var(--opaline-on-error-container)] disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </>
                  ) : progress !== undefined ? (
                    <button
                      type="button"
                      onClick={() => handleCancelDownload(m.id)}
                      disabled={isBusy}
                      className="inline-flex items-center gap-1 rounded-lg border border-[var(--opaline-outline-variant)] px-2.5 py-1 text-[11px] font-medium text-[var(--opaline-on-surface)] transition-colors hover:bg-[var(--opaline-surface-container-low)] disabled:opacity-50"
                    >
                      <X className="h-3 w-3" /> Cancel
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleDownload(m.id)}
                      disabled={isBusy}
                      className="inline-flex items-center gap-1 rounded-lg bg-[var(--opaline-primary)] px-2.5 py-1 text-[11px] font-medium text-[var(--opaline-on-primary)] transition-colors hover:bg-[var(--opaline-primary-hover)] disabled:opacity-50"
                    >
                      {isBusy ? <LoaderIcon className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                      {corrupt ? 'Re-download' : 'Download'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
