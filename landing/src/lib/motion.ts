// ============================================================================
// Motion — shared GSAP setup, the masked heading-reveal primitive and the
// per-section timeline hook. Every section owns its timeline through
// `useSectionTimeline`, which scopes selectors to the section and reverts
// cleanly on unmount.
// ============================================================================

import { useEffect, useLayoutEffect, useRef, type DependencyList, type RefObject } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'

let registered = false

export function registerMotion(): void {
  if (registered) return
  gsap.registerPlugin(ScrollTrigger, SplitText)
  registered = true

  gsap.defaults({
    ease: 'expo.out',
    duration: 0.9,
  })

  ScrollTrigger.config({
    ignoreMobileResize: true,
    autoRefreshEvents: 'visibilitychange,DOMContentLoaded,load',
  })

  gsap.config({ nullTargetWarn: false })
}

registerMotion()

export const EASE = {
  out: 'expo.out',
  inOut: 'power2.inOut',
  quart: 'power4.out',
  spring: 'back.out(1.6)',
} as const

export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

export const prefersCoarsePointer = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia('(pointer: coarse)').matches

/**
 * Per-section GSAP context + ScrollTrigger lifecycle.
 * `factory` runs inside a context scoped to `ref`, so bare selectors like
 * ".line" only match within the section. Returns a cleanup fn (optional).
 *
 * Runs SYNCHRONOUSLY in useLayoutEffect — the GSAP context, ScrollTriggers
 * and initial `gsap.set()` calls all complete before the browser paints.
 * Without this, every section was flashing its pre-animation state for one
 * frame after mount.
 */
export function useSectionTimeline<T extends HTMLElement>(
  ref: RefObject<T | null>,
  factory: () => (() => void) | void,
  deps: DependencyList = [],
): void {
  const factoryRef = useRef(factory)
  factoryRef.current = factory

  useLayoutEffect(() => {
    const ctx = gsap.context(() => factoryRef.current(), ref)
    return () => {
      ctx.revert()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

/**
 * Masked heading reveal — the section h2's hand-authored `.mask-line`
 * rows slide up on enter, clipped by the line mask. Clipping is released
 * once the reveal completes so descenders are never cut.
 *
 * Initial state is applied synchronously in useLayoutEffect so the mask
 * is already at yPercent:112 before the first paint.
 */
export function useHeadingReveal<T extends HTMLElement>(ref: RefObject<T | null>): void {
  useLayoutEffect(() => {
    const root = ref.current
    const inners = root?.querySelectorAll<HTMLElement>('.mask-line-inner')
    if (!root || !inners?.length) return

    if (prefersReducedMotion()) {
      gsap.set(inners, { yPercent: 0 })
      return
    }

    // Lock the from-state before ScrollTrigger takes over — first paint
    // shows the heading already clipped at the bottom edge.
    gsap.set(inners, { yPercent: 112 })

    const tween = gsap.to(inners, {
      yPercent: 0,
      duration: 1.0,
      stagger: 0.09,
      ease: EASE.out,
      scrollTrigger: { start: 'top 84%' },
      onComplete: () => gsap.set(inners, { overflow: 'visible' }),
    })

    return () => {
      tween.scrollTrigger?.kill()
      tween.kill()
    }
  }, [ref])
}

/**
 * Paints the accent gradient onto the split characters directly.
 *
 * `background-clip: text` on the accent <em> stops working the moment
 * SplitText moves its text into child .char boxes — the em is left with
 * no text of its own, so the clip region is empty, and the gradient paints
 * nothing (glyphs become invisible until a text-selection repaints them).
 * Painting each character individually with a phrase-sized background
 * keeps the gradient flowing continuously across the word, and works in
 * every browser regardless of the split structure.
 */
export function paintAccentGradient(root: HTMLElement): () => void {
  const accentChars = Array.from(root.querySelectorAll<HTMLElement>('.accent .char'))
  if (!accentChars.length) return () => {}

  const apply = (): void => {
    if (!accentChars.length) return
    const first = accentChars[0].getBoundingClientRect()
    const last = accentChars[accentChars.length - 1].getBoundingClientRect()
    const width = Math.max(1, last.right - first.left)
    for (const char of accentChars) {
      const left = char.getBoundingClientRect().left - first.left
      char.style.backgroundImage =
        'linear-gradient(115deg, var(--color-brand-live) 10%, #ffb48a 55%, var(--color-brand-soft) 90%)'
      char.style.backgroundSize = `${width}px 100%`
      char.style.backgroundPosition = `${-left}px 0`
      char.style.backgroundRepeat = 'no-repeat'
      char.style.backgroundClip = 'text'
      char.style.webkitBackgroundClip = 'text'
      char.style.color = 'transparent'
      char.style.webkitTextFillColor = 'transparent'
    }
  }
  apply()

  // Characters reflow on resize and on font swap — keep the phrase gradient
  // aligned with the new metrics both times. The font listener is fire-and-
  // forget; if the user unmounts before fonts settle, the apply() call is a
  // safe no-op (accent chars are already gone from the DOM).
  window.addEventListener('resize', apply, { passive: true })
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    document.fonts.ready.then(apply).catch(() => undefined)
  }
  return () => window.removeEventListener('resize', apply)
}

export function refreshScrollTriggers(): void {
  ScrollTrigger.refresh()
}
