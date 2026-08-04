// ============================================================================
// UseCasesSection — three people on the call, in an editorial broken grid.
// The middle column drifts down; the numerals carry the weight.
// ============================================================================

import { useRef } from 'react'
import { gsap } from 'gsap'
import { USE_CASES_NEW } from '@/data/content'
import { cx } from '@/lib/cx'
import { useSectionTimeline, prefersReducedMotion, useHeadingReveal } from '@/lib/motion'

export function UseCasesSection(): React.JSX.Element {
  const rootRef = useRef<HTMLElement>(null)
  const reduced = prefersReducedMotion()

  useHeadingReveal(rootRef)

  useSectionTimeline(
    rootRef,
    () => {
      if (reduced) return
      gsap.set('[data-case]', { y: 60, opacity: 0, force3D: true })
      const ctx = gsap.to('[data-case]', {
        y: 0,
        opacity: 1,
        duration: 0.95,
        stagger: 0.12,
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

  return (
    <section id="cases" ref={rootRef} className="dawn section">
      <div className="container">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="eyebrow">Who it serves · the people on the call</p>
            <h2 className="h2-display mt-6 max-w-[15ch] text-ink">
              <span className="mask-line"><span className="mask-line-inner">Built for the</span></span>
              <span className="mask-line"><span className="mask-line-inner"><em className="accent">voice</em> on the line.</span></span>
            </h2>
          </div>
          <p className="max-w-[36ch] text-[14px] leading-[1.6] text-ink-4">
            Not another dashboard to babysit. A co-pilot that answers the
            moment, for the three people who actually sell.
          </p>
        </div>

        <div className="mt-16 grid gap-5 md:grid-cols-3">
          {USE_CASES_NEW.map((useCase, i) => (
            <article
              key={useCase.id}
              data-case
              className={cx(
                'group relative flex flex-col rounded-2xl border border-rule bg-white/60 p-7 transition-all duration-500 hover:-translate-y-1.5 hover:border-brand/40 hover:shadow-[0_30px_60px_-24px_rgba(181,69,31,0.25)] sm:p-8',
                i === 1 && 'md:mt-12',
              )}
            >
              <div className="flex items-baseline justify-between">
                <span
                  aria-hidden="true"
                  className="font-display text-[64px] leading-none tracking-[-0.04em] text-ink/10 transition-colors duration-500 group-hover:text-brand/25"
                >
                  {useCase.index}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-4">
                  persona
                </span>
              </div>

              <p className="mt-5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-brand">
                {useCase.persona}
              </p>
              <h3 className="h3-display mt-3 text-ink">{useCase.headline}</h3>
              <p className="mt-4 flex-1 text-[13.5px] leading-[1.7] text-ink-3">
                {useCase.scenario}
              </p>

              <div className="mt-6 flex flex-wrap gap-2 border-t border-rule-soft pt-5">
                {useCase.surface.map((chip) => (
                  <span
                    key={chip}
                    className="rounded-full border border-rule bg-paper px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-3"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
