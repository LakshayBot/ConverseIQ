'use client';

// useMeetingSpeakers - meeting speaker management + the "Identify Speakers"
// background job for completed/historical meetings. Polls the job status
// while processing (the same pattern as local summarization) and exposes
// rename/merge actions against the backend speaker endpoints.

import { useCallback, useEffect, useRef, useState } from 'react';
import { authedApiCall } from '@/lib/auth';
import {
  cancelIdentifyMeeting,
  getMeetingSpeakerStatus,
  identifyMeetingSpeakers,
  listenDiarMeetingComplete,
  listenDiarMeetingError,
  listenDiarMeetingProgress,
  type DiarMeetingJobStatus,
} from '@/lib/diarization';

export interface MeetingSpeaker {
  id: string;
  displayName: string;
  sortOrder: number;
  segmentCount: number;
  totalSpeakingTime: number;
}

export type IdentifyState = 'idle' | 'processing' | 'completed' | 'failed';

export function formatSpeakingTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m <= 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

export function useMeetingSpeakers(meetingId: string | null) {
  const [speakers, setSpeakers] = useState<MeetingSpeaker[]>([]);
  const [identifyState, setIdentifyState] = useState<IdentifyState>('idle');
  const [identifyProgress, setIdentifyProgress] = useState(0);
  const [identifyError, setIdentifyError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshSpeakers = useCallback(async () => {
    if (!meetingId) return;
    try {
      const list = await authedApiCall<MeetingSpeaker[]>(
        'GET',
        `/api/v1/meetings/${meetingId}/speakers`,
      );
      setSpeakers(list ?? []);
    } catch (e) {
      console.warn('[speakers] failed to load:', e);
    }
  }, [meetingId]);

  // Load speakers + job state on mount.
  useEffect(() => {
    setSpeakers([]);
    setIdentifyState('idle');
    setIdentifyProgress(0);
    setIdentifyError(null);
    if (!meetingId) return;
    void refreshSpeakers();
    void getMeetingSpeakerStatus(meetingId).then((status) => {
      if (!status) return;
      if (status.state === 'processing') {
        setIdentifyState('processing');
        setIdentifyProgress(status.progress);
      } else if (status.state === 'failed') {
        setIdentifyState('failed');
        setIdentifyError(status.error ?? 'Speaker identification failed.');
      } else if (status.state === 'completed') {
        setIdentifyState('completed');
        void refreshSpeakers();
      }
    });
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [meetingId, refreshSpeakers]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const identify = useCallback(
    async (numSpeakers?: number | null) => {
      if (!meetingId) return;
      setIdentifyState('processing');
      setIdentifyProgress(0);
      setIdentifyError(null);

      // Live events from the Rust job.
      const unlisteners = await Promise.all([
        listenDiarMeetingProgress((status) => {
          if (status.meetingId !== meetingId) return;
          setIdentifyProgress(status.progress);
          if (status.state === 'failed') {
            setIdentifyState('failed');
            setIdentifyError(status.error ?? 'Speaker identification failed.');
            stopPolling();
          }
        }).catch(() => () => {}),
        listenDiarMeetingComplete(async (payload) => {
          if (payload.meetingId !== meetingId) return;
          setIdentifyState('completed');
          setIdentifyProgress(100);
          stopPolling();
          await refreshSpeakers();
        }).catch(() => () => {}),
        listenDiarMeetingError((id, error) => {
          if (id !== meetingId) return;
          setIdentifyState('failed');
          setIdentifyError(error);
          stopPolling();
        }).catch(() => () => {}),
      ]);

      // Poll as a safety net (events can race the initial invoke).
      pollRef.current = setInterval(async () => {
        try {
          const status = await getMeetingSpeakerStatus(meetingId);
          if (!status) return;
          setIdentifyProgress(status.progress);
          if (status.state === 'completed') {
            setIdentifyState('completed');
            stopPolling();
            await refreshSpeakers();
          } else if (status.state === 'failed') {
            setIdentifyState('failed');
            setIdentifyError(status.error ?? 'Speaker identification failed.');
            stopPolling();
          }
        } catch {
          // transient - keep polling
        }
      }, 1500);

      try {
        await identifyMeetingSpeakers(meetingId, numSpeakers ?? null, null);
      } catch (e) {
        setIdentifyState('failed');
        setIdentifyError(e instanceof Error ? e.message : String(e));
        stopPolling();
        unlisteners.forEach((fn) => fn());
        return;
      }
    },
    [meetingId, refreshSpeakers, stopPolling],
  );

  const cancel = useCallback(async () => {
    if (!meetingId) return;
    await cancelIdentifyMeeting(meetingId).catch(() => {});
    stopPolling();
    setIdentifyState('idle');
  }, [meetingId, stopPolling]);

  const renameSpeaker = useCallback(
    async (speakerId: string, displayName: string) => {
      if (!meetingId) return;
      const updated = await authedApiCall<{ id: string; displayName: string }>(
        'PATCH',
        `/api/v1/meetings/${meetingId}/speakers/${speakerId}`,
        { displayName },
      );
      setSpeakers((prev) =>
        prev.map((s) => (s.id === speakerId ? { ...s, displayName: updated.displayName } : s)),
      );
    },
    [meetingId],
  );

  const mergeSpeaker = useCallback(
    async (fromId: string, intoId: string) => {
      if (!meetingId || fromId === intoId) return;
      await authedApiCall(
        'POST',
        `/api/v1/meetings/${meetingId}/speakers/${fromId}/merge`,
        { targetSpeakerId: intoId },
      );
      await refreshSpeakers();
    },
    [meetingId, refreshSpeakers],
  );

  return {
    speakers,
    identifyState,
    identifyProgress,
    identifyError,
    identify,
    cancel,
    renameSpeaker,
    mergeSpeaker,
    refreshSpeakers,
  };
}
