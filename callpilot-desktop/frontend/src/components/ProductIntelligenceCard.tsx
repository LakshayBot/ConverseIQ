'use client';

// ProductIntelligenceCard - the product profile shown in the Intelligence
// rail's detail panel when a product_match card is selected.
//
// Structure (only sections with verified data render - never empty
// placeholders):
//
//   PRODUCT INTELLIGENCE
//   Prodigy · Secure Meters [chip]
//   <description>
//   WHAT IT IS / KEY SPECIFICATIONS / KEY FEATURES / USE CASES /
//   WHY IT STANDS OUT / VARIANTS / LIMITATIONS
//   ── MEETING CONTEXT ──
//   Mentioned at 00:38 · 01:16  + this meeting's mention snippet
//   ── SOURCES ──
//   Official product page · Datasheet · ...
//
// The profile is fetched from the server (which enriches once and caches in
// PostgreSQL). Loading ("Researching product…"), failed, and partial states
// all degrade gracefully without breaking the panel.

import { useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { FileText, ExternalLink, ChevronDown, RefreshCw, Package } from 'lucide-react';
import { useProductIntelligence } from '@/hooks/useProductIntelligence';
import type { ProductIntelligenceProfile, ProductSourceInfo } from '@/lib/callpilotApi';
import { cn } from '@/lib/utils';
import { EASE_OUT } from '@/lib/motion';

export interface ProductMention {
  timestamp: number;
  text: string;
}

interface Props {
  productName: string;
  /** Presentation context (reserved - the card renders identically in both). */
  mode?: 'live' | 'history';
  /** This meeting's mentions of the product (from the transcript map). */
  mentions?: ProductMention[];
  /** The existing card body (mention context / talking points) as fallback. */
  fallbackBody?: string;
  /** Knowledge-base references already attached to this meeting's card. */
  knowledgeChunks?: string[];
}

function formatTime(seconds: number | undefined): string {
  if (seconds === undefined) return '--:--';
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function confidenceTone(score: number): { dot: string; label: string } {
  if (score >= 0.7) return { dot: 'bg-[var(--opaline-success)]', label: 'High confidence' };
  if (score >= 0.4) return { dot: 'bg-[var(--opaline-warning)]', label: 'Medium confidence' };
  return { dot: 'bg-[var(--opaline-info)]', label: 'Low confidence' };
}

export const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="pt-3 first:pt-0">
    <p className="text-overline mb-1.5 text-[var(--opaline-on-surface-variant)]">{title}</p>
    {children}
  </div>
);

export const Bullets: React.FC<{ items: string[] }> = ({ items }) => (
  <ul className="space-y-1">
    {items.map((item, i) => (
      <li key={i} className="flex items-start gap-1.5 text-[13px] leading-[1.5] text-[var(--opaline-on-surface-variant)]">
        <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--opaline-outline)]" />
        <span className="min-w-0">{item}</span>
      </li>
    ))}
  </ul>
);

export const Chips: React.FC<{ items: string[] }> = ({ items }) => (
  <div className="flex flex-wrap gap-1">
    {items.map((item, i) => (
      <span key={i} className="chip chip-neutral !px-1.5 !py-0.5 !text-[11px]">
        {item}
      </span>
    ))}
  </div>
);

export const SpecRows: React.FC<{ items: string[] }> = ({ items }) => (
  <div className="overflow-hidden rounded-md border border-[var(--opaline-outline-variant)]">
    {items.map((row, i) => {
      const colon = row.indexOf(':');
      const [k, v] = colon > 0 ? [row.slice(0, colon), row.slice(colon + 1)] : [row, ''];
      return (
        <div
          key={i}
          className={cn(
            'flex items-baseline justify-between gap-2 px-2.5 py-1.5 text-[12px]',
            i % 2 === 1 && 'bg-[var(--opaline-surface-container-low)]',
          )}
        >
          <span className="min-w-0 shrink-0 text-[var(--opaline-on-surface-variant)]">{k}</span>
          <span className="min-w-0 text-right font-medium text-[var(--opaline-on-surface)]">{v}</span>
        </div>
      );
    })}
  </div>
);

export const SourcesList: React.FC<{ sources: ProductSourceInfo[] }> = ({ sources }) => {
  const [open, setOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const [first, ...rest] = sources;

  if (sources.length === 0) return null;

  const sourceRow = (s: ProductSourceInfo) => (
    <div className="flex items-start gap-2 rounded-md bg-[var(--opaline-surface-container-low)] px-2.5 py-2">
      <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--opaline-outline)]" strokeWidth={1.75} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="chip chip-neutral !px-1.5 !py-0 !text-[10px] uppercase tracking-wide">
            {s.sourceType}
          </span>
          <span className="truncate text-[10px] font-mono text-[var(--opaline-on-surface-variant)]">
            {s.domain}
          </span>
        </div>
        <a
          href={s.url}
          target="_blank"
          rel="noreferrer"
          className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-[var(--opaline-primary)] transition-colors hover:text-[var(--opaline-primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--opaline-primary)]"
        >
          <span className="line-clamp-2">{s.title}</span>
          <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
        </a>
        {s.snippet ? (
          <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-[var(--opaline-on-surface-variant)]">
            {s.snippet}
          </p>
        ) : null}
      </div>
    </div>
  );

  return (
    <Section title="Sources">
      <div className="space-y-1.5">
        {sourceRow(first)}
        {rest.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              className="mt-1 inline-flex items-center gap-1 font-mono text-[11px] text-[var(--opaline-on-surface-variant)] transition-colors hover:text-[var(--opaline-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--opaline-primary)]"
            >
              <span className={cn('transition-transform duration-fast ease-out', open && 'rotate-180')}>
                <ChevronDown className="h-3 w-3" aria-hidden />
              </span>
              View all sources ({sources.length})
            </button>
            <AnimatePresence initial={false}>
              {open && (
                <motion.div
                  initial={reduceMotion ? false : { height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={reduceMotion ? undefined : { height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: EASE_OUT }}
                  className="overflow-hidden"
                >
                  <div className="mt-1.5 space-y-1.5">{rest.map((s) => <div key={s.url}>{sourceRow(s)}</div>)}</div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </Section>
  );
};

const MeetingContext: React.FC<{ mentions?: ProductMention[]; fallbackBody?: string; knowledgeChunks?: string[] }> = ({
  mentions,
  fallbackBody,
  knowledgeChunks,
}) => {
  const hasAnything = (mentions && mentions.length > 0) || !!fallbackBody || (knowledgeChunks && knowledgeChunks.length > 0);
  if (!hasAnything) return null;

  return (
    <Section title="Meeting context">
      {mentions && mentions.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1">
          {mentions.map((m, i) => (
            <span key={i} className="chip chip-primary !px-1.5 !py-0.5 !text-[11px]">
              Mentioned at {formatTime(m.timestamp)}
            </span>
          ))}
        </div>
      )}
      {mentions && mentions.length > 0 && mentions[0].text ? (
        <p className="mb-2 text-[12px] leading-relaxed text-[var(--opaline-on-surface-variant)]">
          “{mentions[0].text}”
        </p>
      ) : fallbackBody ? (
        <p className="mb-2 text-[12px] leading-relaxed text-[var(--opaline-on-surface-variant)]">
          “{fallbackBody.slice(0, 180)}”
        </p>
      ) : null}
      {knowledgeChunks && knowledgeChunks.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {knowledgeChunks.slice(0, 3).map((c, i) => (
            <span key={i} className="chip chip-neutral !px-1.5 !py-0.5 !text-[11px]">
              {c}
            </span>
          ))}
        </div>
      )}
    </Section>
  );
};

const ProfileBody: React.FC<{ profile: ProductIntelligenceProfile; mentions?: ProductMention[]; fallbackBody?: string; knowledgeChunks?: string[] }> = ({
  profile,
  mentions,
  fallbackBody,
  knowledgeChunks,
}) => {
  const tone = confidenceTone(profile.confidenceScore);

  return (
    <div className="flex flex-col gap-2.5">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-display text-headline-sm break-words text-[var(--opaline-on-surface)]">
          {profile.name}
        </h4>
        <span className="status-pill !px-2 !py-0.5 shrink-0">
          <span className={cn('pill-dot', tone.dot)} aria-hidden />
          {tone.label}
        </span>
      </div>

      {(profile.manufacturer || profile.category) && (
        <div className="flex flex-wrap gap-1">
          {profile.manufacturer && (
            <span className="chip chip-neutral !px-1.5 !py-0.5 !text-[11px]">{profile.manufacturer}</span>
          )}
          {profile.category && (
            <span className="chip chip-neutral !px-1.5 !py-0.5 !text-[11px]">{profile.category}</span>
          )}
        </div>
      )}

      {profile.description && (
        <p className="text-body-sm leading-relaxed text-[var(--opaline-on-surface-variant)]">{profile.description}</p>
      )}

      {profile.whatItDoes && (
        <Section title="What it is">
          <p className="text-[13px] leading-[1.55] text-[var(--opaline-on-surface-variant)]">{profile.whatItDoes}</p>
        </Section>
      )}

      {profile.keySpecifications.length > 0 && (
        <Section title="Key specifications">
          <SpecRows items={profile.keySpecifications} />
        </Section>
      )}

      {profile.keyFeatures.length > 0 && (
        <Section title="Key features">
          <Bullets items={profile.keyFeatures} />
        </Section>
      )}

      {profile.useCases.length > 0 && (
        <Section title="Use cases">
          <Bullets items={profile.useCases} />
        </Section>
      )}

      {profile.targetIndustries.length > 0 && (
        <Section title="Target industries">
          <Chips items={profile.targetIndustries} />
        </Section>
      )}

      {profile.standoutPoints.length > 0 && (
        <Section title="Why it stands out">
          <Bullets items={profile.standoutPoints} />
        </Section>
      )}

      {profile.variants.length > 0 && (
        <Section title="Variants">
          <Chips items={profile.variants} />
        </Section>
      )}

      {profile.limitations.length > 0 && (
        <Section title="Limitations">
          <Bullets items={profile.limitations} />
        </Section>
      )}

      <MeetingContext mentions={mentions} fallbackBody={fallbackBody} knowledgeChunks={knowledgeChunks} />
    </div>
  );
};

const LoadingBody: React.FC<{ productName: string }> = ({ productName }) => (
  <div className="flex flex-col gap-3">
    <h4 className="font-display text-headline-sm text-[var(--opaline-on-surface)]">{productName}</h4>
    <span className="status-pill self-start !px-2 !py-0.5">
      <span className="pill-dot animate-pulse bg-[var(--opaline-info)]" aria-hidden />
      Researching product…
    </span>
    <div className="animate-shimmer space-y-2 rounded-md border border-[var(--opaline-outline-variant)] p-3">
      <div className="h-2.5 w-3/4 rounded bg-[var(--opaline-surface-container-low)]" />
      <div className="h-2.5 w-full rounded bg-[var(--opaline-surface-container-low)]" />
      <div className="h-2.5 w-5/6 rounded bg-[var(--opaline-surface-container-low)]" />
    </div>
    <p className="text-caption text-[var(--opaline-on-surface-variant)]">
      Product intelligence is being prepared from verified sources — it will appear here when ready.
    </p>
  </div>
);

export const ProductIntelligenceCard: React.FC<Props> = ({ productName, mentions, fallbackBody, knowledgeChunks }) => {
  const { state, retry } = useProductIntelligence(productName);

  return (
    <div className="flex flex-col gap-2.5">
      <span className="inline-flex items-center gap-1.5 text-overline text-[var(--opaline-on-surface-variant)]">
        <Package className="h-3.5 w-3.5 text-[var(--opaline-primary)]" aria-hidden />
        Product intelligence
      </span>

      {state.status === 'loading' || state.status === 'enriching' ? (
        <LoadingBody productName={productName} />
      ) : state.status === 'failed' ? (
        <div className="flex flex-col gap-2.5">
          <h4 className="font-display text-headline-sm break-words text-[var(--opaline-on-surface)]">{productName}</h4>
          <div className="flex items-center gap-2">
            <span className="status-pill !px-2 !py-0.5">
              <span className="pill-dot bg-[var(--opaline-danger)]" aria-hidden />
              Enrichment unavailable
            </span>
            <button
              type="button"
              onClick={retry}
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--opaline-outline-variant)] px-2 py-1 text-[11px] font-medium text-[var(--opaline-on-surface)] transition-colors hover:bg-[var(--opaline-surface-container-low)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--opaline-primary)]"
            >
              <RefreshCw className="h-3 w-3" aria-hidden />
              Retry research
            </button>
          </div>
          <p className="text-caption text-[var(--opaline-on-surface-variant)]">
            Product intelligence is being prepared. The detected mention is still shown below.
          </p>
          <MeetingContext mentions={mentions} fallbackBody={fallbackBody} knowledgeChunks={knowledgeChunks} />
        </div>
      ) : state.status === 'ready' && state.profile ? (
        <div className="animate-fade-soft">
          <ProfileBody
            profile={state.profile}
            mentions={mentions}
            fallbackBody={fallbackBody}
            knowledgeChunks={knowledgeChunks}
          />
          {state.sources.length > 0 && (
            <div className="pt-2.5">
              <SourcesList sources={state.sources} />
            </div>
          )}
        </div>
      ) : (
        <LoadingBody productName={productName} />
      )}
    </div>
  );
};
