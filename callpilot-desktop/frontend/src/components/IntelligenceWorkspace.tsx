'use client';

// IntelligenceWorkspace - the Intelligence rail's information architecture.
//
// VERTICAL = categories, HORIZONTAL = items within each category:
//
//   PRODUCTS      [Apex 100] [Prodigy] [Sprint 210] →
//   CONTEXTUAL    [AMI requirements] [Accuracy] →
//   OBJECTIONS    [Third-party CT] [Accuracy concerns] →
//   ...
//   ─────────────────────────────
//   SELECTED INTELLIGENCE        ← detail for the selected item
//
// Only categories with detected items are rendered. Each rail scrolls
// horizontally (never wraps). The detail area at the bottom is the
// content view; rails are the navigation.
//
// All data is DERIVED from the panel's real IntelligenceCards (live
// SignalR detections or historical events/recommendations). Both modes
// deliver newest-first, so items are normalized to chronological order.
// Selection rules:
//   - default: the LATEST product (last in the PRODUCTS rail)
//   - a manual selection is respected - later detections never override it
//   - with no products, the latest item of the first non-empty category
//
// Live-mode niceties: freshly arrived items get a brief dot and their
// rail auto-scrolls to reveal them, without shifting other rails.

import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  MessageCircle,
  ThumbsUp,
  Package,
  DollarSign,
  HelpCircle,
  FileText,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import type { IntelligenceCard } from '@/lib/callpilotApi';
import { cn } from '@/lib/utils';
import { EASE_OUT } from '@/lib/motion';

const TYPE_META: Record<IntelligenceCard['type'], { icon: React.ReactNode; label: string }> = {
  competitor_detected: { icon: <AlertTriangle className="h-3.5 w-3.5" />, label: 'Competitor' },
  objection:           { icon: <MessageCircle className="h-3.5 w-3.5" />, label: 'Objection' },
  buying_signal:       { icon: <ThumbsUp className="h-3.5 w-3.5" />, label: 'Signal' },
  product_match:       { icon: <Package className="h-3.5 w-3.5" />, label: 'Product match' },
  pricing_discussion:  { icon: <DollarSign className="h-3.5 w-3.5" />, label: 'Pricing' },
  technical_question:  { icon: <HelpCircle className="h-3.5 w-3.5" />, label: 'Technical' },
};

type CategoryKey = 'products' | 'contextual' | 'objections' | 'pricing' | 'technical' | 'competitors';

const CATEGORY_ORDER: Array<{ key: CategoryKey; label: string }> = [
  { key: 'products', label: 'Products' },
  { key: 'contextual', label: 'Contextual' },
  { key: 'objections', label: 'Objections' },
  { key: 'pricing', label: 'Pricing' },
  { key: 'technical', label: 'Technical' },
  { key: 'competitors', label: 'Competitors' },
];

const TYPE_TO_CATEGORY: Record<IntelligenceCard['type'], CategoryKey> = {
  product_match: 'products',
  buying_signal: 'contextual',
  objection: 'objections',
  pricing_discussion: 'pricing',
  technical_question: 'technical',
  competitor_detected: 'competitors',
};

const SEVERITY_LABEL: Record<IntelligenceCard['severity'], string> = {
  high: 'High relevance',
  medium: 'Medium relevance',
  low: 'Low relevance',
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

/** Strip historical event prefixes for display ("Objection: Data
 *  residency" → "Data residency", "ProductMentioned: X" → "X"). */
function displayName(title: string): string {
  return (
    title
      .replace(/^(ProductMentioned|CompetitorMentioned|PricingDiscussion|PricingQuestion|TechnicalQuestion|Objection):\s*/i, '')
      .trim() || 'Signal'
  );
}

interface IntelligenceWorkspaceProps {
  cards: IntelligenceCard[];
  mode: 'live' | 'history';
}

export const IntelligenceWorkspace: React.FC<IntelligenceWorkspaceProps> = ({ cards, mode }) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const manualRef = useRef(false);
  const reduceMotion = useReducedMotion();

  // Normalize to chronological order (both live and history arrive
  // newest-first) so rails read oldest → newest and "latest" = last item.
  const chronological = useMemoOrdered(cards);
  const railRefs = useRef<Record<string, HTMLElement | null>>({});

  // "New" indication + rail auto-scroll for freshly arrived items (live).
  const knownTitlesRef = useRef<Set<string>>(new Set());
  const [newTitles, setNewTitles] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (mode !== 'live') return;
    const known = knownTitlesRef.current;
    const added = cards.filter((c) => !known.has(c.title)).map((c) => c.title);
    added.forEach((t) => known.add(t));
    if (added.length === 0) return;
    setNewTitles((prev) => new Set([...prev, ...added]));

    // Reveal each new item inside its own rail (no cross-rail jumps).
    requestAnimationFrame(() => {
      added.forEach((title) => {
        const el = railRefs.current[title];
        el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
      });
    });

    const timer = window.setTimeout(() => {
      setNewTitles((prev) => {
        const next = new Set(prev);
        added.forEach((t) => next.delete(t));
        return next;
      });
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [cards, mode, reduceMotion]);

  // Default selection: latest product; otherwise latest item of the
  // first non-empty category. Manual selections are never overridden.
  useEffect(() => {
    if (chronological.length === 0) {
      setSelectedId(null);
      return;
    }
    if (manualRef.current) return;
    setSelectedId((prev) => {
      if (prev && chronological.some((c) => c.title === prev)) return prev;
      const byCategory = groupByCategory(chronological);
      const latestProduct = byCategory.products?.[byCategory.products.length - 1];
      if (latestProduct) return latestProduct.title;
      const firstNonEmpty = CATEGORY_ORDER.find((cat) => (byCategory[cat.key]?.length ?? 0) > 0);
      const items = firstNonEmpty ? byCategory[firstNonEmpty.key] : chronological;
      return items[items.length - 1].title;
    });
  }, [chronological]);

  const selected = chronological.find((c) => c.title === selectedId) ?? null;

  const select = (title: string) => {
    manualRef.current = true;
    setSelectedId(title);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Category rails (vertical scroll region) ──────────────────── */}
      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto pr-1">
        {CATEGORY_ORDER.map((cat) => {
          const items = groupByCategory(chronological)[cat.key] ?? [];
          if (items.length === 0) return null;
          return (
            <CategoryRail
              key={cat.key}
              label={cat.label}
              items={items}
              selectedId={selected?.title ?? null}
              newTitles={newTitles}
              mode={mode}
              railRef={(title, el) => {
                railRefs.current[title] = el;
              }}
              onSelect={select}
            />
          );
        })}
      </div>

      {/* ── Selected intelligence (detail area, bottom) ──────────────── */}
      <div className="shrink-0 border-t border-[var(--opaline-outline-variant)] pt-3">
        {selected ? (
          <div key={selected.title} className="animate-fade-soft flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <span
                className={`inline-flex items-center gap-1.5 text-overline ${SEVERITY_ACCENT[selected.severity]}`}
              >
                {TYPE_META[selected.type]?.icon ?? null}
                {TYPE_META[selected.type]?.label ?? selected.type}
              </span>
              <span className="status-pill !px-2 !py-0.5">
                <span className={`pill-dot ${SEVERITY_DOT[selected.severity]}`} aria-hidden />
                {SEVERITY_LABEL[selected.severity] ?? 'Signal'}
              </span>
            </div>

            <h4 className="font-display text-headline-sm text-[var(--opaline-on-surface)]">
              {displayName(selected.title)}
            </h4>

            {selected.body ? (
              <p className="whitespace-pre-wrap text-body-sm leading-relaxed text-[var(--opaline-on-surface-variant)]">
                {selected.body}
              </p>
            ) : selected.title.toLowerCase().startsWith('detecting') ? (
              <p className="text-caption">Analysing context…</p>
            ) : (
              <p className="text-caption">No additional details available for this signal.</p>
            )}

            {selected.chunks && selected.chunks.length > 0 && (
              <KnowledgeSource sources={selected.chunks} />
            )}
          </div>
        ) : (
          <p className="py-2 text-caption">
            Select an item above to see its details.
          </p>
        )}
      </div>
    </div>
  );
};

/* ────────────────────────────────────────────────────────────────────────────
 * Category rail - one horizontal row of compact cards.
 * ──────────────────────────────────────────────────────────────────────────── */

interface CategoryRailProps {
  label: string;
  items: IntelligenceCard[];
  selectedId: string | null;
  newTitles: Set<string>;
  mode: 'live' | 'history';
  railRef: (title: string, el: HTMLElement | null) => void;
  onSelect: (title: string) => void;
}

const CategoryRail: React.FC<CategoryRailProps> = ({
  label,
  items,
  selectedId,
  newTitles,
  mode,
  railRef,
  onSelect,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setCanScrollRight(el.scrollWidth > el.clientWidth + 8);
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [items.length]);

  const advance = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: Math.max(120, el.clientWidth * 0.7), behavior: reduceMotion ? 'auto' : 'smooth' });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (items.length < 2 || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const idx = items.findIndex((c) => c.title === selectedId);
    const next =
      e.key === 'ArrowRight' ? Math.min(idx + 1, items.length - 1) : Math.max(idx - 1, 0);
    onSelect(items[next].title);
    const itemsEl = scrollRef.current?.querySelectorAll<HTMLElement>('[data-signal-item]');
    itemsEl?.[next]?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
  };

  return (
    <section className="mb-4 last:mb-0">
      <div className="mb-1.5 flex items-baseline justify-between">
        <h3 className="text-overline">{label}</h3>
        <span className="text-data text-[var(--opaline-outline)]">{items.length}</span>
      </div>

      <div className="relative">
        <div
          ref={scrollRef}
          role="listbox"
          aria-label={label}
          onKeyDown={onKeyDown}
          className="custom-scrollbar flex items-stretch gap-2 overflow-x-auto pb-1"
        >
          {items.map((card) => {
            const active = card.title === selectedId;
            const isNew = newTitles.has(card.title);
            const meta = TYPE_META[card.type] ?? {
              icon: <MessageCircle className="h-3.5 w-3.5" />,
              label: 'Context',
            };
            return (
              <button
                key={card.title}
                data-signal-item
                ref={(el) => railRef(card.title, el)}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => onSelect(card.title)}
                title={displayName(card.title)}
                className={cn(
                  'flex h-[74px] w-[136px] shrink-0 flex-col items-start gap-1 rounded-lg border p-2.5 text-left transition-colors duration-fast focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--opaline-primary)]',
                  active
                    ? 'border-[var(--opaline-primary)] bg-[var(--opaline-primary-soft)]'
                    : 'border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] hover:bg-[var(--opaline-surface-container-low)]',
                  isNew && 'animate-fade-soft',
                )}
              >
                <span
                  className={`flex w-full items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.06em] ${SEVERITY_ACCENT[card.severity]}`}
                >
                  {meta.icon}
                  <span className="truncate">{meta.label}</span>
                  {isNew && (
                    <span
                      aria-hidden
                      className="ml-auto h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--opaline-primary)]"
                    />
                  )}
                </span>
                <span className="w-full truncate text-[13px] font-semibold text-[var(--opaline-on-surface)]">
                  {displayName(card.title)}
                </span>
                <span className="text-caption">
                  {mode === 'live' ? 'Mentioned in conversation' : 'Detected'}
                </span>
              </button>
            );
          })}
        </div>

        {canScrollRight && (
          <>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-[var(--opaline-surface)] to-transparent"
            />
            <button
              type="button"
              onClick={advance}
              aria-label={`Scroll ${label.toLowerCase()} rail`}
              className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] text-[var(--opaline-on-surface-variant)] shadow-sm transition-colors duration-fast hover:bg-[var(--opaline-surface-container-low)] hover:text-[var(--opaline-on-surface)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--opaline-primary)]"
            >
              <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            </button>
          </>
        )}
      </div>
    </section>
  );
};

/* ────────────────────────────────────────────────────────────────────────────
 * Helpers
 * ──────────────────────────────────────────────────────────────────────────── */

function groupByCategory(cards: IntelligenceCard[]): Record<CategoryKey, IntelligenceCard[]> {
  const groups: Record<CategoryKey, IntelligenceCard[]> = {
    products: [],
    contextual: [],
    objections: [],
    pricing: [],
    technical: [],
    competitors: [],
  };
  for (const card of cards) {
    const key = TYPE_TO_CATEGORY[card.type] ?? 'contextual';
    groups[key].push(card);
  }
  return groups;
}

function useMemoOrdered(cards: IntelligenceCard[]): IntelligenceCard[] {
  // Both live and historical inputs are newest-first; the workspace wants
  // chronological (oldest → newest) so "latest" = last item.
  return React.useMemo(() => [...cards].reverse(), [cards]);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Knowledge source - the references attached to a signal, presented as
 * a document-style source block (real data from card.chunks).
 * ──────────────────────────────────────────────────────────────────────────── */

const KnowledgeSource: React.FC<{ sources: string[] }> = ({ sources }) => {
  const [open, setOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const [first, ...rest] = sources;

  return (
    <div className="mt-1 border-t border-[var(--opaline-outline-variant)] pt-2.5">
      <p className="text-overline mb-1.5">Knowledge source</p>
      <div className="flex items-start gap-2 rounded-md bg-[var(--opaline-surface-container-low)] px-2.5 py-2">
        <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--opaline-outline)]" strokeWidth={1.75} aria-hidden />
        <p className="min-w-0 text-xs leading-relaxed text-[var(--opaline-on-surface-variant)]">
          {first}
        </p>
      </div>
      {rest.length > 0 && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="mt-2 inline-flex items-center gap-1 font-mono text-[11px] text-[var(--opaline-on-surface-variant)] transition-colors hover:text-[var(--opaline-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--opaline-primary)]"
        >
          <span className={cn('transition-transform duration-fast ease-out', open && 'rotate-180')}>
            <ChevronDown className="h-3 w-3" aria-hidden />
          </span>
          View all sources ({rest.length + 1})
        </button>
      )}
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
              {rest.map((s, i) => (
                <li
                  key={i}
                  className="border-l-2 border-[var(--opaline-outline-variant)] pl-2 text-xs text-[var(--opaline-on-surface-variant)]"
                >
                  {s}
                </li>
              ))}
            </div>
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
};
