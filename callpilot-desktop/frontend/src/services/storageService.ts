/**
 * Storage Service
 *
 * Persists meetings + transcripts via the .NET Gateway REST API. Replaces
 * the old Tauri-SQLite shortcuts (`api_save_transcript`, `api_get_meeting`,
 * `api_get_meetings`) so the desktop no longer carries its own SQLite
 * database for meeting storage. Conversations events and recommendations
 * already live on the .NET side - this service completes the picture by
 * keeping transcripts and meeting metadata on the same Postgres-backed
 * store.
 */

import { invoke } from '@tauri-apps/api/core';
import { authedApiCall } from '@/lib/auth';
import { Transcript } from '@/types';

export interface SaveMeetingRequest {
  meetingTitle: string;
  transcripts: Transcript[];
  folderPath: string | null;
  meetingId?: string | null;
}

/** A meeting-scoped speaker row (id is client-minted, stable across saves). */
export interface SpeakerSave {
  id: string;
  displayName: string;
  sortOrder: number;
}

export interface SaveMeetingResponse {
  meeting_id: string;
}

export interface Meeting {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  startedAt?: string | null;
  endedAt?: string | null;
  folderPath?: string | null;
  transcriptCount?: number;
  eventCount?: number;
  recommendationCount?: number;
  [key: string]: any;
}

/**
 * Storage Service
 * Singleton service for managing meeting storage operations
 */
export class StorageService {
  /**
   * Persist a completed meeting's transcripts to the .NET Gateway.
   *
   * The .NET `POST /api/v1/meetings/{id}/transcripts` endpoint is idempotent -
   * existing transcript segments for the meeting are deleted first, then
   * the new set is written. This keeps desktop retry logic simple and is
   * also the right semantics for retranscription.
   *
   * The `meetingId` must be the .NET UUID that was minted at recording
   * start (the same id that ConversationEvents were persisted under).
   * Returns the meeting id on success.
   */
  async saveMeeting(
    meetingTitle: string,
    transcripts: Transcript[],
    folderPath: string | null,
    meetingId?: string | null,
    speakers?: SpeakerSave[],
  ): Promise<SaveMeetingResponse> {
    if (!meetingId) {
      throw new Error('saveMeeting requires meetingId - every meeting must be created via createMeeting() first');
    }

    const segments = transcripts
      .filter((t) => !t.is_partial && t.text && t.text.trim().length > 0)
      .map((t, idx) => ({
        text: t.text,
        speaker: t.speaker ?? null,
        speakerId: t.speakerId ?? null,
        confidence: typeof t.confidence === 'number' ? t.confidence : 0,
        startOffset: typeof t.audio_start_time === 'number' ? t.audio_start_time : idx,
        endOffset: typeof t.audio_end_time === 'number' ? t.audio_end_time : idx,
        isFinal: true,
        sequence: typeof t.sequence_id === 'number' ? t.sequence_id : idx,
      }));

    const result = await authedApiCall<{ id: string; savedSegments: number }>(
      'POST',
      `/api/v1/meetings/${meetingId}/transcripts`,
      {
        title: meetingTitle,
        folderPath,
        markEnded: true,
        segments,
        speakers: speakers && speakers.length > 0 ? speakers : undefined,
      },
    );

    return { meeting_id: result.id };
  }

  /**
   * Get meeting details (metadata + counts) by ID.
   */
  async getMeeting(meetingId: string): Promise<Meeting> {
    return authedApiCall<Meeting>('GET', `/api/v1/meetings/${meetingId}`);
  }

  /**
   * List all meetings for the current user, newest first.
   */
  async getMeetings(): Promise<Meeting[]> {
    return authedApiCall<Meeting[]>('GET', '/api/v1/meetings');
  }
}

// Export singleton instance
export const storageService = new StorageService();