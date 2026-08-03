// ============================================================================
// LiveCallWindow — the hero's centerpiece. A real call, performed:
// lines type in with a caret, and the moment a line completes, its
// intelligence card lands in the rail with a latency readout. Loops.
// Pauses off-screen. Renders static under reduced motion.
// ============================================================================

import { useEffect, useRef, useState } from 'react'
import { HERO_CARDS, HERO_LINES, type Speaker } from '@/data/content'
import { cx } from '@/lib/cx'
import { prefersReducedMotion } from '@/lib/motion'
import { IntelCard, type Severity } from './IntelCard'
import { SpeakerDot } from './SpeakerDot'
import { Equalizer } from './Equalizer'
import { kindMeta } from './kinds'

const CHAR_MS = 15
const LINE_HOLD_MS = 300
const CARD_HOLD_MS = 420
const LOOP_HOLD_MS = 2600
const RESET_MS = 300

interface WindowLine {
  speaker: Speaker
  time: string
  text: string
}

export function LiveCallWindow({ className }: { className?: string }): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const [typed, setTyped] = useState<number[]>(() => HERO_LINES.map(() => 0))
  const [cardsLanded, setCardsLanded] = useState(-1)
  const [speaking, setSpeaking] = useState(-1)
  const [latency, setLatency] = useState(0)
  const [resetting, setResetting] = useState(false)

  const reduced = prefersReducedMotion()

  useEffect(() => {
    if (reduced) {
      setTyped(HERO_LINES.map((l) => l.text.length))
      setCardsLanded(HERO_CARDS.length - 1)
      return
    }

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let visible = true

    const io = new IntersectionObserver(
      (entries) => {
        visible = entries[0]?.isIntersecting ?? false
      },
      { threshold: 0.18, rootMargin: '0px 0px -8% 0px' },
    )
    if (rootRef.current) io.observe(rootRef.current)

    const sleep = (ms: number): Promise<void> =>
      new Promise((resolve) => {
        timer = setTimeout(resolve, ms)
      })

    const countUp = async (target: number): Promise<void> => {
      const start = performance.now()
      const dur = 520
      const step = (): void => {
        if (cancelled) return
        const p = Math.min(1, (performance.now() - start) / dur)
        setLatency(Math.round(target * (1 - Math.pow(1 - p, 3))))
        if (p < 1) requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
      await sleep(dur + 60)
    }

    const play = async (): Promise<void> => {
      while (!cancelled) {
        for (let i = 0; i < HERO_LINES.length; i++) {
          if (cancelled) return
          while (!visible && !cancelled) await sleep(140)

          setSpeaking(i)
          const text = HERO_LINES[i].text
          for (let c = 1; c <= text.length; c++) {
            if (cancelled) return
            setTyped((prev) => prev.map((v, idx) => (idx === i ? c : v)))
            await sleep(CHAR_MS)
          }
          await sleep(LINE_HOLD_MS)

          if (i < HERO_CARDS.length) {
            setCardsLanded(i)
            window.dispatchEvent(new CustomEvent('cp:voice-pulse'))
            void countUp(298 + i * 41)
            await sleep(CARD_HOLD_MS)
          }
        }

        setSpeaking(-1)
        await sleep(LOOP_HOLD_MS)
        if (cancelled) return

        setResetting(true)
        await sleep(RESET_MS)
        if (cancelled) return
        setResetting(false)
        setTyped(HERO_LINES.map(() => 0))
        setCardsLanded(-1)
        setLatency(0)
      }
    }

    void play()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      io.disconnect()
    }
  }, [reduced])

  return (
    <div
      ref={rootRef}
      className={cx(
        'overflow-hidden rounded-2xl border border-white/[0.09] bg-ink-900/80 shadow-[0_2px_16px_rgba(0,0,0,0.4),0_40px_90px_-24px_rgba(0,0,0,0.7)] backdrop-blur-xl',
        className,
      )}
    >
      {/* ── Window chrome ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.07] px-4 py-2.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            <span className="h-2.5 w-2.5 rounded-full bg-[#e0726b]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#d8b25c]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#7ea36a]" />
          </div>
          <span className="hidden truncate font-mono text-[10.5px] tracking-[0.04em] text-moon-3 sm:block">
            callpilot · live · meeting_2f9c4d
          </span>
        </div>
        <div
          className={cx(
            'flex shrink-0 items-center gap-2 rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors duration-300',
            speaking >= 0
              ? 'border-[rgba(255,122,80,0.35)] text-brand-live'
              : 'border-white/[0.1] text-moon-3',
          )}
        >
          <span
            className={cx(
              'h-1.5 w-1.5 rounded-full',
              speaking >= 0 ? 'bg-brand-live animate-pulse' : 'bg-moon-3',
            )}
          />
          {speaking >= 0 ? 'Listening' : 'Idle'}
        </div>
      </div>

      {/* ── Body: transcript | rail ───────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,15.5rem)]">
        <div className="flex min-h-[380px] flex-col gap-4 px-4 py-5 sm:px-5">
          {HERO_LINES.map((line, i) => (
            <TranscriptRow
              key={line.id}
              line={line}
              index={i}
              typed={typed[i]}
              speaking={speaking === i}
              isLast={i === HERO_LINES.length - 1}
            />
          ))}
          <div className="flex items-center gap-3 pt-1">
            <Equalizer active={speaking >= 0} className="h-4" />
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-moon-3">
              {speaking >= 0 ? 'voice detected' : 'awaiting speech'}
            </span>
          </div>
        </div>

        <div className="relative border-t border-white/[0.07] sm:border-l sm:border-t-0">
          <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-2.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-moon-3">
              Intelligence
            </span>
            <span className="font-mono text-[10px] text-brand-live">
              +{latency} ms
            </span>
          </div>
          <div className="flex min-h-[340px] flex-col gap-2.5 p-3">
            {resetting && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-ink-900/60">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-moon-3">
                  looping…
                </span>
              </div>
            )}
            {cardsLanded < 0 && !resetting && (
              <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-3 text-center">
                <span className="h-8 w-8 rounded-full border border-dashed border-white/[0.14]" />
                <p className="max-w-[200px] font-mono text-[11px] leading-relaxed text-moon-3">
                  cards land here the moment a signal fires
                </p>
              </div>
            )}
            {HERO_CARDS.slice(0, cardsLanded + 1).map((card) => (
              <div key={card.id} className={cx(resetting && 'intel-card--out')}>
                <IntelCard
                  animateIn={!resetting}
                  kind={kindMeta(card.kind).label}
                  icon={kindMeta(card.kind).icon}
                  severity={card.severity as Severity}
                  title={card.title}
                  body={card.body}
                  sources={card.sources}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Footer strip ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-t border-white/[0.07] px-4 py-2.5 sm:px-5">
        <span className="font-mono text-[10px] tracking-[0.06em] text-moon-3">
          real pipeline output · not a static mock
        </span>
        <span className="hidden font-mono text-[10px] tracking-[0.06em] text-moon-3 sm:block">
          card-to-rail · ~300 ms
        </span>
      </div>
    </div>
  )
}

function TranscriptRow({
  line,
  index,
  typed,
  speaking,
  isLast,
}: {
  line: WindowLine
  index: number
  typed: number
  speaking: boolean
  isLast: boolean
}): React.JSX.Element {
  const partial = typed < line.text.length
  const isRep = line.speaker === 'rep'

  return (
    <div className={cx('flex items-start gap-3', !partial && !speaking && index > 0 && 'mt-1')}>
      <SpeakerDot speaker={line.speaker} pulse={speaking} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: isRep ? 'var(--color-rep)' : 'var(--color-prospect)' }}
          >
            {isRep ? 'REP' : 'PROSPECT'}
          </span>
          <span className="font-mono text-[10px] text-moon-3">{line.time}</span>
          {speaking && (
            <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-brand-live">
              · live
            </span>
          )}
        </div>
        <p
          className={cx(
            'mt-0.5 text-[13.5px] leading-[1.55] transition-colors duration-300',
            speaking || isLast ? 'text-moon' : 'text-moon-2/80',
          )}
        >
          {line.text.slice(0, typed)}
          {partial && speaking && <span aria-hidden="true" className="caret" />}
        </p>
      </div>
    </div>
  )
}
