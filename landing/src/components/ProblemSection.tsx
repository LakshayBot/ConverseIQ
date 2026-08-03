// ============================================================================
// ProblemSection — the narrative pivot of the page.
// Desktop: a pinned scroll story — the recap timeline scrubs forward
// ("call ends → uploaded → transcribed → summarized → recap at 9am") until
// the stamp "TOO LATE" slams down, then the whole machine blurs away and the
// same moment inverts: the card that lands DURING the call. The giant word
// behind the stage flips from "LATER" to "NOW."
// Mobile (< 1024px) and reduced motion: the two acts stack naturally in the
// page flow — nothing is pinned, nothing is hidden.
// ============================================================================

import { useRef } from 'react'
import { gsap } from 'gsap'
import { EASE, prefersReducedMotion, useSectionTimeline, useHeadingReveal } from '@/lib/motion'
import { useIsDesktop } from '@/lib/media'
import { cx } from '@/lib/cx'
import { IntelCard, type Severity } from './IntelCard'
import { IconPricing } from './icons'
import { SpeakerDot } from './SpeakerDot'

const TIMELINE_NODES = [
  { label: 'Call ends', meta: '14:32' },
  { label: 'Upload', meta: '14:34' },
  { label: 'Transcribe', meta: '15:10' },
  { label: 'Summarize', meta: '16:45' },
  { label: 'Recap', meta: '09:00 · +1d' },
]

export function ProblemSection(): React.JSX.Element {
  const rootRef = useRef<HTMLElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const reduced = prefersReducedMotion()
  const isDesktop = useIsDesktop()
  const staticLayout = reduced || !isDesktop

  useHeadingReveal(rootRef)

  useSectionTimeline(
    rootRef,
    () => {
      if (staticLayout) return

      const stage = stageRef.current
      if (!stage) return

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: stage,
          start: 'top top',
          end: '+=240%',
          scrub: 1,
          pin: true,
          anticipatePin: 1,
        },
      })

      // ── Act one: the recap machine ──────────────────────────────────
      tl.fromTo(
        '[data-tl-progress]',
        { scaleX: 0 },
        { scaleX: 1, duration: 2.3, ease: 'none' },
        0,
      )
      tl.fromTo(
        '[data-tl-dot]',
        { scale: 0 },
        { scale: 1, stagger: 0.42, duration: 0.25, ease: 'back.out(2.4)' },
        0.15,
      )
      tl.fromTo(
        '[data-tl-label]',
        { opacity: 0.22 },
        { opacity: 1, stagger: 0.42, duration: 0.2 },
        0.15,
      )

      // ── The stamp ───────────────────────────────────────────────────
      tl.fromTo(
        '[data-stamp]',
        { scale: 1.8, opacity: 0, rotate: -9 },
        { scale: 1, opacity: 1, rotate: 0, duration: 0.45, ease: 'back.out(1.8)' },
        2.25,
      )
      tl.to(
        '[data-stamp]',
        { scale: 1.04, duration: 0.35, repeat: 2, yoyo: true, ease: 'sine.inOut' },
        2.75,
      )

      // ── The inversion ───────────────────────────────────────────────
      tl.to(
        '[data-stage="later"]',
        { opacity: 0, scale: 0.97, filter: 'blur(10px)', duration: 0.5, ease: 'power2.in' },
        3.3,
      )
      tl.to('[data-bigword="later"]', { opacity: 0, scale: 1.1, duration: 0.5 }, 3.3)
      tl.fromTo(
        '[data-bigword="now"]',
        { opacity: 0, scale: 0.94 },
        { opacity: 1, scale: 1, duration: 0.55, ease: EASE.out },
        3.55,
      )
      tl.fromTo(
        '[data-stage="now"]',
        { opacity: 0, y: 56 },
        { opacity: 1, y: 0, duration: 0.6, ease: EASE.out },
        3.6,
      )
      tl.fromTo(
        '[data-now-transcript]',
        { opacity: 0, x: -18 },
        { opacity: 1, x: 0, duration: 0.5, ease: EASE.out },
        3.9,
      )
      tl.fromTo(
        '[data-now-card]',
        { opacity: 0, y: 26, scale: 0.96 },
        { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: 'back.out(1.6)' },
        4.05,
      )
      tl.fromTo(
        '[data-now-meta]',
        { opacity: 0 },
        { opacity: 1, duration: 0.4 },
        4.3,
      )
    },
    [staticLayout],
  )

  return (
    <section id="problem" ref={rootRef} className="nocturne section">
      <div className="container">
        <p className="eyebrow">The problem · post-call intelligence</p>
        <h2 className="h2-display mt-6 max-w-[24ch]">
          <span className="mask-line"><span className="mask-line-inner">The recap arrives when</span></span>
          <span className="mask-line"><span className="mask-line-inner">it <em className="accent">can’t help you.</em></span></span>
        </h2>
        <p className="lede mt-6 max-w-[56ch]">
          Every meeting platform records the call, transcribes it, summarizes
          it, and ships the recap next morning. By then the deal has moved on —
          and the objection you missed is the one that lost it.
        </p>
      </div>

      {/* ── Pinned stage (desktop) / stacked flow (mobile) ────────────── */}
      <div
        ref={stageRef}
        className="relative mx-auto mt-16 w-full max-w-[1240px] px-[clamp(1.25rem,4vw,3rem)]"
        style={{ height: staticLayout ? undefined : 'clamp(430px, 62vh, 560px)' }}
      >
        {/* Giant words behind the stage */}
        <div
          aria-hidden="true"
          data-bigword="later"
          className={cx(
            'text-outline pointer-events-none absolute inset-0 flex items-center justify-center',
            staticLayout && 'hidden',
          )}
          style={{ fontSize: 'clamp(6rem, 18vw, 16rem)', zIndex: 0 }}
        >
          LATER
        </div>
        <div
          aria-hidden="true"
          data-bigword="now"
          className={cx(
            'pointer-events-none absolute inset-0 flex items-center justify-center',
            staticLayout && 'hidden',
          )}
          style={{ fontSize: 'clamp(6rem, 18vw, 16rem)', zIndex: 0, color: 'rgba(181,69,31,0.5)' }}
        >
          NOW
        </div>

        {/* ── Act one: the recap timeline ─────────────────────────────── */}
        <div data-stage="later" className={staticLayout ? 'relative mt-14' : 'absolute inset-0 z-[1]'}>
          <div className="relative mx-auto max-w-[900px] pt-[14vh]">
            <div className="relative">
              <div
                aria-hidden="true"
                className="absolute left-0 right-0 top-[5px] h-px bg-white/[0.1]"
              />
              <div
                aria-hidden="true"
                data-tl-progress
                className="absolute left-0 right-0 top-[5px] h-px origin-left"
                style={{
                  background:
                    'linear-gradient(90deg, var(--color-brand), var(--color-brand-live))',
                  boxShadow: '0 0 12px rgba(255,122,80,0.5)',
                  transform: staticLayout ? undefined : 'scaleX(0)',
                }}
              />
              <div className="relative flex justify-between gap-1">
                {TIMELINE_NODES.map((node) => (
                  <div key={node.label} className="flex flex-col items-center gap-3">
                    <span
                      data-tl-dot
                      className="block h-[11px] w-[11px] shrink-0 rounded-full border-2 border-brand-live bg-ink-950"
                      style={{ transform: staticLayout ? undefined : 'scale(0)' }}
                    />
                    <div data-tl-label className="text-center" style={{ opacity: staticLayout ? undefined : 0.22 }}>
                      <div className="font-mono text-[10px] tracking-[0.06em] text-moon-2 sm:text-[11px] sm:tracking-[0.08em]">
                        {node.label}
                      </div>
                      <div className="mt-1 hidden font-mono text-[10px] text-moon-3 sm:block">
                        {node.meta}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-[10vh] flex justify-center">
              <span
                data-stamp
                className={cx(
                  'inline-block rounded-xl border-2 border-brand-live/60 px-8 py-4 font-mono text-[clamp(1.6rem,4vw,2.6rem)] font-semibold uppercase tracking-[0.28em] text-brand-live',
                  !staticLayout && 'opacity-0',
                )}
                style={{ boxShadow: '0 0 60px rgba(255,122,80,0.25), inset 0 0 30px rgba(255,122,80,0.08)' }}
              >
                Too late.
              </span>
            </div>
          </div>
        </div>

        {/* ── Act two: the same moment, live ──────────────────────────── */}
        <div data-stage="now" className={staticLayout ? 'relative mt-16' : 'absolute inset-0 z-[2] opacity-0'}>
          <div className="mx-auto grid max-w-[980px] items-center gap-8 lg:grid-cols-2">
            <div data-now-transcript>
              <div className="flex items-start gap-3">
                <SpeakerDot speaker="prospect" pulse />
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--color-prospect)' }}>
                      PROSPECT
                    </span>
                    <span className="font-mono text-[10px] text-moon-3">14:32:14</span>
                  </div>
                  <p className="mt-1.5 text-[15px] leading-[1.6] text-moon">
                    What does the enterprise license run per year — and is there
                    a self-hosted option?
                  </p>
                </div>
              </div>
              <div className="mt-8 border-l-2 border-brand-live pl-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-brand-live">
                  surfaced during the call
                </p>
                <p className="mt-2 max-w-[44ch] text-[14px] leading-[1.6] text-moon-2">
                  Not after it. The pricing card is on the rail before the buyer
                  finishes the sentence — with the rate card you uploaded as its
                  source.
                </p>
              </div>
            </div>

            <div data-now-card className="mx-auto w-full max-w-[400px]">
              <IntelCard
                animateIn={!staticLayout}
                kind="Pricing question"
                icon={<IconPricing size={11} />}
                severity={'high' as Severity}
                title="Enterprise license · self-hosted"
                body="Quote the annual rate card, then lead with VPC deployment: Docker Compose on their infra, BYOK LLM key, no audio persisted."
                sources={[
                  'rate-card-2026.md · "Enterprise annual · page 2"',
                  'security-brief.md · "All processing on customer infrastructure"',
                ]}
              />
            </div>
          </div>

          <div data-now-meta className="mt-12 flex flex-wrap items-center gap-6 eyebrow text-[10.5px]!">
            <span>recap pipeline</span>
            <span aria-hidden="true">·</span>
            <span className="text-brand-live">live rail · ~300 ms</span>
            <span aria-hidden="true">·</span>
            <span>same conversation, same minute</span>
          </div>
        </div>
      </div>
    </section>
  )
}
