// ============================================================================
// Count-up — used by the latency spec. Starts when the element scrolls
// into view, once.
// ============================================================================

import { useEffect, useRef, useState } from 'react'

export function useCountUp(
  target: number,
  options: { duration?: number; decimals?: number } = {},
): { ref: React.RefObject<HTMLSpanElement | null>; value: string } {
  const ref = useRef<HTMLSpanElement | null>(null)
  const [value, setValue] = useState('0')
  const duration = options.duration ?? 1.4
  const decimals = options.decimals ?? 0

  useEffect(() => {
    const el = ref.current
    if (!el) return

    let raf = 0
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return
        io.disconnect()

        const start = performance.now()
        const tick = (now: number): void => {
          const p = Math.min(1, (now - start) / (duration * 1000))
          const eased = 1 - Math.pow(1 - p, 4)
          setValue((target * eased).toFixed(decimals))
          if (p < 1) raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
      },
      { threshold: 0.4 },
    )

    io.observe(el)
    return () => {
      cancelAnimationFrame(raf)
      io.disconnect()
    }
  }, [target, duration, decimals])

  return { ref, value }
}
