"use client"
import { useSidebar } from "@/components/Sidebar/SidebarProvider";
import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from "react";
import { Transcript, Summary } from "@/types";
import PageContent from "./page-content";
import { useRouter, useSearchParams } from "next/navigation";
import Analytics from "@/lib/analytics";
import { LoaderIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfig } from "@/contexts/ConfigContext";
import { usePaginatedTranscripts } from "@/hooks/usePaginatedTranscripts";
import { useLocalSummarization } from "@/hooks/useLocalSummarization";
import { authedApiCall } from "@/lib/auth";

interface MeetingDetailsResponse {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  transcripts: Transcript[];
  folder_path?: string;
}

function MeetingDetailsContent() {
  const searchParams = useSearchParams();
  const meetingId = searchParams.get('id');
  const { setCurrentMeeting, refetchMeetings, stopSummaryPolling } = useSidebar();
  const { isAutoSummary, summarizationModel } = useConfig(); // Get auto-summary + local model
  const router = useRouter();
  const [meetingDetails, setMeetingDetails] = useState<MeetingDetailsResponse | null>(null);
  const [meetingSummary, setMeetingSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const fetchMeetingSummaryRef = useRef<() => Promise<void>>(async () => {});

  // Use pagination hook for efficient transcript loading
  const {
    metadata,
    segments,
    transcripts,
    isLoading: isLoadingTranscripts,
    isLoadingMore,
    hasMore,
    totalCount,
    loadedCount,
    loadMore,
    refetch,
    error: transcriptError,
  } = usePaginatedTranscripts({ meetingId: meetingId || '' });

  // Local LLM summarization - runs on the user's machine, never the server.
  const { state: localSummaryState, progress: localSummaryProgress, error: localSummaryError, generate: generateLocal, retrySave: retryLocalSave } =
    useLocalSummarization(meetingId || null);

  // Transcript text for local summarization.
  const transcriptText = useMemo(
    () => (segments || []).filter((s: any) => s.text).map((s: any) => s.text).join('\n'),
    [segments],
  );

  // Sync meeting metadata from pagination hook to meeting details state
  useEffect(() => {
    if (metadata && (!meetingId || meetingId === 'intro-call')) {
      // If invalid meeting ID, don't sync
      return;
    }

    if (metadata) {
      console.log('Meeting metadata loaded:', metadata);

      // Build meeting details from metadata and paginated transcripts
      setMeetingDetails({
        id: metadata.id,
        title: metadata.title,
        created_at: metadata.created_at,
        updated_at: metadata.updated_at,
        transcripts: transcripts, // Paginated transcripts from hook
        folder_path: metadata.folder_path, // For retranscription feature
      });

      // Sync with sidebar context
      setCurrentMeeting({ id: metadata.id, title: metadata.title });
    }
  }, [metadata, transcripts, meetingId, setCurrentMeeting]);

  // Handle transcript loading errors
  useEffect(() => {
    if (transcriptError) {
      console.error('Error loading transcripts:', transcriptError);
      setError(transcriptError);
    }
  }, [transcriptError]);

  // Extract fetchMeetingDetails for use in child components (now refetches via hook)
  const fetchMeetingDetails = useCallback(async () => {
    if (!meetingId || meetingId === 'intro-call') {
      return;
    }

    // The usePaginatedTranscripts hook automatically refetches when meetingId changes
    // This function is kept for compatibility with onMeetingUpdated callback
    console.log('fetchMeetingDetails called - pagination hook will handle refetch');
  }, [meetingId]);

  // Reset states when meetingId changes (prevent race conditions)
  useEffect(() => {
    setMeetingDetails(null);
    setMeetingSummary(null);
    setError(null);
    setIsLoading(true);
  }, [meetingId]);

  // Cleanup: Stop polling when navigating away from a meeting
  useEffect(() => {
    return () => {
      if (meetingId) {
        console.log('Cleaning up: Stopping summary polling for meeting:', meetingId);
        stopSummaryPolling(meetingId);
      }
    };
  }, [meetingId, stopSummaryPolling]);

  useEffect(() => {
    console.log('MeetingDetails useEffect triggered - meetingId:', meetingId);

    if (!meetingId || meetingId === 'intro-call') {
      console.warn('No valid meeting ID in URL - meetingId:', meetingId);
      setError("No meeting selected");
      setIsLoading(false);
      Analytics.trackPageView('meeting_details');
      return;
    }

    console.log('Valid meeting ID found, fetching details for:', meetingId);

    setMeetingDetails(null);
    setMeetingSummary(null);
    setError(null);
    setIsLoading(true);

    const fetchMeetingSummary = async () => {
      try {
        const resp = await authedApiCall<{ status: string; data: Summary | null }>(
          'GET',
          `/api/v1/meetings/${meetingId}/summary`,
        );
        console.log('FETCH SUMMARY: Raw response:', resp);

        if (resp?.status !== 'completed' || !resp.data) {
          setMeetingSummary(null);
          return;
        }

        const summaryData = resp.data;
        // Our local summaries are stored as a flat structured object; the
        // legacy BlockNote/markdown formats are handled as-is.
        setMeetingSummary(summaryData);
      } catch (error) {
        console.error('FETCH SUMMARY: Error fetching meeting summary:', error);
        setMeetingSummary(null);
      }
    };
    fetchMeetingSummaryRef.current = fetchMeetingSummary;

    const loadData = async () => {
      try {
        await fetchMeetingSummary();
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [meetingId]);

  // Auto-generate a summary when: the meeting has no summary yet, the user
  // has auto-summary on, a local model is selected, and there is transcript
  // text. Summarization runs on-device through the selected GGUF model. Runs
  // once (guarded by localSummaryState).
  useEffect(() => {
    if (
      meetingId &&
      meetingSummary === null &&
      isAutoSummary &&
      summarizationModel &&
      localSummaryState === 'idle' &&
      segments &&
      segments.length > 0 &&
      transcriptText.trim()
    ) {
      void generateLocal(transcriptText);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId, meetingSummary, isAutoSummary, summarizationModel, localSummaryState, segments?.length]);

  // When local summarization completes, refresh the summary from the backend.
  useEffect(() => {
    if (localSummaryState === 'done' && meetingSummary === null && meetingId) {
      fetchMeetingSummaryRef.current();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localSummaryState, meetingId]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="panel p-8 text-center max-w-sm">
          <p className="text-body-md text-danger mb-4">{error}</p>
          <Button onClick={() => router.push('/')} variant="outline">
            Go Back
          </Button>
        </div>
      </div>
    );
  }

  // Show loading spinner while initial data loads
  if ((isLoading || isLoadingTranscripts) || !meetingDetails) {
    return <div className="flex items-center justify-center h-screen">
      <div className="animate-spin rounded-full h-6 w-6 border-2 border-[var(--opaline-outline-variant)] border-t-[var(--opaline-primary)]" />
    </div>;
  }

  return <PageContent
    meeting={meetingDetails}
    summaryData={meetingSummary}
    localSummaryState={localSummaryState}
    localSummaryProgress={localSummaryProgress}
    localSummaryError={localSummaryError}
    onRegenerateSummary={() => generateLocal(transcriptText)}
    onRetrySaveSummary={retryLocalSave}
    onSummaryChanged={async () => {
      await fetchMeetingSummaryRef.current();
      await refetchMeetings();
    }}
    onMeetingUpdated={async () => {
      // Refetch meeting details to get updated title from backend
      await fetchMeetingDetails();
      // Refetch meetings list to update sidebar
      await refetchMeetings();
    }}
    onRefetchTranscripts={refetch}
    // Pagination props for efficient transcript loading
    segments={segments}
    hasMore={hasMore}
    isLoadingMore={isLoadingMore}
    totalCount={totalCount}
    loadedCount={loadedCount}
    onLoadMore={loadMore}
  />;
}

export default function MeetingDetails() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-screen">
        <LoaderIcon className="animate-spin size-6" />
      </div>
    }>
      <MeetingDetailsContent />
    </Suspense>
  );
}
