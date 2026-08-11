// ============================================================================
// PricingSection — the honest price. Self-hosted: $0 forever, as a dark
// inversion inside the dawn register — the one surface that stays night.
// ============================================================================

import { useRef } from 'react'
import { gsap } from 'gsap'
import { PRICING } from '@/data/content'
import { useSectionTimeline, prefersReducedMotion, useHeadingReveal } from '@/lib/motion'
import { IconArrow, IconCheck } from './icons'
import { Magnetic } from './Magnetic'

export function PricingSection(): React.JSX.Element {
  const rootRef = useRef<HTMLElement>(null)
  const reduced = prefersReducedMotion()

  useHeadingReveal(rootRef)

  useSectionTimeline(
    rootRef,
    () => {
      if (reduced) return
      gsap.set('[data-price-card]', { y: 54, opacity: 0, force3D: true })
      const ctx = gsap.to('[data-price-card]', {
        y: 0,
        opacity: 1,
        duration: 0.9,
        stagger: 0.14,
        ease: 'expo.out',
        scrollTrigger: { trigger: rootRef.current, start: 'top 68%' },
      })
      return () => {
        ctx.scrollTrigger?.kill()
        ctx.kill()
      }
    },
    [reduced],
  )

  return (
    <section id="pricing" ref={rootRef} className="dawn section">
      <div className="container">
        <div className="text-center">
          <p className="eyebrow">Pricing · one line</p>
          <h2 className="h2-display mx-auto mt-6 max-w-[14ch] text-ink">
            <span className="mask-line"><span className="mask-line-inner">The honest price is</span></span>
            <span className="mask-line"><span className="mask-line-inner"><em className="accent">$0.</em></span></span>
          </h2>
          <p className="lede mx-auto mt-6 max-w-[54ch]">
            Open source is not a growth hack here — it is the product. Run it
            forever on your hardware; pay only for the inference you choose.
          </p>
        </div>

        <div className="mx-auto mt-16 grid max-w-[980px] gap-5 md:grid-cols-2">
          {/* ── Self-hosted — the featured inversion ──────────────────── */}
          <div
            data-price-card
            className="nocturne relative overflow-hidden rounded-3xl p-8 touch-card sm:p-10"
            style={{
              border: '1px solid var(--accent-border)',
              boxShadow:
                '0 40px 90px -30px rgba(181,69,31,0.5), inset 0 0 60px var(--accent-tint-3)',
            }}
          >
            <div
              aria-hidden="true"
              className="glow left-1/2 top-0 h-[220px] w-[420px] -translate-x-1/2 -translate-y-1/2 bg-[var(--glow-warm)]"
            />
            <div className="relative">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-brand-live">
                  {PRICING.selfHosted.label}
                </span>
                <span className="rounded-full bg-[var(--accent-tint-2)] px-3 py-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-brand-live">
                  the whole stack
                </span>
              </div>

              <div className="mt-8 flex items-baseline gap-3">
                <span className="display text-moon">{PRICING.selfHosted.price}</span>
                <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-moon-3">
                  {PRICING.selfHosted.cadence}
                </span>
              </div>

              <p className="mt-6 text-[14px] leading-[1.7] text-moon-2">
                {PRICING.selfHosted.body}
              </p>

              <ul className="mt-8 space-y-3">
                {PRICING.selfHosted.points.map((point) => (
                  <li key={point} className="flex items-start gap-3 text-[13.5px] text-moon">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent-tint-2)] text-brand-live">
                      <IconCheck size={11} />
                    </span>
                    {point}
                  </li>
                ))}
              </ul>

              <Magnetic strength={0.3} className="mt-10">
                <a href="#cta" className="btn btn--primary w-full justify-center">
                  Start with your next call
                  <span className="btn-arrow">
                    <IconArrow size={14} />
                  </span>
                </a>
              </Magnetic>
            </div>
          </div>

          {/* ── Managed — optional ────────────────────────────────────── */}
          <div
            data-price-card
            className="relative flex flex-col rounded-3xl border border-rule bg-white/60 p-8 touch-card sm:p-10"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-ink-4">
                {PRICING.optional.label}
              </span>
              <span className="rounded-full border border-rule bg-paper px-3 py-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-4">
                optional
              </span>
            </div>

            <div className="mt-8 flex items-baseline gap-3">
              <span className="display text-ink">{PRICING.optional.price}</span>
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-4">
                {PRICING.optional.cadence}
              </span>
            </div>

            <p className="mt-6 text-[14px] leading-[1.7] text-ink-3">
              {PRICING.optional.body}
            </p>

            <ul className="mt-8 space-y-3">
              {PRICING.optional.points.map((point) => (
                <li key={point} className="flex items-start gap-3 text-[13.5px] text-ink-2">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-paper text-brand">
                    <IconCheck size={11} />
                  </span>
                  {point}
                </li>
              ))}
            </ul>

            <div className="mt-auto pt-10">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-5">
                not per seat. not per call. per deployment.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
