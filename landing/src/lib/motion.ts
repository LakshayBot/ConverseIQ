// ============================================================================
// Motion — shared GSAP setup, the masked heading-reveal primitive and the
// per-section timeline hook. Every section owns its timeline through
// `useSectionTimeline`, which scopes selectors to the section and reverts
// cleanly on unmount.
// ============================================================================

import { useEffect, useRef, type DependencyList, type RefObject } from 'react'
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
 */
export function useSectionTimeline<T extends HTMLElement>(
  ref: RefObject<T | null>,
  factory: () => (() => void) | void,
  deps: DependencyList = [],
): void {
  const factoryRef = useRef(factory)
  factoryRef.current = factory

  useEffect(() => {
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
 */
export function useHeadingReveal<T extends HTMLElement>(ref: RefObject<T | null>): void {
  useEffect(() => {
    const root = ref.current
    const inners = root?.querySelectorAll<HTMLElement>('.mask-line-inner')
    if (!root || !inners?.length) return

    if (prefersReducedMotion()) {
      gsap.set(inners, { yPercent: 0 })
      return
    }

    const tween = gsap.fromTo(
      inners,
      { yPercent: 112 },
      {
        yPercent: 0,
        duration: 1.0,
        stagger: 0.09,
        ease: EASE.out,
        scrollTrigger: { start: 'top 84%' },
        onComplete: () => gsap.set(inners, { overflow: 'visible' }),
      },
    )

    return () => {
      tween.scrollTrigger?.kill()
      tween.kill()
    }
  }, [ref])
}

export function refreshScrollTriggers(): void {
  ScrollTrigger.refresh()
}
