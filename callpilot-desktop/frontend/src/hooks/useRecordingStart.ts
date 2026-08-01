import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { useConfig } from '@/contexts/ConfigContext';
import { useRecordingState, RecordingStatus } from '@/contexts/RecordingStateContext';
import { recordingService } from '@/services/recordingService';
import { createMeeting } from '@/lib/callpilotApi';
import Analytics from '@/lib/analytics';
import { showRecordingNotification } from '@/lib/recordingNotification';
import { toast } from 'sonner';

interface UseRecordingStartReturn {
  handleRecordingStart: () => Promise<void>;
  isAutoStarting: boolean;
  /**
   * Server-issued meeting ID for the active recording session. `null` when
   * not recording. Mints synchronously inside the start handler - guaranteed
   * to be set before `useIntelligenceStream` opens its WebSocket, so cards
   * stream from the first second of the recording.
   */
  sessionId: string | null;
}

/**
 * Custom hook for managing recording start lifecycle.
 * Handles both manual start (button click) and auto-start (from sidebar navigation).
 *
 * Features:
 * - Meeting title generation (format: Meeting DD_MM_YY_HH_MM_SS)
 * - Transcript clearing on start
 * - Analytics tracking
 * - Recording notification display
 * - Auto-start from sidebar via sessionStorage flag
 */
export function useRecordingStart(
  isRecording: boolean,
  setIsRecording: (value: boolean) => void,
  showModal?: (name: 'modelSelector', message?: string) => void
): UseRecordingStartReturn {
  const [isAutoStarting, setIsAutoStarting] = useState(false);
  // Server-issued meeting ID for the active session. `null` until the user
  // starts recording. Stable across pause/resume/stop so the intelligence
  // WebSocket and post-recording transcript writer share the same key.
  const [sessionId, setSessionId] = useState<string | null>(null);

  const { clearTranscripts, setMeetingTitle } = useTranscripts();
  const { setIsMeetingActive } = useSidebar();
  const { selectedDevices } = useConfig();
  const { setStatus } = useRecordingState();

  // Generate meeting title with timestamp
  const generateMeetingTitle = useCallback(() => {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = String(now.getFullYear()).slice(-2);
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `Meeting ${day}_${month}_${year}_${hours}_${minutes}_${seconds}`;
  }, []);

  // Check if Parakeet transcription model is ready
  const checkParakeetReady = useCallback(async (): Promise<boolean> => {
    try {
      await invoke('parakeet_init');
      const hasModels = await invoke<boolean>('parakeet_has_available_models');
      return hasModels;
    } catch (error) {
      console.error('Failed to check Parakeet status:', error);
      return false;
    }
  }, []);

  /**
   * Resolve the actual device names to use for recording. If the caller hasn't
   * picked anything yet (e.g. fresh out of onboarding), fall back to the OS
   * defaults via the Rust backend. Without this, the start call passes `null`
   * for both devices and the audio pipeline has nothing to capture from -
   * which is why the mic button "does nothing" after onboarding.
   */
  const resolveDevices = useCallback(async (): Promise<{ micDevice: string | null; systemDevice: string | null }> => {
    let micDevice = selectedDevices?.micDevice ?? null;
    let systemDevice = selectedDevices?.systemDevice ?? null;

    if (micDevice || systemDevice) {
      return { micDevice, systemDevice };
    }

    // Nothing selected yet - pick OS defaults from the audio device list.
    try {
      const devices = await invoke<Array<{ name: string; device_type: string }>>('get_audio_devices');
      console.log('[useRecordingStart] no devices selected, auto-resolving defaults from', devices.length, 'devices');

      for (const d of devices) {
        if (!micDevice && d.device_type === 'Input') micDevice = d.name;
        if (!systemDevice && d.device_type === 'Output') systemDevice = d.name;
      }

      console.log('[useRecordingStart] auto-resolved →', { micDevice, systemDevice });
    } catch (e) {
      console.warn('[useRecordingStart] failed to auto-resolve devices:', e);
    }

    return { micDevice, systemDevice };
  }, [selectedDevices]);

  // Check if any model is currently downloading
  const checkIfModelDownloading = useCallback(async (): Promise<boolean> => {
    try {
      const models = await invoke<any[]>('parakeet_get_available_models');
      const isDownloading = models.some(m =>
        m.status && (
          typeof m.status === 'object'
            ? 'Downloading' in m.status
            : m.status === 'Downloading'
        )
      );
      return isDownloading;
    } catch (error) {
      console.error('Failed to check model download status:', error);
      return false; // Default to not downloading (will show error + modal)
    }
  }, []);

  /**
   * Synchronously mint a meeting against the .NET Gateway so the recording
   * has a stable ID before any audio is captured or the intelligence WS opens.
   * Falls back to a local UUID if the server is unreachable - the WS still
   * has a stable key for the session and the transcript writer can re-link
   * later when the user has connectivity.
   */
  const mintMeetingId = useCallback(async (title: string): Promise<string> => {
    console.log('[DIAG] mintMeetingId CALLED title=', title);
    try {
      const meeting = await createMeeting(title);
      console.log('[DIAG] mintMeetingId createMeeting RESOLVED →', meeting.id);
      setSessionId(meeting.id);
      console.log('[DIAG] mintMeetingId setSessionId fired for', meeting.id);
      console.log('[useRecordingStart] minted meeting', meeting.id, 'for', title);
      return meeting.id;
    } catch (e) {
      console.error('[DIAG] mintMeetingId createMeeting THREW:', e);
      const fallback = crypto.randomUUID();
      setSessionId(fallback);
      console.warn(
        '[useRecordingStart] createMeeting failed, using local UUID',
        fallback,
        e,
      );
      return fallback;
    }
  }, []);

  // Handle manual recording start (from button click)
  const handleRecordingStart = useCallback(async () => {
    console.log('[DIAG] useRecordingStart.handleRecordingStart entered');
    try {
      console.log('handleRecordingStart called - checking Parakeet model status');

      // Check if Parakeet transcription model is ready before starting
      console.log('[DIAG] step=checkParakeetReady');
      const parakeetReady = await checkParakeetReady();
      console.log('[DIAG] checkParakeetReady →', parakeetReady);
      if (!parakeetReady) {
        console.log('[DIAG] model NOT ready - checking if download in progress');
        const isDownloading = await checkIfModelDownloading();
        console.log('[DIAG] checkIfModelDownloading →', isDownloading);
        if (isDownloading) {
          toast.info('Model download in progress', {
            description: 'Please wait for the transcription model to finish downloading before recording.',
            duration: 5000,
          });
          Analytics.trackButtonClick('start_recording_blocked_downloading', 'home_page');
        } else {
          toast.error('Transcription model not ready', {
            description: 'Please download a transcription model before recording.',
            duration: 5000,
          });
          showModal?.('modelSelector', 'Transcription model setup required');
          Analytics.trackButtonClick('start_recording_blocked_missing', 'home_page');
        }
        setStatus(RecordingStatus.IDLE);
        console.log('[DIAG] bailing - model not ready, no recording started');
        return;
      }

      console.log('Parakeet ready - setting up meeting title and state');

      const randomTitle = generateMeetingTitle();
      setMeetingTitle(randomTitle);

      // Set STARTING status before initiating backend recording
      setStatus(RecordingStatus.STARTING, 'Initializing recording...');

      // Mint a meeting against the .NET Gateway FIRST so the intelligence WS
      // opens against a real session from frame 1.
      console.log('[DIAG] step=mintMeetingId title=', randomTitle);
      const meetingId = await mintMeetingId(randomTitle);
      console.log('[DIAG] mintMeetingId resolved →', meetingId);

      // Resolve devices (auto-pick defaults if user hasn't selected any yet)
      console.log('[DIAG] step=resolveDevices selectedDevices=', selectedDevices);
      const { micDevice, systemDevice } = await resolveDevices();
      console.log('[DIAG] resolved → mic =', micDevice, ', system =', systemDevice);

      // Start the actual backend recording
      console.log('[DIAG] step=recordingService.startRecordingWithDevices');
      console.log('Starting backend recording with meeting:', randomTitle, 'id:', meetingId);
      await recordingService.startRecordingWithDevices(
        micDevice,
        systemDevice,
        randomTitle,
        meetingId
      );
      console.log('[DIAG] recordingService.startRecordingWithDevices RESOLVED OK');

      // Update state after successful backend start
      // Note: RECORDING status will be set by RecordingStateContext event listener
      console.log('Setting isRecordingState to true');
      setIsRecording(true); // This will also update the sidebar via the useEffect
      clearTranscripts(); // Clear previous transcripts when starting new recording
      setIsMeetingActive(true);
      Analytics.trackButtonClick('start_recording', 'home_page');

      // Show recording notification if enabled
      console.log('[DIAG] step=showRecordingNotification');
      await showRecordingNotification();
      console.log('[DIAG] handleRecordingStart COMPLETE');
    } catch (error) {
      console.error('[DIAG] handleRecordingStart CAUGHT error:', error);
      console.error('[DIAG] error name =', (error as any)?.name, 'message =', (error as any)?.message, 'stringified =', String(error));
      setStatus(RecordingStatus.ERROR, error instanceof Error ? error.message : 'Failed to start recording');
      setIsRecording(false); // Reset state on error
      Analytics.trackButtonClick('start_recording_error', 'home_page');
      // Re-throw so RecordingControls can handle device-specific errors
      throw error;
    }
  }, [generateMeetingTitle, setMeetingTitle, setIsRecording, clearTranscripts, setIsMeetingActive, checkParakeetReady, checkIfModelDownloading, selectedDevices, showModal, setStatus, resolveDevices, mintMeetingId]);

  // Check for autoStartRecording flag and start recording automatically
  useEffect(() => {
    const checkAutoStartRecording = async () => {
      if (typeof window !== 'undefined') {
        const shouldAutoStart = sessionStorage.getItem('autoStartRecording');
        if (shouldAutoStart === 'true' && !isRecording && !isAutoStarting) {
          console.log('Auto-starting recording from navigation...');
          setIsAutoStarting(true);
          sessionStorage.removeItem('autoStartRecording'); // Clear the flag

          // Check if Parakeet transcription model is ready before starting
          const parakeetReady = await checkParakeetReady();
          if (!parakeetReady) {
            const isDownloading = await checkIfModelDownloading();
            if (isDownloading) {
              toast.info('Model download in progress', {
                description: 'Please wait for the transcription model to finish downloading before recording.',
                duration: 5000,
              });
              Analytics.trackButtonClick('start_recording_blocked_downloading', 'sidebar_auto');
            } else {
              toast.error('Transcription model not ready', {
                description: 'Please download a transcription model before recording.',
                duration: 5000,
              });
              showModal?.('modelSelector', 'Transcription model setup required');
              Analytics.trackButtonClick('start_recording_blocked_missing', 'sidebar_auto');
            }
            setStatus(RecordingStatus.IDLE);
            setIsAutoStarting(false);
            return;
          }

          // Start the actual backend recording
          try {
            // Generate meeting title
            const generatedMeetingTitle = generateMeetingTitle();

            // Set STARTING status before initiating backend recording
            setStatus(RecordingStatus.STARTING, 'Initializing recording...');

            console.log('Auto-starting backend recording with meeting:', generatedMeetingTitle);
            // Mint a meeting against the .NET Gateway before the WS opens.
            const autoMeetingId = await mintMeetingId(generatedMeetingTitle);
            const { micDevice: autoMic, systemDevice: autoSys } = await resolveDevices();
            const result = await recordingService.startRecordingWithDevices(
              autoMic,
              autoSys,
              generatedMeetingTitle,
              autoMeetingId
            );
            console.log('Auto-start backend recording result:', result);

            // Update UI state after successful backend start
            // Note: RECORDING status will be set by RecordingStateContext event listener
            setMeetingTitle(generatedMeetingTitle);
            setIsRecording(true);
            clearTranscripts();
            setIsMeetingActive(true);
            Analytics.trackButtonClick('start_recording', 'sidebar_auto');

            // Show recording notification if enabled
            await showRecordingNotification();
          } catch (error) {
            console.error('Failed to auto-start recording:', error);
            setStatus(RecordingStatus.ERROR, error instanceof Error ? error.message : 'Failed to auto-start recording');
            alert('Failed to start recording. Check console for details.');
            Analytics.trackButtonClick('start_recording_error', 'sidebar_auto');
          } finally {
            setIsAutoStarting(false);
          }
        }
      }
    };

    checkAutoStartRecording();
  }, [
    isRecording,
    isAutoStarting,
    selectedDevices,
    generateMeetingTitle,
    setMeetingTitle,
    setIsRecording,
    clearTranscripts,
    setIsMeetingActive,
    checkParakeetReady,
    checkIfModelDownloading,
    showModal,
    setStatus,
    resolveDevices,
    mintMeetingId,
  ]);

  // Listen for direct recording trigger from sidebar when already on home page
  useEffect(() => {
    const handleDirectStart = async () => {
      if (isRecording || isAutoStarting) {
        console.log('Recording already in progress, ignoring direct start event');
        return;
      }

      console.log('Direct start from sidebar - checking Parakeet model status');
      setIsAutoStarting(true);

      // Check if Parakeet transcription model is ready before starting
      const parakeetReady = await checkParakeetReady();
      if (!parakeetReady) {
        const isDownloading = await checkIfModelDownloading();
        if (isDownloading) {
          toast.info('Model download in progress', {
            description: 'Please wait for the transcription model to finish downloading before recording.',
            duration: 5000,
          });
          Analytics.trackButtonClick('start_recording_blocked_downloading', 'sidebar_direct');
        } else {
          toast.error('Transcription model not ready', {
            description: 'Please download a transcription model before recording.',
            duration: 5000,
          });
          showModal?.('modelSelector', 'Transcription model setup required');
          Analytics.trackButtonClick('start_recording_blocked_missing', 'sidebar_direct');
        }
        setStatus(RecordingStatus.IDLE);
        setIsAutoStarting(false);
        return;
      }

      try {
        // Generate meeting title
        const generatedMeetingTitle = generateMeetingTitle();

        // Set STARTING status before initiating backend recording
        setStatus(RecordingStatus.STARTING, 'Initializing recording...');

        console.log('Starting backend recording with meeting:', generatedMeetingTitle);
        // Mint a meeting against the .NET Gateway before the WS opens.
        const dMeetingId = await mintMeetingId(generatedMeetingTitle);
        const { micDevice: dMic, systemDevice: dSys } = await resolveDevices();
        const result = await recordingService.startRecordingWithDevices(
          dMic,
          dSys,
          generatedMeetingTitle,
          dMeetingId
        );
        console.log('Backend recording result:', result);

        // Update UI state after successful backend start
        // Note: RECORDING status will be set by RecordingStateContext event listener
        setMeetingTitle(generatedMeetingTitle);
        setIsRecording(true);
        clearTranscripts();
        setIsMeetingActive(true);
        Analytics.trackButtonClick('start_recording', 'sidebar_direct');

        // Show recording notification if enabled
        await showRecordingNotification();
      } catch (error) {
        console.error('Failed to start recording from sidebar:', error);
        setStatus(RecordingStatus.ERROR, error instanceof Error ? error.message : 'Failed to start recording from sidebar');
        alert('Failed to start recording. Check console for details.');
        Analytics.trackButtonClick('start_recording_error', 'sidebar_direct');
      } finally {
        setIsAutoStarting(false);
      }
    };

    window.addEventListener('start-recording-from-sidebar', handleDirectStart);

    return () => {
      window.removeEventListener('start-recording-from-sidebar', handleDirectStart);
    };
  }, [
    isRecording,
    isAutoStarting,
    selectedDevices,
    generateMeetingTitle,
    setMeetingTitle,
    setIsRecording,
    clearTranscripts,
    setIsMeetingActive,
    checkParakeetReady,
    checkIfModelDownloading,
    showModal,
    setStatus,
    resolveDevices,
    mintMeetingId,
  ]);

  return {
    handleRecordingStart,
    isAutoStarting,
    sessionId,
  };
}
