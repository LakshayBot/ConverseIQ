import type { Config } from "tailwindcss";

/* ──────────────────────────────────────────────────────────────────────────
   Tailwind config - Opaline design system
   ──────────────────────────────────────────────────────────────────────────
   Bridges the Opaline CSS variables (globals.css) into Tailwind utilities:

     bg-opaline-surface / bg-opaline-primary
     text-opaline-on-surface / text-opaline-primary
     border-opaline-outline-variant
     shadow-xs..xl (Opaline elevation)
     text-success / bg-success-soft (semantic states)
     duration-base / ease-out (motion tokens)
     font-display / font-body / font-mono

   Legacy shadcn aliases (background/foreground/primary/...) are kept and
   resolve to Opaline via CSS variables.
   ────────────────────────────────────────────────────────────────────────── */

export default {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: ['class'],
  theme: {
    extend: {
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
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
          'primary-hover':             'var(--opaline-primary-hover)',
          'primary-pressed':           'var(--opaline-primary-pressed)',
          'primary-soft':              'var(--opaline-primary-soft)',
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

          overlay:                     'var(--opaline-overlay)',
        },

        /* Semantic states */
        success: {
          DEFAULT: 'var(--opaline-success)',
          soft:    'var(--opaline-success-soft)',
          border:  'var(--opaline-success-border)',
        },
        warning: {
          DEFAULT: 'var(--opaline-warning)',
          soft:    'var(--opaline-warning-soft)',
          border:  'var(--opaline-warning-border)',
        },
        info: {
          DEFAULT: 'var(--opaline-info)',
          soft:    'var(--opaline-info-soft)',
          border:  'var(--opaline-info-border)',
        },
        danger: {
          DEFAULT: 'var(--opaline-danger)',
          soft:    'var(--opaline-danger-soft)',
          border:  'var(--opaline-danger-border)',
        },

        /* Legacy shadcn aliases - repointed to Opaline */
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        primary:    'var(--primary)',
        'primary-foreground': 'var(--primary-foreground)',
        secondary:  'var(--secondary)',
        'secondary-foreground': 'var(--secondary-foreground)',
        accent:     'var(--accent)',
        'accent-foreground': 'var(--accent-foreground)',
        destructive:'var(--destructive)',
        'destructive-foreground': 'var(--destructive-foreground)',
        border:     'var(--border)',
        input:      'var(--input)',
        ring:       'var(--ring)',
        muted: {
          DEFAULT:  'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        popover: {
          DEFAULT:  'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        card: {
          DEFAULT:  'var(--card)',
          foreground: 'var(--card-foreground)',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'Space Grotesk', 'system-ui', 'sans-serif'],
        body:    ['var(--font-body)', 'var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        sans:    ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        mono:    ['var(--font-mono)', 'JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        'display': ['32px', { lineHeight: '1.2', fontWeight: '700', letterSpacing: '-0.02em' }],
        'h1':      ['24px', { lineHeight: '1.3', fontWeight: '600', letterSpacing: '-0.01em' }],
        'h2':      ['18px', { lineHeight: '1.4', fontWeight: '600' }],
        'h3':      ['16px', { lineHeight: '1.4', fontWeight: '600' }],
        'body':    ['14px', { lineHeight: '1.5', fontWeight: '400' }],
        'small':   ['13px', { lineHeight: '1.4', fontWeight: '400' }],
        'caption': ['12px', { lineHeight: '1.3', fontWeight: '400' }],
      },
      borderRadius: {
        /* shadcn scale driven by --radius, so primitives scale with theme */
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        xl: 'calc(var(--radius) + 2px)',
        /* Opaline shape scale */
        'opaline-sm':  'var(--opaline-radius-sm)',
        'opaline-md':  'var(--opaline-radius-md)',
        'opaline-lg':  'var(--opaline-radius-lg)',
        'opaline-xl':  'var(--opaline-radius-xl)',
        'opaline-2xl': 'var(--opaline-radius-2xl)',
      },
      spacing: {
        'opaline-xs': 'var(--opaline-space-xs)',
        'opaline-sm': 'var(--opaline-space-sm)',
        'opaline-md': 'var(--opaline-space-md)',
        'opaline-lg': 'var(--opaline-space-lg)',
        'opaline-xl': 'var(--opaline-space-xl)',
      },
      boxShadow: {
        /* Opaline elevation scale */
        xs:   'var(--shadow-xs)',
        sm:   'var(--shadow-sm)',
        md:   'var(--shadow-md)',
        lg:   'var(--shadow-lg)',
        xl:   'var(--shadow-xl)',
      },
      transitionDuration: {
        micro: 'var(--dur-micro)',
        fast:  'var(--dur-fast)',
        base:  'var(--dur-base)',
        slow:  'var(--dur-slow)',
        slower:'var(--dur-slower)',
      },
      transitionTimingFunction: {
        out:      'var(--ease-out)',
        'in':     'var(--ease-in)',
        'in-out': 'var(--ease-in-out)',
        spring:   'var(--ease-spring)',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
    require('tailwindcss-animate'),
  ],
} satisfies Config;
