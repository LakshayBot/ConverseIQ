import type { Config } from "tailwindcss";

/* ──────────────────────────────────────────────────────────────────────────
   Tailwind config — Opaline design system
   ──────────────────────────────────────────────────────────────────────────
   Bridges the Opaline CSS variables (in globals.css) into Tailwind so
   components can use them as utility classes:

     bg-opaline-surface / bg-opaline-primary
     text-opaline-on-surface / text-opaline-primary
     border-opaline-outline-variant
     font-display / font-body

   Legacy aliases (primary / secondary / accent / destructive) are kept
   so existing components continue to work — they now resolve to Opaline.
   ────────────────────────────────────────────────────────────────────────── */

export default {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        /* Opaline authoritative palette */
        opaline: {
          surface:                     'var(--opaline-surface)',
          'surface-dim':               'var(--opaline-surface-dim)',
          'surface-bright':            'var(--opaline-surface-bright)',
          'surface-container-lowest':  'var(--opaline-surface-container-lowest)',
          'surface-container-low':     'var(--opaline-surface-container-low)',
          'surface-container':         'var(--opaline-surface-container)',
          'surface-container-high':    'var(--opaline-surface-container-high)',
          'surface-container-highest': 'var(--opaline-surface-container-highest)',
          'on-surface':                'var(--opaline-on-surface)',
          'on-surface-variant':        'var(--opaline-on-surface-variant)',
          'inverse-surface':           'var(--opaline-inverse-surface)',
          'inverse-on-surface':        'var(--opaline-inverse-on-surface)',
          'outline':                   'var(--opaline-outline)',
          'outline-variant':           'var(--opaline-outline-variant)',
          'surface-tint':              'var(--opaline-surface-tint)',
          'surface-variant':           'var(--opaline-surface-variant)',

          primary:                     'var(--opaline-primary)',
          'on-primary':                'var(--opaline-on-primary)',
          'primary-container':         'var(--opaline-primary-container)',
          'on-primary-container':      'var(--opaline-on-primary-container)',
          'inverse-primary':           'var(--opaline-inverse-primary)',
          'primary-fixed':             'var(--opaline-primary-fixed)',
          'primary-fixed-dim':         'var(--opaline-primary-fixed-dim)',
          'on-primary-fixed':          'var(--opaline-on-primary-fixed)',
          'on-primary-fixed-variant':  'var(--opaline-on-primary-fixed-variant)',

          secondary:                   'var(--opaline-secondary)',
          'on-secondary':              'var(--opaline-on-secondary)',
          'secondary-container':       'var(--opaline-secondary-container)',
          'on-secondary-container':    'var(--opaline-on-secondary-container)',
          'secondary-fixed':           'var(--opaline-secondary-fixed)',
          'secondary-fixed-dim':       'var(--opaline-secondary-fixed-dim)',
          'on-secondary-fixed':        'var(--opaline-on-secondary-fixed)',
          'on-secondary-fixed-variant':'var(--opaline-on-secondary-fixed-variant)',

          tertiary:                    'var(--opaline-tertiary)',
          'on-tertiary':               'var(--opaline-on-tertiary)',
          'tertiary-container':        'var(--opaline-tertiary-container)',
          'on-tertiary-container':     'var(--opaline-on-tertiary-container)',
          'tertiary-fixed':            'var(--opaline-tertiary-fixed)',
          'tertiary-fixed-dim':        'var(--opaline-tertiary-fixed-dim)',
          'on-tertiary-fixed':         'var(--opaline-on-tertiary-fixed)',
          'on-tertiary-fixed-variant': 'var(--opaline-on-tertiary-fixed-variant)',

          error:                       'var(--opaline-error)',
          'on-error':                  'var(--opaline-on-error)',
          'error-container':           'var(--opaline-error-container)',
          'on-error-container':        'var(--opaline-on-error-container)',

          background:                  'var(--opaline-background)',
          'on-background':             'var(--opaline-on-background)',
        },

        /* Legacy shadcn aliases — repointed to Opaline */
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        primary:    'var(--primary)',
        secondary:  'var(--secondary)',
        accent:     'var(--accent)',
        destructive:'var(--destructive)',
      },
      fontFamily: {
        /* Inter is the single global font for the project. The
           design.md split (Manrope for display, Inter for body) was
           abandoned in app code because the visual mismatch between
           the sidebar and the main content was jarring. The Tailwind
           `font-display` alias is kept for compatibility but routes
           to the same Inter family. */
        display: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        body:    ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        sans:    ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        /* Opaline typography scale — exposed as Tailwind fontSize keys
           so app code can use `text-headline-lg` etc. via the
           utility classes in globals.css. */
        'display': ['32px', { lineHeight: '1.2', fontWeight: '700' }],
        'h1':      ['24px', { lineHeight: '1.3', fontWeight: '600' }],
        'h2':      ['18px', { lineHeight: '1.4', fontWeight: '500' }],
        'body':    ['16px', { lineHeight: '1.6', fontWeight: '400' }],
        'small':   ['14px', { lineHeight: '1.5', fontWeight: '400' }],
        'caption': ['12px', { lineHeight: '1.4', fontWeight: '400' }],
      },
      borderRadius: {
        /* Opaline shape scale */
        'opaline-sm':  'var(--opaline-radius-sm)',
        'opaline-md':  'var(--opaline-radius-md)',
        'opaline-lg':  'var(--opaline-radius-lg)',
        'opaline-xl':  'var(--opaline-radius-xl)',
        'opaline-2xl': 'var(--opaline-radius-2xl)',
      },
      spacing: {
        /* Opaline spacing scale */
        'opaline-xs': 'var(--opaline-space-xs)',
        'opaline-sm': 'var(--opaline-space-sm)',
        'opaline-md': 'var(--opaline-space-md)',
        'opaline-lg': 'var(--opaline-space-lg)',
        'opaline-xl': 'var(--opaline-space-xl)',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
} satisfies Config;
