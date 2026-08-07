/**
 * Shared motion variants - one vocabulary for the whole app.
 *
 * Apple-level restraint: short durations, single ease-out curve,
 * transform/opacity only (GPU friendly). Nothing bounces, nothing
 * exaggerates. Reduced-motion is respected via framer-motion's
 * `useReducedMotion` where component logic needs it; the CSS global
 * kill-switch covers everything else.
 */
import type { Variants } from 'framer-motion';
import type { Easing } from 'framer-motion';

export const EASE_OUT: Easing = [0.16, 1, 0.3, 1];

export const DUR_FAST = 0.16;
export const DUR_BASE = 0.24;

/** Fade + 8px rise - the standard entrance for panels and cards. */
export const fadeUp: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: DUR_BASE, ease: EASE_OUT },
  },
  exit: {
    opacity: 0,
    y: -4,
    transition: { duration: DUR_FAST, ease: EASE_OUT },
  },
};

/** Pure fade - for cross-fades between whole views. */
export const fadeIn: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: DUR_BASE, ease: EASE_OUT } },
  exit: { opacity: 0, transition: { duration: DUR_FAST, ease: EASE_OUT } },
};

/** Scale + fade - for compact elements (toasts, chips, dots). */
export const scaleIn: Variants = {
  initial: { opacity: 0, scale: 0.96 },
  animate: {
    opacity: 1,
    scale: 1,
    transition: { duration: DUR_FAST, ease: EASE_OUT },
  },
  exit: {
    opacity: 0,
    scale: 0.98,
    transition: { duration: DUR_FAST, ease: EASE_OUT },
  },
};

/** Stagger container - pair with children that use fadeUp/scaleIn. */
export const stagger = (staggerChildren = 0.05, delayChildren = 0): Variants => ({
  animate: { transition: { staggerChildren, delayChildren } },
});

/** One-liner to reduce boilerplate on common animated containers. */
export const motionProps = (staggerChildren = 0.05) => ({
  variants: stagger(staggerChildren),
  initial: 'initial',
  animate: 'animate',
  exit: 'exit',
});
