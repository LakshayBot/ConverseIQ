'use client';

// Local speaker diarization (meeting speaker identification) client.
//
// Mirrors lib/llm.ts: model catalog + status, downloads with streamed
// progress events, and the offline "Identify Speakers" job for completed
// meetings. All inference runs on the user's machine through the bundled
// diar-helper (sherpa-onnx) sidecar - nothing leaves the device.

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export type DiarModelStatus = 'missing' | 'downloading' | 'ready' | 'corrupted';

export interface DiarModelInfo {
  id: string;
  name: string;
  description: string;
  embeddingSizeMb: number;
  segmentationSizeMb: number;
  clusterThreshold: number;
  similarityThreshold: number;
  localPath: string | null;
  status: DiarModelStatus;
  progress: number | null;
  selected: boolean;
  helperAvailable: boolean;
}

export interface DiarConfig {
  enabled: boolean | null;
  model: string | null;
}

export interface DiarMeetingJobStatus {
  meetingId: string;
  state: 'processing' | 'completed' | 'failed';
  stage: string;
  progress: number;
  error: string | null;
  speakersFound: number | null;
}

export interface DiarModelDownloadEvent {
  modelName: string;
  progress: number;
  downloadedMb: number;
  totalMb: number;
  speedMbps: number;
}

export function getDiarConfig(): Promise<DiarConfig> {
  return invoke<DiarConfig>('diar_get_config');
}

export async function setDiarConfig(enabled?: boolean, model?: string | null): Promise<DiarConfig> {
  return invoke<DiarConfig>('diar_set_config', { enabled, model });
}

export function getDiarModels(): Promise<DiarModelInfo[]> {
  return invoke<DiarModelInfo[]>('diar_get_models');
}

export function pullDiarModel(name: string): Promise<void> {
  return invoke<void>('diar_pull_model', { name });
}

export function cancelDiarDownload(name: string): Promise<void> {
  return invoke<void>('diar_cancel_download', { name });
}

export function deleteDiarModel(name: string): Promise<void> {
  return invoke<void>('diar_delete_model', { name });
}

/** Runs offline speaker identification for a completed meeting (background job). */
export function identifyMeetingSpeakers(meetingId: string, numSpeakers?: number | null, model?: string | null): Promise<void> {
  return invoke<void>('diar_identify_meeting', { meetingId, numSpeakers, model });
}

export function getMeetingSpeakerStatus(meetingId: string): Promise<DiarMeetingJobStatus | null> {
  return invoke<DiarMeetingJobStatus | null>('diar_get_meeting_status', { meetingId });
}

export function cancelIdentifyMeeting(meetingId: string): Promise<void> {
  return invoke<void>('diar_cancel_identify', { meetingId });
}

export function listenDiarModelDownloadProgress(
  cb: (event: DiarModelDownloadEvent) => void,
): Promise<UnlistenFn> {
  return listen<DiarModelDownloadEvent>('diar-model-download-progress', (e) => cb(e.payload));
}

export function listenDiarModelDownloadComplete(cb: (modelName: string) => void): Promise<UnlistenFn> {
  return listen<{ modelName: string }>('diar-model-download-complete', (e) => cb(e.payload.modelName));
}

export function listenDiarModelDownloadError(cb: (modelName: string, error: string) => void): Promise<UnlistenFn> {
  return listen<{ modelName: string; error: string }>('diar-model-download-error', (e) =>
    cb(e.payload.modelName, e.payload.error),
  );
}

export function listenDiarMeetingProgress(cb: (status: DiarMeetingJobStatus) => void): Promise<UnlistenFn> {
  return listen<DiarMeetingJobStatus>('diar-meeting-progress', (e) => cb(e.payload));
}

export function listenDiarMeetingComplete(
  cb: (payload: { meetingId: string; speakersFound: number; segmentsUpdated: number }) => void,
): Promise<UnlistenFn> {
  return listen<{ meetingId: string; speakersFound: number; segmentsUpdated: number }>(
    'diar-meeting-complete',
    (e) => cb(e.payload),
  );
}

export function listenDiarMeetingError(cb: (meetingId: string, error: string) => void): Promise<UnlistenFn> {
  return listen<{ meetingId: string; error: string }>('diar-meeting-error', (e) =>
    cb(e.payload.meetingId, e.payload.error),
  );
}

/** id → display name (mirrors the Rust tier catalog). */
export const DIAR_MODEL_NAMES: Record<string, string> = {
  fast: 'Fast (Best for laptops)',
  accurate: 'Accurate (Better separation)',
};
