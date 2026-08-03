// ============================================================================
// Footer — the close. Dense and quiet: the brand, the links, and the
// runtime facts that matter to the people self-hosting it.
// ============================================================================

import { Brand } from './Brand'
import { IconArrowUpRight, IconGitHub } from './icons'

const GITHUB_URL = 'https://github.com/LakshayBot/ConverseIQ'

const LINK_COLS: {
  title: string
  links: { label: string; href: string; external?: boolean }[]
}[] = [
  {
    title: 'Narrative',
    links: [
      { label: 'Problem', href: '#problem' },
      { label: 'Pipeline', href: '#pipeline' },
      { label: 'Signals', href: '#signals' },
      { label: 'Architecture', href: '#architecture' },
    ],
  },
  {
    title: 'The product',
    links: [
      { label: 'Use cases', href: '#cases' },
      { label: 'Pricing', href: '#pricing' },
      { label: 'FAQ', href: '#faq' },
      { label: 'Start your next call', href: '#cta' },
    ],
  },
  {
    title: 'Runtime facts',
    links: [
      { label: 'MIT licensed', href: GITHUB_URL, external: true },
      { label: 'Self-hosted', href: GITHUB_URL, external: true },
      { label: 'Bring your own model', href: GITHUB_URL, external: true },
      { label: 'No recording · no call-home', href: GITHUB_URL, external: true },
    ],
  },
]

export function Footer(): React.JSX.Element {
  return (
    <footer className="nocturne border-t border-white/[0.06]">
      <div className="mx-auto w-full max-w-[1240px] px-[clamp(1.25rem,4vw,3rem)] pb-10 pt-16">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div>
            <Brand tone="moon" size="lg" />
            <p className="mt-5 max-w-[34ch] text-[13.5px] leading-[1.7] text-moon-2">
              Live intelligence during the call. On your machine, with your
              model, in front of the question still being asked.
            </p>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="btn btn--ghost mt-8 !px-5 !py-2.5 !text-[13px]"
            >
              <IconGitHub size={14} />
              github.com/LakshayBot/ConverseIQ
              <IconArrowUpRight size={13} />
            </a>
          </div>

          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3">
            {LINK_COLS.map((col) => (
              <div key={col.title}>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-moon-3">
                  {col.title}
                </p>
                <ul className="mt-5 space-y-3">
                  {col.links.map((link) => (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        target={link.external ? '_blank' : undefined}
                        rel={link.external ? 'noreferrer' : undefined}
                        className="nav-link !text-[13.5px]"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-16 flex flex-col items-start justify-between gap-4 border-t border-white/[0.06] pt-8 sm:flex-row sm:items-center">
          <p className="font-mono text-[10.5px] tracking-[0.08em] text-moon-3">
            © 2026 CallPilot · built in the open
          </p>
          <p className="font-mono text-[10.5px] tracking-[0.08em] text-moon-3">
            nemotron · ahocorasick · signalr · pgvector · ~300 ms
          </p>
        </div>
      </div>
    </footer>
  )
}
