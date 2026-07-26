'use client';

// Meeting-details page content for CallPilot.
//
// Two responsibilities, both historically broken:
//
//   1. Transcripts — the old code rendered <TranscriptPanel>, which reads
//      from the live TranscriptContext (the recording buffer). For past
//      meetings that buffer is empty, so the panel rendered zero rows.
//      We now render <VirtualizedTranscriptView> directly with the paginated
//      `segments` the page-level hook already loads from local SQLite.
//
//   2. Intelligence cards — the old code didn't render any. We now load
//      past ConversationEvents + Recommendations from the .NET Gateway and
//      render them through <IntelligencePanel> so the user sees the same
//      product-match / competitor / objection cards they saw live.
//
// The intelligence panel used here reads from the same `IntelligenceCard`
// type the live panel consumes, so card styling is identical.

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LoaderIcon } from 'lucide-react';
import { VirtualizedTranscriptView } from '@/components/VirtualizedTranscriptView';
import { IntelligencePanel } from '@/components/IntelligencePanel';
import { TranscriptSegmentData } from '@/types';
import Analytics from '@/lib/analytics';
import {
  getEventsForMeeting,
  getRecommendationsForMeeting,
  buildPastIntelligenceCards,
  PastConversationEvent,
  PastRecommendation,
} from '@/lib/callpilotApi';

interface PageContentProps {
  meeting: any;
  segments?: TranscriptSegmentData[];
  totalCount?: number;
  loadedCount?: number;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  onMeetingUpdated?: () => void;
  onRefetchTranscripts?: () => void;
  summaryData?: any;
  shouldAutoGenerate?: boolean;
  onAutoGenerateComplete?: () => void;
  [key: string]: any;
}

const PageContent: React.FC<PageContentProps> = ({
  meeting,
  segments,
  totalCount,
  loadedCount,
  hasMore,
  isLoadingMore,
  onLoadMore,
}) => {
  const router = useRouter();
  const segmentCount = segments?.length ?? 0;

  // Past intelligence — loaded from the .NET Gateway for the meeting's events
  // and recommendations. Reconstructed into IntelligenceCards so the same
  // <IntelligencePanel> component renders them with identical styling.
  const [pastCards, setPastCards] = useState<ReturnType<typeof buildPastIntelligenceCards>>([]);
  const [cardsLoading, setCardsLoading] = useState(true);

  useEffect(() => {
    Analytics.trackPageView('meeting_details');
  }, []);

  // Load past events + recommendations whenever the meeting changes.
  useEffect(() => {
    if (!meeting?.id) return;
    let cancelled = false;
    setCardsLoading(true);

    (async () => {
      try {
        const [events, recs] = await Promise.all([
          getEventsForMeeting(meeting.id) as Promise<PastConversationEvent[]>,
          getRecommendationsForMeeting(meeting.id) as Promise<PastRecommendation[]>,
        ]);
        if (cancelled) return;
        setPastCards(buildPastIntelligenceCards(events ?? [], recs ?? []));
      } catch (e) {
        console.warn('[meeting-details] failed to load past intelligence:', e);
        if (!cancelled) setPastCards([]);
      } finally {
        if (!cancelled) setCardsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [meeting?.id]);

  if (!meeting) {
    return (
      <div className="flex items-center justify-center h-screen">
        <LoaderIcon className="animate-spin size-6" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white">
        <div>
          <button
            type="button"
            onClick={() => router.push('/')}
            className="text-xs text-blue-600 hover:underline"
          >
            ← Back to live
          </button>
          <h1 className="mt-1 text-lg font-semibold text-gray-900">{meeting.title || 'Untitled session'}</h1>
        </div>
        <div className="text-xs text-gray-500">
          {segmentCount} segment{segmentCount === 1 ? '' : 's'}
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        <div className="flex h-full">
          {/* Transcript column — fed by the page-level paginated hook, not
             by the empty live TranscriptContext. disableAutoScroll prevents
             the live-stream auto-scroll behaviour from fighting the user
             when they're just reading past content. */}
          <div className="flex-1 min-w-0 overflow-y-auto">
            <div className="max-w-3xl mx-auto p-6">
              <div className="bg-white border border-gray-200 rounded-md p-4">
                <VirtualizedTranscriptView
                  segments={segments ?? []}
                  isRecording={false}
                  isPaused={false}
                  isProcessing={false}
                  isStopping={false}
                  enableStreaming={false}
                  showConfidence={true}
                  disableAutoScroll={true}
                  hasMore={hasMore}
                  isLoadingMore={isLoadingMore}
                  totalCount={totalCount}
                  loadedCount={loadedCount}
                  onLoadMore={onLoadMore}
                />
              </div>
            </div>
          </div>

          {/* Intelligence column — renders past events + recommendations as
             IntelligenceCards. Mirrors the home-page IntelligencePanel so the
             visual treatment is identical. Hidden on small screens to keep
             the transcript readable. */}
          <aside className="hidden xl:flex w-[360px] flex-col gap-3 border-l border-gray-200 bg-gray-50 p-4 overflow-y-auto">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-gray-700">Intelligence</h2>
              <span className="text-[10px] uppercase tracking-wide text-gray-400">
                {pastCards.length > 0 ? `${pastCards.length} card${pastCards.length === 1 ? '' : 's'}` : 'past'}
              </span>
            </div>
            {cardsLoading ? (
              <div className="flex items-center justify-center py-8 text-xs text-gray-400">
                <LoaderIcon className="animate-spin size-4 mr-2" />
                Loading past intelligence…
              </div>
            ) : (
              <IntelligencePanel
                cards={pastCards}
                connected={true}
                error={null}
                sessionId={meeting?.id ?? null}
              />
            )}
          </aside>
        </div>
      </main>
    </div>
  );
};

export default PageContent;