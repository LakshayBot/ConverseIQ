'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RecordingControls } from '@/components/RecordingControls';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { usePermissionCheck } from '@/hooks/usePermissionCheck';
import { useRecordingState, RecordingStatus } from '@/contexts/RecordingStateContext';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { useConfig } from '@/contexts/ConfigContext';
import { StatusOverlays } from '@/app/_components/StatusOverlays';
import Analytics from '@/lib/analytics';
import { entityDisplayName } from '@/lib/callpilotApi';
import { IntelligenceSelectionProvider } from '@/contexts/IntelligenceSelectionContext';
import { SettingsModals } from './_components/SettingsModal';
import { TranscriptPanel } from './_components/TranscriptPanel';
import { IntelligencePanel } from '@/components/IntelligencePanel';
import { CollapsibleRail } from '@/components/CollapsibleRail';
import { useIntelligenceStream } from '@/hooks/useIntelligenceStream';
import { useModalState } from '@/hooks/useModalState';
import { useRecordingStateSync } from '@/hooks/useRecordingStateSync';
import { useRecordingStart } from '@/hooks/useRecordingStart';
import { useRecordingStop } from '@/hooks/useRecordingStop';
import { useTranscriptRecovery } from '@/hooks/useTranscriptRecovery';
import { TranscriptRecovery } from '@/components/TranscriptRecovery';
import { IdleMainPage } from './_components/IdleMainPage';
import { indexedDBService } from '@/services/indexedDBService';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { authedApiCall } from '@/lib/auth';
import { TranscriptSegmentData } from '@/types';
import { transcriptDisplayText } from '@/components/VirtualizedTranscriptView';
import { buildTranscriptEntityMap } from '@/lib/transcriptEntities';
import type { ProductMention } from '@/components/ProductIntelligenceCard';
import { fadeIn, motionProps } from '@/lib/motion';

interface KnowledgeDoc {
  id: string;
  fileName: string;
  processingStatus: string;
  enrichmentStatus: string | null;
  chunkCount: number;
  createdAt: string;
  mode?: 'fast' | 'structured';
}

/** Health pill used in the page header. Mirrors the .status-pill system. */
function StatusPill({
  tone,
  label,
  title,
}: {
  tone: 'live' | 'warn' | 'danger' | 'idle' | 'spin';
  label: string;
  title?: string;
}) {
  return (
    <span
      className={`status-pill ${tone === 'live' ? 'status-pill--live' : tone === 'warn' ? 'status-pill--warn' : tone === 'danger' ? 'status-pill--danger' : tone === 'spin' ? 'status-pill--spin' : ''}`}
      title={title}
    >
      <span className="pill-dot" aria-hidden />
      {label}
    </span>
  );
}

export default function Home() {
  // Local page state (not moved to contexts)
  const [isRecording, setIsRecordingState] = useState(false);
  const [barHeights, setBarHeights] = useState(['58%', '76%', '58%']);
  const [showRecoveryDialog, setShowRecoveryDialog] = useState(false);

  // Use contexts for state management
  const { meetingTitle, transcripts } = useTranscripts();
  const { transcriptModelConfig, selectedDevices } = useConfig();
  const recordingState = useRecordingState();

  // Extract status from global state
  const { status, isStopping, isProcessing, isSaving } = recordingState;

  // Hooks
  const { hasMicrophone, hasSystemAudio } = usePermissionCheck();
  const { setIsMeetingActive, isCollapsed: sidebarCollapsed, refetchMeetings } = useSidebar();
  const { modals, messages, showModal, hideModal } = useModalState(transcriptModelConfig);
  const { isRecordingDisabled, setIsRecordingDisabled } = useRecordingStateSync(isRecording, setIsRecordingState, setIsMeetingActive);
  const { handleRecordingStart, sessionId: hookSessionId } = useRecordingStart(isRecording, setIsRecordingState, showModal);

  // Get handleRecordingStop function and setIsStopping (state comes from global context)
  const { handleRecordingStop, setIsStopping } = useRecordingStop(
    setIsRecordingState,
    setIsRecordingDisabled
  );

  // Recovery hook
  const {
    recoverableMeetings,
    isLoading: isLoadingRecovery,
    isRecovering,
    checkForRecoverableTranscripts,
    recoverMeeting,
    loadMeetingTranscripts,
    deleteRecoverableMeeting
  } = useTranscriptRecovery();

  const router = useRouter();

  // Knowledge bank summary - fetched here so the header pill and the idle
  // panel share one source of truth.
  const [knowledgeDocs, setKnowledgeDocs] = useState<KnowledgeDoc[]>([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const items = await authedApiCall<KnowledgeDoc[]>('GET', '/api/v1/knowledge');
        if (!cancelled) setKnowledgeDocs(items);
      } catch {
        if (!cancelled) setKnowledgeDocs([]);
      } finally {
        if (!cancelled) setKnowledgeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // CallPilot - intelligence stream keyed by the current meeting id.
  //
  // `useRecordingStart` mints the meeting against the .NET Gateway
  // synchronously inside the start handler, so by the time `isRecording`
  // flips true we already have a stable ID. The `?meeting=` URL query
  // override is honored only as a fallback for deep-links from
  // meeting-details (where no recording is started, but the user expects
  // to see the same session's cards).
  const deepLinkMeetingId = (() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('meeting');
  })();
  const sessionId = hookSessionId ?? deepLinkMeetingId;

  const { cards: intelligenceCards, connected: intelligenceConnected, error: intelligenceError } =
    useIntelligenceStream(sessionId);

  // Product entities for live transcript highlighting (the PRODUCTS rail
  // identity, deduped).
  const productNames = useMemo(() => {
    const names = intelligenceCards
      .filter((c) => c.type === 'product_match')
      .map((c) => entityDisplayName(c.title));
    return Array.from(new Set(names));
  }, [intelligenceCards]);

  // Meeting-specific product mentions (timestamp + snippet) for the product
  // profile card's "Meeting context" section. Live buffer → entity map.
  const productMentions = useMemo(() => {
    if (!transcripts || transcripts.length === 0 || productNames.length === 0) return {};
    const segments: TranscriptSegmentData[] = transcripts.map((t) => ({
      id: t.id,
      timestamp: t.audio_start_time ?? 0,
      text: t.text,
      is_partial: t.is_partial,
    }));
    const map = buildTranscriptEntityMap(segments, productNames, transcriptDisplayText);
    const out: Record<string, ProductMention[]> = {};
    for (const [name, occs] of map.byEntityName) {
      out[name] = occs.map((o) => {
        const seg = segments[o.segmentIndex];
        return {
          timestamp: o.timestamp,
          text: seg ? transcriptDisplayText(seg).slice(0, 200) : '',
        };
      });
    }
    return out;
  }, [transcripts, productNames]);

  useEffect(() => {
    // Track page view
    Analytics.trackPageView('home');
  }, []);

  // Startup recovery check
  useEffect(() => {
    const performStartupChecks = async () => {
      try {
        // Skip recovery check if currently recording or processing stop
        // This prevents the recovery dialog from showing when:
        if (recordingState.isRecording ||
          status === RecordingStatus.STOPPING ||
          status === RecordingStatus.PROCESSING_TRANSCRIPTS ||
          status === RecordingStatus.SAVING) {
          console.log('Skipping recovery check - recording in progress or processing');
          return;
        }

        // 1. Clean up old meetings (7+ days)
        try {
          await indexedDBService.deleteOldMeetings(7);
        } catch (error) {
          console.warn('⚠️ Failed to clean up old meetings:', error);
        }

        // 2. Clean up saved meetings (24+ hours after save)
        try {
          await indexedDBService.deleteSavedMeetings(24);
        } catch (error) {
          console.warn('⚠️ Failed to clean up saved meetings:', error);
        }

        // 3. Always check for recoverable meetings on startup
        // Don't skip based on sessionStorage - we need to check every time
        await checkForRecoverableTranscripts();
      } catch (error) {
        console.error('Failed to perform startup checks:', error);
      }
    };

    performStartupChecks();
  }, [checkForRecoverableTranscripts, recordingState.isRecording, status]);

  // Watch for recoverable meetings changes and show dialog once per session
  useEffect(() => {
    // Only show dialog if we have meetings and haven't shown it yet this session
    if (recoverableMeetings.length > 0) {
      const shownThisSession = sessionStorage.getItem('recovery_dialog_shown');
      if (!shownThisSession) {
        setShowRecoveryDialog(true);
        sessionStorage.setItem('recovery_dialog_shown', 'true');
      }
    }
  }, [recoverableMeetings]);

  // Handle recovery with toast notifications and navigation
  const handleRecovery = async (meetingId: string) => {
    try {
      const result = await recoverMeeting(meetingId);

      if (result.success) {
        toast.success('Meeting recovered successfully!', {
          description: result.audioRecoveryStatus?.status === 'success'
            ? 'Transcripts and audio recovered'
            : 'Transcripts recovered (no audio available)',
          action: result.meetingId ? {
            label: 'View Meeting',
            onClick: () => {
              router.push(`/meeting-details?id=${result.meetingId}`);
            }
          } : undefined,
          duration: 10000,
        });

        // Refresh sidebar to show the newly recovered meeting
        await refetchMeetings();

        // If no more recoverable meetings, clear session flag so dialog can show again
        if (recoverableMeetings.length === 0) {
          sessionStorage.removeItem('recovery_dialog_shown');
        }

        // Auto-navigate after a short delay
        if (result.meetingId) {
          setTimeout(() => {
            router.push(`/meeting-details?id=${result.meetingId}`);
          }, 2000);
        }
      }
    } catch (error) {
      toast.error('Failed to recover meeting', {
        description: error instanceof Error ? error.message : 'Unknown error occurred',
      });
      throw error;
    }
  };

  // Handle dialog close - clear session flag if no meetings left
  const handleDialogClose = () => {
    setShowRecoveryDialog(false);
    // If user closes dialog and there are no more meetings, clear the flag
    // This allows the dialog to show again next session if new meetings appear
    if (recoverableMeetings.length === 0) {
      sessionStorage.removeItem('recovery_dialog_shown');
    }
  };

  useEffect(() => {
    if (recordingState.isRecording) {
      const interval = setInterval(() => {
        setBarHeights(prev => {
          const newHeights = [...prev];
          newHeights[0] = Math.random() * 20 + 10 + 'px';
          newHeights[1] = Math.random() * 20 + 10 + 'px';
          newHeights[2] = Math.random() * 20 + 10 + 'px';
          return newHeights;
        });
      }, 300);

      return () => clearInterval(interval);
    }
  }, [recordingState.isRecording]);

  // Computed values using global status
  const isProcessingStop = status === RecordingStatus.PROCESSING_TRANSCRIPTS || isProcessing;

  // Model label for the header pill
  const modelLabel =
    transcriptModelConfig.provider === 'localWhisper'
      ? 'Whisper'
      : transcriptModelConfig.provider === 'parakeet'
        ? 'Parakeet'
        : transcriptModelConfig.provider || 'Model';

  const sessionLive =
    recordingState.isRecording || status === RecordingStatus.STARTING;

  // Intelligence presentation context, derived from real app state:
  //   live    → a recording is active right now
  //   history → a past meeting's session is loaded (deep-link) but no
  //             microphone is active - read-only snapshot
  //   idle    → nothing loaded at all
  const intelligenceMode: 'live' | 'history' | 'idle' = sessionLive
    ? 'live'
    : sessionId
      ? 'history'
      : 'idle';
  const railStatusLabel =
    intelligenceMode === 'live'
      ? 'Listening'
      : intelligenceMode === 'history'
        ? 'Past'
        : 'Idle';

  return (
    <div className="flex flex-col h-screen bg-[var(--grain-paper)]">
      {/* All Modals supported*/}
      <SettingsModals
        modals={modals}
        messages={messages}
        onClose={hideModal}
      />

      {/* Recovery Dialog */}
      <TranscriptRecovery
        isOpen={showRecoveryDialog}
        onClose={handleDialogClose}
        recoverableMeetings={recoverableMeetings}
        onRecover={handleRecovery}
        onDelete={deleteRecoverableMeeting}
        onLoadPreview={loadMeetingTranscripts}
      />

      {/* ── Page header: context + system health + shortcuts ─────────── */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-[var(--opaline-outline-variant)] bg-[var(--grain-paper)] px-6 pb-4 pt-5">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="font-display text-headline-md text-[var(--opaline-on-surface)]">
            Live call
          </h1>
          <span className="hidden truncate text-caption sm:inline">
            {sessionLive
              ? isStopping
                ? 'Finishing up…'
                : 'Transcribing in real time'
              : 'Ready when you are'}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <StatusPill
            tone={hasMicrophone ? 'live' : 'danger'}
            label="Mic"
            title={hasMicrophone ? 'Microphone ready' : 'Microphone permission missing'}
          />
          <StatusPill
            tone={hasSystemAudio ? 'live' : 'warn'}
            label="System"
            title={hasSystemAudio ? 'System audio ready' : 'System audio unavailable'}
          />
          <StatusPill tone="live" label={modelLabel} title="Speech recognition model" />
          <StatusPill
            tone={knowledgeDocs.length > 0 ? 'live' : 'idle'}
            label={knowledgeLoading ? 'Knowledge…' : `Knowledge · ${knowledgeDocs.length}`}
            title="Knowledge bank documents"
          />
          <span className="mx-1 hidden h-4 w-px bg-[var(--opaline-outline-variant)] sm:block" />
          <StatusPill
            tone={
              intelligenceConnected
                ? 'live'
                : sessionId
                  ? 'spin'
                  : 'idle'
            }
            label={
              intelligenceConnected
                ? 'Stream live'
                : sessionId
                  ? 'Connecting…'
                  : 'Stream idle'
            }
            title="Intelligence stream"
          />
          <span className="ml-1 hidden items-center gap-1.5 text-caption lg:inline-flex">
            <kbd className="kbd">⌘ R</kbd>
            <span className="text-[var(--opaline-outline)]">starts a call</span>
          </span>
        </div>
      </header>

      <IntelligenceSelectionProvider>
      <div className="relative flex flex-1 overflow-hidden">
        {/* Transcript column. `relative` anchors the floating mic button so it
           stays centered within THIS column on every viewport - independent of
           the sidebar width and the right-side intelligence aside. */}
        <div className="relative flex-1 min-w-0">
          <AnimatePresence mode="wait" initial={false}>
            {sessionLive ? (
              <motion.div
                key="live"
                className="h-full"
                variants={fadeIn}
                initial="initial"
                animate="animate"
                exit="exit"
              >
                <TranscriptPanel
                  isProcessingStop={isProcessingStop}
                  isStopping={isStopping}
                  showModal={showModal}
                  products={productNames}
                />
              </motion.div>
            ) : (
              <motion.div
                key="idle"
                className="h-full"
                variants={fadeIn}
                initial="initial"
                animate="animate"
                exit="exit"
              >
                <IdleMainPage
                  onStartRecording={handleRecordingStart}
                  knowledgeDocs={knowledgeDocs}
                  knowledgeLoading={knowledgeLoading}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Recording controls - absolutely positioned inside the transcript
             column so they stay horizontally centered between the sidebar
             and the intelligence aside. `bottom-12` lifts the dock above
             the transcript scroll edge.

             Only rendered while a call is starting/active: the idle home
             screen already has the hero "Start a call" CTA, so showing the
             mic dock at idle would be a redundant second entry point. */}
          {(isRecording || status === RecordingStatus.STARTING) &&
            status !== RecordingStatus.PROCESSING_TRANSCRIPTS &&
            status !== RecordingStatus.SAVING && (
              <div className="pointer-events-none absolute bottom-10 left-0 right-0 z-10 flex justify-center">
                <div className="pointer-events-auto">
                  <RecordingControls
                    isRecording={recordingState.isRecording}
                    onRecordingStop={(callApi = true) => handleRecordingStop(callApi)}
                    onRecordingStart={handleRecordingStart}
                    onTranscriptReceived={() => { }} // Not actually used by RecordingControls
                    onStopInitiated={() => setIsStopping(true)}
                    barHeights={barHeights}
                    onTranscriptionError={(message) => {
                      showModal('errorAlert', message);
                    }}
                    isRecordingDisabled={isRecordingDisabled}
                    isParentProcessing={isProcessingStop}
                    selectedDevices={selectedDevices}
                    meetingName={meetingTitle}
                  />
                </div>
              </div>
            )}
        </div>
        <CollapsibleRail
          label="Intelligence"
          header={
            <>
              <h2 className="text-overline">Intelligence</h2>
              <span
                className={`status-pill !px-2 !py-0.5 ${
                  intelligenceMode === 'live' ? 'status-pill--live' : ''
                }`}
              >
                <span className="pill-dot" aria-hidden />
                {railStatusLabel}
              </span>
            </>
          }
        >
          <IntelligencePanel
            cards={intelligenceCards}
            connected={intelligenceConnected}
            error={intelligenceError}
            sessionId={sessionId}
            mode={intelligenceMode}
            productMentions={productMentions}
          />
        </CollapsibleRail>

        {/* Status Overlays - Processing and Saving */}
        <StatusOverlays
          isProcessing={status === RecordingStatus.PROCESSING_TRANSCRIPTS && !recordingState.isRecording}
          isSaving={status === RecordingStatus.SAVING}
          sidebarCollapsed={sidebarCollapsed}
        />
      </div>
      </IntelligenceSelectionProvider>
    </div>
  );
}
