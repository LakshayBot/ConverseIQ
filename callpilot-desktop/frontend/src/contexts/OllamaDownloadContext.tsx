'use client';

// Stub for the deleted OllamaDownloadContext. CallPilot does not bundle a
// local LLM downloader — providers are configured server-side via the .NET
// Gateway. This stub keeps existing imports type-checking.

import React, { createContext, useContext, useMemo } from 'react';

interface OllamaDownloadState {
  activeDownloads: Record<string, number>;
  downloadingModels: Set<string>;
  isDownloading: (model: string) => boolean;
  getProgress: (model: string) => number;
  registerDownload: (model: string) => void;
  unregisterDownload: (model: string) => void;
  updateProgress: (model: string, percent: number) => void;
}

const Ctx = createContext<OllamaDownloadState | null>(null);

export function OllamaDownloadProvider({ children }: { children: React.ReactNode }) {
  const value = useMemo<OllamaDownloadState>(() => ({
    activeDownloads: {},
    downloadingModels: new Set<string>(),
    isDownloading: () => false,
    getProgress: () => 0,
    registerDownload: () => {},
    unregisterDownload: () => {},
    updateProgress: () => {},
  }), []);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOllamaDownload(): OllamaDownloadState {
  const ctx = useContext(Ctx);
  return ctx ?? {
    activeDownloads: {},
    downloadingModels: new Set<string>(),
    isDownloading: () => false,
    getProgress: () => 0,
    registerDownload: () => {},
    unregisterDownload: () => {},
    updateProgress: () => {},
  };
}
