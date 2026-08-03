// ============================================================================
// Magnetic — wraps a button/link; it leans toward the cursor on hover.
// GPU-only transforms, skipped on touch and reduced motion.
// ============================================================================

import { useRef, type ReactNode } from 'react'
import { prefersCoarsePointer, prefersReducedMotion } from '@/lib/motion'

export function Magnetic({
  children,
  strength = 0.3,
  className,
}: {
  children: ReactNode
  strength?: number
  className?: string
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  const onMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const el = ref.current
    if (!el || prefersCoarsePointer() || prefersReducedMotion()) return
    const rect = el.getBoundingClientRect()
    const dx = e.clientX - (rect.left + rect.width / 2)
    const dy = e.clientY - (rect.top + rect.height / 2)
    el.style.transform = `translate3d(${dx * strength}px, ${dy * strength}px, 0)`
  }

  const onLeave = (): void => {
    const el = ref.current
    if (!el) return
    el.style.transform = 'translate3d(0, 0, 0)'
  }

  return (
    <div
      ref={ref}
      className={className}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      style={{
        transition: 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)',
        willChange: 'transform',
      }}
    >
      {children}
    </div>
  )
}
