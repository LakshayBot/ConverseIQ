'use client';

// VirtualizedTranscriptView — live transcript feed.
//
// Reference for the visual language: a court-reporter's live feed / broadcast
// subtitles. Dense, calm, focused. The signature element is a 3px-wide
// left-edge bar in the brand gradient on the active (most-recent) row, plus
// a soft 1ch-wide breathing caret that follows the in-flight partial. They
// both communicate "things are happening right now" without ever demanding
// attention.
//
// Tokens (in addition to the existing app palette):
//   --ink-900  #0f172a   final transcript text
//   --ink-500  #64748b   partial (in-progress) text
//   --ink-300  #cbd5e1   timestamps, dividers
//   --rep      #10b981   REP speaker chip
//   --prospect #0ea5e9   PROSPECT speaker chip
//   brand gradient (blue→indigo→violet) — the "now" indicator
//
// Performance:
//   - Virtualizer uses dynamic measurement so row heights match real content
//     (partials are typically one line, finals can be two).
//   - Overscan dropped from 10 → 5 (still smooth, less re-render work).
//   - The text-row component is React.memo so re-renders only re-paint
//     the row whose data actually changed.

import { useCallback, useRef, useReducer, startTransition, useEffect, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useAutoScroll } from '@/hooks/useAutoScroll';
import { ConfidenceIndicator } from './ConfidenceIndicator';
import { SpeakerDot } from './SpeakerDot';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { RecordingStatusBar } from './RecordingStatusBar';
import { TranscriptSegmentData } from '@/types';

// Threshold for enabling virtualization (below this, use simple rendering)
const VIRTUALIZATION_THRESHOLD = 10;

const BRAND_GRADIENT = 'linear-gradient(180deg, #3b82f6 0%, #6366f1 50%, #8b5cf6 100%)';

// ──────────────────────────────────────────────────────────────────────────────
// Format helpers
// ──────────────────────────────────────────────────────────────────────────────

/** Recording-relative time as MM:SS. No brackets — the timestamp is its own
 *  monospace column, brackets would compete with the text. */
function formatRecordingTime(seconds: number | undefined): string {
  if (seconds === undefined) return '--:--';
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/** Soft-filler cleanup ("uh", "um") so the live feed reads cleanly. Final
 *  segment text only — partials stay verbatim so the user sees the current
 *  utterance as it is. */
function cleanStopWords(text: string): string {
  return text
    .replace(/\b(uh|um|er|ah|hmm|hm|eh|oh)[,\s]*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ──────────────────────────────────────────────────────────────────────────────
// Row component
// ──────────────────────────────────────────────────────────────────────────────

interface TranscriptRowProps {
  id: string;
  timestamp: number | undefined;
  text: string;
  confidence?: number;
  isPartial: boolean;
  isActive: boolean;
  showConfidence: boolean;
  audioSource?: 'mic' | 'system' | 'unknown';
}

const TranscriptRow = memo(function TranscriptRow({
  id,
  timestamp,
  text,
  confidence,
  isPartial,
  isActive,
  showConfidence,
  audioSource,
}: TranscriptRowProps) {
  const isFinal = !isPartial;
  // Final text gets filler cleanup; partial text stays verbatim so the
  // speaker's mid-thought phrasing reads true.
  const displayText = isFinal
    ? cleanStopWords(text) || (text.trim() === '' ? '[Silence]' : text)
    : text || (isPartial ? '…' : '[Silence]');

  const speakerSource: 'mic' | 'system' | 'unknown' | undefined = audioSource;

  // Figma dialogue layout: 24px speaker circle on the left, a column
  // (timestamp on top, body text below) on the right. 12px gap between
  // the circle and the column, 24px gap between consecutive turns.
  const circleSize = isPartial ? 20 : 24;

  // Text style:
  //   - final:    sans-serif, --body-text, regular, 14px (Figma's body color)
  //   - partial:  monospace, --nav-muted-text, italic, 13px (signals "transient")
  const textClass = isPartial
    ? 'font-mono italic text-[13px] text-[var(--nav-muted-text)] leading-[22.75px]'
    : 'text-[14px] text-[var(--body-text)] leading-[22.75px]';

  return (
    <div
      id={`segment-${id}`}
      className={`relative pl-3 pr-1 py-1.5 rounded-md transition-colors duration-150 ${
        isActive ? 'bg-[var(--opaline-surface-container-low)]' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Speaker circle — 24px (or 20px while partial). Figma's saturated
            green (REP) / purple (PROSPECT). */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="flex-shrink-0 rounded-full mt-[2px]"
              style={{
                width: circleSize,
                height: circleSize,
                backgroundColor:
                  speakerSource === 'system'
                    ? 'var(--prospect-circle)'
                    : speakerSource === 'mic'
                      ? 'var(--rep-circle)'
                      : 'var(--nav-dim-text)',
              }}
              aria-label={
                speakerSource === 'mic'
                  ? 'REP'
                  : speakerSource === 'system'
                    ? 'PROSPECT'
                    : undefined
              }
            />
          </TooltipTrigger>
          <TooltipContent>
            {confidence !== undefined && showConfidence && (
              <ConfidenceIndicator confidence={confidence} showIndicator={showConfidence} />
            )}
          </TooltipContent>
        </Tooltip>

        {/* Column — timestamp on top, body text below. */}
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[12px] text-[var(--nav-muted-text)] tabular-nums">
            {formatRecordingTime(timestamp)}
          </div>
          <p className={`min-w-0 ${textClass}`}>
            {displayText}
            {/* Live caret — breathes on the active partial row. */}
            {isPartial && isActive && (
              <span
                aria-hidden
                className="live-caret ml-px inline-block align-baseline"
              />
            )}
          </p>
        </div>
      </div>
    </div>
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// Main view
// ──────────────────────────────────────────────────────────────────────────────

export const VirtualizedTranscriptView: React.FC<{
  segments: TranscriptSegmentData[];
  isRecording?: boolean;
  isPaused?: boolean;
  isProcessing?: boolean;
  isStopping?: boolean;
  enableStreaming?: boolean;
  showConfidence?: boolean;
  disableAutoScroll?: boolean;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  totalCount?: number;
  loadedCount?: number;
  onLoadMore?: () => void;
}> = ({
  segments,
  isRecording = false,
  isPaused = false,
  isProcessing = false,
  isStopping = false,
  enableStreaming = false,
  showConfidence = true,
  disableAutoScroll = false,
  hasMore = false,
  isLoadingMore = false,
  totalCount = 0,
  loadedCount = 0,
  onLoadMore,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadMoreTriggerRef = useRef<HTMLDivElement>(null);
  const [, rerender] = useReducer((x: number) => x + 1, 0);

  // Dynamic measurement so partial rows (single line) and final rows
  // (often wrap to two) don't fight the fixed estimate. estimateSize is
  // a fallback for the first render before measurement is available.
  const virtualizer = useVirtualizer({
    count: segments.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 36,
    overscan: 5,
    measureElement: (el) => el.getBoundingClientRect().height,
    onChange: () => {
      startTransition(() => {
        rerender();
      });
    },
  });

  useAutoScroll({
    scrollRef,
    segments,
    isRecording,
    isPaused,
    virtualizer,
    virtualizationThreshold: VIRTUALIZATION_THRESHOLD,
    disableAutoScroll,
  });

  // The "active" row is the most-recent segment — it's the one that gets the
  // pulsing left-edge bar + caret. Reference equality on the last segment.
  const lastIndex = segments.length - 1;
  const lastSegment = lastIndex >= 0 ? segments[lastIndex] : null;

  // Infinite scroll trigger.
  useEffect(() => {
    if (!onLoadMore || !hasMore || isLoadingMore || isRecording || segments.length === 0) {
      return;
    }
    const triggerElement = loadMoreTriggerRef.current;
    if (!triggerElement) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
          onLoadMore();
        }
      },
      { root: null, rootMargin: '100px', threshold: 0 }
    );
    observer.observe(triggerElement);

    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, onLoadMore, isRecording, segments.length]);

  const renderItem = useCallback(
    (segment: TranscriptSegmentData, index: number, isActive: boolean) => (
      <TranscriptRow
        key={segment.id}
        id={segment.id}
        timestamp={segment.timestamp}
        text={segment.text}
        confidence={segment.confidence}
        isPartial={segment.is_partial ?? false}
        isActive={isActive}
        showConfidence={showConfidence}
        audioSource={segment.audioSource as 'mic' | 'system' | 'unknown' | undefined}
      />
    ),
    [showConfidence]
  );

  // Streaming flag is intentionally ignored now — the typewriter was the
  // bottleneck. The prop is kept for API compat (callers don't need to
  // change) but no animation runs.
  void enableStreaming;

  // RecordingStatusBar must only render during an active session. It reads
  // `isRecording` from RecordingStateContext internally, so without this
  // gate the bar would show "Recording • 0:00" on every idle page-load.
  const showStatusBar = isRecording || isPaused || isProcessing || isStopping;

  if (segments.length < VIRTUALIZATION_THRESHOLD) {
    return (
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto transcript-scroll p-6"
      >
        <div className="max-w-3xl mx-auto flex flex-col gap-6">
          {segments.map((segment, index) =>
            renderItem(segment, index, segment === lastSegment)
          )}
        </div>
        <div ref={loadMoreTriggerRef} />
        {showStatusBar && <RecordingStatusBar isPaused={isPaused} />}
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto transcript-scroll p-6"
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const segment = segments[virtualRow.index];
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {renderItem(segment, virtualRow.index, virtualRow.index === lastIndex)}
            </div>
          );
        })}
      </div>
      <div ref={loadMoreTriggerRef} />
      {showStatusBar && <RecordingStatusBar isPaused={isPaused} />}
    </div>
  );
};