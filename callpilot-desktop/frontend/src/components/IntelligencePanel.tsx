'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle, MessageCircle, ThumbsUp, Package, DollarSign, HelpCircle, Bug } from 'lucide-react';
import type { IntelligenceCard } from '@/lib/callpilotApi';

interface Props {
  cards: IntelligenceCard[];
  connected: boolean;
  error: string | null;
  /** Current session ID — surfaced in the panel header so the user can see
   *  whether one is active (and what to paste into DevTools if debugging). */
  sessionId?: string | null;
  /** Resolved WS URL — used in the debug strip so we can verify the URL the
   *  hook actually opened against matches what the engine expects. */
  wsUrl?: string | null;
  /** WebSocket readyState (0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED).
   *  Lets the user distinguish "stuck before connect" from "connected but
   *  no cards yet" without opening DevTools. */
  wsReadyState?: number | null;
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

// Map WebSocket.readyState codes to human-readable labels. Surfaced in the
// debug strip so the user can see *which* state the socket is stuck in.
const READY_STATE_LABEL: Record<number, string> = {
  0: 'CONNECTING',
  1: 'OPEN',
  2: 'CLOSING',
  3: 'CLOSED',
};

const DebugStrip: React.FC<{
  sessionId: string | null | undefined;
  connected: boolean;
  error: string | null;
  wsUrl: string | null | undefined;
  wsReadyState: number | null | undefined;
}> = ({ sessionId, connected, error, wsUrl, wsReadyState }) => {
  const readyLabel = wsReadyState != null ? READY_STATE_LABEL[wsReadyState] ?? `STATE(${wsReadyState})` : 'n/a';
  return (
    <details className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] font-mono text-gray-700">
      <summary className="flex items-center gap-1 cursor-pointer select-none text-gray-600">
        <Bug className="w-3 h-3" />
        <span>Intelligence WS debug</span>
        <span className="ml-auto text-gray-400">{readyLabel}</span>
      </summary>
      <dl className="mt-2 grid grid-cols-[110px_1fr] gap-x-2 gap-y-1">
        <dt className="text-gray-500">sessionId</dt>
        <dd className="break-all">{sessionId ?? 'null'}</dd>
        <dt className="text-gray-500">wsUrl</dt>
        <dd className="break-all">{wsUrl ?? 'n/a'}</dd>
        <dt className="text-gray-500">readyState</dt>
        <dd>{wsReadyState ?? 'n/a'} ({readyLabel})</dd>
        <dt className="text-gray-500">connected</dt>
        <dd>{String(connected)}</dd>
        <dt className="text-gray-500">error</dt>
        <dd>{error ?? 'null'}</dd>
      </dl>
    </details>
  );
};

export const IntelligencePanel: React.FC<Props> = ({ cards, connected, error, sessionId, wsUrl, wsReadyState }) => {
  // Small status pill that shows WS connection state + the active session id.
  // Critical for debugging — without this the user can't tell whether the WS
  // is even being opened (the empty state below all reads "Connecting…" or
  // "Waiting for intelligence…" depending on connected).
  const statusBadge = (() => {
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
          Connected
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600 border border-gray-200">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse" />
        Connecting
      </span>
    );
  })();
  if (error) {
    return (
      <div className="rounded-md border border-dashed border-gray-300 bg-white/60 p-4 text-sm text-gray-500">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-gray-700">Intelligence stream offline</span>
          {statusBadge}
        </div>
        <div className="mt-1 text-xs">{error}. Check Settings → AI Engine URL.</div>
        {sessionId && (
          <div className="mt-2 text-[10px] text-gray-400 font-mono break-all">
            session: {sessionId}
          </div>
        )}
        <DebugStrip
          sessionId={sessionId}
          connected={connected}
          error={error}
          wsUrl={wsUrl}
          wsReadyState={wsReadyState}
        />
      </div>
    );
  }

  if (!cards.length) {
    return (
      <div className="rounded-md border border-dashed border-gray-300 bg-white/60 p-4 text-sm text-gray-500">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-gray-700">
            {connected ? 'Connected — waiting for intelligence…' : 'Waiting for intelligence…'}
          </span>
          {statusBadge}
        </div>
        <div className="mt-1 text-xs">
          {connected
            ? 'Competitors, objections, and product matches will surface here as the conversation unfolds.'
            : sessionId
              ? 'Connecting to CallPilot AI engine…'
              : 'Start a recording to open the intelligence stream.'}
        </div>
        {sessionId && (
          <div className="mt-2 text-[10px] text-gray-400 font-mono break-all">
            session: {sessionId}
          </div>
        )}
        <DebugStrip
          sessionId={sessionId}
          connected={connected}
          error={error}
          wsUrl={wsUrl}
          wsReadyState={wsReadyState}
        />
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
