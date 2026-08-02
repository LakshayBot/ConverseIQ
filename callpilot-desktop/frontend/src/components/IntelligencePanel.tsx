'use client';

import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  MessageCircle,
  ThumbsUp,
  Package,
  DollarSign,
  HelpCircle,
  Mic,
  Sparkles,
  Radio,
  WifiOff,
} from 'lucide-react';
import type { IntelligenceCard } from '@/lib/callpilotApi';

interface Props {
  cards: IntelligenceCard[];
  connected: boolean;
  error: string | null;
  /** Current session ID - surfaced in the panel so the user can confirm the
   *  active meeting at a glance. */
  sessionId?: string | null;
}

const TYPE_META: Record<IntelligenceCard['type'], { icon: React.ReactNode; label: string }> = {
  competitor_detected: { icon: <AlertTriangle className="w-4 h-4" />, label: 'Competitor' },
  objection:           { icon: <MessageCircle className="w-4 h-4" />, label: 'Objection' },
  buying_signal:       { icon: <ThumbsUp className="w-4 h-4" />, label: 'Buying signal' },
  product_match:       { icon: <Package className="w-4 h-4" />, label: 'Product match' },
  pricing_discussion:  { icon: <DollarSign className="w-4 h-4" />, label: 'Pricing' },
  technical_question:  { icon: <HelpCircle className="w-4 h-4" />, label: 'Technical' },
};

const SEVERITY_BORDER: Record<IntelligenceCard['severity'], string> = {
  high: 'border-l-[3px] border-l-[var(--intel-high)]',
  medium: 'border-l-2 border-l-[var(--intel-medium)]',
  low: 'border-l-2 border-l-[var(--intel-low)]',
};

const SEVERITY_ACCENT: Record<IntelligenceCard['severity'], string> = {
  high: 'text-[var(--intel-high)]',
  medium: 'text-[var(--intel-medium)]',
  low: 'text-[var(--intel-low)]',
};

const SEVERITY_DOT: Record<IntelligenceCard['severity'], string> = {
  high: 'bg-[var(--intel-high)]',
  medium: 'bg-[var(--intel-medium)]',
  low: 'bg-[var(--intel-low)]',
};

/**
 * Visual state of the intelligence stream - drives both the empty-state card
 * (icon, palette, copy) and the small pill in the top right. Centralising
 * the four states here keeps the two surfaces in sync.
 */
type StreamState = 'idle' | 'opening' | 'live' | 'offline';

interface StateMeta {
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  pill: { dot: string; bg: string; text: string; border: string; label: string };
  title: string;
  subtitle: string;
}

const STATE_META: Record<StreamState, StateMeta> = {
  idle: {
    icon: <Mic className="h-5 w-5" />,
    iconBg: 'bg-[var(--grain-paper-2)]',
    iconColor: 'text-[var(--grain-ink-500)]',
    pill: { dot: 'bg-[var(--grain-ink-300)]', bg: 'bg-[var(--grain-paper-2)]', text: 'text-[var(--grain-ink-700)]', border: 'border-[var(--grain-ink-200)]', label: 'Start recording' },
    title: 'Product information will appear here',
    subtitle: 'Cards will appear here as soon as you start a recording and the call begins.',
  },
  opening: {
    icon: <Radio className="h-5 w-5 animate-pulse" />,
    iconBg: 'bg-[var(--grain-paper-2)]',
    iconColor: 'text-[var(--grain-ink-500)]',
    pill: { dot: 'bg-[var(--grain-ink-500)] animate-pulse', bg: 'bg-[var(--grain-paper-2)]', text: 'text-[var(--grain-ink-700)]', border: 'border-[var(--grain-ink-200)]', label: 'Opening stream' },
    title: 'Opening intelligence stream…',
    subtitle: 'Connecting to the CallPilot AI engine - usually takes a second.',
  },
  live: {
    icon: <Sparkles className="h-5 w-5" />,
    iconBg: 'bg-[var(--grain-rep-soft)]',
    iconColor: 'text-[var(--grain-rep)]',
    pill: { dot: 'bg-[var(--grain-rep)]', bg: 'bg-[var(--grain-rep-soft)]', text: 'text-[var(--grain-rep)]', border: 'border-[var(--grain-rep-soft)]', label: 'Live' },
    title: 'Listening for intelligence',
    subtitle: 'Competitors, objections, and product matches will surface here as the conversation unfolds.',
  },
  offline: {
    icon: <WifiOff className="h-5 w-5" />,
    iconBg: 'bg-[var(--grain-paper-2)]',
    iconColor: 'text-[var(--grain-ink-500)]',
    pill: { dot: 'bg-[var(--grain-ink-300)]', bg: 'bg-[var(--grain-paper-2)]', text: 'text-[var(--grain-ink-500)]', border: 'border-[var(--grain-ink-200)]', label: 'Offline' },
    title: 'Intelligence stream offline',
    subtitle: '', // filled by caller (includes the engine error text)
  },
};

/**
 * Reimagined empty-state card: centred, polished, icon-led. The previous
 * dashed-border + inline-headline + side-pill layout wrapped the pill onto
 * two lines and read as unfinished. This card uses a soft surface, a clear
 * hierarchy (icon → title → subtitle → pill), and a whitespace-nowrap pill
 * that always renders on one line.
 */
const EmptyState: React.FC<{
  meta: StateMeta;
  sessionId?: string | null;
  subtitleOverride?: string;
}> = ({ meta, sessionId, subtitleOverride }) => {
  const { icon, iconBg, iconColor, pill, title } = meta;
  const subtitle = subtitleOverride ?? meta.subtitle;
  return (
    <div className="rounded-lg border-2 border-dashed border-[var(--hairline)] bg-[var(--grain-paper-2)] px-4 py-10 text-center min-h-[200px] flex flex-col items-center justify-center">
      <p className="text-sm font-medium text-[var(--nav-dim-text)]">{title}</p>
      {subtitle && (
        <p className="mt-1.5 text-xs leading-relaxed text-[var(--nav-dim-text)]/80 max-w-[280px]">{subtitle}</p>
      )}
      <span
        className={`mt-3 inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[10px] font-medium border ${pill.bg} ${pill.text} ${pill.border}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${pill.dot}`} />
        {pill.label}
      </span>
      {sessionId && (
        <div className="mt-4 text-[10px] text-[var(--grain-ink-500)] font-mono break-all">
          session: {sessionId}
        </div>
      )}
    </div>
  );
};

/**
 * Idle-state preview: instead of a large fixed-height empty panel, show a
 * compact low-opacity ghost of a real product card (type row + title bar +
 * placeholder lines + the state pill) so users know what to expect from the
 * rail before they ever start a call.
 */
const IdleGhostPreview: React.FC<{
  meta: StateMeta;
  sessionId?: string | null;
}> = ({ meta, sessionId }) => {
  const { pill } = meta;
  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] p-4 opacity-70" aria-hidden>
        {/* Type row - mirrors a live intelligence card header */}
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-[var(--opaline-on-surface-variant)]">
          <span className="text-[var(--opaline-on-surface-variant)]">{meta.icon}</span>
          <span>Product match</span>
          <span className="ml-auto text-[10px] font-semibold">-</span>
        </div>
        {/* Title bar */}
        <div className="mt-2 h-3 w-3/4 rounded-sm bg-[var(--opaline-surface-container-high)] animate-pulse" />
        {/* Placeholder lines */}
        <div className="mt-2.5 space-y-1.5">
          <div className="h-2 w-full rounded-sm bg-[var(--opaline-surface-container-high)]" />
          <div className="h-2 w-5/6 rounded-sm bg-[var(--opaline-surface-container-high)]" />
          <div className="h-2 w-2/3 rounded-sm bg-[var(--opaline-surface-container-high)]" />
        </div>
      </div>
      <p className="px-1 text-[11px] leading-relaxed text-[var(--grain-ink-500)]">
        Cards like this appear here the moment a competitor, objection, or
        product is mentioned during the call.
      </p>
      <span
        className={`ml-1 inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[10px] font-medium border ${pill.bg} ${pill.text} ${pill.border}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${pill.dot}`} />
        {pill.label}
      </span>
      {sessionId && (
        <div className="ml-1 text-[10px] text-[var(--grain-ink-500)] font-mono break-all">
          session: {sessionId}
        </div>
      )}
    </div>
  );
};

/**
 * Resolves the panel state from the props the page already tracks.
 *   error   → 'offline'
 *   connected → 'live'  (cards may still be empty until the first event)
 *   hasSession but not connected → 'opening'
 *   no session → 'idle'
 */
function resolveStreamState(connected: boolean, error: string | null, hasSession: boolean): StreamState {
  if (error) return 'offline';
  if (connected) return 'live';
  if (hasSession) return 'opening';
  return 'idle';
}

export const IntelligencePanel: React.FC<Props> = ({ cards, connected, error, sessionId }) => {
  const hasSession = Boolean(sessionId);

  if (!cards.length) {
    const state = resolveStreamState(connected, error, hasSession);
    const meta = STATE_META[state];
    if (state === 'idle') {
      return <IdleGhostPreview meta={meta} sessionId={sessionId} />;
    }
    // Offline gets the engine error message folded into the subtitle.
    const subtitleOverride =
      state === 'offline' && error
        ? `${error}. Check Settings → AI Engine URL.`
        : undefined;
    return <EmptyState meta={meta} sessionId={sessionId} subtitleOverride={subtitleOverride} />;
  }

  return (
    <div className="flex flex-col gap-2">
      {cards.map((card, i) => (
        <IntelligenceCardItem key={`${card.type}-${i}-${card.title}`} card={card} />
      ))}
    </div>
  );
};

const IntelligenceCardItem: React.FC<{ card: IntelligenceCard }> = ({ card }) => {
  const [open, setOpen] = useState(false);
  const meta = TYPE_META[card.type] ?? { icon: <MessageCircle className="h-4 w-4" strokeWidth={2} />, label: card.type };
  const hasChunks = card.chunks && card.chunks.length > 0;

  return (
    <div
      className={`rounded-xl border border-black/[0.06] bg-[var(--opaline-surface-container-lowest)] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.06)] overflow-hidden ${SEVERITY_BORDER[card.severity]}`}
    >
      <div className="p-4">
        {/* Label row — type badge (tinted pill) + priority badge (outline chip),
            each in the severity accent. */}
        <div className="flex items-center justify-between gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full bg-[var(--intel-type-bg)] px-2.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] ${SEVERITY_ACCENT[card.severity]}`}
          >
            {meta.icon}
            {meta.label}
          </span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] px-2.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.1em] ${SEVERITY_ACCENT[card.severity]}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${SEVERITY_DOT[card.severity]}`} aria-hidden />
            {card.severity}
          </span>
        </div>

        {/* Title — largest text in the card, heaviest weight. */}
        <div className="mt-2 text-[15px] font-bold leading-snug text-[var(--opaline-on-surface)]">
          {card.title}
        </div>

        {/* Body — medium weight, muted, comfortable leading. */}
        {card.body && (
          <div className="mt-1.5 text-[13px] leading-[1.5] whitespace-pre-wrap text-[var(--opaline-on-surface-variant)]">
            {card.body}
          </div>
        )}

        {/* Footer — hairline divider, smallest muted type. */}
        {hasChunks && (
          <div className="mt-3 border-t border-black/[0.06] pt-2.5">
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="inline-flex items-center gap-1 font-mono text-[11px] text-[var(--opaline-on-surface-variant)] transition-colors hover:text-[var(--opaline-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--opaline-primary)]"
            >
              {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              View sources ({card.chunks.length})
            </button>
            {open && (
              <ul className="mt-2 space-y-2">
                {card.chunks.map((chunk, i) => (
                  <li key={i} className="text-xs text-[var(--opaline-on-surface-variant)] border-l-2 border-[var(--opaline-outline-variant)] pl-2">
                    {chunk}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
};