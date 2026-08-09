'use client';

// IntelligencePanel - the stateful surface of the right Intelligence rail.
//
// Three presentation contexts, derived from real application state (see
// `mode`): live (active recording), history (reading a past meeting) and
// idle (nothing loaded). When signals exist, the panel renders the
// two-region IntelligenceWorkspace (detail + horizontal carousel); the
// empty surfaces below are calm, mode-appropriate, and never imply live
// listening on historical screens.

import React from 'react';
import {
  AlertTriangle,
  MessageCircle,
  Package,
  DollarSign,
  HelpCircle,
  Mic,
  Sparkles,
  Radio,
  WifiOff,
} from 'lucide-react';
import type { IntelligenceCard } from '@/lib/callpilotApi';
import { IntelligenceWorkspace } from '@/components/IntelligenceWorkspace';

interface Props {
  cards: IntelligenceCard[];
  connected: boolean;
  error: string | null;
  /** Current session ID - surfaced in the panel so the user can confirm the
   *  active meeting at a glance. */
  sessionId?: string | null;
  /** Presentation context, derived from real application state:
   *   - "live"    → an active recording is streaming signals (listening/
   *                 detecting states allowed)
   *   - "history" → the user is reading a past meeting (calm, read-only -
   *                 never "listening")
   *   - "idle"    → no active session at all
   *  Defaults to the legacy connected/sessionId resolution when omitted. */
  mode?: 'live' | 'history' | 'idle';
  /** Transcript occurrences per product (lowercased entity name → mentions),
   *  forwarded to the workspace for the product profile's meeting context. */
  productMentions?: Record<string, import('@/components/ProductIntelligenceCard').ProductMention[]>;
}

/** The signal types, in reading order - used in the idle state so the
 *  rail teaches what it will surface before a call ever starts. */
const SIGNAL_TYPES: Array<{ key: IntelligenceCard['type']; label: string; icon: React.ReactNode }> = [
  { key: 'competitor_detected', label: 'Competitor', icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  { key: 'objection', label: 'Objection', icon: <MessageCircle className="h-3.5 w-3.5" /> },
  { key: 'pricing_discussion', label: 'Pricing', icon: <DollarSign className="h-3.5 w-3.5" /> },
  { key: 'product_match', label: 'Product match', icon: <Package className="h-3.5 w-3.5" /> },
  { key: 'technical_question', label: 'Technical', icon: <HelpCircle className="h-3.5 w-3.5" /> },
];

/**
 * Visual state of the intelligence stream - drives the empty-state surface
 * (icon, palette, copy).
 */
type StreamState = 'idle' | 'opening' | 'live' | 'offline';

/**
 * The idle surface: a composed taxonomy preview, not a fake card skeleton.
 * Shows what the rail detects, so the first call feels familiar.
 */
const IdleTaxonomyPreview: React.FC<{ sessionId?: string | null }> = ({ sessionId }) => (
  <div className="flex flex-col gap-5 pt-2">
    <div className="flex flex-col items-center gap-2.5 rounded-xl border border-dashed border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-low)]/60 px-4 py-7 text-center">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--opaline-surface-container-lowest)] text-[var(--opaline-on-surface-variant)] shadow-xs">
        <Sparkles className="h-4 w-4" strokeWidth={1.75} />
      </span>
      <div>
        <p className="text-body-md font-medium text-[var(--opaline-on-surface)]">
          Signal feed
        </p>
        <p className="mt-1 text-caption leading-relaxed">
          Detected moments appear here the moment they&apos;re spoken —
          no call summary to wait for.
        </p>
      </div>
    </div>
    <div>
      <p className="text-overline mb-2 px-1">Detects</p>
      <ul className="flex flex-col gap-0.5">
        {SIGNAL_TYPES.map((s) => (
          <li key={s.key}>
            <span className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] font-medium text-[var(--opaline-on-surface-variant)]">
              <span className="text-[var(--opaline-outline)]">{s.icon}</span>
              {s.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
    {sessionId && (
      <p className="px-1 text-data break-all text-[var(--opaline-outline)]">
        session: {sessionId}
      </p>
    )}
  </div>
);

/** Listening surface - alive but quiet: an equalizer breathes. */
const ListeningState: React.FC<{ sessionId?: string | null }> = ({ sessionId }) => (
  <div className="flex flex-col items-center gap-3 rounded-xl border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-low)]/60 px-4 py-8 text-center">
    <div className="flex h-6 items-center gap-[3px]" aria-hidden>
      <span className="eq-bar h-full w-[3px] rounded-full bg-[var(--opaline-primary)]" style={{ animationDelay: '0ms' }} />
      <span className="eq-bar h-full w-[3px] rounded-full bg-[var(--opaline-primary)]" style={{ animationDelay: '160ms' }} />
      <span className="eq-bar h-full w-[3px] rounded-full bg-[var(--opaline-primary)]" style={{ animationDelay: '320ms' }} />
      <span className="eq-bar h-full w-[3px] rounded-full bg-[var(--opaline-primary)]" style={{ animationDelay: '80ms' }} />
      <span className="eq-bar h-full w-[3px] rounded-full bg-[var(--opaline-primary)]" style={{ animationDelay: '240ms' }} />
    </div>
    <div>
      <p className="text-body-md font-medium text-[var(--opaline-on-surface)]">
        Listening for signals
      </p>
      <p className="mt-1 text-caption leading-relaxed">
        Competitors, objections, pricing, and product matches will land here
        as the conversation unfolds.
      </p>
    </div>
    {sessionId && (
      <p className="text-data break-all text-[var(--opaline-outline)]">
        session: {sessionId}
      </p>
    )}
  </div>
);

/** Opening surface - the stream is connecting. */
const OpeningState: React.FC = () => (
  <div className="flex flex-col items-center gap-3 rounded-xl border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-low)]/60 px-4 py-8 text-center">
    <span className="status-pill status-pill--spin">
      <span className="pill-dot" aria-hidden />
      Connecting stream
    </span>
    <p className="text-caption leading-relaxed">
      Linking the session to the CallPilot engine — usually a second.
    </p>
  </div>
);

/**
 * Historical empty state - calm and archival. A past meeting must never
 * imply an active microphone, so there is no equalizer, no pulse, and no
 * "listening" language - just a quiet note that nothing was recorded.
 */
const HistoricalEmptyState: React.FC = () => (
  <div className="flex flex-col items-center gap-2.5 rounded-xl border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-low)]/60 px-4 py-8 text-center">
    <p className="text-body-md font-medium text-[var(--opaline-on-surface)]">
      No signals detected
    </p>
    <p className="max-w-[240px] text-caption leading-relaxed">
      No notable intelligence signals were recorded for this meeting.
    </p>
  </div>
);

/** Offline surface - stream error. */
const OfflineState: React.FC<{ message?: string }> = ({ message }) => (
  <div className="flex flex-col items-center gap-3 rounded-xl border border-[var(--opaline-danger-border)] bg-[var(--opaline-danger-soft)]/60 px-4 py-8 text-center">
    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--opaline-surface-container-lowest)] text-danger shadow-xs">
      <WifiOff className="h-4 w-4" strokeWidth={1.75} />
    </span>
    <div>
      <p className="text-body-md font-medium text-danger">Intelligence offline</p>
      <p className="mt-1 text-caption leading-relaxed">
        {message ?? 'The stream disconnected. Check the server and try again.'}
      </p>
    </div>
  </div>
);

function resolveStreamState(connected: boolean, error: string | null, hasSession: boolean): StreamState {
  if (error) return 'offline';
  if (connected) return 'live';
  if (hasSession) return 'opening';
  return 'idle';
}

export const IntelligencePanel: React.FC<Props> = ({
  cards,
  connected,
  error,
  sessionId,
  mode,
  productMentions,
}) => {
  const hasSession = Boolean(sessionId);

  // Live + history both render the two-region workspace when signals
  // exist - the workspace itself is mode-aware (carousel labels, "new"
  // dots, no live language in history).
  if (mode === 'live' || mode === 'history') {
    if (cards.length === 0) {
      if (mode === 'history') return <HistoricalEmptyState />;
      const state = resolveStreamState(connected, error, hasSession);
      if (state === 'idle') return <IdleTaxonomyPreview sessionId={sessionId} />;
      if (state === 'live') return <ListeningState sessionId={sessionId} />;
      if (state === 'opening') return <OpeningState />;
      return (
        <OfflineState
          message={error ? `${error}. Check Settings → CallPilot → server URL.` : undefined}
        />
      );
    }
    return <IntelligenceWorkspace cards={cards} mode={mode} productMentions={productMentions} />;
  }

  // Idle (no session): taxonomy preview.
  return <IdleTaxonomyPreview sessionId={sessionId} />;
};
