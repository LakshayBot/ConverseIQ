// ============================================================================
// MarqueeStrip — the honest stack, running past. Mono words + em-dot
// separators; a second copy mirrors to close the loop. Paused on hover.
// ============================================================================

import { cx } from '@/lib/cx'

const STACK_MARQUEE = [
  'Nemotron',
  'Aho-Corasick',
  'SignalR',
  '~300 ms',
  'BYOK',
  'MIT',
  'self-hosted',
  'no recording',
  'PostgreSQL',
  'pgvector',
  'Redis',
  'Tauri',
  'Docling',
  'GLiNER',
]

export function MarqueeStrip({
  items = STACK_MARQUEE,
  className,
}: {
  items?: string[]
  className?: string
}): React.JSX.Element {
  const row = (key: string): React.JSX.Element => (
    <div key={key} aria-hidden={key === 'b'} className="flex shrink-0 items-center">
      {items.map((item, i) => (
        <span key={`${key}-${i}`} className="flex items-center">
          <span className="px-7 font-mono text-[12px] uppercase tracking-[0.22em] text-moon-2/70">
            {item}
          </span>
          <span aria-hidden="true" className="h-1 w-1 rounded-full bg-brand-live/60" />
        </span>
      ))}
    </div>
  )

  return (
    <div
      className={cx(
        'nocturne relative overflow-hidden border-y border-white/[0.06] py-5',
        className,
      )}
      style={{
        ['--marquee-speed' as string]: '44s',
      }}
    >
      <div className="marquee">
        <div className="marquee-track">
          {row('a')}
          {row('b')}
        </div>
      </div>
    </div>
  )
}
