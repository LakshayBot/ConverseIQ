// ============================================================================
// FAQSection — answered in the voice. Accordion driven by grid-rows, so the
// height animation is pure CSS and stays perfectly smooth.
// ============================================================================

import { useRef, useState } from 'react'
import { FAQ } from '@/data/content'
import { cx } from '@/lib/cx'
import { IconChevronDown } from './chevrons'

export function FAQSection(): React.JSX.Element {
  const rootRef = useRef<HTMLElement>(null)
  const [open, setOpen] = useState<number>(0)

  return (
    <section id="faq" ref={rootRef} className="dawn section">
      <div className="container">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
          <div>
            <p className="eyebrow">FAQ · asked, answered</p>
            <h2 className="h2-display mask-lines mt-6 max-w-[12ch] text-ink">
              Straight <em className="accent">answers.</em>
            </h2>
            <p className="mt-6 max-w-[34ch] text-[14px] leading-[1.7] text-ink-4">
              The questions every rep and every security team asks — answered
              in the product’s voice.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            {FAQ.map((item, i) => {
              const isOpen = open === i
              return (
                <div
                  key={item.q}
                  className={cx(
                    'overflow-hidden rounded-2xl border transition-all duration-300',
                    isOpen ? 'border-brand/35 bg-white/70' : 'border-rule bg-white/40 hover:border-ink/20',
                  )}
                >
                  <button
                    type="button"
                    data-cursor="hover"
                    onClick={() => setOpen(isOpen ? -1 : i)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center justify-between gap-6 px-6 py-5 text-left"
                  >
                    <span className="flex items-baseline gap-4">
                      <span className="font-mono text-[10.5px] tracking-[0.16em] text-brand">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="text-[15.5px] font-medium text-ink">{item.q}</span>
                    </span>
                    <span
                      className={cx(
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-all duration-300',
                        isOpen
                          ? 'rotate-180 border-brand/50 bg-brand-paper text-brand'
                          : 'border-rule text-ink-4',
                      )}
                      aria-hidden="true"
                    >
                      <IconChevronDown size={13} />
                    </span>
                  </button>
                  <div
                    className="grid transition-[grid-template-rows] duration-500"
                    style={{
                      gridTemplateRows: isOpen ? '1fr' : '0fr',
                      transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
                    }}
                  >
                    <div className="overflow-hidden">
                      <p className="px-6 pb-6 pl-[3.35rem] text-[13.5px] leading-[1.75] text-ink-3">
                        {item.a}
                      </p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
