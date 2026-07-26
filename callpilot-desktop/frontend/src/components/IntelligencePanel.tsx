'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle, MessageCircle, ThumbsUp, Package, DollarSign, HelpCircle } from 'lucide-react';
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
 * Small status pill that summarises the intelligence stream state.
 *
 * Three meaningful states:
 *   - "Start transcribing" — no session yet. The panel is dormant until the
 *     user clicks the mic. Tells the user *what action unlocks intelligence*.
 *   - "Opening stream" — a session exists but SignalR is still negotiating.
 *     Short-lived; surfaces the work being done without the dev-flavoured
 *     "Connecting" copy.
 *   - "Live" — connected; cards can arrive at any time.
 *
 * `error` short-circuits everything to a red "Offline" pill.
 */
const StatusPill: React.FC<{ connected: boolean; error: string | null; hasSession: boolean }> = ({
  connected,
  error,
  hasSession,
}) => {
  if (error) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700 border border-red-200">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
        Offline
      </span>
    );
  }
  if (connected) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 border border-emerald-200">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        Live
      </span>
    );
  }
  if (hasSession) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 border border-amber-200">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
        Opening stream
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600 border border-gray-200">
      <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
      Start transcribing
    </span>
  );
};

export const IntelligencePanel: React.FC<Props> = ({ cards, connected, error, sessionId }) => {
  const hasSession = Boolean(sessionId);

  if (error) {
    return (
      <div className="rounded-md border border-dashed border-gray-300 bg-white/60 p-4 text-sm text-gray-500">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-gray-700">Intelligence stream offline</span>
          <StatusPill connected={false} error={error} hasSession={hasSession} />
        </div>
        <div className="mt-1 text-xs">{error}. Check Settings → AI Engine URL.</div>
        {sessionId && (
          <div className="mt-2 text-[10px] text-gray-400 font-mono break-all">
            session: {sessionId}
          </div>
        )}
      </div>
    );
  }

  if (!cards.length) {
    // Three meaningful copy variants:
    //   1. No session yet   → "Start transcribing" (action prompt).
    //   2. Session, not yet connected → "Opening stream" (in-progress).
    //   3. Session, connected, no cards yet → "Live, listening" (reassurance).
    const headline = !hasSession
      ? 'Start transcribing to open the intelligence stream'
      : connected
        ? 'Live — listening for competitors, objections, and product matches'
        : 'Opening intelligence stream…';
    return (
      <div className="rounded-md border border-dashed border-gray-300 bg-white/60 p-4 text-sm text-gray-500">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-gray-700">{headline}</span>
          <StatusPill connected={connected} error={null} hasSession={hasSession} />
        </div>
        <div className="mt-1 text-xs">
          {!hasSession
            ? 'Cards appear here as soon as you start a recording and the call begins.'
            : connected
              ? 'Competitors, objections, and product matches will surface here as the conversation unfolds.'
              : 'Connecting to the CallPilot AI engine — this usually takes a second.'}
        </div>
        {sessionId && (
          <div className="mt-2 text-[10px] text-gray-400 font-mono break-all">
            session: {sessionId}
          </div>
        )}
      </div>
    );
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