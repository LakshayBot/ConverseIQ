// ============================================================================
// VoiceField — lazy wrapper. Three.js is code-split out of the main bundle
// and only mounts on fine-pointer devices at desktop widths. Under reduced
// motion or on touch, the hero falls back to static ambient glows.
//
// Architectural note: the R3F Canvas injects its own inline
// `position: relative; width/height: 100%`, which would override any
// `absolute inset-0` className passed to it — leaving the particle field as
// an in-flow block (a detached strip at the top of the hero) instead of a
// background layer. The wrapper below owns the geometry: it is the element
// that is absolutely positioned and inset-0, and the Canvas fills it. The
// Hero therefore owns its ambience; nothing exists outside its bounds.
// ============================================================================

import { Suspense, lazy, useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { cx } from '@/lib/cx'
import { prefersCoarsePointer, prefersReducedMotion } from '@/lib/motion'

const VoiceFieldScene = lazy(() =>
  import('./VoiceFieldScene').then((m) => ({ default: m.VoiceFieldScene })),
)

export function VoiceField({ className }: { className?: string }): React.JSX.Element {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    if (prefersReducedMotion() || prefersCoarsePointer()) return
    const mq = window.matchMedia('(min-width: 900px)')
    const sync = (): void => setEnabled(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  return (
    <div
      aria-hidden="true"
      className={cx('pointer-events-none absolute inset-0 overflow-hidden', className)}
    >
      {enabled && (
        <Suspense fallback={null}>
          <Canvas
            camera={{ position: [0, 0, 14], fov: 55 }}
            dpr={[1, 1.75]}
            gl={{ antialias: false, alpha: true, powerPreference: 'high-performance' }}
            style={{ pointerEvents: 'none' }}
          >
            <VoiceFieldScene />
          </Canvas>
        </Suspense>
      )}
    </div>
  )
}
