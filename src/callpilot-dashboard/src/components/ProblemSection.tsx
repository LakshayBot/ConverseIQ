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
import { EASE, prefersReducedMotion, useSectionTimeline, useHeadingReveal, useStaggerReveal } from '@/lib/motion'
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

// A few ember specks drifting through the pause — barely there.
const LATER_PARTICLES = [
  { id: 'p1', x: '12%', y: '30%', size: 4, delay: '0s', dur: '7s' },
  { id: 'p2', x: '86%', y: '24%', size: 3, delay: '1.2s', dur: '9s' },
  { id: 'p3', x: '78%', y: '58%', size: 5, delay: '0.6s', dur: '8s' },
  { id: 'p4', x: '22%', y: '66%', size: 3, delay: '2.1s', dur: '10s' },
  { id: 'p5', x: '38%', y: '16%', size: 3, delay: '0.9s', dur: '6.5s' },
  { id: 'p6', x: '64%', y: '76%', size: 4, delay: '1.6s', dur: '8.5s' },
  { id: 'p7', x: '52%', y: '88%', size: 3, delay: '0.3s', dur: '7.5s' },
  { id: 'p8', x: '8%', y: '50%', size: 4, delay: '2.4s', dur: '9.5s' },
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

      // ── Pin every animated piece to its from-state synchronously.
      // The inline `style={staticLayout ? undefined : '...'}` defaults
      // would otherwise leak through for one frame on initial mount
      // before GSAP took over.
      gsap.set('[data-later-caption]', { opacity: 0, y: 14 })
      gsap.set('[data-later-glow]', { opacity: 0 })
      gsap.set('[data-later-particles]', { opacity: 0, y: 10 })
      gsap.set('[data-bigword="later"]', { opacity: 0, scale: 0.98, y: 16 })
      gsap.set('[data-tl-progress]', { scaleX: 0, transformOrigin: 'left center' })
      gsap.set('[data-tl-dot]', { scale: 0, filter: 'blur(3px)' })
      gsap.set('[data-tl-ring]', { opacity: 0.55, scale: 0.4 })
      gsap.set('[data-tl-label]', { clipPath: 'inset(0% 0% 100% 0%)', y: 8 })
      gsap.set('[data-stamp]', { scale: 1.35, opacity: 0, rotate: -8, filter: 'blur(6px)' })
      gsap.set('[data-bigword="now"]', { opacity: 0, scale: 0.96 })
      gsap.set('[data-stage="now"]', { opacity: 0, y: 40, force3D: true })
      gsap.set('[data-now-transcript]', { clipPath: 'inset(0% 0% 100% 0%)', y: 14 })
      gsap.set('[data-now-signal-beam]', { scaleY: 0, transformOrigin: 'top center' })
      gsap.set('[data-now-signal-dot]', { y: 0 })
      gsap.set('[data-now-signal-label]', { opacity: 0, x: -8 })
      gsap.set('[data-now-card]', {
        opacity: 0,
        y: 56,
        scale: 0.93,
        rotate: 1.5,
        filter: 'blur(6px)',
        force3D: true,
      })
      gsap.set('[data-now-pedestal]', { opacity: 0 })
      gsap.set('[data-now-decision]', { opacity: 0, x: 14 })
      gsap.set('[data-now-meta]', { opacity: 0 })

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

      // ── Act one: after the call — the pause ─────────────────────────
      // The caption drifts up, the aura breathes in, the embers appear,
      // and the word settles like an engraving catching the light.
      tl.to('[data-later-caption]', { opacity: 1, y: 0, duration: 0.6, ease: EASE.out }, 0.1)
      tl.to('[data-later-glow]', { opacity: 1, duration: 1.5, ease: 'sine.inOut' }, 0.15)
      tl.to('[data-later-particles]', { opacity: 1, y: 0, duration: 1.2, ease: EASE.out }, 0.3)
      tl.to(
        '[data-bigword="later"]',
        { opacity: 1, scale: 1.02, y: -6, duration: 1.4, ease: 'power2.out' },
        0.2,
      )

      // The processing machine runs — each station arrives in quiet order.
      tl.to('[data-tl-progress]', { scaleX: 1, duration: 2.1, ease: 'none' }, 0.55)
      tl.to(
        '[data-tl-dot]',
        { scale: 1, filter: 'blur(0px)', stagger: 0.38, duration: 0.45, ease: 'power2.out' },
        0.7,
      )
      tl.to(
        '[data-tl-ring]',
        { opacity: 0, scale: 1.7, stagger: 0.38, duration: 0.6, ease: 'power2.out' },
        0.7,
      )
      tl.to(
        '[data-tl-label]',
        { clipPath: 'inset(0% 0% 0% 0%)', y: 0, stagger: 0.38, duration: 0.5, ease: 'power2.out' },
        0.75,
      )

      // ── The seal — a slow press, no bounce ──────────────────────────
      tl.to(
        '[data-stamp]',
        { scale: 1, opacity: 1, rotate: -2.5, filter: 'blur(0px)', duration: 0.7, ease: 'power3.out' },
        2.3,
      )
      tl.to(
        '[data-stamp]',
        { scale: 1.02, duration: 0.5, repeat: 2, yoyo: true, ease: 'sine.inOut' },
        3.0,
      )

      // ── The inversion ───────────────────────────────────────────────
      tl.to(
        '[data-stage="later"]',
        { opacity: 0, scale: 0.97, filter: 'blur(10px)', duration: 0.5, ease: 'power2.in' },
        3.3,
      )
      tl.to('[data-bigword="later"]', { opacity: 0, scale: 1.08, duration: 0.5 }, 3.3)
      tl.to(
        '[data-later-caption], [data-later-glow], [data-later-particles]',
        { opacity: 0, duration: 0.5 },
        3.3,
      )

      // The word settles into the environment first — dim, behind everything.
      tl.to(
        '[data-bigword="now"]',
        { opacity: 0.8, scale: 1.05, duration: 0.55, ease: EASE.out },
        3.55,
      )
      tl.to(
        '[data-stage="now"]',
        { opacity: 1, y: 0, duration: 0.6, ease: EASE.out },
        3.6,
      )

      // 01 — the question wipes up from its own mask.
      tl.to(
        '[data-now-transcript]',
        { clipPath: 'inset(0% 0% 0% 0%)', y: 0, duration: 0.55, ease: EASE.out },
        3.9,
      )

      // the signal — the AI understands: the beam grows downward, the
      // pulse travels it, and the reading annotates itself.
      tl.to(
        '[data-now-signal-beam]',
        { scaleY: 1, duration: 0.45, ease: 'power2.inOut' },
        4.15,
      )
      tl.to(
        '[data-now-signal-dot]',
        { y: 32, duration: 0.45, ease: 'power2.inOut' },
        4.2,
      )
      tl.to(
        '[data-now-signal-label]',
        { opacity: 1, x: 0, duration: 0.35, ease: EASE.out },
        4.35,
      )

      // 02 — the payoff: the card rises, levels and sharpens onto its
      // pedestal; the glow blooms as it lands.
      tl.to(
        '[data-now-card]',
        {
          opacity: 1,
          y: 0,
          scale: 1,
          rotate: 0,
          filter: 'blur(0px)',
          duration: 0.75,
          ease: 'back.out(1.6)',
        },
        4.5,
      )
      tl.to('[data-now-pedestal]', { opacity: 1, duration: 0.5 }, 4.6)

      // the decision slides in beside it.
      tl.to(
        '[data-now-decision]',
        { opacity: 1, x: 0, duration: 0.5, ease: EASE.out },
        4.75,
      )

      // 03 — the same minute strip closes the reading path.
      tl.to('[data-now-meta]', { opacity: 1, duration: 0.4 }, 4.95)
    },
    [staticLayout],
  )

  // Mobile / static flow: the two acts read top-to-bottom — the timeline
  // stations step in as they scroll into view, the stamp presses down on
  // arrival, and the NOW scene reveals layer by layer, like reading a chat.
  useStaggerReveal(stageRef, '[data-tl-station], [data-now-transcript], [data-now-signal], [data-now-card], [data-now-decision], [data-now-meta]', {
    enabled: staticLayout,
    y: 26,
    stagger: 0.08,
  })
  useStaggerReveal(stageRef, '[data-stamp]', { enabled: staticLayout, y: 14, scale: 0.94, delay: 0.15 })

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
        style={{ height: staticLayout ? undefined : 'clamp(684px, 78vh, 720px)' }}
      >
        {/* ── Act one: after the call — the pause ────────────────────────
            A centred editorial moment: the caption, the engraved word,
            the processing timeline, the stamp. The word is atmosphere —
            blurred warm light behind it, a few embers drifting — and the
            timeline carries the story. The eye moves straight down. */}
        <div data-stage="later" className={staticLayout ? 'relative mt-14' : 'absolute inset-0 z-[1]'}>
          {/* Atmosphere */}
          <div aria-hidden="true" data-later-glow className="later-glow" />
          <div aria-hidden="true" data-later-particles className="later-particles pointer-events-none absolute inset-0 overflow-hidden">
            {LATER_PARTICLES.map((p) => (
              <span
                key={p.id}
                style={{
                  left: p.x,
                  top: p.y,
                  width: p.size,
                  height: p.size,
                  animationDelay: p.delay,
                  ['--later-float-dur' as string]: p.dur,
                }}
              />
            ))}
          </div>

          <div className="relative mx-auto flex h-full max-w-[760px] flex-col items-center justify-center px-6 pb-4">
            {/* Caption */}
            <p data-later-caption className="later-caption">after the call</p>

            {/* The engraved word */}
            <div data-bigword="later" className="later-word mt-5">
              LATER
            </div>

            {/* The processing timeline — the story */}
            <div className="relative mt-10 w-full">
              <div
                aria-hidden="true"
                className="absolute left-0 right-0 top-[6px] h-px"
                style={{
                  background:
                    'linear-gradient(90deg, transparent, var(--border-strong) 12%, var(--border-strong) 88%, transparent)',
                }}
              />
              <div
                aria-hidden="true"
                data-tl-progress
                className="absolute left-0 right-0 top-[6px] h-px origin-left"
                style={{
                  background:
                    'linear-gradient(90deg, var(--color-brand), var(--color-brand-live))',
                  boxShadow: 'var(--shadow-rail), 0 0 24px var(--glow-warm)',
                  transform: staticLayout ? undefined : 'scaleX(0)',
                }}
              />
              <div className="relative flex justify-between gap-1">
                {TIMELINE_NODES.map((node) => (
                  <div key={node.label} data-tl-station className="flex flex-col items-center gap-3">
                    <span
                      data-tl-dot
                      className="relative block h-3 w-3 shrink-0 rounded-full"
                      style={{ transform: staticLayout ? undefined : 'scale(0)' }}
                    >
                      <span
                        aria-hidden="true"
                        className="absolute inset-0 rounded-full border border-brand-live/70"
                      />
                      <span
                        aria-hidden="true"
                        className="absolute inset-[3px] rounded-full bg-brand-live"
                        style={{ boxShadow: 'var(--shadow-dot)' }}
                      />
                      <span
                        aria-hidden="true"
                        data-tl-ring
                        className="absolute -inset-2 rounded-full border border-brand-live/30 opacity-0"
                      />
                    </span>
                    <div data-tl-label className="text-center">
                      <div className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-moon-2 sm:text-[11px]">
                        {node.label}
                      </div>
                      <div className="mt-1.5 hidden font-mono text-[9.5px] tracking-[0.08em] text-moon-3 sm:block">
                        {node.meta}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* The seal — the punchline */}
            <div className="mt-12 flex justify-center">
              <span
                data-stamp
                className={cx(
                  'relative inline-block rounded-2xl px-9 py-4 sm:px-11',
                  !staticLayout && 'opacity-0',
                )}
                style={{
                  background: 'var(--stamp-bg)',
                  border: '1px solid var(--accent-border)',
                  boxShadow: 'var(--shadow-stamp), inset 0 0 30px var(--accent-tint-3)',
                  transform: staticLayout ? undefined : 'rotate(-2.5deg)',
                }}
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-1.5 rounded-xl border border-dashed border-[var(--accent-border)]"
                />
                <span className="relative block font-mono text-[clamp(1.35rem,3.4vw,2.2rem)] font-semibold uppercase tracking-[0.3em] text-brand-live">
                  Too late.
                </span>
              </span>
            </div>
          </div>
        </div>

        {/* ── Act two: the same moment, live ────────────────────────────
            A cinematic sequence in layers, not rows:
            01 the question (top) → the signal travels (middle) →
            02 the card lands (bottom) → 03 the decision strip (edge).
            The NOW wordmark is pure environment — dim, right, behind
            the card's edge. The bottom fade pulls into the next chapter. */}
        <div data-stage="now" className={staticLayout ? 'relative mt-16' : 'absolute inset-0 z-[2] opacity-0'}>
          {/* lg top padding clears the fixed navbar: the pinned stage sits
              at the viewport top, so the composition needs its own air
              above the headline. */}
          <div className="relative mx-auto flex h-full max-w-[1120px] flex-col justify-between pb-2 lg:pt-[92px]">
            {/* 01 — the question */}
            <div data-now-transcript className="max-w-[48ch]">
              <div className="flex items-center gap-3">
                <span className="font-mono text-[10px] tracking-[0.2em] text-moon-3">01</span>
                <span aria-hidden="true" className="h-px w-6 bg-[var(--border-strong)]" />
                <SpeakerDot speaker="prospect" pulse />
                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--color-prospect)' }}>
                  PROSPECT
                </span>
                <span className="font-mono text-[10px] text-moon-3">14:32:14</span>
                <span className="ml-1 flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-brand-live">
                  <span className="h-1 w-1 animate-pulse rounded-full bg-brand-live" />
                  live
                </span>
              </div>

              <p className="mt-5 font-display text-[clamp(1.5rem,2.7vw,2.3rem)] leading-[1.24] tracking-[-0.02em] text-moon">
                What does the <em className="accent">enterprise license</em> run per year —
                and is there a self-hosted option?
              </p>

              <p className="mt-2.5 max-w-[44ch] text-[13px] leading-[1.6] text-moon-3">
                The trie caught the phrase in 200 ms — grounded in the rate
                card you uploaded.
              </p>
            </div>

            {/* the signal — the AI understands */}
            <div data-now-signal className="flex items-center gap-5">
              <div className="relative h-10 w-px bg-[var(--border-track)]">
                <span
                  data-now-signal-beam
                  aria-hidden="true"
                  className="absolute inset-0 origin-top"
                  style={{
                    transform: staticLayout ? undefined : 'scaleY(0)',
                    background:
                      'linear-gradient(180deg, var(--color-brand-live), var(--accent-tint-3))',
                    boxShadow: 'var(--shadow-rail)',
                  }}
                />
                <span
                  data-now-signal-dot
                  aria-hidden="true"
                  className="absolute -left-[3.5px] top-0 h-2 w-2 rounded-full bg-brand-live"
                  style={{ boxShadow: 'var(--shadow-dot)' }}
                />
              </div>
              <span data-now-signal-label className="font-mono text-[10px] uppercase tracking-[0.16em] text-moon-3">
                pricing · trie + regex · <span className="text-brand-live">0.88</span>
              </span>
            </div>

            {/* 02 — the card, the payoff */}
            <div className="grid items-end gap-8 lg:grid-cols-12 lg:gap-10">
              <div data-now-card className="lg:col-span-7">
                <div className="group relative mx-auto w-full max-w-[430px] lg:mx-0">
                  {/* A focused, directional top-light on the card — narrow
                      radial, tight blur, so the glow reads as light from
                      the composition rather than a wash across the stage. */}
                  <div
                    aria-hidden="true"
                    className="absolute -top-12 left-1/2 h-44 w-[110%] -translate-x-1/2"
                    style={{
                      background:
                        'radial-gradient(52% 65% at 50% 8%, var(--glow-card), transparent 72%)',
                      filter: 'blur(36px)',
                    }}
                  />
                  <div
                    data-now-pedestal
                    aria-hidden="true"
                    className="absolute -bottom-8 left-1/2 h-8 w-4/5 -translate-x-1/2 rounded-full bg-[var(--glow-pedestal)] blur-2xl"
                  />
                  {/* gradient-ring shell — the payoff frame */}
                  <div
                    className="relative rounded-2xl p-px transition-transform duration-500 group-hover:-translate-y-1"
                    style={{ background: 'var(--ring-accent)' }}
                  >
                    <div className="rounded-[calc(1rem-1px)] bg-[var(--surface-glass-solid)] shadow-[var(--shadow-shell)] backdrop-blur-xl transition-shadow duration-500 group-hover:shadow-[var(--shadow-shell-hover)]">
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
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-x-8 top-0 h-8 rounded-full bg-[var(--reflection)] blur-xl"
                    />
                  </div>
                  <p className="mt-2 flex items-center justify-center gap-2.5 font-mono text-[10px] uppercase tracking-[0.16em] text-moon-3">
                    <span>02</span>
                    <span aria-hidden="true" className="h-px w-4 bg-[var(--border-strong)]" />
                    the rail · live
                  </p>
                </div>
              </div>

              {/* the decision */}
              <div data-now-decision className="lg:col-span-5 lg:pb-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-brand-live">
                  the decision
                </p>
                <p className="mt-3 max-w-[34ch] text-[14px] leading-[1.7] text-moon-2">
                  Quote the annual rate card, then lead with VPC deployment —
                  BYOK key, no audio persisted.
                </p>
                <p className="mt-4 flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-moon-3">
                  your next sentence
                  <span aria-hidden="true" className="text-brand-live">→</span>
                </p>
              </div>
            </div>

            {/* 03 — the same minute */}
            <div data-now-meta className="border-t border-[var(--border-faint)] pt-3">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <span className="font-mono text-[10px] tracking-[0.2em] text-moon-3">03</span>
                <span aria-hidden="true" className="hidden h-px w-6 bg-[var(--border-strong)] sm:block" />
                <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-moon-2">
                  the question · 14:32:14
                </span>
                <span aria-hidden="true" className="text-brand-live">→</span>
                <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-moon-2">
                  +200 ms · the trie
                </span>
                <span aria-hidden="true" className="text-brand-live">→</span>
                <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-moon-2">
                  +298 ms · the card
                </span>
                <span aria-hidden="true" className="text-brand-live">→</span>
                <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-brand-live">
                  your next sentence
                </span>
              </div>
            </div>
          </div>

          {/* pull into the next chapter */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-10"
            style={{ background: 'var(--section-fade)' }}
          />
        </div>
      </div>
    </section>
  )
}
