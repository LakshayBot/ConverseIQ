// ============================================================================
// Theme — the page's theme state (nocturne | light). The actual visual
// variables live in CSS on `[data-theme]` (html). This module owns the
// state, persistence, system-preference resolution, and the transition
// choreography — nothing else on the page knows what a theme is.
//
// First paint is handled by the inline bootstrap in index.html, so the
// correct theme is on <html> before React mounts (no flash).
// ============================================================================

import { useCallback, useEffect, useState } from 'react'

export type Theme = 'nocturne' | 'light'

const STORAGE_KEY = 'callpilot-theme'
export const THEME_EVENT = 'callpilot:theme'

export function resolveTheme(): Theme {
  if (typeof window === 'undefined') return 'nocturne'
  const saved = window.localStorage.getItem(STORAGE_KEY)
  if (saved === 'nocturne' || saved === 'light') return saved
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'nocturne'
}

export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const [theme, setTheme] = useState<Theme>(resolveTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: theme }))
    try {
      window.localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      /* private mode — preference just won't persist */
    }
  }, [theme])

  const toggleTheme = useCallback(() => {
    // Animate the swap: color-carrying properties transition for ~550 ms.
    // Transform/opacity are GSAP-owned and never included, so no timeline
    // is disturbed and no animation restarts.
    const root = document.documentElement
    root.classList.add('theme-transition')
    setTheme((current) => (current === 'nocturne' ? 'light' : 'nocturne'))
    window.setTimeout(() => root.classList.remove('theme-transition'), 620)
  }, [])

  return { theme, toggleTheme }
}
