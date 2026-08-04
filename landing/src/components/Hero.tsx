// ============================================================================
// Hero — the signature moment.
//   · The claim: "The answer, mid-question." Characters rise into their
//     clipped boxes while the page is still booting.
//   · The proof: the live call window below, typing a real call and landing
//     intelligence cards. The window sits on a tilted stage that flattens
//     as you scroll — the demo becomes the product.
//   · The room: the voice field — a particle sea that breathes with the call.
//
// Initial-state discipline — two phases, no gaps:
//   PHASE 1 (mount, useLayoutEffect, BEFORE the first paint): the heading is
//   split into characters and every element the boot timeline animates is
//   placed in its hidden "from" state. The resting state never paints — not
//   even behind the preloader, which reveals the hero progressively while
//   its curtain lifts.
//   PHASE 2 (boot, when the curtain completes): the timeline releases and
//   everything animates to rest. Nothing was ever shown pre-animation, so
//   there is no stable → animate → stable sequence.
// ============================================================================

import { useLayoutEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { SplitText } from 'gsap/SplitText'
import { EASE, paintAccentGradient, prefersReducedMotion } from '@/lib/motion'
import { VoiceField } from './three/VoiceField'
import { LiveCallWindow } from './LiveCallWindow'
import { IconArrow, IconArrowUpRight, IconGitHub } from './icons'
import { Magnetic } from './Magnetic'

const GITHUB_URL = 'https://github.com/LakshayBot/ConverseIQ'

export function Hero({ booted }: { booted: boolean }): React.JSX.Element {
  const rootRef = useRef<HTMLElement>(null)
  const eyebrowRef = useRef<HTMLDivElement>(null)
  const h1Ref = useRef<HTMLHeadingElement>(null)
  const ledeRef = useRef<HTMLParagraphElement>(null)
  const metaRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const stageFadeRef = useRef<HTMLDivElement>(null)
  const cueRef = useRef<HTMLDivElement>(null)
  const splitRef = useRef<SplitText | null>(null)
  const clearGradientRef = useRef<() => void>(() => {})

  // ── Phase 1: hidden from-state, applied before the first paint ──────
  // The preloader's curtain reveals the hero gradually while booted is
  // still false — so the from-state must exist from mount, not from boot.
  useLayoutEffect(() => {
    const reduced = prefersReducedMotion()
    if (reduced) {
      if (h1Ref.current) gsap.set(h1Ref.current, { opacity: 1 })
      return
    }
    if (!h1Ref.current) return

    const split = SplitText.create(h1Ref.current, { type: 'chars', charsClass: 'char' })
    splitRef.current = split
    clearGradientRef.current = paintAccentGradient(h1Ref.current)
    gsap.set(split.chars, { yPercent: 118, rotateX: -50, opacity: 0, force3D: true })

    if (eyebrowRef.current) gsap.set(eyebrowRef.current, { y: 16, opacity: 0, force3D: true })
    if (ledeRef.current) gsap.set(ledeRef.current, { y: 22, opacity: 0, force3D: true })
    if (metaRef.current) gsap.set(metaRef.current, { y: 18, opacity: 0, force3D: true })
    if (stageRef.current) gsap.set(stageRef.current, { y: 90, opacity: 0, force3D: true })
    if (cueRef.current) gsap.set(cueRef.current, { opacity: 0 })

    // The accent gradient is measured against the layout. If the webfonts
    // swap in after mount, re-measure once so the phrase stays continuous.
    const reapplyGradient = (): void => {
      clearGradientRef.current()
      if (h1Ref.current) clearGradientRef.current = paintAccentGradient(h1Ref.current)
    }
    void (document.fonts?.ready ?? Promise.resolve()).then(() => reapplyGradient())

    return () => {
      split.revert()
      splitRef.current = null
      clearGradientRef.current()
    }
  }, [])

  // ── Phase 2: the boot timeline — plays the moment the curtain lifts ──
  useLayoutEffect(() => {
    if (!booted) return

    const split = splitRef.current
    const tl = gsap.timeline()
    tl.to(eyebrowRef.current, { y: 0, opacity: 1, duration: 0.6, ease: EASE.out })
    if (split) {
      tl.to(
        split.chars,
        {
          yPercent: 0,
          rotateX: 0,
          opacity: 1,
          duration: 0.95,
          stagger: 0.014,
          ease: 'power4.out',
          delay: 0.05,
          onComplete: () => gsap.set(split.chars, { overflow: 'visible' }),
        },
        '<0.1',
      )
    }
    tl.to(ledeRef.current, { y: 0, opacity: 1, duration: 0.8, ease: EASE.out }, '-=0.5')
    tl.to(metaRef.current, { y: 0, opacity: 1, duration: 0.7, ease: EASE.out }, '-=0.55')
    tl.to(
      '[data-hero="stage"]',
      { y: 0, opacity: 1, duration: 1.15, ease: EASE.out, delay: 0.15 },
      '-=0.6',
    )
    tl.to(cueRef.current, { opacity: 1, duration: 0.5 }, '-=0.4')

    return () => {
      tl.kill()
    }
  }, [booted])

  // ── Scroll flattening — the stage tilts back and settles as you scroll ──
  useLayoutEffect(() => {
    if (!stageRef.current) return
    const stage = stageRef.current

    const tween = gsap.fromTo(
      stage,
      { rotateX: 14, scale: 0.96, transformOrigin: '50% 30%' },
      {
        rotateX: 0,
        scale: 1,
        ease: 'none',
        scrollTrigger: {
          trigger: stage,
          start: 'top 92%',
          end: 'top 30%',
          scrub: 1,
        },
      },
    )

    const fade = gsap.to(stageFadeRef.current, {
      opacity: 0.25,
      y: -60,
      ease: 'none',
      scrollTrigger: {
        trigger: rootRef.current,
        start: 'top top',
        end: 'bottom top',
        scrub: 1,
      },
    })

    return () => {
      tween.scrollTrigger?.kill()
      tween.kill()
      fade.scrollTrigger?.kill()
      fade.kill()
    }
  }, [])

  return (
    <section
      ref={rootRef}
      id="top"
      className="nocturne relative flex min-h-[100svh] flex-col overflow-hidden"
    >
      {/* ── The room: voice field + ambient glow ───────────────────────── */}
      <VoiceField className="absolute inset-0 z-0 h-full w-full" />
      <div aria-hidden="true" className="glow right-[-20%] top-[30%] h-[48vmax] w-[48vmax] bg-[var(--glow-cool)]" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-[42vh]"
        style={{ background: 'var(--hero-top-light)' }}
      />

      <div className="relative z-[2] mx-auto flex w-full max-w-[1240px] flex-1 flex-col justify-end px-[clamp(1.25rem,4vw,3rem)] pb-10 pt-24">
        {/* ── Eyebrow ─────────────────────────────────────────────────── */}
        <div ref={eyebrowRef} data-hero="eyebrow" className="eyebrow flex items-center gap-3">
          <span aria-hidden="true" className="relative inline-block h-2 w-2 rounded-full bg-brand-live">
            <span className="absolute inset-0 animate-ping rounded-full bg-brand-live opacity-60" />
          </span>
          Real-time sales intelligence · open source
        </div>

        {/* ── Headline ────────────────────────────────────────────────── */}
        <h1
          ref={h1Ref}
          className="display mask-chars mt-6 max-w-[15ch]"
        >
          The answer, <em className="accent">mid&#8209;question.</em>
        </h1>

        <p ref={ledeRef} className="lede mt-6 max-w-[58ch]">
          CallPilot listens to your live sales call — spots competitors,
          objections, pricing and product mentions the moment they’re spoken —
          and surfaces a talking point grounded in your own knowledge base,
          ~300 ms after the trigger. On your machine. With your model.
        </p>

        {/* ── CTAs ────────────────────────────────────────────────────── */}
        <div className="mt-8 flex flex-wrap items-center gap-3.5">
          <Magnetic strength={0.35}>
            <a href="#cta" className="btn btn--primary">
              Start with your next call
              <span className="btn-arrow">
                <IconArrow size={15} />
              </span>
            </a>
          </Magnetic>
          <Magnetic strength={0.25}>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="btn btn--ghost"
            >
              <IconGitHub size={15} />
              Source on GitHub
              <IconArrowUpRight size={14} />
            </a>
          </Magnetic>
        </div>

        {/* ── Meta row ────────────────────────────────────────────────── */}
        <div ref={metaRef} className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-2 eyebrow text-[10.5px]!">
          <span>MIT licensed</span>
          <span aria-hidden="true">·</span>
          <span>Self-hosted</span>
          <span aria-hidden="true">·</span>
          <span>Bring your own model</span>
          <span aria-hidden="true">·</span>
          <span>No recording</span>
        </div>

        {/* ── The stage ───────────────────────────────────────────────── */}
        {/* The outer div owns the boot entrance (rise + fade-in) and the
            scroll flatten (tilt → flat). The inner div owns only the
            scroll-away fade — kept separate so the two never fight over
            the same properties. */}
        <div data-hero="stage" ref={stageRef} className="mt-9" style={{ perspective: 1400 }}>
          <div ref={stageFadeRef} className="will-change-transform">
            <LiveCallWindow />
          </div>
        </div>

        {/* ── Scroll cue ──────────────────────────────────────────────── */}
        <div ref={cueRef} data-hero="cue" className="pointer-events-none mt-9 flex items-center gap-4">
          <div className="cue-line" aria-hidden="true" />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-moon-3">
            the call is already playing
          </span>
        </div>
      </div>
    </section>
  )
}
