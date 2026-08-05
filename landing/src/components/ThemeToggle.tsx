// ============================================================================
// ThemeToggle — the sun/moon switch. A rotating disc: the icon crosses over
// as it spins, the disc itself carries the accent tint. State comes from
// lib/theme (persistent, system-aware); the swap is instant, animated only
// by the theme-transition class on <html>.
// ============================================================================

import { useTheme } from '@/lib/theme'
import { cx } from '@/lib/cx'

function SunIcon({ size = 15 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M18.7 5.3 17 7M7 17l-1.7 1.7" />
    </svg>
  )
}

function MoonIcon({ size = 15 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20.2 14.6A8.5 8.5 0 0 1 9.4 3.8a8.5 8.5 0 1 0 10.8 10.8z" />
    </svg>
  )
}

export function ThemeToggle({ className }: { className?: string }): React.JSX.Element {
  const { theme, toggleTheme } = useTheme()
  const isLight = theme === 'light'

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isLight ? 'Switch to dark theme' : 'Switch to light theme'}
      aria-pressed={isLight}
      className={cx(
        'relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border transition-colors duration-300 touch-card',
        'border-[var(--border-mid)] text-moon-2 hover:border-[var(--border-strong)] hover:text-moon active:text-moon',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="absolute inset-0.5 rounded-full bg-[var(--accent-tint-3)] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
      />
      <span
        aria-hidden="true"
        className="relative block transition-transform duration-500"
        style={{ transform: `rotate(${isLight ? 180 : 0}deg)` }}
      >
        <span
          className="absolute inset-0 transition-opacity duration-300"
          style={{ opacity: isLight ? 0 : 1 }}
        >
          <MoonIcon />
        </span>
        <span
          className="relative block transition-opacity duration-300"
          style={{ opacity: isLight ? 1 : 0 }}
        >
          <SunIcon />
        </span>
      </span>
    </button>
  )
}
