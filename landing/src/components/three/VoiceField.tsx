// ============================================================================
// VoiceField — lazy wrapper. Three.js is code-split out of the main bundle
// and only mounts on fine-pointer devices at desktop widths. Under reduced
// motion or on touch, the hero falls back to static ambient glows.
// ============================================================================

import { Suspense, lazy, useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
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

  if (!enabled) {
    return <div aria-hidden="true" className={className} />
  }

  return (
    <Canvas
      className={className}
      camera={{ position: [0, 0, 14], fov: 55 }}
      dpr={[1, 1.75]}
      gl={{ antialias: false, alpha: true, powerPreference: 'high-performance' }}
      style={{ pointerEvents: 'none' }}
    >
      <Suspense fallback={null}>
        <VoiceFieldScene />
      </Suspense>
    </Canvas>
  )
}
