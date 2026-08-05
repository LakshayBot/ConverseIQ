// ============================================================================
// FinalCTA — the bookend. The page opened in the dark of the live call and
// closes the same way: the headline of the product's promise, at full scale.
// ============================================================================

import { useRef } from 'react'
import { gsap } from 'gsap'
import { SplitText } from 'gsap/SplitText'
import {
  EASE,
  paintAccentGradient,
  prefersReducedMotion,
  useSectionTimeline,
} from '@/lib/motion'
import { IconArrow, IconArrowUpRight, IconGitHub } from './icons'
import { Magnetic } from './Magnetic'

const GITHUB_URL = 'https://github.com/LakshayBot/ConverseIQ'

export function FinalCTA(): React.JSX.Element {
  const rootRef = useRef<HTMLElement>(null)
  const h2Ref = useRef<HTMLHeadingElement>(null)
  const reduced = prefersReducedMotion()

  useSectionTimeline(
    rootRef,
    () => {
      if (reduced) return
      const split = SplitText.create(h2Ref.current!, { type: 'chars', charsClass: 'char' })
      const clearGradient = paintAccentGradient(h2Ref.current!)

      // Pin every animated element to its from-state SYNCHRONOUSLY before
      // ScrollTrigger takes over. Without this, the chars / sub / actions /
      // foot would all be visible at their resting position for one frame
      // before the timeline started.
      gsap.set(split.chars, {
        yPercent: 112,
        rotateX: -50,
        transformOrigin: '50% 100%',
        force3D: true,
      })
      gsap.set('[data-cta-sub]', { y: 22, opacity: 0, force3D: true })
      gsap.set('[data-cta-actions]', { y: 20, opacity: 0, force3D: true })
      gsap.set('[data-cta-foot]', { opacity: 0 })

      const tl = gsap.timeline({
        scrollTrigger: { trigger: rootRef.current, start: 'top 72%' },
      })
      tl.to(split.chars, {
        yPercent: 0,
        rotateX: 0,
        duration: 1.0,
        stagger: 0.02,
        ease: 'power4.out',
        onComplete: () => gsap.set(split.chars, { overflow: 'visible' }),
      })
      tl.to('[data-cta-sub]', { y: 0, opacity: 1, duration: 0.7, ease: EASE.out }, '-=0.45')
      tl.to('[data-cta-actions]', { y: 0, opacity: 1, duration: 0.7, ease: EASE.out }, '-=0.45')
      tl.to('[data-cta-foot]', { opacity: 1, duration: 0.6 }, '-=0.3')
      return () => {
        tl.kill()
        clearGradient()
        split.revert()
      }
    },
    [reduced],
  )

  return (
    <section id="cta" ref={rootRef} className="nocturne section relative overflow-hidden">
      <div aria-hidden="true" className="glow left-1/2 top-1/2 h-[70vmax] w-[70vmax] -translate-x-1/2 -translate-y-1/2 bg-[rgba(181,69,31,0.14)]" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[30vh]"
        style={{
          background:
            'var(--hero-top-light)',
        }}
      />

      <div
        className="container relative flex flex-col items-center pb-24 pt-16 text-center"
        style={{ paddingBottom: 'calc(4rem + var(--safe-bottom))' }}
      >
        <p className="eyebrow">Ready when the next call is</p>

        <h2
          ref={h2Ref}
          className="display-xl mask-chars mt-10 max-w-[12ch]"
        >
          The call is still <em className="accent">live.</em>
        </h2>

        <p data-cta-sub className="lede mt-10 max-w-[52ch]">
          Start your next call with CallPilot — your machine, your model, your
          knowledge. And answer the question while it is still being asked.
        </p>

        <div data-cta-actions className="mt-12 flex flex-wrap items-center justify-center gap-3.5">
          <Magnetic strength={0.35}>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="btn btn--primary">
              Start with your next call
              <span className="btn-arrow">
                <IconArrow size={15} />
              </span>
            </a>
          </Magnetic>
          <Magnetic strength={0.25}>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="btn btn--ghost">
              <IconGitHub size={15} />
              Source on GitHub
              <IconArrowUpRight size={14} />
            </a>
          </Magnetic>
        </div>

        <p data-cta-foot className="mt-14 font-mono text-[10px] uppercase tracking-[0.2em] text-moon-3">
          one docker compose up · first transcript in ~30 s · zero audio stored
        </p>
      </div>
    </section>
  )
}
