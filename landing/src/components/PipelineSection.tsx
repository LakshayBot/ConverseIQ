// ============================================================================
// PipelineSection — pinned storytelling. One utterance travels through the
// system in three acts: capture (the waveform), detect (the trie lighting
// up on SCIM / SAML / Okta), surface (the grounded card). Scrubbed, so the
// visitor drives the pipeline with their scroll.
// ============================================================================

import { useRef } from 'react'
import { gsap } from 'gsap'
import { EASE, prefersReducedMotion, useSectionTimeline } from '@/lib/motion'
import { IntelCard, type Severity } from './IntelCard'
import { IconTechnical } from './icons'
import { Equalizer } from './Equalizer'

const ACTS = [
  {
    num: '01',
    title: 'Capture',
    body: 'Your mic and system audio, in 40 ms frames over SignalR. Nothing is recorded — the buffer is the product.',
    meta: 'PCM16 · 16 kHz · 40 ms · no bot in the room',
  },
  {
    num: '02',
    title: 'Detect',
    body: 'Nemotron streams partials every 200 ms. On each final, the Aho-Corasick trie and the regex engine scan for signals.',
    meta: 'Aho-Corasick + regex · 60 s debounce · 0.84–0.92 confidence',
  },
  {
    num: '03',
    title: 'Surface',
    body: 'A talking point assembles — headline, priority, sources — grounded in your knowledge base, and lands on the rail.',
    meta: 'BYOK LLM · card-to-rail ~300 ms',
  },
]

const DETECT_TEXT = 'Do you support SCIM provisioning and SAML single sign-on? We run it with Okta.'
const TOKENS = ['SCIM', 'SAML', 'Okta']

export function PipelineSection(): React.JSX.Element {
  const rootRef = useRef<HTMLElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const reduced = prefersReducedMotion()

  useSectionTimeline(
    rootRef,
    () => {
      if (reduced) return
      const stage = stageRef.current
      if (!stage) return

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: stage,
          start: 'top top',
          end: '+=280%',
          scrub: 1,
          pin: true,
          anticipatePin: 1,
        },
      })

      // Act labels crossfade 01 → 02 → 03
      tl.fromTo(
        '[data-act="01"]',
        { opacity: 1, y: 0 },
        { opacity: 0, y: -26, duration: 0.35, ease: 'power2.in' },
        0.95,
      )
      tl.fromTo(
        '[data-act="02"]',
        { opacity: 0, y: 26 },
        { opacity: 1, y: 0, duration: 0.35, ease: EASE.out },
        1.15,
      )
      tl.fromTo(
        '[data-act="02"]',
        { opacity: 1, y: 0 },
        { opacity: 0, y: -26, duration: 0.35, ease: 'power2.in' },
        1.95,
      )
      tl.fromTo(
        '[data-act="03"]',
        { opacity: 0, y: 26 },
        { opacity: 1, y: 0, duration: 0.35, ease: EASE.out },
        2.15,
      )

      // Panels crossfade
      tl.fromTo(
        '[data-panel="capture"]',
        { opacity: 1, scale: 1 },
        { opacity: 0, scale: 0.985, filter: 'blur(8px)', duration: 0.45, ease: 'power2.in' },
        1.0,
      )
      tl.fromTo(
        '[data-panel="detect"]',
        { opacity: 0, y: 34, filter: 'blur(8px)' },
        { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.5, ease: EASE.out },
        1.2,
      )
      tl.fromTo(
        '[data-panel="detect"]',
        { opacity: 1 },
        { opacity: 0, y: -24, filter: 'blur(8px)', duration: 0.45, ease: 'power2.in' },
        2.0,
      )
      tl.fromTo(
        '[data-panel="surface"]',
        { opacity: 0, y: 40, scale: 0.96 },
        { opacity: 1, y: 0, scale: 1, duration: 0.55, ease: 'back.out(1.5)' },
        2.2,
      )

      // Progress ticks
      tl.fromTo(
        '[data-tick="1"]',
        { scale: 0 },
        { scale: 1, duration: 0.25, ease: 'back.out(2)' },
        0.1,
      )
      tl.fromTo(
        '[data-tick="2"]',
        { scale: 0 },
        { scale: 1, duration: 0.25, ease: 'back.out(2)' },
        1.1,
      )
      tl.fromTo(
        '[data-tick="3"]',
        { scale: 0 },
        { scale: 1, duration: 0.25, ease: 'back.out(2)' },
        2.1,
      )
    },
    [reduced],
  )

  return (
    <section id="pipeline" ref={rootRef} className="nocturne section">
      <div className="container">
        <p className="eyebrow">How it works · one utterance, three acts</p>
        <h2 className="h2-display mask-lines mt-6 max-w-[16ch]">
          Every signal has a <em className="accent">journey.</em>
        </h2>
      </div>

      <div
        ref={stageRef}
        className="relative mx-auto mt-16 w-full max-w-[1240px] px-[clamp(1.25rem,4vw,3rem)]"
        style={{ height: reduced ? undefined : 'clamp(480px, 68vh, 620px)' }}
      >
        <div className="grid h-full gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-center">
          {/* ── Left: act descriptions ─────────────────────────────────── */}
          <div className="relative min-h-[240px]">
            <div className="flex items-center gap-2.5" aria-hidden="true">
              {[1, 2, 3].map((n) => (
                <span
                  key={n}
                  data-tick={n}
                  className="h-1.5 w-1.5 rounded-full bg-brand-live"
                  style={{ transform: 'scale(0)' }}
                />
              ))}
            </div>
            <div className="mt-8">
              {ACTS.map((act, i) => (
                <div
                  key={act.num}
                  data-act={ACTS[i].num}
                  className={reduced ? 'mt-8' : 'absolute inset-0 opacity-0'}
                  style={reduced ? undefined : { opacity: i === 0 && !reduced ? 1 : undefined }}
                >
                  <div className="flex items-baseline gap-5">
                    <span className="font-mono text-[13px] tracking-[0.2em] text-brand-live">
                      {act.num}
                    </span>
                    <span className="h3-display text-moon">{act.title}</span>
                  </div>
                  <p className="mt-4 max-w-[46ch] text-[15.5px] leading-[1.65] text-moon-2">
                    {act.body}
                  </p>
                  <p className="mt-4 font-mono text-[10.5px] uppercase tracking-[0.16em] text-moon-3">
                    {act.meta}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* ── Right: the stage panels ────────────────────────────────── */}
          <div className="relative min-h-[340px] lg:min-h-[420px]">
            {/* Act 1 — capture */}
            <div
              data-panel="capture"
              className={reduced ? 'glass rounded-2xl p-8' : 'glass absolute inset-0 rounded-2xl p-8'}
              style={{ opacity: reduced ? undefined : 1 }}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-moon-3">
                  capture · streaming buffer
                </span>
                <span className="font-mono text-[10px] text-brand-live">● 16 kHz</span>
              </div>
              <div className="mt-10 flex h-36 items-end justify-center gap-[5px] sm:h-44">
                <Equalizer active bars={18} className="h-full !gap-[5px]" />
              </div>
              <p className="mt-8 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-moon-3">
                ffmpeg → signalr → nemotron
              </p>
            </div>

            {/* Act 2 — detect */}
            <div
              data-panel="detect"
              className={reduced ? 'glass mt-8 rounded-2xl p-8' : 'glass absolute inset-0 rounded-2xl p-8 opacity-0'}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-moon-3">
                  detect · trie + regex
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-live" />
                  <span className="font-mono text-[10px] text-brand-live">200 ms</span>
                </span>
              </div>
              <p className="mt-8 text-[16.5px] leading-[1.7] text-moon sm:text-[18px]">
                {splitTokens(DETECT_TEXT, TOKENS)}
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                <span className="rounded-full bg-[rgba(255,122,80,0.12)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-brand-live">
                  trie · SCIM · integration
                </span>
                <span className="rounded-full bg-[rgba(255,122,80,0.12)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-brand-live">
                  trie · SAML · integration
                </span>
                <span className="rounded-full bg-[rgba(125,93,246,0.14)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[#a89bff]">
                  regex · technical_question
                </span>
              </div>
            </div>

            {/* Act 3 — surface */}
            <div
              data-panel="surface"
              className={reduced ? 'mt-8' : 'absolute inset-0 opacity-0'}
            >
              <div className="mx-auto max-w-[440px]">
                <IntelCard
                  animateIn={!reduced}
                  kind="Technical question"
                  icon={<IconTechnical size={11} />}
                  severity={'medium' as Severity}
                  title="SCIM / SAML / Okta — integration"
                  body="Supported natively: SCIM 2.0 provisioning and SAML 2.0 SSO. Okta is a tested identity provider — the exact paragraph from the integration docs is attached."
                  sources={[
                    'integrations.md · "SCIM 2.0 provisioning · §3.2"',
                    'integrations.md · "SAML 2.0 SSO · §4.1"',
                  ]}
                />
              </div>
              <p className="mt-6 text-center font-mono text-[10.5px] uppercase tracking-[0.18em] text-moon-3">
                assembled from your docs · broadcast in ~300 ms
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function splitTokens(text: string, tokens: string[]): React.JSX.Element[] {
  const pattern = new RegExp(`(${tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g')
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
