'use client';

// VirtualizedTranscriptView - live + historical transcript feed.
//
// Court-reporter visual language: dense, calm, focused. The signature
// element is a 3px-wide left-edge bar on the active (most-recent) row,
// plus a breathing caret that follows the in-flight partial.
//
// Detected PRODUCT entities (from the Intelligence rail) are highlighted
// wherever they appear in the text - passive tint by default, solid
// accent when that occurrence is the active one. The transcript and the
// Intelligence rail share one selection (IntelligenceSelectionContext):
// clicking a rail product scrolls to its latest mention; clicking a
// mention selects the product in the rail.
//
// Performance:
//   - Occurrences are precomputed per (segments, products) change in
//     transcriptEntities.ts - never searched per render.
//   - The row component is React.memo; only rows whose parts/active
//     state changed re-paint.

import {
  useCallback,
  useRef,
  useReducer,
  startTransition,
  useEffect,
  useMemo,
  useState,
  memo,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useReducedMotion } from 'framer-motion';
import { useAutoScroll } from '@/hooks/useAutoScroll';
import { ConfidenceIndicator } from './ConfidenceIndicator';
import { SpeakerDot } from './SpeakerDot';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { RecordingStatusBar } from './RecordingStatusBar';
import { TranscriptSegmentData } from '@/types';
import { useIntelligenceSelection } from '@/contexts/IntelligenceSelectionContext';
import {
  buildTranscriptEntityMap,
  splitTextByOccurrences,
  type TextPart,
  type TranscriptEntityOccurrence,
} from '@/lib/transcriptEntities';
import { cn } from '@/lib/utils';

// Threshold for enabling virtualization (below this, use simple rendering)
const VIRTUALIZATION_THRESHOLD = 10;

const BRAND_GRADIENT =
  'linear-gradient(180deg, var(--opaline-primary) 0%, var(--opaline-primary-hover) 100%)';

// ──────────────────────────────────────────────────────────────────────────────
// Format + display helpers
// ──────────────────────────────────────────────────────────────────────────────

/** Recording-relative time as MM:SS. No brackets - the timestamp is its own
 *  monospace column, brackets would compete with the text. */
function formatRecordingTime(seconds: number | undefined): string {
  if (seconds === undefined) return '--:--';
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/** Soft-filler cleanup ("uh", "um") so the feed reads cleanly. Final
 *  segment text only - partials stay verbatim. */
function cleanStopWords(text: string): string {
  return text
    .replace(/\b(uh|um|er|ah|hmm|hm|eh|oh)[,\s]*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The exact text the row renders - entity occurrences are computed on
 *  this, so offsets always align with what the user sees. */
export function transcriptDisplayText(segment: TranscriptSegmentData): string {
  const text = segment.text ?? '';
  if (segment.is_partial) return text || '…';
  return cleanStopWords(text) || (text.trim() === '' ? '[Silence]' : text);
}

// ──────────────────────────────────────────────────────────────────────────────
// Entity highlight - inline button span inside the transcript text.
// ──────────────────────────────────────────────────────────────────────────────

const EntityHighlight = memo(function EntityHighlight({
  part,
  active,
  onEntityClick,
}: {
  part: TextPart;
  active: boolean;
  onEntityClick: (occ: TranscriptEntityOccurrence) => void;
}) {
  const occ = part.occurrence!;
  return (
    <button
      type="button"
      onClick={() => onEntityClick(occ)}
      aria-label={`Product mention: ${occ.entityName}${occ.timestamp >= 0 ? ` at ${formatRecordingTime(occ.timestamp)}` : ''}`}
      className={cn(
        'mx-[1px] inline cursor-pointer rounded-[3px] px-[3px] transition-colors duration-fast focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--opaline-primary)] focus-visible:ring-offset-1 [font:inherit] [line-height:inherit] [text-align:inherit]',
        active
          ? 'bg-[var(--opaline-primary)] text-[var(--opaline-on-primary)] underline decoration-[var(--opaline-on-primary)]/50 decoration-1 underline-offset-2'
          : 'bg-[var(--opaline-primary-soft)] text-[var(--opaline-on-surface)] hover:bg-[var(--opaline-tone-12)]',
      )}
    >
      {part.text}
    </button>
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// Row component
// ──────────────────────────────────────────────────────────────────────────────

interface TranscriptRowProps {
  id: string;
  timestamp: number | undefined;
  parts: TextPart[];
  confidence?: number;
  isPartial: boolean;
  isActive: boolean;
  hasEntityActive: boolean;
  activeOccurrenceKey: string | null;
  showConfidence: boolean;
  audioSource?: 'mic' | 'system' | 'unknown';
  speakerLabel?: string;
  onEntityClick: (occ: TranscriptEntityOccurrence) => void;
}

const activeKeyOf = (occ: TranscriptEntityOccurrence) => `${occ.segmentId}:${occ.startOffset}`;

const TranscriptRow = memo(function TranscriptRow({
  id,
  timestamp,
  parts,
  confidence,
  isPartial,
  isActive,
  hasEntityActive,
  activeOccurrenceKey,
  showConfidence,
  audioSource,
  speakerLabel,
  onEntityClick,
}: TranscriptRowProps) {
  const speakerSource: 'mic' | 'system' | 'unknown' | undefined = audioSource;

  // Figma dialogue layout: 24px speaker circle on the left, a column
  // (timestamp on top, body text below) on the right.
  const circleSize = isPartial ? 20 : 24;

  // Text style:
  //   - final:    sans-serif, --body-text, regular, 14px
  //   - partial:  monospace, --nav-muted-text, italic, 13px (transient)
  const textClass = isPartial
    ? 'font-mono italic text-[13px] text-[var(--nav-muted-text)] leading-[22.75px]'
    : 'text-[14px] text-[var(--body-text)] leading-[22.75px]';

  return (
    <div
      id={`segment-${id}`}
      className={cn(
        'relative pl-3 pr-1 py-1.5 rounded-md transition-colors duration-fast',
        hasEntityActive
          ? 'bg-[var(--opaline-tone-4)]'
          : isActive
            ? 'bg-[var(--opaline-surface-container-low)]'
            : '',
      )}
    >
      {(isActive || hasEntityActive) && (
        <span
          aria-hidden
          className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full"
          style={{ background: hasEntityActive ? 'var(--opaline-primary)' : BRAND_GRADIENT }}
        />
      )}
      <div className="flex items-start gap-3">
        {/* Speaker circle */}
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

        {/* Column - speaker label + timestamp on top, body text below. */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {speakerLabel && (
              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-low)] px-1.5 py-px text-[10px] font-medium tracking-wide text-[var(--opaline-on-surface-variant)]">
                <span aria-hidden className="h-1 w-1 rounded-full bg-[var(--opaline-primary)]" />
                {speakerLabel}
              </span>
            )}
            <div className="font-mono text-[12px] text-[var(--nav-muted-text)] tabular-nums">
              {formatRecordingTime(timestamp)}
            </div>
          </div>
          <p className={`min-w-0 ${textClass}`}>
            {parts.map((part, i) =>
              part.occurrence ? (
                <EntityHighlight
                  key={`${part.occurrence.segmentId}:${part.occurrence.startOffset}`}
                  part={part}
                  active={activeKeyOf(part.occurrence) === activeOccurrenceKey}
                  onEntityClick={onEntityClick}
                />
              ) : (
                <span key={i}>{part.text}</span>
              ),
            )}
            {/* Live caret - breathes on the active partial row. */}
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
  /** Detected product entity names - highlighted wherever they appear. */
  products?: string[];
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
  products = [],
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadMoreTriggerRef = useRef<HTMLDivElement>(null);
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const reduceMotion = useReducedMotion();
  const { selectedId, lastSource, select } = useIntelligenceSelection();

  // ── Entity occurrence map - precomputed, never searched per render ──
  const entityMap = useMemo(
    () => buildTranscriptEntityMap(segments, products, transcriptDisplayText),
    [segments, products],
  );

  const partsBySegment = useMemo(() => {
    const map = new Map<string, TextPart[]>();
    for (const seg of segments) {
      const occs = entityMap.bySegmentId.get(seg.id);
      if (occs && occs.length > 0) {
        map.set(seg.id, splitTextByOccurrences(transcriptDisplayText(seg), occs));
      }
    }
    return map;
  }, [segments, entityMap]);

  // ── Active occurrence - set by rail selection (scrolls) or by a
  //    transcript click (already in view). ─────────────────────────────
  const [activeOccurrenceKey, setActiveOccurrenceKey] = useState<string | null>(null);

  const findLatest = useCallback(
    (id: string): TranscriptEntityOccurrence | undefined => {
      const key = id.toLowerCase();
      for (const [name, occ] of entityMap.latestByEntityName) {
        if (name.toLowerCase() === key) return occ;
      }
      return undefined;
    },
    [entityMap],
  );

  useEffect(() => {
    if (!selectedId || lastSource !== 'rail') return;
    const latest = findLatest(selectedId);
    if (!latest) return;
    setActiveOccurrenceKey(activeKeyOf(latest));
    if (segments.length >= VIRTUALIZATION_THRESHOLD) {
      virtualizer.scrollToIndex(latest.segmentIndex, { align: 'center' });
    } else {
      requestAnimationFrame(() => {
        document
          .getElementById(`segment-${latest.segmentId}`)
          ?.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, lastSource, findLatest, segments.length, reduceMotion]);

  const handleEntityClick = useCallback(
    (occ: TranscriptEntityOccurrence) => {
      setActiveOccurrenceKey(activeKeyOf(occ));
      select(occ.entityName, 'transcript');
    },
    [select],
  );

  // Dynamic measurement so partial rows and final rows don't fight the
  // fixed estimate.
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

  // The "active" row is the most-recent segment - it gets the pulsing
  // left-edge bar + caret. Reference equality on the last segment.
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
    (segment: TranscriptSegmentData, index: number, isActive: boolean) => {
      const parts = partsBySegment.get(segment.id);
      const hasEntityActive = parts?.some(
        (p) => p.occurrence && activeKeyOf(p.occurrence) === activeOccurrenceKey,
      );
      return (
        <TranscriptRow
          key={segment.id}
          id={segment.id}
          timestamp={segment.timestamp}
          parts={parts ?? [{ text: transcriptDisplayText(segment) }]}
          confidence={segment.confidence}
          isPartial={segment.is_partial ?? false}
          isActive={isActive}
          hasEntityActive={!!hasEntityActive}
          activeOccurrenceKey={activeOccurrenceKey}
          showConfidence={showConfidence}
          audioSource={segment.audioSource as 'mic' | 'system' | 'unknown' | undefined}
          speakerLabel={segment.speakerLabel}
          onEntityClick={handleEntityClick}
        />
      );
    },
    [partsBySegment, activeOccurrenceKey, handleEntityClick, showConfidence],
  );

  // Streaming flag is intentionally ignored now - the typewriter was the
  // bottleneck. The prop is kept for API compat.
  void enableStreaming;

  // RecordingStatusBar must only render during an active session.
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
