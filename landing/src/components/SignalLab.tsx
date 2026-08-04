// ============================================================================
// SignalLab — the detection vocabulary, made tangible. Six cells; activating
// one runs its micro-demo: the snippet, the phrase the system caught, the
// confidence, and the card that would land.
// ============================================================================

import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { gsap } from 'gsap'
import { SIGNAL_DEMOS } from '@/data/content'
import { cx } from '@/lib/cx'
import { useSectionTimeline, prefersReducedMotion, useHeadingReveal } from '@/lib/motion'
import { IntelCard, type Severity } from './IntelCard'
import { kindMeta } from './kinds'
import { IconChevronDown } from './chevrons'

const SEV: Record<string, Severity> = {
  product: 'high',
  pricing: 'medium',
  objection: 'high',
  technical: 'low',
  competitor: 'high',
  'pricing-q': 'medium',
}

export function SignalLab(): React.JSX.Element {
  const rootRef = useRef<HTMLElement>(null)
  const [active, setActive] = useState<string>('competitor')
  const reduced = prefersReducedMotion()

  useHeadingReveal(rootRef)

  useSectionTimeline(
    rootRef,
    () => {
      if (reduced) return
      gsap.set('[data-cell]', { y: 46, opacity: 0, force3D: true })
      const ctx = gsap.to('[data-cell]', {
        y: 0,
        opacity: 1,
        duration: 0.85,
        stagger: 0.08,
        ease: 'expo.out',
        scrollTrigger: { trigger: rootRef.current, start: 'top 70%' },
      })
      return () => {
        ctx.scrollTrigger?.kill()
        ctx.kill()
      }
    },
    [reduced],
  )

  const demo = SIGNAL_DEMOS.find((s) => s.id === active) ?? SIGNAL_DEMOS[0]

  return (
    <section id="signals" ref={rootRef} className="nocturne section">
      <div className="container">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="eyebrow">The signals · detection vocabulary</p>
            <h2 className="h2-display mt-6 max-w-[16ch]">
              <span className="mask-line"><span className="mask-line-inner">Six signals.</span></span>
              <span className="mask-line"><span className="mask-line-inner"><em className="accent">One ear.</em></span></span>
            </h2>
          </div>
          <p className="max-w-[34ch] text-[14px] leading-[1.6] text-moon-3">
            Each one is a named event with a confidence score — the same
            taxonomy the desktop app and the live rail speak.
          </p>
        </div>

        {/* ── Cells ───────────────────────────────────────────────────── */}
        <div className="mt-14 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {SIGNAL_DEMOS.map((signal) => {
            const isActive = active === signal.id
            return (
              <button
                key={signal.id}
                type="button"
                data-cell
                data-cursor="hover"
                onClick={() => setActive(isActive ? '' : signal.id)}
                aria-expanded={isActive}
                aria-label={`${signal.name} — ${signal.tagline}`}
                className={cx(
                  'group relative overflow-hidden rounded-xl border p-5 text-left transition-all duration-300',
                  isActive
                    ? 'border-[var(--accent-border)] bg-[var(--accent-tint-3)]'
                    : 'border-[var(--card-border)] bg-[var(--card-bg)] hover:border-[var(--border-mid)]',
                )}
                style={{ opacity: reduced ? 1 : undefined }}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10.5px] tracking-[0.2em] text-moon-3">
                    {signal.index}
                  </span>
                  <span
                    className={cx(
                      'flex h-8 w-8 items-center justify-center rounded-full border transition-transform duration-300',
                      isActive
                        ? 'rotate-180 border-[var(--accent-border)] text-brand-live'
                        : 'border-[var(--border-mid)] text-moon-3 group-hover:text-moon',
                    )}
                    aria-hidden="true"
                  >
                    <IconChevronDown size={13} />
                  </span>
                </div>

                <div className="mt-5 flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent-tint-2)] text-brand-live">
                    {kindMeta(signal.event).icon}
                  </span>
                  <div>
                    <div className="text-[15px] font-semibold text-moon">{signal.name}</div>
                    <div className="mt-0.5 font-mono text-[10px] text-moon-3">{signal.event}</div>
                  </div>
                </div>

                <p className="mt-4 text-[12.5px] leading-[1.55] text-moon-2/80">{signal.tagline}</p>
                <p className="mt-4 truncate font-mono text-[10px] tracking-[0.08em] text-brand-live/90">
                  {signal.trigger}
                </p>
              </button>
            )
          })}
        </div>

        {/* ── Micro-demo ──────────────────────────────────────────────── */}
        <AnimatePresence mode="wait">
          {demo && (
            <motion.div
              key={demo.id}
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -14 }}
              transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
              className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]"
            >
              {/* Snippet panel */}
              <div className="glass rounded-xl p-6 sm:p-8">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-moon-3">
                    live snippet · what the system heard
                  </span>
                  <span className="rounded-full bg-[var(--accent-tint)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-brand-live">
                    {demo.trigger}
                  </span>
                </div>
                <p className="mt-7 text-[17px] leading-[1.7] text-moon sm:text-[19px]">
                  {highlight(demo.snippet, demo.highlight)}
                </p>
                <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-moon-3">
                  <span>
                    confidence{' '}
                    <span className="text-brand-live">{demo.confidence}</span>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{demo.event}</span>
                </div>
              </div>

              {/* Card panel */}
              <div className="flex items-center">
                <div className="w-full">
                  <IntelCard
                    animateIn
                    kind={kindMeta(demo.event).label}
                    icon={kindMeta(demo.event).icon}
                    severity={SEV[demo.id]}
                    title={demo.name}
                    body={demo.body}
                  />
                  <p className="mt-3 px-1 font-mono text-[10px] uppercase tracking-[0.16em] text-moon-3">
                    {demo.name} → the rail · in real time
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  )
}

function highlight(text: string, tokens: string[]): React.JSX.Element[] {
  const pattern = new RegExp(
    `(${tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
    'g',
  )
  return text.split(pattern).map((part, i) =>
    tokens.includes(part) ? (
      <mark key={i} className="tok">
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  )
}
