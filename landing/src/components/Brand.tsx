// ============================================================================
// Brand — CallPilot wordmark + mark. Two-tone terracotta, geometric, quiet.
// Tones: ink (dawn register), moon (nocturne register), brand (accent).
// ============================================================================

import { cx } from '@/lib/cx'

interface BrandProps {
  className?: string
  size?: 'sm' | 'md' | 'lg'
  tone?: 'ink' | 'moon' | 'brand'
}

export function Brand({ className, size = 'md', tone = 'ink' }: BrandProps): React.JSX.Element {
  const sizes = {
    sm: { text: 'text-[15px]', mark: 18 },
    md: { text: 'text-[18px]', mark: 22 },
    lg: { text: 'text-[22px]', mark: 26 },
  }[size]

  const word = {
    ink: 'text-ink',
    moon: 'text-moon',
    brand: 'text-brand-3',
  }[tone]

  return (
    <div className={cx('inline-flex items-center gap-2 select-none', className)}>
      <Mark size={sizes.mark} tone={tone} />
      <span
        className={cx(
          'font-display tracking-[-0.02em] font-medium leading-none',
          sizes.text,
          word,
        )}
      >
        CallPilot
      </span>
    </div>
  )
}

function Mark({ size, tone }: { size: number; tone: 'ink' | 'moon' | 'brand' }): React.JSX.Element {
  const stroke = {
    ink: 'var(--color-ink)',
    moon: 'var(--color-moon)',
    brand: 'var(--color-brand-3)',
  }[tone]
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth="1.75"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="4" y1="9" x2="4" y2="15" />
      <line x1="9" y1="6" x2="9" y2="18" />
      <line x1="14" y1="3" x2="14" y2="21" stroke="var(--color-brand-live)" />
      <line x1="19" y1="8" x2="19" y2="16" />
    </svg>
  )
}
