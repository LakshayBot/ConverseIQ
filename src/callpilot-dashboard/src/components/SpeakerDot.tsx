// ============================================================================
// SpeakerDot — colored dot for rep / prospect. The only saturated colors
// in the system, shared with the product's live rail.
// ============================================================================

import type { Speaker } from '@/data/content'
import { cx } from '@/lib/cx'

export function SpeakerDot({
  speaker,
  size = 8,
  pulse = false,
}: {
  speaker: Speaker
  size?: number
  pulse?: boolean
}): React.JSX.Element {
  const color = speaker === 'rep' ? 'var(--color-rep)' : 'var(--color-prospect)'
  return (
    <span
      aria-hidden="true"
      className={cx('inline-block rounded-full shrink-0 relative', pulse && 'animate-pulse')}
      style={{
        width: size,
        height: size,
        background: color,
        marginTop: 6,
        boxShadow: `0 0 ${size * 2.5}px ${color}66`,
      }}
    />
  )
}
