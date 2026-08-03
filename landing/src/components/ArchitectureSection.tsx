// ============================================================================
// ArchitectureSection — the dawn register. Everything on your hardware,
// drawn as three nodes with data flowing between them, then the honest
// stack table and the latency spec counted up from the codebase constants.
// ============================================================================

import { useRef } from 'react'
import { gsap } from 'gsap'
import { ARCH_NODES, LATENCY, STACK } from '@/data/content'
import { useSectionTimeline, prefersReducedMotion } from '@/lib/motion'
import { useCountUp } from '@/lib/count'
import { IconArrow } from './icons'
import { Magnetic } from './Magnetic'

export function ArchitectureSection(): React.JSX.Element {
  const rootRef = useRef<HTMLElement>(null)
  const reduced = prefersReducedMotion()

  useSectionTimeline(
    rootRef,
    () => {
      if (reduced) return
      const ctx = gsap.fromTo(
        '[data-node]',
        { y: 50, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.85,
          stagger: 0.14,
          ease: 'expo.out',
          scrollTrigger: { trigger: rootRef.current, start: 'top 68%' },
        },
      )
      const rows = gsap.fromTo(
        '[data-stack-row]',
        { opacity: 0, x: -22 },
        {
          opacity: 1,
          x: 0,
          duration: 0.6,
          stagger: 0.05,
          ease: 'expo.out',
          scrollTrigger: { trigger: rootRef.current, start: 'top 55%' },
        },
      )
      return () => {
        ctx.scrollTrigger?.kill()
        ctx.kill()
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
        <h2 className="h2-display mask-lines mt-6 max-w-[17ch] text-ink">
          The whole stack, <em className="accent">on your machine.</em>
        </h2>
        <p className="lede mt-6 max-w-[58ch]">
          No subscription, no call-home, no third-party bot in the room.
          Every component ships in the repo — read it, fork it, air-gap it.
        </p>

        {/* ── Diagram: three nodes, data flowing ──────────────────────── */}
        <div className="relative mt-16 grid gap-10 lg:grid-cols-3 lg:gap-0">
          {ARCH_NODES.map((node, i) => (
            <div key={node.id} className="relative flex lg:flex-col">
              <div data-node className="glass relative z-[1] flex-1 rounded-2xl p-6 sm:p-7">
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
                <p className="mt-5 font-mono text-[10.5px] leading-relaxed text-ink-4">
                  {node.meta}
                </p>
              </div>

              {i < ARCH_NODES.length - 1 && (
                <div
                  aria-hidden="true"
                  className="flex items-center justify-center py-4 lg:absolute lg:left-full lg:top-1/2 lg:-translate-y-1/2 lg:py-0"
                  style={{ zIndex: 2 }}
                >
                  <div className="flow-line flex h-10 w-10 items-center justify-center rounded-full border border-rule bg-paper">
                    <IconArrow size={13} className="text-brand" />
                  </div>
                </div>
              )}
            </div>
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
