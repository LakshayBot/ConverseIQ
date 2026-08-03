// ============================================================================
// Motion — shared GSAP setup, reveal primitives and the per-section
// timeline hook. Every section owns its timeline through `useSectionTimeline`,
// which scopes selectors to the section and reverts cleanly on unmount.
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

export const DUR = {
  micro: 0.14,
  short: 0.24,
  medium: 0.42,
  long: 0.72,
  narrative: 1.2,
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

export interface SplitMaskOptions {
  stagger?: number
  duration?: number
  ease?: string
  start?: string
}

/**
 * Masked line reveal — each line of a SplitText is clipped by CSS
 * (.mask-lines .line) and slides up from below on enter.
 */
export function revealLines(
  el: HTMLElement,
  options: SplitMaskOptions = {},
): () => void {
  if (prefersReducedMotion()) return () => {}

  const split = SplitText.create(el, { type: 'lines', linesClass: 'line' })
  gsap.from(split.lines, {
    yPercent: 112,
    duration: options.duration ?? 1.05,
    stagger: options.stagger ?? 0.09,
    ease: options.ease ?? EASE.out,
    scrollTrigger: { start: options.start ?? 'top 82%' },
  })
  return () => {
    split.revert()
  }
}

/**
 * Masked character reveal — headline characters rise into their clipped
 * boxes. Slower, more deliberate than lines: reserved for the moments
 * that carry the narrative.
 */
export function revealChars(
  el: HTMLElement,
  options: SplitMaskOptions = {},
): () => void {
  if (prefersReducedMotion()) {
    gsap.set(el, { opacity: 1 })
    return () => {}
  }

  const split = SplitText.create(el, { type: 'chars' })
  gsap.from(split.chars, {
    yPercent: 118,
    rotateX: -55,
    transformOrigin: '50% 100%',
    duration: options.duration ?? 0.9,
    stagger: options.stagger ?? 0.016,
    ease: options.ease ?? 'power4.out',
    scrollTrigger: { start: options.start ?? 'top 80%' },
  })
  return () => {
    split.revert()
  }
}

/**
 * Word-level mask reveal for mixed-content elements (spans inside headings
 * with accent styling survive: we split plain-text nodes only).
 */
export function revealWords(
  el: HTMLElement,
  options: SplitMaskOptions = {},
): () => void {
  if (prefersReducedMotion()) return () => {}

  const split = SplitText.create(el, { type: 'words' })
  gsap.from(split.words, {
    yPercent: 110,
    duration: options.duration ?? 0.95,
    stagger: options.stagger ?? 0.03,
    ease: options.ease ?? EASE.out,
    scrollTrigger: { start: options.start ?? 'top 82%' },
  })
  return () => {
    split.revert()
  }
}

export function refreshScrollTriggers(): void {
  ScrollTrigger.refresh()
}
