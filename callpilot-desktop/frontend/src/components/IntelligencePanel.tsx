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
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import type { IntelligenceCard } from '@/lib/callpilotApi';
import { fadeUp, stagger, EASE_OUT } from '@/lib/motion';
import { ProductWorkspace, ProductEmptyState } from '@/components/ProductWorkspace';

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
}

const TYPE_META: Record<IntelligenceCard['type'], { icon: React.ReactNode; label: string }> = {
  competitor_detected: { icon: <AlertTriangle className="w-4 h-4" />, label: 'Competitor' },
  objection:           { icon: <MessageCircle className="w-4 h-4" />, label: 'Objection' },
  buying_signal:       { icon: <ThumbsUp className="w-4 h-4" />, label: 'Buying signal' },
  product_match:       { icon: <Package className="w-4 h-4" />, label: 'Product match' },
  pricing_discussion:  { icon: <DollarSign className="w-4 h-4" />, label: 'Pricing' },
  technical_question:  { icon: <HelpCircle className="w-4 h-4" />, label: 'Technical' },
};

/** The five signal types, in reading order - used in the idle state so the
 *  rail teaches what it will surface before a call ever starts. */
const SIGNAL_TYPES: Array<{ key: IntelligenceCard['type']; label: string; icon: React.ReactNode }> = [
  { key: 'competitor_detected', label: 'Competitor', icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  { key: 'objection', label: 'Objection', icon: <MessageCircle className="h-3.5 w-3.5" /> },
  { key: 'pricing_discussion', label: 'Pricing', icon: <DollarSign className="h-3.5 w-3.5" /> },
  { key: 'product_match', label: 'Product match', icon: <Package className="h-3.5 w-3.5" /> },
  { key: 'technical_question', label: 'Technical', icon: <HelpCircle className="h-3.5 w-3.5" /> },
];

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
}) => {
  const hasSession = Boolean(sessionId);
  const reduceMotion = useReducedMotion();

  // Products are surfaced through the ProductWorkspace (content region +
  // horizontal selector); every other signal type stays a card below it.
  const productCards = cards.filter((c) => c.type === 'product_match');
  const signalCards = cards.filter((c) => c.type !== 'product_match');

  // Historical view: read-only snapshot. Cards render as a static list
  // (no stream states, no live language); an empty meeting gets a calm
  // archival empty state.
  if (mode === 'history') {
    if (!cards.length) return <HistoricalEmptyState />;
    return (
      <div className="flex flex-col gap-4">
        {productCards.length > 0 ? (
          <ProductWorkspace products={productCards} mode="history" />
        ) : (
          <ProductEmptyState mode="history" />
        )}
        {signalCards.length > 0 && (
          <motion.ul
            className="flex flex-col gap-2"
            variants={reduceMotion ? undefined : stagger(0.05)}
            initial="initial"
            animate="animate"
          >
            <AnimatePresence initial={false}>
              {signalCards.map((card, i) => (
                <motion.li
                  key={`${card.type}-${i}-${card.title}`}
                  variants={reduceMotion ? undefined : fadeUp}
                  transition={reduceMotion ? undefined : { duration: 0.24, ease: EASE_OUT }}
                >
                  <IntelligenceCardItem card={card} />
                </motion.li>
              ))}
            </AnimatePresence>
          </motion.ul>
        )}
      </div>
    );
  }

  if (!cards.length) {
    const state = resolveStreamState(connected, error, hasSession);
    if (state === 'idle') return <IdleTaxonomyPreview sessionId={sessionId} />;
    if (state === 'live') return <ListeningState sessionId={sessionId} />;
    if (state === 'opening') return <OpeningState />;
    return (
      <OfflineState
        message={
          error
            ? `${error}. Check Settings → CallPilot → server URL.`
            : undefined
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {productCards.length > 0 ? (
        <ProductWorkspace products={productCards} mode="live" />
      ) : (
        <ProductEmptyState mode="live" />
      )}
      {signalCards.length > 0 && (
        <motion.ul
          className="flex flex-col gap-2"
          variants={reduceMotion ? undefined : stagger(0.07)}
          initial="initial"
          animate="animate"
        >
          <AnimatePresence initial={false}>
            {signalCards.map((card, i) => (
              <motion.li
                key={`${card.type}-${i}-${card.title}`}
                variants={reduceMotion ? undefined : fadeUp}
                transition={reduceMotion ? undefined : { duration: 0.24, ease: EASE_OUT }}
              >
                <IntelligenceCardItem card={card} />
              </motion.li>
            ))}
          </AnimatePresence>
        </motion.ul>
      )}
    </div>
  );
};

const IntelligenceCardItem: React.FC<{ card: IntelligenceCard }> = ({ card }) => {
  const [open, setOpen] = useState(false);
  const meta = TYPE_META[card.type] ?? { icon: <MessageCircle className="h-4 w-4" strokeWidth={2} />, label: card.type };
  const hasChunks = card.chunks && card.chunks.length > 0;
  const reduceMotion = useReducedMotion();

  return (
    <div
      className={`rounded-xl border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] shadow-xs overflow-hidden ${SEVERITY_BORDER[card.severity]}`}
    >
      <div className="p-4">
        {/* Label row - type badge + priority chip, each in the severity accent. */}
        <div className="flex items-center justify-between gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full bg-[var(--intel-type-bg)] px-2.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] ${SEVERITY_ACCENT[card.severity]}`}
          >
            {meta.icon}
            {meta.label}
          </span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border border-[var(--opaline-tone-8)] px-2.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.1em] ${SEVERITY_ACCENT[card.severity]}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${SEVERITY_DOT[card.severity]}`} aria-hidden />
            {card.severity}
          </span>
        </div>

        {/* Title - largest text in the card, heaviest weight. */}
        <div className="mt-2 text-[15px] font-bold leading-snug text-[var(--opaline-on-surface)]">
          {card.title}
        </div>

        {/* Body - medium weight, muted, comfortable leading. */}
        {card.body && (
          <div className="mt-1.5 text-[13px] leading-[1.5] whitespace-pre-wrap text-[var(--opaline-on-surface-variant)]">
            {card.body}
          </div>
        )}

        {/* Footer - hairline divider, smallest muted type, animated expand. */}
        {hasChunks && (
          <div className="mt-3 border-t border-[var(--opaline-outline-variant)] pt-2.5">
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              className="inline-flex items-center gap-1 font-mono text-[11px] text-[var(--opaline-on-surface-variant)] transition-colors hover:text-[var(--opaline-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--opaline-primary)]"
            >
              <span
                className={`transition-transform duration-fast ease-out ${open ? 'rotate-180' : ''}`}
              >
                <ChevronDown className="h-3 w-3" />
              </span>
              View sources ({card.chunks.length})
            </button>
            <AnimatePresence initial={false}>
              {open && (
                <motion.ul
                  initial={reduceMotion ? false : { height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={reduceMotion ? undefined : { height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: EASE_OUT }}
                  className="overflow-hidden"
                >
                  <div className="mt-2 space-y-2">
                    {card.chunks.map((chunk, i) => (
                      <li
                        key={i}
                        className="border-l-2 border-[var(--opaline-outline-variant)] pl-2 text-xs text-[var(--opaline-on-surface-variant)]"
                      >
                        {chunk}
                      </li>
                    ))}
                  </div>
                </motion.ul>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
};
