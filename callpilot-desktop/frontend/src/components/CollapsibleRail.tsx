'use client';

// CollapsibleRail - the right-side Intelligence rail as a native shell
// surface.
//
//   • Desktop (lg+): an inline rail that slides between 340px and 0 with
//     a 250ms width transition; the main content reclaims the space.
//   • Mobile (<lg): the rail becomes a drawer that slides in from the
//     right over an overlay - it never squeezes the main layout.
//
// The open/closed preference is persisted in localStorage so the state
// survives navigation and refresh. The rail stays mounted in both states
// (content, scroll position and card state are preserved) - only its
// width/visibility changes.
//
// The boundary toggle follows the product pattern: OPEN shows ‹ (points
// toward the collapse direction), CLOSED shows › (points toward where the
// panel will open). 250ms ease-out, transform/width only, and the global
// reduced-motion kill-switch covers prefers-reduced-motion.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, PanelRightClose, X } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'callpilot-rail-open';
const WIDTH_STORAGE_KEY = 'callpilot-rail-width';
const DESKTOP_BREAKPOINT = '(min-width: 1024px)'; // matches Tailwind `lg`
const DEFAULT_WIDTH = 340;
const MIN_WIDTH = 280;
const MAX_WIDTH = 480;
const TRANSITION_CLASS = 'transition-[width,right] duration-[250ms] ease-out';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface CollapsibleRailProps {
  /** Accessible name for the rail/drawer, e.g. "Intelligence". */
  label: string;
  /** Header content rendered above the panel (title, status chip, ...). */
  header: React.ReactNode;
  /** Panel content - stays mounted across open/close. */
  children: React.ReactNode;
}

export const CollapsibleRail: React.FC<CollapsibleRailProps> = ({ label, header, children }) => {
  const [isDesktop, setIsDesktop] = useState(false);
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) return stored === '1';
    // First visit: open on desktop, closed on mobile so the drawer never
    // covers the whole screen unexpectedly.
    return window.matchMedia(DESKTOP_BREAKPOINT).matches;
  });

  const drawerRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Resizable width (desktop): drag the rail's left edge. Persisted so a
  // narrow/wide preference survives navigation and refresh.
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return DEFAULT_WIDTH;
    const stored = Number(localStorage.getItem(WIDTH_STORAGE_KEY));
    if (Number.isFinite(stored) && stored >= MIN_WIDTH && stored <= MAX_WIDTH) return stored;
    return DEFAULT_WIDTH;
  });
  const widthRef = useRef(width);
  const [isDragging, setIsDragging] = useState(false);

  const startResize = (e: React.PointerEvent) => {
    if (!open) return;
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = widthRef.current;
    setIsDragging(true);

    const onMove = (ev: PointerEvent) => {
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + (startX - ev.clientX)));
      widthRef.current = next;
      setWidth(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setIsDragging(false);
      try {
        localStorage.setItem(WIDTH_STORAGE_KEY, String(widthRef.current));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Track the breakpoint so the drawer only engages below lg.
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_BREAKPOINT);
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const setOpenPersisted = useCallback((next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      /* storage unavailable - state still applies for this session */
    }
  }, []);

  const toggle = useCallback(() => setOpenPersisted(!open), [open, setOpenPersisted]);

  // Focus the close button when the mobile drawer opens.
  useEffect(() => {
    if (open && !isDesktop) {
      const t = window.setTimeout(() => closeButtonRef.current?.focus(), 50);
      return () => window.clearTimeout(t);
    }
  }, [open, isDesktop]);

  // Drawer keyboard: Escape closes, Tab traps focus inside the panel.
  useEffect(() => {
    if (!open || isDesktop) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpenPersisted(false);
        return;
      }
      if (e.key === 'Tab' && drawerRef.current) {
        const focusables = Array.from(
          drawerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        ).filter((el) => el.offsetParent !== null);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, isDesktop, setOpenPersisted]);

  return (
    <>
      {/* ── Desktop inline rail (lg+) ─────────────────────────────────── */}
      <aside
        aria-label={label}
        className={cn(
          'relative hidden h-full shrink-0 flex-col overflow-hidden bg-[var(--grain-paper)] lg:flex',
          TRANSITION_CLASS,
          isDragging && '!transition-none',
          open
            ? 'border-l border-[var(--opaline-outline-variant)]'
            : 'border-l border-transparent',
        )}
        style={{ width: open ? width : 0 }}
      >
        {/* Resize handle - drag the rail's left edge (desktop). */}
        {open && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize Intelligence panel"
            onPointerDown={startResize}
            className="group absolute inset-y-0 -left-[3px] z-20 hidden w-[7px] cursor-col-resize touch-none items-center justify-center lg:flex"
          >
            <span
              className="h-10 w-[3px] rounded-full bg-[var(--opaline-outline)] opacity-0 transition-opacity duration-fast group-hover:opacity-60 group-active:opacity-60"
              aria-hidden
            />
          </div>
        )}
        {/* Fixed-width inner column: content never reflows during the
            width transition. */}
        <div className="flex h-full min-h-0 min-w-0 flex-col" style={{ width }}>
          <div className="flex shrink-0 items-center gap-2 border-b border-[var(--opaline-outline-variant)] px-5 pb-3 pt-4">
            <div className="flex min-w-0 flex-1 items-center gap-2">{header}</div>
            {/* In-header collapse control (desktop). The boundary toggle
                is the reopen affordance when the rail is closed. */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={toggle}
                  aria-expanded={open}
                  aria-label={`Collapse ${label} panel`}
                  className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--opaline-on-surface-variant)] transition-colors duration-fast hover:bg-[var(--opaline-surface-container-low)] hover:text-[var(--opaline-on-surface)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--opaline-primary)] lg:inline-flex"
                >
                  <PanelRightClose className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>Collapse panel</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {children}
          </div>
        </div>
      </aside>

      {/* ── Desktop boundary toggle ───────────────────────────────────── */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-label={open ? `Collapse ${label} panel` : `Open ${label} panel`}
            className={cn(
              'absolute top-1/2 z-10 hidden h-8 w-5 -translate-y-1/2 items-center justify-center rounded-l-full rounded-r-full border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] text-[var(--opaline-on-surface-variant)] shadow-sm hover:bg-[var(--opaline-surface-container-low)] hover:text-[var(--opaline-on-surface)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--opaline-primary)] lg:flex',
              TRANSITION_CLASS,
            )}
            style={{ right: open ? width : 0 }}
          >
            {open ? (
              <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">
          <p>{open ? 'Collapse panel' : 'Open panel'}</p>
        </TooltipContent>
      </Tooltip>

      {/* ── Mobile drawer (<lg) - never squeezes the layout ───────────── */}
      <div
        className={cn('fixed inset-0 z-40 lg:hidden', open ? '' : 'pointer-events-none')}
        aria-hidden={!open}
      >
        {/* Overlay */}
        <div
          className={cn(
            'absolute inset-0 bg-[var(--opaline-overlay)] transition-opacity duration-[250ms] ease-out',
            open ? 'opacity-100' : 'opacity-0',
          )}
          onClick={() => setOpenPersisted(false)}
        />
        {/* Drawer panel - always mounted so content/state is preserved. */}
        <aside
          ref={drawerRef}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          className={cn(
            'absolute inset-y-0 right-0 flex w-[min(86vw,360px)] flex-col border-l border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface)] shadow-xl transition-transform duration-[250ms] ease-out',
            open ? 'translate-x-0' : 'translate-x-full',
          )}
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--opaline-outline-variant)] px-5 pb-3 pt-4">
            {header}
            <button
              ref={closeButtonRef}
              type="button"
              onClick={() => setOpenPersisted(false)}
              aria-label={`Close ${label} panel`}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--opaline-on-surface-variant)] transition-colors duration-fast hover:bg-[var(--opaline-surface-container-low)] hover:text-[var(--opaline-on-surface)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--opaline-primary)]"
            >
              <X className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            </button>
          </div>
          <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {children}
          </div>
        </aside>
      </div>

      {/* ── Mobile open button (floating, bottom-right) ───────────────── */}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={open ? `Close ${label} panel` : `Open ${label} panel`}
        className={cn(
          'fixed bottom-6 right-6 z-30 flex h-10 w-10 items-center justify-center rounded-full border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] text-[var(--opaline-on-surface-variant)] shadow-lg transition-colors duration-fast hover:bg-[var(--opaline-surface-container-low)] hover:text-[var(--opaline-on-surface)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--opaline-primary)] lg:hidden',
          open ? 'opacity-0 pointer-events-none' : 'opacity-100',
        )}
      >
        <ChevronRight className="h-5 w-5" strokeWidth={1.75} aria-hidden />
      </button>
    </>
  );
};
