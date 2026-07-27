'use client';

import React, { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode, MutableRefObject } from 'react';
import { Transcript, TranscriptUpdate } from '@/types';
import { toast } from 'sonner';
import { authedApiCall } from '@/lib/auth';
import { useRecordingState } from './RecordingStateContext';
import { transcriptService } from '@/services/transcriptService';
import { recordingService } from '@/services/recordingService';
import { indexedDBService } from '@/services/indexedDBService';

interface TranscriptContextType {
  transcripts: Transcript[];
  transcriptsRef: MutableRefObject<Transcript[]>
  addTranscript: (update: TranscriptUpdate) => void;
  copyTranscript: () => void;
  flushBuffer: () => void;
  transcriptContainerRef: React.RefObject<HTMLDivElement>;
  meetingTitle: string;
  setMeetingTitle: (title: string) => void;
  clearTranscripts: () => void;
  currentMeetingId: string | null;
  markMeetingAsSaved: () => Promise<void>;
}

const TranscriptContext = createContext<TranscriptContextType | undefined>(undefined);

export function TranscriptProvider({ children }: { children: ReactNode }) {
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [meetingTitle, setMeetingTitle] = useState('+ New Call');
  const [currentMeetingId, setCurrentMeetingId] = useState<string | null>(null);
  // Mirror of currentMeetingId so the engine-ingest fire-and-forget call
  // inside addTranscript sees the latest value without re-creating the
  // callback on every state change.
  const currentMeetingIdRef = useRef<string | null>(null);

  // Recording state context - provides backend-synced state
  const recordingState = useRecordingState();

  // Refs for transcript management
  const transcriptsRef = useRef<Transcript[]>(transcripts);
  const isUserAtBottomRef = useRef<boolean>(true);
  const transcriptContainerRef = useRef<HTMLDivElement>(null);
  const finalFlushRef = useRef<(() => void) | null>(null);

  // Keep ref updated with current transcripts
  useEffect(() => {
    transcriptsRef.current = transcripts;
  }, [transcripts]);

  // Smart auto-scroll: Track user scroll position
  useEffect(() => {
    const handleScroll = () => {
      const container = transcriptContainerRef.current;
      if (!container) return;

      const { scrollTop, scrollHeight, clientHeight } = container;
      const isAtBottom = scrollTop + clientHeight >= scrollHeight - 10; // 10px tolerance
      isUserAtBottomRef.current = isAtBottom;
    };

    const container = transcriptContainerRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll);
      return () => container.removeEventListener('scroll', handleScroll);
    }
  }, []);

  // Auto-scroll when transcripts change (only if user is at bottom)
  useEffect(() => {
    // Only auto-scroll if user was at the bottom before new content
    if (isUserAtBottomRef.current && transcriptContainerRef.current) {
      // Wait for Framer Motion animation to complete (150ms) before scrolling
      // This ensures scrollHeight includes the full rendered height of the new transcript
      const scrollTimeout = setTimeout(() => {
        const container = transcriptContainerRef.current;
        if (container) {
          container.scrollTo({
            top: container.scrollHeight,
            behavior: 'smooth'
          });
        }
      }, 150); // Match Framer Motion transition duration

      return () => clearTimeout(scrollTimeout);
    }
  }, [transcripts]);

  // Initialize IndexedDB and listen for recording-started/stopped events
  useEffect(() => {
    let unlistenRecordingStarted: (() => void) | undefined;
    let unlistenRecordingStopped: (() => void) | undefined;

    const setupRecordingListeners = async () => {
      try {
        // Initialize IndexedDB
        await indexedDBService.init();

        // Listen for recording-started event
        unlistenRecordingStarted = await recordingService.onRecordingStarted(async (event: any) => {
          console.log('[DIAG] recording-started event RECEIVED from Rust', event?.payload);
          try {
            // Prefer the server-issued meeting id (from the .NET Gateway
            // POST /api/v1/meetings, threaded through RecordingControls →
            // start_recording_with_devices_and_meeting). Falling back to a
            // local timestamp breaks the intelligence WebSocket fan-out
            // because the engine ingest posts under session_id and the
            // panel subscribes under the .NET UUID — they have to match.
            const meetingId =
              event?.payload?.meeting_id ||
              `meeting-${Date.now()}`;
            setCurrentMeetingId(meetingId);
            currentMeetingIdRef.current = meetingId;

            // Store in sessionStorage as fallback for markMeetingAsSaved
            sessionStorage.setItem('indexeddb_current_meeting_id', meetingId);
            console.log('[Recording Started] 💾 IndexedDB meeting ID stored:', meetingId);

            // Get meeting name
            const meetingName =
              event?.payload?.meeting_name ||
              (await recordingService.getRecordingMeetingName());

            // Use a better fallback that matches the backend's naming pattern
            const effectiveTitle = meetingName || `Meeting ${new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-')}`;

            // Initialize meeting metadata in IndexedDB
            await indexedDBService.saveMeetingMetadata({
              meetingId,
              title: effectiveTitle,
              startTime: Date.now(),
              lastUpdated: Date.now(),
              transcriptCount: 0,
              savedToSQLite: false,
              folderPath: undefined // Will update shortly
            });

            // Synchronize meeting title to state (fixes tray stop title issue)
            setMeetingTitle(effectiveTitle);

            // Fetch folder path from backend and update metadata
            // This ensures folder path is persisted even if app crashes
            try {
              const { invoke } = await import('@tauri-apps/api/core');
              const folderPath = await invoke<string>('get_meeting_folder_path');
              if (folderPath) {
                const metadata = await indexedDBService.getMeetingMetadata(meetingId);
                if (metadata) {
                  metadata.folderPath = folderPath;
                  await indexedDBService.saveMeetingMetadata(metadata);
                }
              }
            } catch (error) {
              // Non-fatal - will be set on stop if recording completes normally
            }
          } catch (error) {
            console.error('Failed to initialize meeting in IndexedDB:', error);
          }
        });

        // Listen for recording-stopped event
        unlistenRecordingStopped = await recordingService.onRecordingStopped(async (payload) => {
          try {
            if (currentMeetingId) {
              // Update folder path in IndexedDB
              const metadata = await indexedDBService.getMeetingMetadata(currentMeetingId);

              if (metadata && payload.folder_path) {
                metadata.folderPath = payload.folder_path;
                await indexedDBService.saveMeetingMetadata(metadata);
              }
            }
          } catch (error) {
            console.error('Failed to update meeting metadata on stop:', error);
          }
        });
      } catch (error) {
        console.error('Failed to setup recording listeners:', error);
      }
    };

    setupRecordingListeners();

    return () => {
      if (unlistenRecordingStarted) {
        unlistenRecordingStarted();
        console.log('🧹 Recording started listener cleaned up');
      }
      if (unlistenRecordingStopped) {
        unlistenRecordingStopped();
        console.log('🧹 Recording stopped listener cleaned up');
      }
    };
  }, [currentMeetingId]);

  // Main transcript buffering logic with sequence_id ordering
  useEffect(() => {
    let unlistenFn: (() => void) | undefined;
    let transcriptCounter = 0;
    let transcriptBuffer = new Map<number, Transcript>();
    let lastProcessedSequence = 0;
    let processingMicrotask: Promise<void> | null = null;

    /**
     * Bubble the tail of `arr` into the correct chronological position.
     * Cheaper than a full sort because the Rust worker emits monotonically
     * increasing sequence_ids — new transcripts only ever need to bubble
     * up by a few slots when they arrive out of order (rare, only when
     * the VAD snapshot race fires).
     *
     * Compares (chunk_start_time, sequence_id) tuple — primary key is
     * chunk_start_time, with sequence_id as a stable tiebreaker.
     */
    const bubbleSort = (arr: Transcript[]) => {
      const n = arr.length;
      if (n < 2) return;
      const cmp = (a: Transcript, b: Transcript) => {
        const dt = (a.chunk_start_time || 0) - (b.chunk_start_time || 0);
        if (dt !== 0) return dt;
        return (a.sequence_id || 0) - (b.sequence_id || 0);
      };
      // Tail-bubble: walk back from the end, swapping until in-order.
      // Typical work = O(swap distance) per emission, ~O(1) for serial
      // workers emitting in order.
      for (let i = n - 1; i > 0; i--) {
        if (cmp(arr[i - 1], arr[i]) > 0) {
          const tmp = arr[i - 1];
          arr[i - 1] = arr[i];
          arr[i] = tmp;
        } else {
          break;
        }
      }
    };

    // Drain the buffer. The drain is now triggered as a microtask (via
    // `queueMicrotask`) so updates from a single Tauri event tick coalesce
    // into one React state update without the previous 10ms setTimeout
    // stutter. With the old typewriter removed, every microtask-drained
    // update paints immediately, so latency from Tauri-event-arrival to
    // pixels-on-screen drops from ~10ms to ~0ms on top of the engine-side
    // 500ms speedup.
    const processBufferedTranscripts = (forceFlush = false) => {
      const sortedTranscripts: Transcript[] = [];

      // Process all available sequential transcripts.
      // The Rust STT worker emits monotonically increasing sequence_ids,
      // so the hot path is a straight append — typical O(N) for the
      // append + O(N log N) one-time sort. The old code re-sorted the
      // entire transcript array on every partial; with 300ms cadence that
      // dominated per-frame work once the meeting grew past ~50 segments.
      let nextSequence = lastProcessedSequence + 1;
      while (transcriptBuffer.has(nextSequence)) {
        const bufferedTranscript = transcriptBuffer.get(nextSequence)!;
        sortedTranscripts.push(bufferedTranscript);
        transcriptBuffer.delete(nextSequence);
        lastProcessedSequence = nextSequence;
        nextSequence++;
      }

      // Add any buffered transcripts that might be out of order
      const now = Date.now();
      const staleThreshold = 100;  // 100ms safety net only (serial workers = sequential order)
      const recentThreshold = 0;    // Show immediately - no delay needed with serial processing
      const staleTranscripts: Transcript[] = [];
      const recentTranscripts: Transcript[] = [];
      const forceFlushTranscripts: Transcript[] = [];

      for (const [sequenceId, transcript] of transcriptBuffer.entries()) {
        if (forceFlush) {
          // Force flush mode: process ALL remaining transcripts regardless of timing
          forceFlushTranscripts.push(transcript);
          transcriptBuffer.delete(sequenceId);
          console.log(`Force flush: processing transcript with sequence_id ${sequenceId}`);
        } else {
          const transcriptAge = now - parseInt(transcript.id.split('-')[0]);
          if (transcriptAge > staleThreshold) {
            // Process stale transcripts (>100ms old - safety net)
            staleTranscripts.push(transcript);
            transcriptBuffer.delete(sequenceId);
          } else if (transcriptAge >= recentThreshold) {
            // Process immediately (0ms threshold with serial workers)
            recentTranscripts.push(transcript);
            transcriptBuffer.delete(sequenceId);
            console.log(`Processing transcript with sequence_id ${sequenceId}, age: ${transcriptAge}ms`);
          }
        }
      }

      // Sort both stale and recent transcripts by chunk_start_time, then by sequence_id
      const sortTranscripts = (transcripts: Transcript[]) => {
        return transcripts.sort((a, b) => {
          const chunkTimeDiff = (a.chunk_start_time || 0) - (b.chunk_start_time || 0);
          if (chunkTimeDiff !== 0) return chunkTimeDiff;
          return (a.sequence_id || 0) - (b.sequence_id || 0);
        });
      };

      const sortedStaleTranscripts = sortTranscripts(staleTranscripts);
      const sortedRecentTranscripts = sortTranscripts(recentTranscripts);
      const sortedForceFlushTranscripts = sortTranscripts(forceFlushTranscripts);

      const allNewTranscripts = [...sortedTranscripts, ...sortedRecentTranscripts, ...sortedStaleTranscripts, ...sortedForceFlushTranscripts];

      if (allNewTranscripts.length > 0) {
        setTranscripts(prev => {
          // Create a set of existing sequence_ids for deduplication
          const existingSequenceIds = new Set(prev.map(t => t.sequence_id).filter(id => id !== undefined));

          // LIVE STREAMING: when an interim "partial" update arrives, replace the most
          // recent partial in place so the UI shows incremental text in one row
          // instead of stacking duplicate-looking rows every 300ms.
          let basePrev = prev;
          const partials = allNewTranscripts.filter(t => t.is_partial);
          const finals = allNewTranscripts.filter(t => !t.is_partial);
          if (partials.length > 0) {
            const lastPartial = [...basePrev].reverse().find(t => t.is_partial);
            if (lastPartial) {
              basePrev = basePrev.filter(t => t !== lastPartial);
            }
          }
          // If a final came in, also drop any in-progress partial that overlaps it
          // (the partial belongs to the same speech turn that just finalized).
          if (finals.length > 0) {
            const finalStart = Math.min(...finals.map(t => t.chunk_start_time ?? 0));
            basePrev = basePrev.filter(t => {
              if (!t.is_partial) return true;
              const tEnd = (t.audio_end_time ?? t.chunk_start_time ?? 0);
              return tEnd <= finalStart - 0.5; // 500ms tolerance
            });
          }

          // Filter out any new transcripts that already exist
          const uniqueNewTranscripts = allNewTranscripts.filter(transcript =>
            transcript.sequence_id !== undefined && !existingSequenceIds.has(transcript.sequence_id)
          );

          // Incremental merge: append the new transcripts at the tail and
          // only sort relative to the small window around the insertion
          // point. Previously this was a full O(N log N) sort on every
          // emission. With sequence_ids monotonic from the Rust worker,
          // a single tail-append + bubble-up by chunk_start_time keeps the
          // total work per emission bounded by the number of *out-of-order*
          // segments (essentially zero under serial workers).
          if (uniqueNewTranscripts.length === 0) {
            if (basePrev !== prev) {
              // still need to apply the partial-replace
              bubbleSort(basePrev);
              return basePrev;
            }
            return prev;
          }

          console.log(`Adding ${uniqueNewTranscripts.length} unique transcripts out of ${allNewTranscripts.length} received`);

          const combined = [...basePrev, ...uniqueNewTranscripts];
          bubbleSort(combined);
          return combined;
        });

        // Log the processing summary
        const logMessage = forceFlush
          ? `Force flush processed ${allNewTranscripts.length} transcripts (${sortedTranscripts.length} sequential, ${forceFlushTranscripts.length} forced)`
          : `Processed ${allNewTranscripts.length} transcripts (${sortedTranscripts.length} sequential, ${recentTranscripts.length} recent, ${staleTranscripts.length} stale)`;
        console.log(logMessage);
      }
    };

    // Assign final flush function to ref for external access
    finalFlushRef.current = () => processBufferedTranscripts(true);

    const setupListener = async () => {
      try {
        console.log('🔥 Setting up MAIN transcript listener during component initialization...');
        unlistenFn = await transcriptService.onTranscriptUpdate((update) => {
          const now = Date.now();
          console.log('🎯 MAIN LISTENER: Received transcript update:', {
            sequence_id: update.sequence_id,
            text: update.text.substring(0, 50) + '...',
            timestamp: update.timestamp,
            is_partial: update.is_partial,
            received_at: new Date(now).toISOString(),
            buffer_size_before: transcriptBuffer.size
          });

          // Check for duplicate sequence_id before processing
          if (transcriptBuffer.has(update.sequence_id)) {
            console.log('🚫 MAIN LISTENER: Duplicate sequence_id, skipping buffer:', update.sequence_id);
            return;
          }

          // Create transcript for buffer with NEW timestamp fields
          const newTranscript: Transcript = {
            id: `${Date.now()}-${transcriptCounter++}`,
            text: update.text,
            timestamp: update.timestamp,
            sequence_id: update.sequence_id,
            chunk_start_time: update.chunk_start_time,
            is_partial: update.is_partial,
            confidence: update.confidence,
            // NEW: Recording-relative timestamps for playback sync
            audio_start_time: update.audio_start_time,
            audio_end_time: update.audio_end_time,
            duration: update.duration,
          };

          // Add to buffer
          transcriptBuffer.set(update.sequence_id, newTranscript);
          console.log(`✅ MAIN LISTENER: Buffered transcript with sequence_id ${update.sequence_id}. Buffer size: ${transcriptBuffer.size}, Last processed: ${lastProcessedSequence}`);

          // Save to IndexedDB (non-blocking)
          if (currentMeetingId) {
            indexedDBService.saveTranscript(currentMeetingId, update)
              .catch((err: unknown) => console.warn('IndexedDB save failed:', err));
          }

          // Clear any existing timer and set a new one
          // Coalesce multiple Tauri events that arrive in the same tick into
          // a single React state update. queueMicrotask runs *after* the
          // current synchronous emit loop drains (so a Rust burst of 4 partials
          // collapses to one render) but *before* the next paint, so the user
          // sees text as soon as the browser is ready to paint — no visible
          // 10ms setTimeout stutter.
          if (!processingMicrotask) {
            processingMicrotask = Promise.resolve().then(() => {
              processingMicrotask = null;
              processBufferedTranscripts();
            });
          }

          // ALSO fan the update out to the .NET Gateway so the same tested
          // event-detection + SignalR broadcast pipeline the .NET CLI agent
          // uses runs for desktop transcripts. addTranscript is idempotent
          // on setTranscripts (text+timestamp dedup) and gates the actual
          // /process POST behind `!update.is_partial && currentMeetingId`,
          // so:
          //   • partials: only the dedup-aware setTranscripts runs (no-op
          //     against the buffered copy once processBufferedTranscripts
          //     fires 10ms later) — no /process POST.
          //   • finals: setTranscripts is again a no-op against the
          //     buffered copy, AND POST /api/v1/meetings/{id}/process fires
          //     so EventDetectionService → engine → SignalR broadcast runs.
          // If currentMeetingIdRef.current is null (recording-started
          // landed late), addTranscript logs and skips — the next final
          // will succeed.
          addTranscript(update);
        });
        console.log('✅ MAIN transcript listener setup complete');
      } catch (error) {
        console.error('❌ Failed to setup MAIN transcript listener:', error);
        alert('Failed to setup transcript listener. Check console for details.');
      }
    };

    setupListener();
    console.log('Started enhanced listener setup');

    return () => {
      console.log('🧹 CLEANUP: Cleaning up MAIN transcript listener...');
      // processingMicrotask is a one-shot promise — nothing to clear
      // (if it hasn't fired yet it will resolve to a no-op state since
      // setTranscripts on a stale closure is harmless).
      if (unlistenFn) {
        // Wrap unlisten in try/catch — Tauri 2's webview runtime throws
        // "TypeError: undefined is not an object (evaluating
        // 'listeners[eventId].handlerId')" when an unregister call hits
        // a stale eventId (typical when the page reloads or the listener
        // registration races with the cleanup). The error is harmless —
        // the listener will eventually be GC'd — but it surfaces as an
        // unhandled runtime error and breaks the React render. Swallow
        // it here so the UI keeps working.
        try {
          unlistenFn();
          console.log('🧹 CLEANUP: MAIN transcript listener cleaned up');
        } catch (e) {
          console.warn('🧹 CLEANUP: unlisten threw (stale eventId, harmless):', e);
        }
      }
    };
  }, [currentMeetingId]); // Add currentMeetingId dependency

  // Sync transcript history and meeting name from backend on reload
  // This fixes the issue where reloading during active recording causes state desync
  useEffect(() => {
    const syncFromBackend = async () => {
      // If recording is active and we have no local transcripts, sync from backend
      if (recordingState.isRecording && transcripts.length === 0) {
        try {
          console.log('[Reload Sync] Recording active after reload, syncing transcript history...');

          // Fetch transcript history from backend
          const history = await transcriptService.getTranscriptHistory();
          console.log(`[Reload Sync] Retrieved ${history.length} transcript segments from backend`);

          // Convert backend format to frontend Transcript format
          const formattedTranscripts: Transcript[] = history.map((segment: any) => ({
            id: segment.id,
            text: segment.text,
            timestamp: segment.display_time, // Use display_time for UI
            sequence_id: segment.sequence_id,
            chunk_start_time: segment.audio_start_time,
            is_partial: false, // History segments are always final
            confidence: segment.confidence,
            audio_start_time: segment.audio_start_time,
            audio_end_time: segment.audio_end_time,
            duration: segment.duration,
          }));

          setTranscripts(formattedTranscripts);
          console.log('[Reload Sync] ✅ Transcript history synced successfully');

          // Fetch meeting name from backend
          const meetingName = await recordingService.getRecordingMeetingName();
          if (meetingName) {
            console.log('[Reload Sync] Retrieved meeting name:', meetingName);
            setMeetingTitle(meetingName);
            console.log('[Reload Sync] ✅ Meeting title synced successfully');
          }
        } catch (error) {
          console.error('[Reload Sync] Failed to sync from backend:', error);
        }
      }
    };

    syncFromBackend();
  }, [recordingState.isRecording]); // Run when recording state changes

  // Manual transcript update handler (for RecordingControls component)
  const addTranscript = useCallback((update: TranscriptUpdate) => {
    console.log('🎯 addTranscript called with:', {
      sequence_id: update.sequence_id,
      text: update.text.substring(0, 50) + '...',
      timestamp: update.timestamp,
      is_partial: update.is_partial
    });

    const newTranscript: Transcript = {
      id: update.sequence_id ? update.sequence_id.toString() : Date.now().toString(),
      text: update.text,
      timestamp: update.timestamp,
      sequence_id: update.sequence_id || 0,
      chunk_start_time: update.chunk_start_time,
      is_partial: update.is_partial,
      confidence: update.confidence,
      audio_start_time: update.audio_start_time,
      audio_end_time: update.audio_end_time,
      duration: update.duration,
    };

    setTranscripts(prev => {
      console.log('📊 Current transcripts count before update:', prev.length);

      // Check if this transcript already exists
      const exists = prev.some(
        t => t.text === update.text && t.timestamp === update.timestamp
      );
      if (exists) {
        console.log('🚫 Duplicate transcript detected, skipping:', update.text.substring(0, 30) + '...');
        return prev;
      }

      // Add new transcript and sort by sequence_id to maintain order
      const updated = [...prev, newTranscript];
      const sorted = updated.sort((a, b) => (a.sequence_id || 0) - (b.sequence_id || 0));

      console.log('✅ Added new transcript. New count:', sorted.length);
      console.log('📝 Latest transcript:', {
        id: newTranscript.id,
        text: newTranscript.text.substring(0, 30) + '...',
        sequence_id: newTranscript.sequence_id
      });

      return sorted;
    });

    // Fan final transcripts out to the .NET Gateway via the same tested
    // pipeline the .NET CLI agent's audio path uses: EventDetectionService
    // runs detect_all() against the user's trie, persists the
    // ConversationEvent, then broadcasts EventDetected + RecommendationGenerated
    // to /hubs/desktop-agent subscribers. The desktop's @microsoft/signalr
    // consumer (useIntelligenceStream) receives them. Best-effort: log on
    // failure but never block the UI.
    if (!update.is_partial && update.text && update.text.trim().length > 0) {
      const meetingId = currentMeetingIdRef.current;
      if (meetingId) {
        console.log('[DIAG] pushing final transcript to /process:', { meetingId, len: update.text.length });
        authedApiCall('POST', `/api/v1/meetings/${meetingId}/process`, { text: update.text })
          .then((resp) => {
            const events = (resp as any)?.events?.length ?? 0;
            const recs = (resp as any)?.recommendations?.length ?? 0;
            if (events || recs) {
              console.log('[DIAG] /process resolved', { events, recs });
            }
          })
          .catch((err) => {
            console.warn('[DIAG] /process failed (non-fatal):', err);
          });
      } else {
        console.log('[DIAG] final transcript arrived but currentMeetingId is null — skipping /process');
      }
    }
  }, []);

  // Copy transcript to clipboard with recording-relative timestamps
  const copyTranscript = useCallback(() => {
    // Format timestamps as recording-relative [MM:SS] instead of wall-clock time
    const formatTime = (seconds: number | undefined): string => {
      if (seconds === undefined) return '[--:--]';
      const totalSecs = Math.floor(seconds);
      const mins = Math.floor(totalSecs / 60);
      const secs = totalSecs % 60;
      return `[${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;
    };

    const fullTranscript = transcripts
      .map(t => `${formatTime(t.audio_start_time)} ${t.text}`)
      .join('\n');
    navigator.clipboard.writeText(fullTranscript);

    toast.success("Transcript copied to clipboard");
  }, [transcripts]);

  // Force flush buffer (for final transcript processing)
  const flushBuffer = useCallback(() => {
    if (finalFlushRef.current) {
      console.log('🔄 Flushing transcript buffer...');
      finalFlushRef.current();
    }
  }, []);

  // Clear transcripts (used when starting new recording)
  const clearTranscripts = useCallback(() => {
    setTranscripts([]);
    // Don't clear currentMeetingId here - it will be set by recording-started event
  }, []);

  // Mark current meeting as saved in IndexedDB
  const markMeetingAsSaved = useCallback(async () => {
    // Try context state first, fallback to sessionStorage
    const meetingId = currentMeetingId || sessionStorage.getItem('indexeddb_current_meeting_id');

    if (!meetingId) {
      console.error('[IndexedDB] ❌ Cannot mark meeting as saved: No meeting ID available!');
      console.error('[IndexedDB] currentMeetingId:', currentMeetingId);
      console.error('[IndexedDB] sessionStorage:', sessionStorage.getItem('indexeddb_current_meeting_id'));
      return;
    }

    try {
      await indexedDBService.markMeetingSaved(meetingId);

      // Clear both sources
      setCurrentMeetingId(null);
      sessionStorage.removeItem('indexeddb_current_meeting_id');
    } catch (error) {
      console.error('[IndexedDB] ❌ Failed to mark meeting as saved:', error);
    }
  }, [currentMeetingId]);

  const value: TranscriptContextType = {
    transcripts,
    transcriptsRef,
    addTranscript,
    copyTranscript,
    flushBuffer,
    transcriptContainerRef,
    meetingTitle,
    setMeetingTitle,
    clearTranscripts,
    currentMeetingId,
    markMeetingAsSaved,
  };

  return (
    <TranscriptContext.Provider value={value}>
      {children}
    </TranscriptContext.Provider>
  );
}

export function useTranscripts() {
  const context = useContext(TranscriptContext);
  if (context === undefined) {
    throw new Error('useTranscripts must be used within a TranscriptProvider');
  }
  return context;
}
