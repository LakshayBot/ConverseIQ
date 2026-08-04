// ============================================================================
// ScrollProgress — a 2 px hairline of terracotta along the very top edge,
// tied to scroll position. The only element that tracks progress globally.
// ============================================================================

import { useLayoutEffect, useRef } from 'react'
import { gsap } from 'gsap'

export function ScrollProgress(): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const tween = gsap.to(el, {
      scaleX: 1,
      ease: 'none',
      scrollTrigger: {
        start: 0,
        end: 'max',
        scrub: 0.3,
      },
    })
    return () => {
      tween.scrollTrigger?.kill()
      tween.kill()
    }
  }, [])

  return <div ref={ref} aria-hidden="true" className="scroll-progress" />
}
