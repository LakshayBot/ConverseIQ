// ============================================================================
// CardAnatomy — the intelligence card, dissected. Every part is annotated;
// hovering an annotation lights that part of the card. A severity switcher
// (high / medium / low) shows how the same claim changes volume.
// ============================================================================

import { useRef, useState } from 'react'
import { gsap } from 'gsap'
import { ANATOMY_NOTES } from '@/data/content'
import { cx } from '@/lib/cx'
import { useSectionTimeline, prefersReducedMotion } from '@/lib/motion'
import { SEV_COLOR, type Severity } from './IntelCard'
import { IconProduct, IconSource } from './icons'

const SEVERITIES: Severity[] = ['high', 'medium', 'low']

export function CardAnatomy(): React.JSX.Element {
  const rootRef = useRef<HTMLElement>(null)
  const [severity, setSeverity] = useState<Severity>('high')
  const [note, setNote] = useState<string>('n1')
  const reduced = prefersReducedMotion()

  useSectionTimeline(
    rootRef,
    () => {
      if (reduced) return
      const ctx = gsap.fromTo(
        '[data-anatomy]',
        { y: 44, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.9,
          stagger: 0.1,
          ease: 'expo.out',
          scrollTrigger: { trigger: rootRef.current, start: 'top 68%' },
        },
      )
      return () => {
        ctx.scrollTrigger?.kill()
        ctx.kill()
      }
    },
    [reduced],
  )

  const sevColor = SEV_COLOR[severity]

  return (
    <section id="anatomy" ref={rootRef} className="nocturne section">
      <div className="container">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="eyebrow">The artifact · anatomy of a card</p>
            <h2 className="h2-display mask-lines mt-6 max-w-[17ch]">
              A claim with <em className="accent">receipts.</em>
            </h2>
          </div>
          <p className="max-w-[36ch] text-[14px] leading-[1.6] text-moon-3">
            Every card is structured the same way, in the live rail and on
            this page: type, priority, headline, talking point, sources.
          </p>
        </div>

        <div className="mt-14 grid gap-12 lg:grid-cols-2 lg:items-center">
          {/* ── The card ──────────────────────────────────────────────── */}
          <div data-anatomy className="relative mx-auto w-full max-w-[470px]">
            <div
              aria-hidden="true"
              className="glow left-1/2 top-1/2 h-[80%] w-[80%] -translate-x-1/2 -translate-y-1/2 bg-[rgba(181,69,31,0.22)]"
            />

            {/* Severity switcher */}
            <div className="relative z-[1] mb-5 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-moon-3">
                priority
              </span>
              <div className="flex gap-1.5">
                {SEVERITIES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    data-cursor="hover"
                    onClick={() => setSeverity(s)}
                    aria-pressed={severity === s}
                    className={cx(
                      'rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] transition-all duration-300',
                      severity === s
                        ? 'border-brand-live/50 bg-[rgba(255,122,80,0.1)] text-brand-live'
                        : 'border-white/[0.1] text-moon-3 hover:text-moon',
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div
              className="relative z-[1] overflow-hidden rounded-2xl border border-black/[0.07] bg-white/[0.06] shadow-[0_2px_10px_rgba(0,0,0,0.35),0_30px_70px_-20px_rgba(0,0,0,0.6)] backdrop-blur-sm transition-all duration-500"
              style={{ borderLeft: `3px solid ${sevColor}` }}
            >
              <div className="p-5 sm:p-6">
                <div
                  data-anatomy-part="n1"
                  className={cx('flex items-center justify-between gap-2 transition-all duration-300', note === 'n1' && 'rounded-lg bg-[rgba(255,122,80,0.08)] p-1 -m-1')}
                >
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.09em]"
                    style={{ background: 'var(--intel-badge)', color: sevColor }}
                  >
                    <IconProduct size={11} />
                    Product match
                  </span>
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.1] px-2.5 py-0.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.12em]"
                    style={{ color: sevColor }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: sevColor }} />
                    {severity}
                  </span>
                </div>

                <div
                  data-anatomy-part="n3"
                  className={cx('mt-3 text-[17px] font-semibold leading-snug text-moon transition-all duration-300', note === 'n3' && 'text-brand-live')}
                >
                  Apex 100 — grid gateway
                </div>

                <div
                  data-anatomy-part="n4"
                  className={cx('mt-2 text-[13px] leading-[1.6] text-moon-2 transition-all duration-300', note === 'n4' && 'text-moon')}
                >
                  500+ endpoints per gateway, OTA firmware updates, API-based
                  billing. Lead with the endpoint density — it’s their stated
                  constraint, and the rate card matches the Pro tier.
                </div>

                <div
                  data-anatomy-part="n5"
                  className="mt-4 border-t border-white/[0.08] pt-3"
                >
                  <div className={cx('flex items-center gap-1.5 font-mono text-[10.5px] transition-colors duration-300', note === 'n5' ? 'text-brand-live' : 'text-moon-2')}>
                    <IconSource size={11} />
                    Sources (2)
                  </div>
                  <ul className="mt-2 space-y-1.5">
                    <li className="border-l-2 border-white/[0.14] pl-2 font-mono text-[10.5px] leading-relaxed text-moon-2">
                      apex-100-spec.pdf · “500+ endpoints” · page 3
                    </li>
                    <li className="border-l-2 border-white/[0.14] pl-2 font-mono text-[10.5px] leading-relaxed text-moon-2">
                      rate-card-2026.md · “Pro tier” · §2.1
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          {/* ── Annotations ───────────────────────────────────────────── */}
          <div data-anatomy className="flex flex-col gap-3">
            {ANATOMY_NOTES.map((a) => (
              <button
                key={a.id}
                type="button"
                data-cursor="hover"
                onMouseEnter={() => setNote(a.id)}
                onFocus={() => setNote(a.id)}
                onMouseLeave={() => setNote('')}
                onBlur={() => setNote('')}
                onClick={() => setNote(note === a.id ? '' : a.id)}
                aria-pressed={note === a.id}
                className={cx(
                  'group flex items-start gap-5 rounded-xl border p-4 text-left transition-all duration-300',
                  note === a.id
                    ? 'border-brand-live/40 bg-[rgba(255,122,80,0.05)]'
                    : 'border-white/[0.07] bg-transparent hover:border-white/[0.16]',
                )}
              >
                <span
                  className={cx(
                    'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] tracking-[0.1em] transition-all duration-300',
                    note === a.id
                      ? 'border-brand-live/60 bg-brand-live text-ink-950'
                      : 'border-white/[0.14] text-moon-3 group-hover:text-moon',
                  )}
                >
                  {a.num}
                </span>
                <div>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[15px] font-semibold text-moon">{a.label}</span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-moon-3">
                      part {a.num}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[13px] leading-[1.6] text-moon-2">{a.detail}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
