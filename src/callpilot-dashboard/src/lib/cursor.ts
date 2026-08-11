// ============================================================================
// Cursor — dot + trailing halo with lerp; grows over interactive elements.
// Skipped on touch devices and under reduced motion.
// ============================================================================

import { useEffect } from 'react'
import { prefersCoarsePointer, prefersReducedMotion } from './motion'

export function useCursor(): void {
  useEffect(() => {
    if (prefersCoarsePointer() || prefersReducedMotion()) return

    document.body.classList.add('cp-cursor-on')

    const dot = document.createElement('div')
    dot.className = 'cp-cursor'

    const halo = document.createElement('div')
    halo.className = 'cp-cursor-halo'

    document.body.appendChild(dot)
    document.body.appendChild(halo)

    let x = window.innerWidth / 2
    let y = window.innerHeight / 2
    let tx = x
    let ty = y
    let hx = x
    let hy = y
    let raf = 0

    const onMove = (e: PointerEvent): void => {
      tx = e.clientX
      ty = e.clientY
      if (!halo.classList.contains('is-visible')) {
        halo.classList.add('is-visible')
        x = tx
        y = ty
        hx = tx
        hy = ty
      }
    }

    const onOver = (e: PointerEvent): void => {
      const target = e.target as HTMLElement | null
      if (target?.closest('a, button, [data-cursor="hover"], input, textarea')) {
        halo.classList.add('is-active')
        dot.classList.add('is-active')
      }
    }

    const onOut = (e: PointerEvent): void => {
      const target = e.target as HTMLElement | null
      if (target?.closest('a, button, [data-cursor="hover"], input, textarea')) {
        halo.classList.remove('is-active')
        dot.classList.remove('is-active')
      }
    }

    const onLeave = (): void => {
      halo.classList.remove('is-visible')
    }

    const tick = (): void => {
      x += (tx - x) * 0.55
      y += (ty - y) * 0.55
      hx += (tx - hx) * 0.16
      hy += (ty - hy) * 0.16
      dot.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`
      halo.style.transform = `translate3d(${hx}px, ${hy}px, 0) translate(-50%, -50%)`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerover', onOver, { passive: true })
    window.addEventListener('pointerout', onOut, { passive: true })
    document.documentElement.addEventListener('pointerleave', onLeave)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerover', onOver)
      window.removeEventListener('pointerout', onOut)
      document.documentElement.removeEventListener('pointerleave', onLeave)
      dot.remove()
      halo.remove()
      document.body.classList.remove('cp-cursor-on')
    }
  }, [])
}
