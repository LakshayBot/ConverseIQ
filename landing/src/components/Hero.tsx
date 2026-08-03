// ============================================================================
// Hero — the signature moment.
//   · The claim: "The answer arrives mid-question." Characters rise into
//     their clipped boxes while the page is still booting.
//   · The proof: the live call window below, typing a real call and landing
//     intelligence cards. The window sits on a tilted stage that flattens
//     as you scroll — the demo becomes the product.
//   · The room: the voice field — a particle sea that breathes with the call.
// ============================================================================

import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { SplitText } from 'gsap/SplitText'
import { EASE, prefersReducedMotion } from '@/lib/motion'
import { VoiceField } from './three/VoiceField'
import { LiveCallWindow } from './LiveCallWindow'
import { IconArrow, IconArrowUpRight, IconGitHub } from './icons'
import { Magnetic } from './Magnetic'

const GITHUB_URL = 'https://github.com/LakshayBot/ConverseIQ'

export function Hero({ booted }: { booted: boolean }): React.JSX.Element {
  const rootRef = useRef<HTMLElement>(null)
  const h1Ref = useRef<HTMLHeadingElement>(null)
  const ledeRef = useRef<HTMLParagraphElement>(null)
  const metaRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  // ── Boot choreography — only after the preloader lifts ──────────────
  useEffect(() => {
    if (!booted || !rootRef.current) return

    const tl = gsap.timeline()
    tl.from('[data-hero="eyebrow"]', {
      y: 16,
      opacity: 0,
      duration: 0.6,
      ease: EASE.out,
    })

    if (!prefersReducedMotion()) {
      const split = SplitText.create(h1Ref.current!, { type: 'chars', charsClass: 'char' })
      tl.from(
        split.chars,
        {
          yPercent: 118,
          rotateX: -50,
          transformOrigin: '50% 100%',
          duration: 0.95,
          stagger: 0.014,
          ease: 'power4.out',
          delay: 0.05,
          onComplete: () => gsap.set(split.chars, { overflow: 'visible' }),
        },
        '<0.1',
      )
    } else {
      gsap.set(h1Ref.current, { opacity: 1 })
    }

    tl.from(ledeRef.current, { y: 22, opacity: 0, duration: 0.8, ease: EASE.out }, '-=0.5')
    tl.from(metaRef.current, { y: 18, opacity: 0, duration: 0.7, ease: EASE.out }, '-=0.55')
    tl.from(
      '[data-hero="stage"]',
      {
        y: 90,
        opacity: 0,
        duration: 1.15,
        ease: EASE.out,
        delay: 0.15,
      },
      '-=0.6',
    )
    tl.from('[data-hero="cue"]', { opacity: 0, duration: 0.5 }, '-=0.4')

    return () => {
      tl.kill()
    }
  }, [booted])

  // ── Scroll flattening — the stage tilts back and settles as you scroll ──
  useEffect(() => {
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

    const fade = gsap.to(stage, {
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
      <div aria-hidden="true" className="glow left-[-15%] top-[-10%] h-[55vmax] w-[55vmax] bg-[rgba(181,69,31,0.16)]" />
      <div aria-hidden="true" className="glow right-[-20%] top-[30%] h-[48vmax] w-[48vmax] bg-[rgba(125,93,246,0.09)]" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-[42vh]"
        style={{
          background:
            'radial-gradient(120% 90% at 50% 0%, rgba(238,240,247,0.05), transparent 62%)',
        }}
      />

      <div className="relative z-[2] mx-auto flex w-full max-w-[1240px] flex-1 flex-col justify-end px-[clamp(1.25rem,4vw,3rem)] pb-10 pt-24">
        {/* ── Eyebrow ─────────────────────────────────────────────────── */}
        <div data-hero="eyebrow" className="eyebrow flex items-center gap-3">
          <span aria-hidden="true" className="relative inline-block h-2 w-2 rounded-full bg-brand-live">
            <span className="absolute inset-0 animate-ping rounded-full bg-brand-live opacity-60" />
          </span>
          Real-time sales intelligence · open source
        </div>

        {/* ── Headline ────────────────────────────────────────────────── */}
        <h1
          ref={h1Ref}
          className="display mask-chars mt-6 max-w-[15ch]"
          style={{ opacity: prefersReducedMotion() ? 1 : undefined }}
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
        <div data-hero="stage" ref={stageRef} className="mt-9" style={{ perspective: 1400 }}>
          <LiveCallWindow />
        </div>

        {/* ── Scroll cue ──────────────────────────────────────────────── */}
        <div data-hero="cue" className="pointer-events-none mt-9 flex items-center gap-4">
          <div className="cue-line" aria-hidden="true" />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-moon-3">
            the call is already playing
          </span>
        </div>
      </div>
    </section>
  )
}
