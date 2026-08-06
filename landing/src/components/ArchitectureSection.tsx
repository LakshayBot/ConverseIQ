// ============================================================================
// ArchitectureSection — the dawn register. Everything on your hardware,
// drawn as three modules connected by a pipeline, then the honest stack
// table and the latency spec counted up from the codebase constants.
// The diagram is one flex row: cards own their width, connectors own the
// space BETWEEN them. Nothing overlaps — the line, node and traveling
// pulse all live in the gap, and the whole connector rotates 90° on small
// screens so the pipeline reads vertically. On entry the pipeline
// assembles left to right: card 1, its connector, card 2, its connector,
// card 3. Hovering a card lights only itself and its two connectors.
// ============================================================================

import { Fragment, useRef } from 'react'
import { gsap } from 'gsap'
import { ARCH_NODES, LATENCY, STACK } from '@/data/content'
import { useSectionTimeline, prefersReducedMotion, useHeadingReveal } from '@/lib/motion'
import { useCountUp } from '@/lib/count'
import { IconArrow } from './icons'
import { Magnetic } from './Magnetic'

export function ArchitectureSection(): React.JSX.Element {
  const rootRef = useRef<HTMLElement>(null)
  const reduced = prefersReducedMotion()

  useHeadingReveal(rootRef)

  useSectionTimeline(
    rootRef,
    () => {
      if (reduced) return
      // From-state applied synchronously: the first paint shows the section
      // heading alone — no card, no connector, no stack row.
      gsap.set('[data-arch-card]', { y: 40, opacity: 0, force3D: true })
      gsap.set('[data-arch-link]', { scaleX: 0, transformOrigin: 'left center' })
      gsap.set('[data-arch-node]', { scale: 0, opacity: 0 })
      gsap.set('[data-arch-pulse]', { opacity: 0 })
      gsap.set('[data-stack-row]', { opacity: 0, x: -22, force3D: true })

      // The pipeline assembles itself, left to right: each module arrives,
      // its connector draws itself, the node lands, the pulse starts
      // flowing — then the next module.
      const tl = gsap.timeline({
        scrollTrigger: { trigger: rootRef.current, start: 'top 68%' },
      })
      tl.to('[data-arch-card="1"]', { y: 0, opacity: 1, duration: 0.7, ease: 'expo.out' })
      tl.to('[data-arch-link="1"]', { scaleX: 1, duration: 0.5, ease: 'power2.inOut' }, '-=0.28')
      tl.to('[data-arch-node="1"]', { scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(1.8)' }, '-=0.32')
      tl.to('[data-arch-pulse="1"]', { opacity: 1, duration: 0.3, ease: 'none' }, '-=0.18')
      tl.to('[data-arch-card="2"]', { y: 0, opacity: 1, duration: 0.7, ease: 'expo.out' }, '-=0.35')
      tl.to('[data-arch-link="2"]', { scaleX: 1, duration: 0.5, ease: 'power2.inOut' }, '-=0.28')
      tl.to('[data-arch-node="2"]', { scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(1.8)' }, '-=0.32')
      tl.to('[data-arch-pulse="2"]', { opacity: 1, duration: 0.3, ease: 'none' }, '-=0.18')
      tl.to('[data-arch-card="3"]', { y: 0, opacity: 1, duration: 0.7, ease: 'expo.out' }, '-=0.35')

      const rows = gsap.to('[data-stack-row]', {
        opacity: 1,
        x: 0,
        duration: 0.6,
        stagger: 0.05,
        ease: 'expo.out',
        scrollTrigger: { trigger: rootRef.current, start: 'top 55%' },
      })
      return () => {
        tl.scrollTrigger?.kill()
        tl.kill()
        rows.scrollTrigger?.kill()
        rows.kill()
      }
    },
    [reduced],
  )

  return (
    <section id="architecture" ref={rootRef} className="dawn section">
      <div aria-hidden="true" className="glow right-[-12%] top-[8%] h-[42vmax] w-[42vmax] bg-[rgba(181,69,31,0.1)]" />

      <div className="container relative">
        <p className="eyebrow">Architecture · your hardware, your key</p>
        <h2 className="h2-display mt-6 max-w-[17ch] text-ink">
          <span className="mask-line"><span className="mask-line-inner">The whole stack,</span></span>
          <span className="mask-line"><span className="mask-line-inner"><em className="accent">on your machine.</em></span></span>
        </h2>
        <p className="lede mt-6 max-w-[58ch]">
          No subscription, no call-home, no third-party bot in the room.
          Every component ships in the repo — read it, fork it, air-gap it.
        </p>

        {/* ── The pipeline: three modules, connectors in the space between ──
            One flex row. Cards grow to share the width; connectors own a
            fixed slot in the middle of the gap — the line, the node and
            the pulse never touch a card border. */}
        <div className="arch-pipeline mt-16">
          {ARCH_NODES.map((node, i) => (
            <Fragment key={node.id}>
              <div
                data-arch-card={i + 1}
                className="arch-card glass relative z-[1] flex min-w-0 flex-1 flex-col rounded-2xl p-6 sm:p-7"
              >
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-4">
                  {node.label}
                </p>
                <h3 className="h3-display mt-3 text-ink">{node.title}</h3>
                <div className="mt-5 flex flex-wrap gap-2">
                  {node.tech.map((t) => (
                    <span
                      key={t}
                      className="rounded-full border border-rule bg-white px-3 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3"
                    >
                      {t}
                    </span>
                  ))}
                </div>
                {/* mt-auto anchors the meta to the bottom, so every card's
                    header, title, chips and meta share one baseline even
                    when chips wrap differently. */}
                <p className="mt-auto pt-5 font-mono text-[10.5px] leading-relaxed text-ink-4">
                  {node.meta}
                </p>
              </div>

              {i < ARCH_NODES.length - 1 && <ArchConnector index={i} />}
            </Fragment>
          ))}
        </div>

        {/* ── Honest stack + latency spec ─────────────────────────────── */}
        <div className="mt-20 grid gap-14 lg:grid-cols-2">
          {/* Stack table */}
          <div>
            <p className="eyebrow">What it actually runs on</p>
            <div className="mt-6 overflow-hidden rounded-2xl border border-rule">
              {STACK.map((row, i) => (
                <div
                  key={row.layer}
                  data-stack-row
                  className="flex items-center justify-between gap-4 border-b border-rule-soft px-5 py-3.5 last:border-b-0"
                  style={{ background: i % 2 === 0 ? 'rgba(255,255,255,0.5)' : 'transparent' }}
                >
                  <span className="text-[13.5px] font-medium text-ink">{row.layer}</span>
                  <span className="flex items-center gap-3">
                    <span className="hidden font-mono text-[11px] text-ink-4 sm:block">
                      {row.tech}
                    </span>
                    <span
                      className={
                        row.local
                          ? 'rounded-full bg-good-soft px-2.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-good'
                          : 'rounded-full bg-warn-soft px-2.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-warn'
                      }
                    >
                      {row.local ? 'local' : 'cloud'}
                    </span>
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-4 font-mono text-[10.5px] leading-relaxed text-ink-4">
              Two optional cloud services — LLM enrichment and competitive
              intel — never touch the live call.
            </p>
          </div>

          {/* Latency spec */}
          <div>
            <p className="eyebrow">Real numbers, from the codebase</p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              {LATENCY.map((item) => {
                const parsed = parseLatency(item.value)
                return (
                  <div key={item.label} className="rounded-2xl border border-rule bg-white/60 p-5">
                    <div className="font-display text-[clamp(1.6rem,3vw,2.4rem)] tracking-[-0.02em] text-ink">
                      {parsed ? (
                        <LatencyValue
                          prefix={parsed.prefix}
                          number={parsed.number}
                          suffix={parsed.suffix}
                        />
                      ) : (
                        item.value
                      )}
                    </div>
                    <div className="mt-2 text-[12.5px] font-medium text-ink-3">{item.label}</div>
                    <div className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-5">
                      {item.sub}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="mt-16 flex flex-wrap items-center gap-3">
          <Magnetic strength={0.3}>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="btn btn--light">
              Read the source
            </a>
          </Magnetic>
          <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-4">
            MIT licensed · ~17 design docs · 10 ADRs
          </span>
        </div>
      </div>
    </section>
  )
}

const GITHUB_URL = 'https://github.com/LakshayBot/ConverseIQ'

// The connector — it owns the space between two cards. A hairline track
// with a brand fill that draws itself, a small center node with a
// directional arrow, and a pulse traveling along the track. On small
// screens the whole track rotates 90° into a vertical timeline.
function ArchConnector({ index }: { index: number }): React.JSX.Element {
  return (
    <span className="arch-connector" aria-hidden="true">
      <span className="arch-track">
        <span className="arch-track-line" />
        <span data-arch-link={index + 1} className="arch-track-fill" />
        <span data-arch-pulse={index + 1} className="arch-track-pulse-wrap">
          <span className="arch-track-pulse" />
        </span>
      </span>
      <span data-arch-node={index + 1} className="arch-node">
        <IconArrow size={10} />
      </span>
    </span>
  )
}

function LatencyValue({
  prefix,
  number,
  suffix,
}: {
  prefix: string
  number: number
  suffix: string
}): React.JSX.Element {
  const { ref, value } = useCountUp(number, {
    duration: 1.5,
    decimals: suffix.includes('.') ? 1 : 0,
  })
  return (
    <span ref={ref}>
      {prefix}
      {value}
      {suffix}
    </span>
  )
}

function parseLatency(
  raw: string,
): { prefix: string; number: number; suffix: string } | null {
  const m = raw.match(/^([^0-9]*)(\d+(?:\.\d+)?)(.*)$/)
  if (!m) return null
  return { prefix: m[1], number: parseFloat(m[2]), suffix: m[3] }
}
