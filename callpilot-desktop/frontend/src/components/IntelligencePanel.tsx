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
  /** Current session ID — surfaced in the panel so the user can confirm the
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
  high: 'border-l-red-500',
  medium: 'border-l-yellow-500',
  low: 'border-l-blue-500',
};

/**
 * Visual state of the intelligence stream — drives both the empty-state card
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
    iconBg: 'bg-slate-100',
    iconColor: 'text-slate-500',
    pill: { dot: 'bg-slate-400', bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200', label: 'Start transcribing' },
    title: 'Start transcribing to open the intelligence stream',
    subtitle: 'Cards will appear here as soon as you start a recording and the call begins.',
  },
  opening: {
    icon: <Radio className="h-5 w-5 animate-pulse" />,
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-600',
    pill: { dot: 'bg-amber-500 animate-pulse', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', label: 'Opening stream' },
    title: 'Opening intelligence stream…',
    subtitle: 'Connecting to the CallPilot AI engine — usually takes a second.',
  },
  live: {
    icon: <Sparkles className="h-5 w-5" />,
    iconBg: 'bg-emerald-50',
    iconColor: 'text-emerald-600',
    pill: { dot: 'bg-emerald-500', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', label: 'Live' },
    title: 'Listening for intelligence',
    subtitle: 'Competitors, objections, and product matches will surface here as the conversation unfolds.',
  },
  offline: {
    icon: <WifiOff className="h-5 w-5" />,
    iconBg: 'bg-red-50',
    iconColor: 'text-red-600',
    pill: { dot: 'bg-red-500', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', label: 'Offline' },
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
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-7 text-center shadow-sm">
      <div
        className={`mx-auto flex h-11 w-11 items-center justify-center rounded-full ${iconBg}`}
      >
        <div className={iconColor}>{icon}</div>
      </div>
      <p className="mt-3 text-sm font-semibold text-gray-900">{title}</p>
      {subtitle && (
        <p className="mt-1 text-xs leading-relaxed text-gray-500">{subtitle}</p>
      )}
      <span
        className={`mt-3 inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[10px] font-medium border ${pill.bg} ${pill.text} ${pill.border}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${pill.dot}`} />
        {pill.label}
      </span>
      {sessionId && (
        <div className="mt-4 text-[10px] text-gray-400 font-mono break-all">
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
  const meta = TYPE_META[card.type] ?? { icon: <MessageCircle className="w-4 h-4" />, label: card.type };
  const hasChunks = card.chunks && card.chunks.length > 0;

  return (
    <div
      className={`bg-white rounded-md border border-gray-200 border-l-4 ${SEVERITY_BORDER[card.severity]} shadow-sm overflow-hidden`}
    >
      <div className="p-3">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-gray-500">
          <span className="text-gray-700">{meta.icon}</span>
          <span>{meta.label}</span>
          <span className="ml-auto text-[10px] font-semibold uppercase text-gray-400">{card.severity}</span>
        </div>
        <div className="mt-1 text-sm font-semibold text-gray-900">{card.title}</div>
        {card.body && <div className="mt-1 text-sm text-gray-700 whitespace-pre-wrap">{card.body}</div>}
        {hasChunks && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="mt-2 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
          >
            {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            View sources ({card.chunks.length})
          </button>
        )}
        {open && hasChunks && (
          <ul className="mt-2 space-y-2">
            {card.chunks.map((chunk, i) => (
              <li key={i} className="text-xs text-gray-600 border-l-2 border-gray-200 pl-2">
                {chunk}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};