// ============================================================================
// PipelineSection — the machine scene. One utterance travels a pipeline:
//   CAPTURE  → the ring buffer. A waveform scrolls through the 40 ms frame
//              window while the machine reads pcm16 · 16 kHz. Establishing
//              shot — the call is already playing.
//   DETECT   → the trie. The transcript wipes in, a scan line sweeps it,
//              the tokens catch and the detection chips pop with it.
//   SURFACE  → the rail. The talking point assembles and lands on the
//              card shell while the latency counter counts to ~300 ms.
// The stage is ONE persistent product window — the same meeting session as
// the hero's call — with the pipeline rail as its spine. The utterance is
// the pulse; it departs a station, rides the beam, and lands at the next.
// The narrative text crossfades in a single fixed slot above the window, so
// the eye has one anchor while the machine changes around it. The window's
// chrome (status pill) and footer (meta strip) swap on the same beats as
// the views — nothing changes alone.
// Every act gets an equal scroll budget and the same internal cadence:
// depart → travel → land → annotate. No dead air, no trailing hold.
// Mobile (< 1024px) and reduced motion: the three acts stack naturally in
// the page flow — nothing is pinned, nothing is hidden.
// ============================================================================

import { useRef } from 'react'
import { gsap } from 'gsap'
import { EASE, prefersReducedMotion, useSectionTimeline, useHeadingReveal, useStaggerReveal } from '@/lib/motion'
import { useIsDesktop } from '@/lib/media'
import { cx } from '@/lib/cx'
import { IntelCard, type Severity } from './IntelCard'
import { IconTechnical } from './icons'
import { Equalizer } from './Equalizer'

const ACTS = [
  {
    num: '01',
    title: 'Capture',
    pill: 'LISTENING',
    body: 'Your mic and system audio, in 40 ms frames over SignalR. Nothing is recorded — the buffer is the product.',
    meta: 'pcm16 · 16 khz · 40 ms · no bot in the room',
  },
  {
    num: '02',
    title: 'Detect',
    pill: 'SCANNING',
    body: 'Nemotron streams partials every 200 ms. On each final, the Aho-Corasick trie and the regex engine scan for signals.',
    meta: 'aho-corasick + regex · 60 s debounce · 0.84–0.92',
  },
  {
    num: '03',
    title: 'Surface',
    pill: 'ASSEMBLING',
    body: 'A talking point assembles — headline, priority, sources — grounded in your knowledge base, and lands on the rail.',
    meta: 'byok llm · card-to-rail ~300 ms',
  },
]

const RAIL_STATIONS = ['capture', 'detect', 'surface']

const DETECT_TEXT = 'Do you support SCIM provisioning and SAML single sign-on? We run it with Okta.'
const TOKENS = ['SCIM', 'SAML', 'Okta']

const CHIPS = [
  { label: 'trie · SCIM · integration', tone: 'bg-[var(--accent-tint)] text-brand-live' },
  { label: 'trie · SAML · integration', tone: 'bg-[var(--accent-tint)] text-brand-live' },
  { label: 'regex · technical_question', tone: 'bg-[var(--prospect-tint)] text-[var(--prospect-text)]' },
]

// Deterministic "audio" for the ring-buffer strip — a sum of sines so the
// heights look like speech energy, stable across renders and themes.
const WAVE_BARS = Array.from({ length: 64 }, (_, i) => {
  const a =
    Math.sin(i * 0.42) * 0.5 + Math.sin(i * 0.11 + 1.7) * 0.3 + Math.sin(i * 1.9 + 4.2) * 0.2
  return 0.16 + (a * 0.5 + 0.5) * 0.72
})

// The scanned-token lit state — the `.tok` look, driven by the scrub so the
// beam can turn it on and off with the playhead.
const TOK_LIT = {
  backgroundColor: 'rgba(255, 122, 80, 0.16)',
  color: '#ffd9c8',
  boxShadow: 'inset 0 0 0 1px rgba(255, 122, 80, 0.35)',
  duration: 0.14,
  ease: 'none',
}

const CHIP_IN = { opacity: 1, scale: 1, y: 0, duration: 0.24, ease: 'back.out(1.6)' }

export function PipelineSection(): React.JSX.Element {
  const rootRef = useRef<HTMLElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const latencyRef = useRef<HTMLSpanElement>(null)
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

      // ── Lock the from-state synchronously. Act one is the establishing
      // shot: capture composed, station 01 lit, beam empty, the pulse
      // waiting at the top of the rail.
      gsap.set('[data-pulse]', { top: '16.667%', xPercent: -50, yPercent: -50, opacity: 0, scale: 0.5 })
      gsap.set('[data-beam-fill]', { scaleY: 0, transformOrigin: 'top center' })
      gsap.set('[data-rail-core="2"], [data-rail-core="3"]', { scale: 0 })
      gsap.set('[data-ring]', { opacity: 0, scale: 0.4 })
      gsap.set('[data-act="02"], [data-act="03"]', { opacity: 0, y: 26, force3D: true })
      gsap.set('[data-pill="2"], [data-pill="3"]', { opacity: 0, y: -8 })
      gsap.set('[data-meta="2"], [data-meta="3"]', { opacity: 0, y: -8 })
      gsap.set('[data-view="detect"], [data-view="surface"]', { opacity: 0, y: 26, filter: 'blur(8px)', force3D: true })
      gsap.set('[data-transcript]', { clipPath: 'inset(0% 0% 100% 0%)' })
      gsap.set('[data-scan-line]', { opacity: 0, top: 0 })
      gsap.set('[data-scan-token]', { backgroundColor: 'rgba(255, 122, 80, 0)', color: '#eef0f7', boxShadow: 'inset 0 0 0 0px rgba(255, 122, 80, 0)' })
      gsap.set('[data-chip]', { opacity: 0, scale: 0.7, y: 8, force3D: true })
      gsap.set('[data-conf]', { opacity: 0, x: -10 })
      gsap.set('[data-card-shell]', { opacity: 0, y: 30, scale: 0.95, filter: 'blur(6px)', force3D: true })
      gsap.set('[data-pedestal]', { opacity: 0 })
      gsap.set('[data-latency]', { opacity: 0 })
      gsap.set('[data-rail-cap]', { opacity: 0 })

      const latencyProxy = { v: 0 }

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: stage,
          start: 'top top',
          end: '+=300%',
          scrub: 1,
          pin: true,
          anticipatePin: 1,
        },
      })

      // ── ACT I → II: the utterance departs capture ──────────────────
      // The machine just caught it — the ring fires, the pulse spawns at
      // station 01 and rides the beam down as the beam fills.
      tl.to('[data-ring="1"]', { opacity: 0.55, scale: 0.4, duration: 0.1, ease: 'none' }, 0.04)
      tl.to('[data-ring="1"]', { opacity: 0, scale: 1.7, duration: 0.5, ease: 'power2.out' }, 0.14)
      tl.to('[data-pulse]', { opacity: 1, scale: 1, duration: 0.12, ease: 'back.out(2)' }, 0.24)
      tl.to('[data-pulse]', { top: '50%', duration: 0.52, ease: 'none' }, 0.30)
      tl.to('[data-beam-fill]', { scaleY: 0.5, duration: 0.52, ease: 'none' }, 0.30)
      tl.to('[data-rail-core="2"]', { scale: 1, duration: 0.22, ease: 'back.out(2)' }, 0.78)
      tl.to('[data-rail-label="2"]', { color: '#ff7a50', duration: 0.25, ease: 'none' }, 0.80)
      tl.to('[data-ring="2"]', { opacity: 0.55, scale: 0.4, duration: 0.1, ease: 'none' }, 0.78)
      tl.to('[data-ring="2"]', { opacity: 0, scale: 1.7, duration: 0.5, ease: 'power2.out' }, 0.88)
      tl.to('[data-pulse]', { scale: 1.3, duration: 0.06, ease: 'none' }, 0.82)
      tl.to('[data-pulse]', { scale: 1, duration: 0.12, ease: 'back.out(2)' }, 0.88)

      // The narrative annotates the arrival — one fixed slot, crossfading.
      tl.to('[data-act="01"]', { opacity: 0, y: -26, duration: 0.3, ease: 'power2.in' }, 0.52)
      tl.to('[data-act="02"]', { opacity: 1, y: 0, duration: 0.32, ease: EASE.out }, 0.82)
      tl.to('[data-pill="1"], [data-meta="1"]', { opacity: 0, y: -10, duration: 0.22, ease: 'power2.in' }, 0.86)
      tl.to('[data-pill="2"], [data-meta="2"]', { opacity: 1, y: 0, duration: 0.26, ease: EASE.out }, 1.06)

      // The window flips views as the utterance arrives at the station.
      tl.to('[data-view="capture"]', { opacity: 0, y: -14, filter: 'blur(8px)', duration: 0.3, ease: 'power2.in' }, 0.90)
      tl.to('[data-view="detect"]', { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.34, ease: EASE.out }, 1.10)

      // ── ACT II: the scan ───────────────────────────────────────────
      // The transcript wipes in, the scan line sweeps it, the tokens catch
      // as the line passes, and the detection chips pop in its wake.
      tl.to('[data-transcript]', { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.34, ease: EASE.out }, 1.22)
      tl.to('[data-scan-line]', { opacity: 1, duration: 0.05, ease: 'none' }, 1.56)
      tl.to('[data-scan-line]', { top: '100%', duration: 0.38, ease: 'none' }, 1.60)
      tl.to('[data-scan-token="1"]', TOK_LIT, 1.66)
      tl.to('[data-scan-token="2"]', TOK_LIT, 1.78)
      tl.to('[data-scan-token="3"]', TOK_LIT, 1.90)
      tl.to('[data-scan-line]', { opacity: 0, duration: 0.05, ease: 'none' }, 1.98)
      tl.to('[data-chip="1"]', CHIP_IN, 1.72)
      tl.to('[data-chip="2"]', CHIP_IN, 1.84)
      tl.to('[data-chip="3"]', CHIP_IN, 1.96)
      tl.to('[data-conf]', { opacity: 1, x: 0, duration: 0.24, ease: EASE.out }, 2.04)

      // ── ACT II → III: the utterance departs detect ─────────────────
      tl.to('[data-pulse]', { top: '83.333%', duration: 0.52, ease: 'none' }, 2.06)
      tl.to('[data-beam-fill]', { scaleY: 1, duration: 0.52, ease: 'none' }, 2.06)
      tl.to('[data-rail-core="3"]', { scale: 1, duration: 0.22, ease: 'back.out(2)' }, 2.54)
      tl.to('[data-rail-label="3"]', { color: '#ff7a50', duration: 0.25, ease: 'none' }, 2.56)
      tl.to('[data-ring="3"]', { opacity: 0.55, scale: 0.4, duration: 0.1, ease: 'none' }, 2.54)
      tl.to('[data-ring="3"]', { opacity: 0, scale: 1.7, duration: 0.5, ease: 'power2.out' }, 2.64)
      tl.to('[data-pulse]', { scale: 1.3, duration: 0.06, ease: 'none' }, 2.58)
      tl.to('[data-pulse]', { scale: 1, duration: 0.12, ease: 'back.out(2)' }, 2.64)

      tl.to('[data-act="02"]', { opacity: 0, y: -26, duration: 0.3, ease: 'power2.in' }, 2.14)
      tl.to('[data-act="03"]', { opacity: 1, y: 0, duration: 0.32, ease: EASE.out }, 2.44)
      tl.to('[data-pill="2"], [data-meta="2"]', { opacity: 0, y: -10, duration: 0.22, ease: 'power2.in' }, 2.40)
      tl.to('[data-pill="3"], [data-meta="3"]', { opacity: 1, y: 0, duration: 0.26, ease: EASE.out }, 2.62)
      tl.to('[data-view="detect"]', { opacity: 0, y: -14, filter: 'blur(8px)', duration: 0.3, ease: 'power2.in' }, 2.44)
      tl.to('[data-view="surface"]', { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.34, ease: EASE.out }, 2.64)

      // ── ACT III: the payoff — the card lands on the rail ────────────
      tl.to('[data-latency]', { opacity: 1, duration: 0.18, ease: 'none' }, 2.66)
      tl.to(
        latencyProxy,
        {
          v: 298,
          duration: 0.28,
          ease: 'power3.out',
          onUpdate: () => {
            if (latencyRef.current) latencyRef.current.textContent = String(Math.round(latencyProxy.v))
          },
        },
        2.70,
      )
      tl.to('[data-card-shell]', { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', duration: 0.42, ease: 'back.out(1.6)' }, 2.72)
      tl.to('[data-pedestal]', { opacity: 1, duration: 0.3, ease: 'none' }, 2.80)
      tl.to('[data-rail-cap]', { opacity: 1, duration: 0.1, ease: EASE.out }, 2.90)
    },
    [staticLayout],
  )

  useStaggerReveal(stageRef, '[data-pipe-block]', {
    enabled: staticLayout,
    y: 26,
    stagger: 0.08,
  })

  return (
    <section id="pipeline" ref={rootRef} className="nocturne section">
      <div className="container">
        <p className="eyebrow">How it works · one utterance, three acts</p>
        <h2 className="h2-display mt-6 max-w-[16ch]">
          <span className="mask-line"><span className="mask-line-inner">Every signal has a</span></span>
          <span className="mask-line"><span className="mask-line-inner"><em className="accent">journey.</em></span></span>
        </h2>
      </div>

      <div
        ref={stageRef}
        className="relative mx-auto mt-16 w-full max-w-[900px] px-[clamp(1.25rem,4vw,3rem)]"
        style={{ height: staticLayout ? undefined : 'clamp(600px, 76vh, 720px)' }}
      >
        {staticLayout ? (
          // ── Mobile / reduced motion: the three acts stack in flow ──
          <div className="relative">
            {ACTS.map((act) => (
              <div key={act.num} data-pipe-block className="relative mx-auto mt-14 w-full max-w-[760px] first:mt-0">
                <div className="flex items-baseline gap-5">
                  <span className="font-mono text-[13px] tracking-[0.2em] text-brand-live">{act.num}</span>
                  <span className="h3-display text-moon">{act.title}</span>
                </div>
                <p className="mt-4 max-w-[56ch] text-[15.5px] leading-[1.65] text-moon-2">{act.body}</p>
                <div className="mt-6">
                  <PipelineWindow act={act} isStatic latencyRef={latencyRef} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          // ── Desktop: the pinned machine scene ──────────────────────
          <div className="relative flex h-full flex-col">
            {/* A warm pool of light behind the machine — the focal point
                of the scene. */}
            <div
              aria-hidden="true"
              className="absolute -top-24 left-1/2 h-72 w-[85%] -translate-x-1/2"
              style={{
                background: 'radial-gradient(55% 60% at 50% 30%, var(--glow-warm), transparent 70%)',
                filter: 'blur(48px)',
              }}
            />

            {/* The narrative — one fixed slot, crossfading in place */}
            <div className="relative z-[1] mx-auto w-full max-w-[760px]">
              <div className="relative min-h-[150px]">
                {ACTS.map((act) => (
                  <div
                    key={act.num}
                    data-act={act.num}
                    className={cx('absolute inset-0', act.num !== '01' && 'opacity-0')}
                  >
                    <div className="flex items-baseline gap-5">
                      <span className="font-mono text-[13px] tracking-[0.2em] text-brand-live">{act.num}</span>
                      <span className="h3-display text-moon">{act.title}</span>
                    </div>
                    <p className="mt-4 max-w-[56ch] text-[15.5px] leading-[1.65] text-moon-2">{act.body}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* The machine — the window is the scene */}
            <div className="relative z-[1] mt-9 flex-1">
              <div className="mx-auto flex h-full w-full max-w-[760px] flex-col justify-center">
                <PipelineWindow isStatic={false} latencyRef={latencyRef} />
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

// ============================================================================
// The machine window — chrome (traffic lights + session label + status pill),
// the pipeline rail spine, the three morphing views, and the meta footer.
// Desktop: one window, all three views stacked, scrubbed by the timeline.
// Static: one compact window per act, rendered in page flow.
// ============================================================================

function PipelineWindow({
  act,
  isStatic,
  latencyRef,
}: {
  act?: (typeof ACTS)[number]
  isStatic: boolean
  latencyRef: React.RefObject<HTMLSpanElement | null>
}): React.JSX.Element {
  return (
    <div className="relative flex flex-col overflow-hidden rounded-2xl border border-[var(--glass-border)] bg-[var(--surface-glass-strong)] shadow-[var(--shadow-window)] backdrop-blur-xl">
      {/* ── Chrome ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border-soft)] px-4 py-2.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            <span className="h-2.5 w-2.5 rounded-full bg-[#e0726b]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#d8b25c]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#7ea36a]" />
          </div>
          <span className="hidden truncate font-mono text-[10.5px] tracking-[0.04em] text-moon-3 sm:block">
            callpilot · pipeline · meeting_2f9c4d
          </span>
        </div>

        {isStatic && act ? (
          <Pill label={act.pill} />
        ) : (
          <div className="relative h-[26px] w-[116px]">
            {ACTS.map((a, i) => (
              <Pill
                key={a.num}
                label={a.pill}
                dataPill={String(i + 1)}
                className="absolute inset-0"
                style={i === 0 ? undefined : { opacity: 0 }}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Body ───────────────────────────────────────────────────── */}
      {isStatic && act ? (
        <div className="p-5 sm:p-6">
          {act.num === '01' && <CaptureView isStatic />}
          {act.num === '02' && <DetectView isStatic />}
          {act.num === '03' && <SurfaceView isStatic latencyRef={latencyRef} />}
        </div>
      ) : (
        <div className="flex h-[320px]">
          {/* The rail — the journey map, always visible */}
          <div className="relative w-[132px] shrink-0 border-r border-[var(--border-soft)]">
            <div
              aria-hidden="true"
              className="absolute left-1/2 top-[16.67%] h-[66.67%] w-px -translate-x-1/2 bg-[var(--border-track)]"
            />
            <div
              aria-hidden="true"
              data-beam-fill
              className="absolute left-1/2 top-[16.67%] h-[66.67%] w-px -translate-x-1/2 origin-top"
              style={{
                background: 'linear-gradient(180deg, var(--color-brand-live), var(--color-brand))',
                boxShadow: 'var(--shadow-rail)',
              }}
            />
            <div className="absolute inset-0 grid grid-rows-3">
              {RAIL_STATIONS.map((station, i) => (
                <div key={station} className="relative flex items-center justify-center">
                  {/* The dot sits exactly on the row center — the pulse and
                      the beam target the row thirds, so dot, beam and pulse
                      share one geometry contract. */}
                  <span className="relative block h-2 w-2 rounded-full border border-[var(--border-mid)]">
                    <span
                      data-rail-core={i + 1}
                      className="absolute inset-0 rounded-full bg-brand-live"
                      style={{
                        boxShadow: 'var(--shadow-dot)',
                        transform: i === 0 ? undefined : 'scale(0)',
                      }}
                    />
                    <span
                      data-ring={i + 1}
                      aria-hidden="true"
                      className="absolute -inset-2 rounded-full border border-brand-live/30 opacity-0"
                    />
                  </span>
                  <span
                    data-rail-label={i + 1}
                    className="absolute left-1/2 top-1/2 mt-4 -translate-x-1/2 whitespace-nowrap font-mono text-[9px] uppercase tracking-[0.14em]"
                    style={{ color: i === 0 ? '#ff7a50' : 'var(--color-moon-3)' }}
                  >
                    {station}
                  </span>
                </div>
              ))}
            </div>
            {/* The utterance — rides the beam between stations */}
            <span
              data-pulse
              aria-hidden="true"
              className="absolute left-1/2 top-0 h-2 w-2 rounded-full bg-brand-live"
              style={{ boxShadow: 'var(--shadow-dot)' }}
            />
          </div>

          {/* The views — three states of the same machine */}
          <div className="relative min-w-0 flex-1">
            <CaptureView />
            <DetectView />
            <SurfaceView latencyRef={latencyRef} />
          </div>
        </div>
      )}

      {/* ── Meta footer — swaps with the act ───────────────────────── */}
      <div className="border-t border-[var(--border-soft)] px-4 py-2.5 sm:px-5">
        {isStatic && act ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-moon-3">{act.meta}</span>
        ) : (
          <div className="relative h-[15px]">
            {ACTS.map((a, i) => (
              <span
                key={a.num}
                data-meta={String(i + 1)}
                className="absolute inset-y-0 left-0 flex items-center font-mono text-[10px] uppercase tracking-[0.16em] text-moon-3"
                style={i === 0 ? undefined : { opacity: 0 }}
              >
                {a.meta}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Pill({
  label,
  dataPill,
  className,
  style,
}: {
  label: string
  dataPill?: string
  className?: string
  style?: React.CSSProperties
}): React.JSX.Element {
  return (
    <span
      data-pill={dataPill}
      className={cx(
        'flex items-center justify-center gap-2 rounded-full border border-[var(--accent-border)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-brand-live',
        className,
      )}
      style={style}
    >
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-live" />
      {label}
    </span>
  )
}

// ============================================================================
// The three views
// ============================================================================

// Capture — the ring buffer. A waveform scrolls past the 40 ms frame window
// while the machine reads format, rate and frame number. Pure CSS motion —
// the strip is two identical copies looping one copy-width, so the seam is
// invisible and the strip never needs a script.
function CaptureView({ isStatic = false }: { isStatic?: boolean }): React.JSX.Element {
  return (
    <div
      data-view="capture"
      className={cx('flex h-full flex-col p-5 sm:p-6', !isStatic && 'absolute inset-0')}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-moon-3">
          capture · ring buffer
        </span>
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-brand-live">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-live" />
          rec
        </span>
      </div>

      <div className="relative mt-5 overflow-hidden rounded-xl border border-[var(--border-soft)] bg-[var(--color-ink-900)] px-4 pb-4 pt-3">
        <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.16em] text-moon-3">
          <span>pcm16 · 16 khz · mono</span>
          <span>frame 0472</span>
        </div>
        <div className="relative mt-3 h-[64px] sm:h-[76px]">
          <span
            aria-hidden="true"
            className="absolute left-[22%] top-0 z-[1] font-mono text-[9px] uppercase tracking-[0.14em] text-brand-live"
          >
            40 ms frame
          </span>
          <div aria-hidden="true" className="pip-wave absolute inset-x-0 bottom-0 top-[13px] overflow-hidden">
            <div className="pip-wave-track flex h-full items-end gap-[2px]">
              {[0, 1].map((copy) => (
                <span key={copy} className="flex h-full shrink-0 items-end gap-[2px]">
                  {WAVE_BARS.map((h, i) => (
                    <span
                      key={i}
                      className="w-[3px] rounded-[2px]"
                      style={{
                        height: `${Math.round(h * 100)}%`,
                        background: 'linear-gradient(180deg, var(--color-brand-live), var(--color-brand))',
                      }}
                    />
                  ))}
                </span>
              ))}
            </div>
          </div>
          <div
            aria-hidden="true"
            className="absolute bottom-0 left-[22%] top-[13px] w-[42px] border-x border-brand-live/60 bg-[var(--accent-tint-3)]"
          />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.16em] text-moon-3">
        <span className="flex items-center gap-2.5">
          <Equalizer active bars={9} className="h-3.5" />
          input · mic + system
        </span>
        <span className="hidden sm:block">ffmpeg → signalr → nemotron</span>
      </div>
    </div>
  )
}

// Detect — the trie at work. The transcript wipes in, the scan line sweeps
// it, the tokens catch as the line passes, and the chips land in its wake.
function DetectView({ isStatic = false }: { isStatic?: boolean }): React.JSX.Element {
  return (
    <div
      data-view="detect"
      className={cx('flex h-full flex-col p-5 sm:p-6', !isStatic && 'absolute inset-0 opacity-0')}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-moon-3">
          nemotron · streaming partials
        </span>
        <span className="flex items-center gap-1.5 font-mono text-[10px] text-brand-live">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-live" />
          200 ms
        </span>
      </div>

      <div className="relative mt-6 max-w-[48ch]">
        {!isStatic && <span data-scan-line aria-hidden="true" className="pip-scan-line" />}
        <p
          data-transcript={isStatic ? undefined : ''}
          className="text-[16.5px] leading-[1.7] text-moon sm:text-[18px]"
        >
          {splitTokens(DETECT_TEXT, TOKENS, isStatic)}
        </p>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {CHIPS.map((chip, i) => (
          <span
            key={chip.label}
            data-chip={isStatic ? undefined : i + 1}
            className={cx(
              'rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em]',
              chip.tone,
            )}
          >
            {chip.label}
          </span>
        ))}
      </div>

      <div className="mt-auto flex items-center gap-2 pt-4">
        <span
          data-conf={isStatic ? undefined : ''}
          className="font-mono text-[10px] uppercase tracking-[0.16em] text-moon-3"
        >
          confidence <span className="text-brand-live">0.84–0.92</span> · matches 3
        </span>
      </div>
    </div>
  )
}

// Surface — the payoff. The card assembles on its shell while the latency
// counter counts to ~300 ms, then the caption confirms the broadcast.
function SurfaceView({
  isStatic = false,
  latencyRef,
}: {
  isStatic?: boolean
  latencyRef: React.RefObject<HTMLSpanElement | null>
}): React.JSX.Element {
  return (
    <div
      data-view="surface"
      className={cx('flex h-full flex-col p-5 sm:p-6', !isStatic && 'absolute inset-0 opacity-0')}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-moon-3">
          surface · the rail
        </span>
        <span
          data-latency={isStatic ? undefined : ''}
          className="font-mono text-[10px] text-brand-live"
        >
          +<span ref={latencyRef}>{isStatic ? '298' : '0'}</span> ms
        </span>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center py-2">
        <div data-card-shell={isStatic ? undefined : ''} className="relative w-full max-w-[400px]">
          {/* directional top-light — the card is the lit object now */}
          <div
            aria-hidden="true"
            className="absolute -top-10 left-1/2 h-36 w-[105%] -translate-x-1/2"
            style={{
              background: 'radial-gradient(52% 65% at 50% 8%, var(--glow-card), transparent 72%)',
              filter: 'blur(32px)',
            }}
          />
          <div
            data-pedestal={isStatic ? undefined : ''}
            aria-hidden="true"
            className="absolute -bottom-6 left-1/2 h-6 w-4/5 -translate-x-1/2 rounded-full bg-[var(--glow-pedestal)] blur-2xl"
          />
          {/* gradient-ring shell — the payoff frame */}
          <div className="relative rounded-2xl p-px" style={{ background: 'var(--ring-accent)' }}>
            <div className="rounded-[calc(1rem-1px)] bg-[var(--surface-glass-solid)] shadow-[var(--shadow-shell)]">
              <IntelCard
                animateIn={isStatic}
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
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-8 top-0 h-7 rounded-full bg-[var(--reflection)] blur-xl"
            />
          </div>
        </div>
      </div>

      <p
        data-rail-cap={isStatic ? undefined : ''}
        className="text-center font-mono text-[10px] uppercase tracking-[0.18em] text-moon-3"
      >
        assembled from your docs · broadcast in ~300 ms
      </p>
    </div>
  )
}

function splitTokens(text: string, tokens: string[], isStatic: boolean): React.JSX.Element[] {
  const pattern = new RegExp(`(${tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g')
  return text.split(pattern).map((part, i) => {
    const tokenIndex = tokens.indexOf(part)
    if (tokenIndex < 0) return <span key={i}>{part}</span>
    return (
      <span
        key={i}
        data-scan-token={isStatic ? undefined : tokenIndex + 1}
        className={cx(isStatic ? 'tok' : 'pip-scan-token')}
      >
        {part}
      </span>
    )
  })
}
