'use client';

// Local LLM (meeting summarization) client.
//
// Mirrors the speech-model manager API (lib/whisper.ts / lib/parakeet.ts):
// model catalog + status, download with streamed progress events, and local
// inference. All inference runs on the user's machine through the bundled
// llama-helper (llama.cpp) sidecar against downloaded GGUF models - the
// transcript never leaves the device.

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export type LlmModelStatus = 'missing' | 'downloading' | 'ready' | 'corrupted';

export interface LlmModelInfo {
  id: string;
  name: string;
  ggufFile: string;
  sizeMb: number;
  contextSize: number;
  template: string;
  description: string;
  localPath: string | null;
  status: LlmModelStatus;
  progress: number | null;
  selected: boolean;
  helperAvailable: boolean;
}

export interface LlmConfig {
  model: string | null;
  autoSummarize: boolean | null;
}

export interface LocalSummary {
  summary?: string;
  keyPoints?: string[];
  decisions?: string[];
  actionItems?: string[];
  customerRequirements?: string[];
  objections?: string[];
  followUps?: string[];
}

export interface SummaryProgressEvent {
  stage: string;
  percent: number;
}

export interface DownloadProgressEvent {
  modelName: string;
  progress: number;
}

export function getLlmConfig(): Promise<LlmConfig> {
  return invoke<LlmConfig>('llm_get_config');
}

export async function setLlmConfig(model?: string | null, autoSummarize?: boolean): Promise<LlmConfig> {
  return invoke<LlmConfig>('llm_set_config', { model, autoSummarize });
}

export function getLlmModels(): Promise<LlmModelInfo[]> {
  return invoke<LlmModelInfo[]>('llm_get_models');
}

export function pullLlmModel(name: string): Promise<void> {
  return invoke<void>('llm_pull_model', { name });
}

export function cancelLlmDownload(name: string): Promise<void> {
  return invoke<void>('llm_cancel_download', { name });
}

export function deleteLlmModel(name: string): Promise<void> {
  return invoke<void>('llm_delete_model', { name });
}

/** Runs local meeting summarization and returns the structured summary. */
export function generateLocalSummary(transcript: string, model?: string | null): Promise<LocalSummary> {
  return invoke<LocalSummary>('llm_generate_summary', { transcript, model });
}

export function listenLlmDownloadProgress(
  cb: (event: DownloadProgressEvent) => void,
): Promise<UnlistenFn> {
  return listen<DownloadProgressEvent>('llm-model-download-progress', (e) => cb(e.payload));
}

export function listenLlmSummaryProgress(
  cb: (event: SummaryProgressEvent) => void,
): Promise<UnlistenFn> {
  return listen<SummaryProgressEvent>('llm-summary-progress', (e) => cb(e.payload));
}

/** id → display name (mirrors the Rust GGUF catalog). */
export const SUMMARIZATION_MODEL_NAMES: Record<string, string> = {
  'qwen3.5-2b-q4': 'Qwen 3.5 2B (Balanced)',
  'qwen3.5-4b-q4': 'Qwen 3.5 4B (High quality)',
  'gemma3-1b-q8': 'Gemma 3 1B (Fast)',
  'gemma3-4b-q4': 'Gemma 3 4B (Balanced)',
};

