'use client';

// Meeting-details page content for CallPilot.
//
// Two responsibilities, both historically broken:
//
//   1. Transcripts - the old code rendered <TranscriptPanel>, which reads
//      from the live TranscriptContext (the recording buffer). For past
//      meetings that buffer is empty, so the panel rendered zero rows.
//      We now render <VirtualizedTranscriptView> directly with the paginated
//      `segments` the page-level hook already loads from local SQLite.
//
//   2. Intelligence cards - the old code didn't render any. We now load
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

  // Past intelligence - loaded from the .NET Gateway for the meeting's events
  // and recommendations. Reconstructed into IntelligenceCards so the same
  // <IntelligencePanel> component renders them with identical styling.
  const [pastCards, setPastCards] = useState<ReturnType<typeof buildPastIntelligenceCards>>([]);
  const [cardsLoading, setCardsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'transcript' | 'summary'>('transcript');

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
    <div className="flex flex-col h-screen bg-[var(--grain-paper)]">
      {/* Header - breadcrumb + actions row + tab strip, Figma style. */}
      <header className="bg-white border-b border-[var(--hairline)]">
        <div className="flex items-center justify-between px-6 py-4">
          {/* Breadcrumb: Meetings (muted) > [title] (dark, medium). */}
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[14px] text-[var(--nav-muted-text)]">Meetings</span>
            <svg className="h-3 w-3 text-[var(--nav-muted-text)]" viewBox="0 0 16 16" fill="currentColor">
              <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z" />
            </svg>
            <h1 className="text-[14px] font-medium text-[var(--nav-active-text)] truncate">
              {meeting.title || 'Untitled session'}
            </h1>
          </div>

          {/* Right side - segment count + a single icon button. Figma has
             a row of 4 icons; we keep the count + a single share-like
             icon so the right side reads as a quiet utility rail. */}
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-[var(--nav-muted-text)]">
              {segmentCount} segment{segmentCount === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              onClick={() => router.push('/')}
              className="text-[12px] font-medium text-[var(--nav-inactive-text)] hover:text-[var(--nav-active-text)] transition-colors"
            >
              Back to live
            </button>
          </div>
        </div>

        {/* Tab strip - Summary / Transcript with bottom-border active indicator. */}
        <div className="flex px-6 border-t border-[var(--tab-divider)]">
          {(['summary', 'transcript'] as const).map((key) => {
            const isActive = activeTab === key;
            const label = key.charAt(0).toUpperCase() + key.slice(1);
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={`relative px-3 pt-3 pb-2.5 text-[14px] font-medium transition-colors ${
                  isActive
                    ? 'text-[var(--nav-active-text)]'
                    : 'text-[var(--nav-muted-text)] hover:text-[var(--nav-active-text)]'
                }`}
              >
                {label}
                {isActive && (
                  <span
                    aria-hidden
                    className="absolute left-0 right-0 bottom-0 h-[2px]"
                    style={{ backgroundColor: 'var(--tab-active-border)' }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        <div className="flex h-full">
          {/* Transcript column - fed by the page-level paginated hook, not
             by the empty live TranscriptContext. disableAutoScroll prevents
             the live-stream auto-scroll behaviour from fighting the user
             when they're just reading past content. */}
          <div className="custom-scrollbar flex-1 min-w-0 overflow-y-auto">
            <div className="max-w-3xl mx-auto p-6">
              <div className="bg-[var(--opaline-surface-container-lowest)] border border-[var(--opaline-outline-variant)] rounded-xl p-4">
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

          {/* Intelligence column - renders past events + recommendations as
             IntelligenceCards. Mirrors the home-page IntelligencePanel so the
             visual treatment is identical. Hidden on small screens to keep
             the transcript readable. The header is sticky so the section
             title stays visible while cards scroll beneath it; the content
             area scrolls independently (thin design-system scrollbar). */}
          <aside className="custom-scrollbar hidden xl:flex w-[360px] flex-col border-l border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-low)] overflow-y-auto">
            <div className="sticky top-0 z-10 flex items-baseline justify-between border-b border-[var(--opaline-outline-variant)]/60 bg-[var(--opaline-surface-container-low)] px-4 pt-4 pb-3">
              <h2 className="font-display text-label-md text-[var(--opaline-on-surface)]">Intelligence</h2>
              <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--opaline-on-surface-variant)]">
                {pastCards.length > 0 ? `${pastCards.length} card${pastCards.length === 1 ? '' : 's'}` : 'past'}
              </span>
            </div>
            <div className="flex-1 px-4 pb-10 pt-3">
              {cardsLoading ? (
                <div className="flex items-center justify-center py-8 text-xs text-[var(--opaline-on-surface-variant)]">
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
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
};

export default PageContent;