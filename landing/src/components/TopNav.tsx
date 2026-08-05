// ============================================================================
// TopNav — glass on scroll, hairline links, magnetic CTA. On mobile the
// links fold into a full-screen sheet.
// ============================================================================

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { cx } from '@/lib/cx'
import { IconArrow } from './icons'
import { Brand } from './Brand'
import { Magnetic } from './Magnetic'
import { ThemeToggle } from './ThemeToggle'

const LINKS = [
  { label: 'Problem', href: '#problem' },
  { label: 'Pipeline', href: '#pipeline' },
  { label: 'Signals', href: '#signals' },
  { label: 'Architecture', href: '#architecture' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'FAQ', href: '#faq' },
]

export function TopNav(): React.JSX.Element {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onScroll = (): void => setScrolled(window.scrollY > 32)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  return (
    <>
      <header
        className={cx(
          'nocturne fixed inset-x-0 top-0 z-[110] transition-all duration-500',
          scrolled
            ? 'border-b border-[var(--border-soft)] bg-[var(--surface-glass-strong)] backdrop-blur-xl'
            : 'border-b border-transparent bg-transparent',
        )}
      >
        <div
          className="mx-auto flex h-[68px] w-full max-w-[1240px] items-center justify-between px-[clamp(1.25rem,4vw,3rem)]"
          style={{ paddingTop: 'var(--safe-top)' }}
        >
          <a href="#top" aria-label="CallPilot — back to top" className="no-drag">
            <Brand tone="moon" />
          </a>

          <nav className="hidden items-center gap-7 lg:flex" aria-label="Primary">
            {LINKS.map((link) => (
              <a key={link.href} href={link.href} className="nav-link">
                {link.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <ThemeToggle className="hidden sm:flex" />
            <Magnetic strength={0.3} className="hidden sm:block">
              <a href="#cta" className="btn btn--primary px-5! py-2.5! text-[13px]!">
                Start your next call
                <span className="btn-arrow">
                  <IconArrow size={13} />
                </span>
              </a>
            </Magnetic>
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-label={open ? 'Close menu' : 'Open menu'}
              aria-expanded={open}
              className="flex h-11 w-11 flex-col items-center justify-center gap-[5px] rounded-full border border-[var(--border-mid)] lg:hidden"
            >
              <span
                className={cx('h-px w-4 bg-moon transition-transform duration-300', open && 'translate-y-[3px] rotate-45')}
              />
              <span
                className={cx('h-px w-4 bg-moon transition-transform duration-300', open && '-translate-y-[3px] -rotate-45')}
              />
            </button>
          </div>
        </div>
      </header>

      {/* ── Mobile sheet ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.28 }}
            className="nocturne fixed inset-0 z-[105] flex flex-col justify-end bg-[var(--sheet-bg)] px-[clamp(1.25rem,4vw,3rem)] pb-8 pt-28 backdrop-blur-xl lg:hidden"
            style={{ paddingBottom: 'calc(2rem + var(--safe-bottom))' }}
          >
            <nav aria-label="Mobile" className="flex flex-col gap-2">
              {LINKS.map((link, i) => (
                <motion.a
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  initial={{ y: 26, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.05 + i * 0.05, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                  className="h3-display flex items-baseline justify-between border-b border-[var(--border-soft)] py-4 text-moon"
                >
                  {link.label}
                  <span className="font-mono text-[11px] tracking-[0.2em] text-moon-3">
                    0{i + 1}
                  </span>
                </motion.a>
              ))}
            </nav>
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.4, duration: 0.4 }}
              className="mt-8"
            >
              <div aria-hidden="true" className="mx-auto mb-6 h-1 w-9 rounded-full bg-[var(--border-mid)]" />
              <div className="mb-4 flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-moon-3">
                  appearance
                </span>
                <ThemeToggle />
              </div>
              <a href="#cta" onClick={() => setOpen(false)} className="btn btn--primary w-full justify-center">
                Start with your next call
                <IconArrow size={15} />
              </a>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
