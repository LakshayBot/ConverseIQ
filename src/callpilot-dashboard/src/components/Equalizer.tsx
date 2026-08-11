// ============================================================================
// Equalizer — the voice meter. Bars bounce while the speaker is active;
// they go quiet the moment speech stops. Pure CSS animation, no JS loop.
// ============================================================================

import { useMemo } from 'react'
import { cx } from '@/lib/cx'

const BAR_COUNT = 9

export function Equalizer({
  active = true,
  bars = BAR_COUNT,
  className,
}: {
  active?: boolean
  bars?: number
  className?: string
}): React.JSX.Element {
  const barsArr = useMemo(
    () =>
      Array.from({ length: bars }, (_, i) => ({
        delay: -Math.abs(Math.sin(i * 1.7)) * 1.1,
        duration: 0.7 + Math.abs(Math.sin(i * 0.9)) * 0.55,
        height: 0.4 + Math.abs(Math.sin(i * 2.3)) * 0.6,
      })),
    [bars],
  )

  return (
    <span
      aria-hidden="true"
      className={cx('inline-flex items-end gap-[3px]', className)}
    >
      {barsArr.map((b, i) => (
        <span
          key={i}
          className={cx('eq-bar', !active && 'is-quiet')}
          style={{
            height: `${Math.round(b.height * 100)}%`,
            animationDelay: `${b.delay}s`,
            animationDuration: `${b.duration}s`,
          }}
        />
      ))}
    </span>
  )
}
