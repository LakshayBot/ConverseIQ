// ============================================================================
// Preloader — the boot sequence. "callpilot" types in like a transcript,
// then the curtain lifts. Dispatches `cp:booted` on exit.
//
// Reduced-motion path: hide the curtain synchronously in useLayoutEffect
// so it never paints, then fire onDone. No interval, no GSAP, no
// timing surface.
// ============================================================================

import { useEffect, useLayoutEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { EASE, prefersReducedMotion } from '@/lib/motion'

const WORD = 'callpilot'

export function Preloader({ onDone }: { onDone: () => void }): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const lineRef = useRef<HTMLDivElement>(null)
  // Use a ref so the long-running effect doesn't tear down + restart when
  // the parent re-renders with a new `onDone` identity (e.g. App's setState).
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useLayoutEffect(() => {
    if (!prefersReducedMotion() || !rootRef.current) return
    rootRef.current.style.display = 'none'
    onDoneRef.current()
  }, [])

  useEffect(() => {
    if (prefersReducedMotion()) return

    let typed = 0
    const typeTimer = setInterval(() => {
      typed += 1
      if (textRef.current) textRef.current.textContent = WORD.slice(0, typed)
      if (typed >= WORD.length) {
        clearInterval(typeTimer)
        boot()
      }
    }, 46)

    const boot = (): void => {
      const tl = gsap.timeline({ onComplete: () => onDoneRef.current() })
      tl.to(lineRef.current, {
        opacity: 1,
        y: 0,
        duration: 0.4,
        ease: EASE.out,
      })
        .to(rootRef.current, {
          clipPath: 'inset(0 0 100% 0)',
          duration: 0.85,
          ease: EASE.inOut,
          delay: 0.35,
        })
        .set(rootRef.current, { display: 'none' })
    }

    return () => clearInterval(typeTimer)
  }, [])

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      className="fixed inset-0 z-[300] flex flex-col items-center justify-center bg-ink-950"
      style={{ clipPath: 'inset(0 0 0% 0)' }}
    >
      <div className="flex items-baseline gap-3 font-mono text-[clamp(1.4rem,3vw,2rem)] tracking-[0.08em] text-moon">
        <span ref={textRef} />
        <span className="caret" />
      </div>
      <div
        ref={lineRef}
        className="mt-5 font-mono text-[10.5px] uppercase tracking-[0.24em] text-moon-3 opacity-0"
        style={{ transform: 'translateY(6px)' }}
      >
        listening for intelligence
      </div>
      <div
        aria-hidden="true"
        className="absolute bottom-0 left-0 h-[2px] w-full origin-left"
        style={{
          background:
            'linear-gradient(90deg, transparent, var(--color-brand-live), transparent)',
        }}
      />
    </div>
  )
}
