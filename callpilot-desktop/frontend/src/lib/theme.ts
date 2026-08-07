/**
 * Theme engine - System / Light / Dark.
 *
 * The resolved theme is applied as `dark` class on <html> plus a
 * `color-scheme` hint so native controls (scrollbars, inputs) follow.
 * Preferences persist in localStorage; OS changes are followed while
 * the preference is "system".
 */

export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'callpilot-theme';

export function getThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  } catch {
    /* storage unavailable - fall through to system */
  }
  return 'system';
}

export function setThemePreference(pref: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    /* ignore */
  }
  const root = document.documentElement;
  root.classList.add('theme-switching');
  applyTheme(getSystemTheme());
  window.setTimeout(() => root.classList.remove('theme-switching'), 340);
}

export function getSystemTheme(): 'light' | 'dark' {
  if (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  ) {
    return 'dark';
  }
  return 'light';
}

/** Applies the resolved theme for the current preference + OS theme. */
export function applyTheme(osTheme: 'light' | 'dark' = getSystemTheme()): void {
  const pref = getThemePreference();
  const resolved = pref === 'system' ? osTheme : pref;
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
}

/** Init once at startup; follows OS changes while pref === 'system'. */
export function initTheme(): () => void {
  const os = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => applyTheme(os.matches ? 'dark' : 'light');
  applyTheme();
  os.addEventListener('change', onChange);
  return () => os.removeEventListener('change', onChange);
}

/** Flash-free first paint: applied synchronously before React hydrates. */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var p=localStorage.getItem('callpilot-theme')||'system';var d=p==='dark'||(p==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.classList.toggle('dark',d);r.style.colorScheme=d?'dark':'light';}catch(e){}})();`;
