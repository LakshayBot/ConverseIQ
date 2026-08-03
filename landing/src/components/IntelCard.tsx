// ============================================================================
// IntelCard — the product's signature artifact, reproduced pixel-for-pixel
// from the live rail: type badge, priority, headline, talking point, sources.
// ============================================================================

import { useState } from 'react'
import { cx } from '@/lib/cx'
import { IconSource } from './icons'
import { IconChevronDown, IconChevronRight } from './chevrons'
import { SEV_COLOR, type Severity } from './severity'

export type { Severity } from './severity'

export interface IntelCardProps {
  kind: string
  severity: Severity
  title: string
  body?: string
  sources?: string[]
  icon?: React.ReactNode
  className?: string
  animateIn?: boolean
}

const SEV_BORDER: Record<Severity, string> = {
  high: 'border-l-[3px] border-l-[var(--sev-high)]',
  medium: 'border-l-2 border-l-[var(--sev-med)]',
  low: 'border-l-2 border-l-[var(--sev-low)]',
}

export function IntelCard({
  kind,
  severity,
  title,
  body,
  sources,
  icon,
  className,
  animateIn = false,
}: IntelCardProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const hasSources = Boolean(sources && sources.length > 0)

  return (
    <div
      className={cx(
        'intel-card overflow-hidden rounded-xl border border-black/[0.07] bg-white/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.2),0_10px_28px_rgba(0,0,0,0.25)] backdrop-blur-sm',
        SEV_BORDER[severity],
        animateIn && 'intel-card--in',
        className,
      )}
    >
      <div className="p-4">
        <div className="flex items-center justify-between gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.09em]"
            style={{ background: 'var(--intel-badge)', color: SEV_COLOR[severity] }}
          >
            {icon}
            {kind}
          </span>
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.1] px-2.5 py-0.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.12em]"
            style={{ color: SEV_COLOR[severity] }}
          >
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: SEV_COLOR[severity] }}
            />
            {severity}
          </span>
        </div>

        <div className="mt-2.5 text-[15px] font-semibold leading-snug text-moon">
          {title}
        </div>

        {body && (
          <div className="mt-1.5 text-[12.5px] leading-[1.55] whitespace-pre-wrap text-moon-2">
            {body}
          </div>
        )}

        {hasSources && (
          <div className="mt-3 border-t border-white/[0.08] pt-2.5">
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 font-mono text-[10.5px] text-moon-2 transition-colors hover:text-moon"
            >
              {open ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
              <IconSource size={11} />
              Sources ({sources!.length})
            </button>
            {open && (
              <ul className="mt-2 space-y-1.5">
                {sources!.map((s, i) => (
                  <li
                    key={i}
                    className="border-l-2 border-white/[0.14] pl-2 text-[11px] leading-relaxed text-moon-2"
                  >
                    {s}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
