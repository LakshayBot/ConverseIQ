'use client';

import { invoke } from '@tauri-apps/api/core';
import { appDataDir } from '@tauri-apps/api/path';
import { useCallback, useEffect, useState, useRef } from 'react';
import { Play, Pause, Square, Mic, AlertCircle, X } from 'lucide-react';
import { ProcessRequest, SummaryResponse } from '@/types/summary';
import { listen } from '@tauri-apps/api/event';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import Analytics from '@/lib/analytics';
import { useRecordingState } from '@/contexts/RecordingStateContext';

interface RecordingControlsProps {
  isRecording: boolean;
  barHeights: string[];
  onRecordingStop: (callApi?: boolean) => void;
  onRecordingStart: () => void;
  onTranscriptReceived: (summary: SummaryResponse) => void;
  onTranscriptionError?: (message: string) => void;
  onStopInitiated?: () => void; // Called immediately when stop button is clicked
  isRecordingDisabled: boolean;
  isParentProcessing: boolean;
  selectedDevices?: {
    micDevice: string | null;
    systemDevice: string | null;
  };
  meetingName?: string;
}

export const RecordingControls: React.FC<RecordingControlsProps> = ({
  isRecording,
  barHeights,
  onRecordingStop,
  onRecordingStart,
  onTranscriptReceived,
  onTranscriptionError,
  onStopInitiated,
  isRecordingDisabled,
  isParentProcessing,
  selectedDevices,
  meetingName,
}) => {
  // Use global recording state context for pause state (syncs with tray operations)
  const recordingState = useRecordingState();
  const isPaused = recordingState.isPaused;
  const activeDuration = recordingState.activeDuration;

  // ── Listening dock: live timer + live waveform ──────────────────────
  // Timer is the backend `active_duration` (excludes pauses, polled 500ms)
  // so it matches the real recording clock. Waveform is driven by the
  // `audio-levels` Tauri event when present, otherwise by a speech-aware
  // animation fallback so the bars always feel live while listening.
  const DOCK_BARS = 22;
  const [dockLevels, setDockLevels] = useState<number[]>(() =>
    Array.from({ length: 22 }, (_, i) => 0.25 + 0.4 * Math.abs(Math.sin(i * 0.65))),
  );
  const liveLevelRef = useRef<number | null>(null);
  const boostUntilRef = useRef(0);

  const dockSeconds = Math.max(0, Math.floor(activeDuration ?? 0));
  const formatDockTime = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  useEffect(() => {
    if (!isRecording || isPaused) return;
    let unlistenLevels: (() => void) | undefined;
    let unlistenSpeech: (() => void) | undefined;
    (async () => {
      try {
        unlistenLevels = await listen('audio-levels', (event: any) => {
          const levels = event?.payload?.levels;
          if (Array.isArray(levels) && levels.length > 0) {
            const peak = Math.max(
              ...levels.map((l: any) => Number(l?.rms_level ?? l?.peak_level ?? 0) || 0),
            );
            liveLevelRef.current = Math.max(0, Math.min(1, peak));
          }
        });
      } catch { /* fallback animation covers it */ }
      try {
        unlistenSpeech = await listen('speech-detected', () => {
          boostUntilRef.current = Date.now() + 1200;
        });
      } catch { /* optional */ }
    })();
    const id = setInterval(() => {
      setDockLevels((prev) => {
        const live = liveLevelRef.current;
        const boosted = Date.now() < boostUntilRef.current;
        const base = live !== null && live > 0.02
          ? live
          : boosted
            ? 0.55 + Math.random() * 0.35
            : 0.18 + Math.random() * 0.4;
        // Smooth toward the target so bars glide instead of jumping.
        const target = Math.max(0.08, Math.min(1, base));
        const last = prev[prev.length - 1] ?? 0.3;
        const next = last + (target - last) * 0.55 + (Math.random() - 0.5) * 0.08;
        return [...prev.slice(1), Math.max(0.08, Math.min(1, next))];
      });
    }, 110);
    return () => {
      clearInterval(id);
      if (unlistenLevels) unlistenLevels();
      if (unlistenSpeech) unlistenSpeech();
    };
  }, [isRecording, isPaused]);

  const [showPlayback, setShowPlayback] = useState(false);
  const [recordingPath, setRecordingPath] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isPausing, setIsPausing] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const MIN_RECORDING_DURATION = 2000; // 2 seconds minimum recording time
  const [transcriptionErrors, setTranscriptionErrors] = useState(0);
  const [isValidatingModel, setIsValidatingModel] = useState(false);
  const [speechDetected, setSpeechDetected] = useState(false);
  const [deviceError, setDeviceError] = useState<{ title: string, message: string } | null>(null);

  const currentTime = 0;
  const duration = 0;
  const isPlaying = false;
  const progress = 0;

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    const checkTauri = async () => {
      try {
        const result = await invoke('is_recording');
        console.log('Tauri is initialized and ready, is_recording result:', result);
      } catch (error) {
        console.error('Tauri initialization error:', error);
        alert('Failed to initialize recording. Please check the console for details.');
      }
    };
    checkTauri();
  }, []);

  const handleStartRecording = useCallback(async () => {
    if (isStarting || isValidatingModel) return;
    console.log('Starting recording...');
    console.log('Selected devices:', selectedDevices);
    console.log('Meeting name:', meetingName);
    console.log('Current isRecording state:', isRecording);

    setShowPlayback(false);
    setTranscript(''); // Clear any previous transcript
    setSpeechDetected(false); // Reset speech detection on new recording

    try {
      // Call the validation callback which will:
      // 1. Check if model is ready
      // 2. Show appropriate toast/modal
      // 3. Call backend if valid
      // 4. Update UI state
      await onRecordingStart();
    } catch (error) {
      console.error('Failed to start recording:', error);
      console.error('Error details:', {
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : 'Unknown',
        stack: error instanceof Error ? error.stack : undefined
      });

      // Parse error message to provide user-friendly feedback
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Check for device-related errors
      if (errorMsg.includes('microphone') || errorMsg.includes('mic') || errorMsg.includes('input')) {
        setDeviceError({
          title: 'Microphone Not Available',
          message: 'Unable to access your microphone. Please check that:\n• Your microphone is connected\n• The app has microphone permissions\n• No other app is using the microphone'
        });
      } else if (errorMsg.includes('system audio') || errorMsg.includes('speaker') || errorMsg.includes('output')) {
        setDeviceError({
          title: 'System Audio Not Available',
          message: 'Unable to capture system audio. Please check that:\n• A virtual audio device (like BlackHole) is installed\n• The app has screen recording permissions (macOS)\n• System audio is properly configured'
        });
      } else if (errorMsg.includes('permission')) {
        setDeviceError({
          title: 'Permission Required',
          message: 'Recording permissions are required. Please:\n• Grant microphone access in System Settings\n• Grant screen recording access for system audio (macOS)\n• Restart the app after granting permissions'
        });
      } else {
        setDeviceError({
          title: 'Recording Failed',
          message: `Unable to start recording: ${errorMsg}`,
        });
      }
    }
  }, [onRecordingStart, isStarting, isValidatingModel, selectedDevices, meetingName, isRecording]);

  /**
   * Robust toggle: queries the backend's actual recording state before deciding
   * whether to start or stop. Handles state-mismatch bugs where the React UI
   * thinks the app is idle but the backend audio pipeline is still running
   * (which can happen after a hot-reload, a crashed tab, or a missed event).
   *
   * The "stop" path is special: it must invoke the `stop_recording` Tauri
   * command FIRST (so the backend actually stops the audio pipeline), then
   * notify the parent for post-stop processing. The old wiring only called
   * the parent hook - which never fired `stop_recording` - leaving the
   * backend recording while the React state thought otherwise.
   *
   * Defined after `stopRecordingAction` so it's in scope; React hoists state
   * but `useCallback` references resolve at call time.
   */
  // (moved below after stopRecordingAction is declared)

  const stopRecordingAction = useCallback(async () => {
    console.log('Executing stop recording...');
    try {
      setIsProcessing(true);
      const dataDir = await appDataDir();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const savePath = `${dataDir}/recording-${timestamp}.wav`;
      console.log('Saving recording to:', savePath);
      console.log('About to call stop_recording command');
      const result = await invoke('stop_recording', {
        args: {
          save_path: savePath
        }
      });
      console.log('stop_recording command completed successfully:', result);
      setRecordingPath(savePath);
      // setShowPlayback(true);
      setIsProcessing(false);
      // Track successful transcription
      Analytics.trackTranscriptionSuccess();
      onRecordingStop(true);
    } catch (error) {
      console.error('Failed to stop recording:', error);
      if (error instanceof Error) {
        console.error('Error details:', {
          message: error.message,
          name: error.name,
          stack: error.stack,
        });
        if (error.message.includes('No recording in progress')) {
          return;
        }
      } else if (typeof error === 'string' && error.includes('No recording in progress')) {
        return;
      } else if (error && typeof error === 'object' && 'toString' in error) {
        if (error.toString().includes('No recording in progress')) {
          return;
        }
      }
      setIsProcessing(false);
      onRecordingStop(false);
    } finally {
      setIsStopping(false);
    }
  }, [onRecordingStop]);

  const handleStopRecording = useCallback(async () => {
    console.log('handleStopRecording called - isRecording:', isRecording, 'isStarting:', isStarting, 'isStopping:', isStopping);
    if (!isRecording || isStarting || isStopping) {
      console.log('Early return from handleStopRecording due to state check');
      return;
    }

    console.log('Stopping recording...');

    // Notify parent immediately (for UI state updates)
    onStopInitiated?.();

    setIsStopping(true);

    // Immediately trigger the stop action
    await stopRecordingAction();
  }, [isRecording, isStarting, isStopping, stopRecordingAction, onStopInitiated]);

  /**
   * Toggle recording by querying the backend's actual state first. This is
   * the function wired to the main mic button so a single click always
   * does the right thing - recovers from React/backend state mismatch.
   *
   * The "stop" path MUST call stopRecordingAction() (which invokes the Rust
   * stop_recording command), NOT just the parent post-stop hook. Otherwise
   * the audio pipeline keeps running while the UI thinks it's idle.
   */
  const handleToggleRecording = useCallback(async () => {
    console.log('[DIAG] mic button click - handleToggleRecording entered. isStarting=', isStarting, 'isValidatingModel=', isValidatingModel, 'isRecording=', isRecording);
    if (isStarting || isValidatingModel) {
      console.log('[DIAG] mic click ignored - busy (isStarting or isValidatingModel true)');
      return;
    }

    let backendRecording = false;
    try {
      backendRecording = await invoke<boolean>('is_recording');
      console.log('[DIAG] is_recording probe →', backendRecording);
    } catch (e) {
      console.warn('[DIAG] is_recording probe FAILED:', e);
    }
    console.log('[RecordingControls] toggle: backend recording =', backendRecording, 'UI isRecording =', isRecording);

    if (backendRecording || isRecording) {
      // STOP: directly invoke the Rust stop command, then notify parent.
      console.log('[DIAG] branch = STOP');
      Analytics.trackButtonClick('stop_recording', 'recording_controls');
      onStopInitiated?.();
      try {
        const dataDir = await appDataDir();
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        await invoke('stop_recording', { args: { save_path: `${dataDir}/recording-${ts}.wav` } });
        console.log('[DIAG] stop_recording invoke OK');
      } catch (e) {
        console.warn('[RecordingControls] stop_recording error (ignoring):', e);
      }
      try { await onRecordingStop(true); } catch (e) {
        console.warn('[RecordingControls] onRecordingStop error:', e);
      }
    } else {
      // START: delegate to existing handleStartRecording (validates models, starts pipeline).
      console.log('[DIAG] branch = START → calling handleStartRecording()');
      Analytics.trackButtonClick('start_recording', 'recording_controls');
      try {
        await handleStartRecording();
        console.log('[DIAG] handleStartRecording resolved OK');
      } catch (e) {
        console.error('[DIAG] handleStartRecording THREW:', e);
        // Re-raise so React's error boundary / outer catch sees it.
        throw e;
      }
    }
  }, [isRecording, isStarting, isValidatingModel, onRecordingStop, onStopInitiated, handleStartRecording]);

  const handlePauseRecording = useCallback(async () => {
    if (!isRecording || isPaused || isPausing) return;

    console.log('Pausing recording...');
    setIsPausing(true);

    try {
      await invoke('pause_recording');
      // isPaused state now managed by RecordingStateContext via events
      console.log('Recording paused successfully');
    } catch (error) {
      console.error('Failed to pause recording:', error);
      alert('Failed to pause recording. Please check the console for details.');
    } finally {
      setIsPausing(false);
    }
  }, [isRecording, isPaused, isPausing]);

  const handleResumeRecording = useCallback(async () => {
    if (!isRecording || !isPaused || isResuming) return;

    console.log('Resuming recording...');
    setIsResuming(true);

    try {
      await invoke('resume_recording');
      // isPaused state now managed by RecordingStateContext via events
      console.log('Recording resumed successfully');
    } catch (error) {
      console.error('Failed to resume recording:', error);
      alert('Failed to resume recording. Please check the console for details.');
    } finally {
      setIsResuming(false);
    }
  }, [isRecording, isPaused, isResuming]);

  useEffect(() => {
    return () => {
      // Cleanup on unmount if needed
    };
  }, []);

  useEffect(() => {
    console.log('Setting up recording event listeners');
    let unsubscribes: (() => void)[] = [];

    const setupListeners = async () => {
      try {
        // Transcript error listener - handles both regular and actionable errors
        const transcriptErrorUnsubscribe = await listen('transcript-error', (event) => {
          console.log('transcript-error event received:', event);
          console.error('Transcription error received:', event.payload);
          const errorMessage = event.payload as string;

          Analytics.trackTranscriptionError(errorMessage);
          console.log('Tracked transcription error:', errorMessage);

          setTranscriptionErrors(prev => {
            const newCount = prev + 1;
            console.log('Transcription error count incremented:', newCount);
            return newCount;
          });
          setIsProcessing(false);
          console.log('Calling onRecordingStop(false) due to transcript error');
          onRecordingStop(false);
          if (onTranscriptionError) {
            onTranscriptionError(errorMessage);
          }
        });

        // Transcription error listener - handles structured error objects with actionable flag
        const transcriptionErrorUnsubscribe = await listen('transcription-error', (event) => {
          console.log('transcription-error event received:', event);
          console.error('Transcription error received:', event.payload);

          let errorMessage: string;
          let isActionable = false;

          if (typeof event.payload === 'object' && event.payload !== null) {
            const payload = event.payload as { error: string, userMessage: string, actionable: boolean };
            errorMessage = payload.userMessage || payload.error;
            isActionable = payload.actionable || false;
          } else {
            errorMessage = String(event.payload);
          }

          Analytics.trackTranscriptionError(errorMessage);
          console.log('Tracked transcription error:', errorMessage);

          setTranscriptionErrors(prev => {
            const newCount = prev + 1;
            console.log('Transcription error count incremented:', newCount);
            return newCount;
          });
          setIsProcessing(false);
          console.log('Calling onRecordingStop(false) due to transcription error');
          onRecordingStop(false);

          // For actionable errors (like model loading failures), the main page will handle showing the model selector
          // For regular errors, they are handled by useModalState global listener which shows a toast
          // We don't want to show a modal (via onTranscriptionError) AND a toast, so we skip the callback here
          /* if (onTranscriptionError && !isActionable) {
            onTranscriptionError(errorMessage);
          } */
        });

        // Pause/Resume events are now handled by RecordingStateContext
        // No need for duplicate listeners here

        // Speech detected listener - for UX feedback when VAD detects speech
        const speechDetectedUnsubscribe = await listen('speech-detected', (event) => {
          console.log('speech-detected event received:', event);
          setSpeechDetected(true);
        });

        unsubscribes = [
          transcriptErrorUnsubscribe,
          transcriptionErrorUnsubscribe,
          speechDetectedUnsubscribe
        ];
        console.log('Recording event listeners set up successfully');
      } catch (error) {
        console.error('Failed to set up recording event listeners:', error);
      }
    };

    setupListeners();

    return () => {
      console.log('Cleaning up recording event listeners');
      unsubscribes.forEach(unsubscribe => {
        if (unsubscribe && typeof unsubscribe === 'function') {
          unsubscribe();
        }
      });
    };
  }, [onRecordingStop, onTranscriptionError]);

  return (
    <TooltipProvider>
      <div className="flex flex-col items-start">
        {/* Listening label — sits above the dock, like the reference */}
        {isRecording && !showPlayback && !(isProcessing && !isParentProcessing) && (
          <div className="mb-2 flex items-center gap-1.5 pl-1">
            <span
              aria-hidden
              className={`h-1.5 w-1.5 rounded-full ${isPaused ? 'bg-[var(--opaline-warning)]' : 'animate-pulse bg-blue-500'}`}
            />
            <span className="text-[13px] text-[var(--opaline-on-surface-variant)]">
              {isPaused ? 'Paused' : 'Listening...'}
            </span>
          </div>
        )}
        {/* Meetily-style listening dock: waveform · timer · Pause · Stop */}
        <div className="flex items-center gap-4 rounded-2xl border border-black/[0.06] bg-[var(--opaline-surface-container-lowest)] px-5 py-3.5 shadow-[0_16px_48px_-12px_rgb(0_0_0/0.25)]">
          {isProcessing && !isParentProcessing ? (
            <div className="flex items-center space-x-2">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-[var(--opaline-ink)]"></div>
              <span className="text-sm text-[var(--opaline-on-surface-variant)]">Processing recording...</span>
            </div>
          ) : (
            <>
              {showPlayback ? (
                <>
                  <button
                    onClick={handleStartRecording}
                    className="w-10 h-10 flex items-center justify-center bg-danger text-destructive-foreground rounded-full hover:bg-danger transition-colors"
                  >
                    <Mic size={16} />
                  </button>

                  <div className="w-px h-6 bg-[var(--opaline-surface-container)] mx-1" />

                  <div className="flex items-center space-x-1 mx-2">
                    <div className="text-sm text-[var(--opaline-on-surface-variant)] min-w-[40px]">
                      {formatTime(currentTime)}
                    </div>
                    <div
                      className="relative w-24 h-1 bg-[var(--opaline-surface-container)] rounded-full"
                    >
                      <div
                        className="absolute h-full bg-primary rounded-full"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <div className="text-sm text-[var(--opaline-on-surface-variant)] min-w-[40px]">
                      {formatTime(duration)}
                    </div>
                  </div>

                  <button
                    className="w-10 h-10 flex items-center justify-center bg-[var(--opaline-surface-container-high)] rounded-full text-[var(--opaline-on-surface-variant)] cursor-not-allowed"
                    disabled
                  >
                    <Play size={16} />
                  </button>
                </>
              ) : (
                <>
                  {!isRecording ? (
                    // Start recording button (also handles the case where backend
                    // is still running but the React state got desynced).
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={handleToggleRecording}
                          disabled={isStarting || isProcessing || isValidatingModel}
                          aria-label={isRecording ? 'Stop recording' : 'Start recording'}
                          className={`w-12 h-12 flex items-center justify-center ${isStarting || isProcessing || isValidatingModel ? 'bg-[var(--opaline-on-surface-variant)]' : 'bg-[var(--opaline-primary)] hover:bg-[var(--opaline-primary-hover)] active:bg-[var(--opaline-primary-pressed)]'
                            } rounded-full text-primary-foreground transition-colors duration-fast relative`}
                        >
                          {isValidatingModel ? (
                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-foreground"></div>
                          ) : (
                            <Mic size={20} />
                          )}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Start / stop recording</p>
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    // Listening mode: live waveform · elapsed timer · Pause · Stop
                    <>
                      <div
                        role="img"
                        aria-label={isPaused ? 'Audio level (paused)' : 'Live audio level'}
                        className="flex h-8 items-center gap-[3px]"
                      >
                        {dockLevels.map((level, index) => (
                          <div
                            key={index}
                            className="w-[3px] rounded-full bg-[#9aa0a6] transition-[height] duration-100"
                            style={{
                              height: isPaused ? '4px' : `${Math.round(5 + level * 24)}px`,
                              opacity: isPaused ? 0.45 : 0.55 + level * 0.45,
                            }}
                          />
                        ))}
                      </div>

                      <span
                        aria-label={`Elapsed time ${formatDockTime(dockSeconds)}`}
                        className="min-w-[52px] text-[15px] font-medium tabular-nums text-[var(--opaline-on-surface)]"
                      >
                        {formatDockTime(dockSeconds)}
                      </span>

                      <button
                        type="button"
                        onClick={() => {
                          if (isPaused) {
                            Analytics.trackButtonClick('resume_recording', 'recording_controls');
                            handleResumeRecording();
                          } else {
                            Analytics.trackButtonClick('pause_recording', 'recording_controls');
                            handlePauseRecording();
                          }
                        }}
                        disabled={isPausing || isResuming || isStopping}
                        aria-label={isPaused ? 'Resume recording' : 'Pause recording'}
                        className="inline-flex h-10 items-center gap-2 rounded-xl bg-black/[0.05] px-4 text-[14px] font-medium text-[var(--opaline-on-surface)] transition-colors hover:bg-black/[0.08] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white/[0.08] dark:hover:bg-white/[0.12]"
                      >
                        {isPausing || isResuming ? (
                          <span className="text-[13px]">{isPausing ? 'Pausing…' : 'Resuming…'}</span>
                        ) : isPaused ? (
                          <>
                            <Play size={15} />
                            Resume
                          </>
                        ) : (
                          <>
                            <Pause size={15} />
                            Pause
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          Analytics.trackButtonClick('stop_recording', 'recording_controls');
                          handleStopRecording();
                        }}
                        disabled={isStopping || isPausing || isResuming}
                        aria-label="Stop recording"
                        className="inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--opaline-danger-soft)] px-4 text-[14px] font-medium text-[var(--opaline-danger)] transition-colors hover:brightness-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isStopping ? (
                          <span className="text-[13px]">Stopping…</span>
                        ) : (
                          <>
                            <Square size={11} fill="currentColor" aria-hidden />
                            Stop
                          </>
                        )}
                      </button>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>

        {/* Show validation status only */}
        {isValidatingModel && (
          <div className="text-xs text-[var(--opaline-on-surface-variant)] text-center mt-2">
            Validating speech recognition...
          </div>
        )}

        {/* Device error alert */}
        {deviceError && (
          <Alert variant="destructive" className="mt-4 border-[var(--opaline-danger-border)] bg-[var(--opaline-danger-soft)]">
            <AlertCircle className="h-5 w-5 text-danger" />
            <button
              onClick={() => setDeviceError(null)}
              className="absolute right-3 top-3 text-danger hover:text-danger transition-colors"
              aria-label="Close alert"
            >
              <X className="h-4 w-4" />
            </button>
            <AlertTitle className="text-danger font-semibold mb-2">
              {deviceError.title}
            </AlertTitle>
            <AlertDescription className="text-danger">
              {deviceError.message.split('\n').map((line, i) => (
                <div key={i} className={i > 0 ? 'ml-2' : ''}>
                  {line}
                </div>
              ))}
            </AlertDescription>
          </Alert>
        )}

        {/* {showPlayback && recordingPath && (
        <div className="text-sm text-[var(--opaline-on-surface-variant)] px-4">
          Recording saved to: {recordingPath}
        </div>
      )} */}
      </div>
    </TooltipProvider>
  );
};