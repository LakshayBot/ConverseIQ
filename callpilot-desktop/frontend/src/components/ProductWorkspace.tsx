'use client';

// ProductWorkspace - the "Products" portion of the Intelligence rail.
//
// A compact sales-intelligence workspace with two regions:
//   • TOP: the selected product's content (name, signal severity,
//     description, talking points, sources) - the dominant region.
//   • BOTTOM: a horizontally scrollable product selector.
//
// The product list is DERIVED from the panel's real product_match cards
// (live SignalR detections or historical events/recommendations) - no
// parallel state, no fake data. Selection is local UI state only: new
// detections extend the selector without resetting the user's current
// choice, and the first product is chosen until the user decides.
//
// The component is context-aware through the existing mode flag:
//   - "live"    → detection language is fine ("Product match")
//   - "history" → read-only language ("Detected product"), no live cues

import React, { useEffect, useRef, useState } from 'react';
import { Package, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import type { IntelligenceCard } from '@/lib/callpilotApi';
import { cn } from '@/lib/utils';
import { EASE_OUT } from '@/lib/motion';

/** Strip the historical event prefix so "ProductMentioned: Acme" reads
 *  "Acme" in the workspace (display-only - the underlying card is
 *  untouched). */
function productDisplayName(title: string): string {
  return title.replace(/^ProductMentioned:\s*/i, '').trim() || 'Product';
}

const SEVERITY_LABEL: Record<IntelligenceCard['severity'], string> = {
  high: 'High signal',
  medium: 'Medium signal',
  low: 'Low signal',
};

interface ProductWorkspaceProps {
  products: IntelligenceCard[];
  mode: 'live' | 'history';
}

export const ProductWorkspace: React.FC<ProductWorkspaceProps> = ({ products, mode }) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const reduceMotion = useReducedMotion();

  // Keep the current selection stable while the stream delivers new
  // detections; only fall back to the first product when the selected one
  // disappears (or nothing has been chosen yet).
  useEffect(() => {
    if (products.length === 0) {
      setSelectedId(null);
      return;
    }
    setSelectedId((prev) => {
      if (prev && products.some((p) => p.title === prev)) return prev;
      return products[0].title;
    });
  }, [products]);

  // Reveal a subtle right-edge fade while more products exist off-screen.
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
  }, [products.length]);

  const selected = products.find((p) => p.title === selectedId) ?? products[0] ?? null;
  const selectedIndex = selected ? products.findIndex((p) => p.title === selected.title) : -1;

  const selectAndReveal = (title: string, index: number) => {
    setSelectedId(title);
    const items = scrollRef.current?.querySelectorAll<HTMLElement>('[data-product-item]');
    items?.[index]?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
  };

  // Arrow keys navigate the selector (listbox pattern).
  const onSelectorKeyDown = (e: React.KeyboardEvent) => {
    if (products.length < 2 || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const next =
      e.key === 'ArrowRight'
        ? Math.min(selectedIndex + 1, products.length - 1)
        : Math.max(selectedIndex - 1, 0);
    selectAndReveal(products[next].title, next);
  };

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between">
        <h3 className="text-overline">Products</h3>
        <span className="text-data text-[var(--opaline-outline)]">{products.length}</span>
      </div>

      <div className="panel-inset flex flex-col overflow-hidden">
        {/* ── TOP: product content region (dominant) ─────────────────── */}
        <div className="custom-scrollbar max-h-[300px] min-h-[150px] flex-1 overflow-y-auto p-4">
          {selected ? (
            <div key={selected.title} className="animate-fade-soft">
              <p className="text-overline">
                {mode === 'live' ? 'Product match' : 'Detected product'} ·{' '}
                {SEVERITY_LABEL[selected.severity] ?? 'Signal'}
              </p>
              <h4 className="font-display mt-2 text-headline-sm text-[var(--opaline-on-surface)]">
                {productDisplayName(selected.title)}
              </h4>
              {selected.body ? (
                <p className="mt-2 whitespace-pre-wrap text-body-sm leading-relaxed text-[var(--opaline-on-surface-variant)]">
                  {selected.body}
                </p>
              ) : selected.title.toLowerCase().startsWith('detecting') ? (
                <p className="mt-2 text-caption">
                  Analysing product context…
                </p>
              ) : (
                <p className="mt-2 text-caption">
                  No additional details available for this product.
                </p>
              )}

              {selected.chunks && selected.chunks.length > 0 && (
                <SourcesList sources={selected.chunks} />
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1.5 py-6 text-center">
              <Package className="h-4 w-4 text-[var(--opaline-outline)]" strokeWidth={1.75} aria-hidden />
              <p className="text-body-sm font-medium text-[var(--opaline-on-surface)]">
                No product matches yet.
              </p>
              <p className="max-w-[220px] text-caption">
                {mode === 'live'
                  ? 'Products mentioned during the conversation will appear here.'
                  : 'No products were detected in this conversation.'}
              </p>
            </div>
          )}
        </div>

        {/* ── BOTTOM: horizontal product selector ────────────────────── */}
        <div className="border-t border-[var(--opaline-outline-variant)] py-2 pl-2 pr-1">
          <div className="relative">
            <div
              ref={scrollRef}
              role="listbox"
              aria-label="Detected products"
              onKeyDown={onSelectorKeyDown}
              className="custom-scrollbar flex items-center gap-2 overflow-x-auto py-1 pr-1"
            >
              {products.map((p, i) => {
                const active = p.title === selected?.title;
                return (
                  <button
                    key={p.title}
                    data-product-item
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => setSelectedId(p.title)}
                    title={productDisplayName(p.title)}
                    className={cn(
                      'flex h-9 max-w-[190px] min-w-[116px] shrink-0 items-center gap-2 rounded-md border px-2.5 text-[12px] font-medium transition-colors duration-fast focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--opaline-primary)]',
                      active
                        ? 'border-[var(--opaline-primary)] bg-[var(--opaline-primary-soft)] text-[var(--opaline-primary)]'
                        : 'border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] text-[var(--opaline-on-surface-variant)] hover:bg-[var(--opaline-surface-container-low)] hover:text-[var(--opaline-on-surface)]',
                    )}
                  >
                    <Package className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                    <span className="truncate">{productDisplayName(p.title)}</span>
                  </button>
                );
              })}
            </div>
            {/* Fade hint: more products exist off-screen */}
            {canScrollRight && products.length > 1 && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-[var(--opaline-surface-container-lowest)] to-transparent"
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

/** Compact expandable source list - same interaction as the signal cards. */
const SourcesList: React.FC<{ sources: string[] }> = ({ sources }) => {
  const [open, setOpen] = useState(false);
  const reduceMotion = useReducedMotion();

  return (
    <div className="mt-3 border-t border-[var(--opaline-outline-variant)] pt-2.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 font-mono text-[11px] text-[var(--opaline-on-surface-variant)] transition-colors hover:text-[var(--opaline-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--opaline-primary)]"
      >
        <span
          className={cn('transition-transform duration-fast ease-out', open && 'rotate-180')}
        >
          <ChevronDown className="h-3 w-3" aria-hidden />
        </span>
        Sources ({sources.length})
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
              {sources.map((s, i) => (
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

/** Compact empty state used when signals exist but no products were
 *  detected - minimal, mode-aware, never implies live listening in
 *  history. */
export const ProductEmptyState: React.FC<{ mode: 'live' | 'history' }> = ({ mode }) => (
  <section className="flex flex-col gap-1.5">
    <h3 className="text-overline">Products</h3>
    <p className="text-body-sm font-medium text-[var(--opaline-on-surface)]">
      No product matches yet.
    </p>
    <p className="text-caption">
      {mode === 'live'
        ? 'Products mentioned during the conversation will appear here.'
        : 'No products were detected in this conversation.'}
    </p>
  </section>
);
