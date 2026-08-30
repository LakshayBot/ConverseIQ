'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AuthSession,
  describeAuthError,
  getSession,
  login as authLogin,
  logout as authLogout,
  register as authRegister,
  tryRestoreSession,
} from '@/lib/auth';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  status: AuthStatus;
  session: AuthSession | null;
  /** Throws a `string` (user-facing message) on failure. */
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Manually re-reads the cached session - useful after a forced refresh. */
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Provider that owns the user's auth lifecycle. On mount it calls
 * `tryRestoreSession()`, which asks the Rust side to hit `/api/v1/auth/refresh`
 * with any stored refresh token. The session is then exposed via `useAuth()`.
 *
 * Status transitions:
 *   loading       → restored or first cold launch
 *   authenticated → login / register / refresh succeeded
 *   unauthenticated → no session, or refresh/login failed
 *
 * `useAuth()` rejects with `null` outside the provider, so it's safe to call
 * from any component rendered inside the root layout.
 */
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<AuthSession | null>(null);
  // Guard against React strict-mode double-fire in dev.
  const initRanRef = useRef(false);

  const refreshSession = useCallback(async () => {
    const s = await getSession();
    setSession(s);
    setStatus(s ? 'authenticated' : 'unauthenticated');
    if (s) {
      const { resetSessionExpiredFlag } = await import('@/lib/auth');
      resetSessionExpiredFlag();
    }
  }, []);

  // Global 401 handler: when any API call emits session-expired, log out
  useEffect(() => {
    const handleSessionExpired = async () => {
      console.warn('[auth] session expired — logging out');
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('clear_auth_token');
      } catch {}
      setSession(null);
      setStatus('unauthenticated');
      // Professional UX: toast notification like major apps (Slack/Notion)
      try {
        const { toast } = await import('sonner');
        toast.error('Session expired', {
          description: 'Your session has expired. Please log in again to continue.',
          duration: 5000,
        });
      } catch {}
    };

    window.addEventListener('callpilot:session-expired', handleSessionExpired);
    return () => window.removeEventListener('callpilot:session-expired', handleSessionExpired);
  }, []);

  // Periodic token health check (every 10 min) — only refresh if actually expired
  useEffect(() => {
    if (status !== 'authenticated') return;
    const interval = setInterval(async () => {
      try {
        const s = await getSession();
        if (!s) {
          setSession(null);
          setStatus('unauthenticated');
          return;
        }
        // Only refresh if token is actually expired (not 5 min before)
        const exp = new Date(s.accessTokenExpiresAt).getTime();
        if (Date.now() >= exp) {
          const refreshed = await tryRestoreSession();
          if (refreshed) {
            setSession(refreshed);
          } else {
            const stillValid = s.refreshTokenExpiresAt
              ? Date.now() < new Date(s.refreshTokenExpiresAt).getTime()
              : true;
            if (!stillValid) {
              setSession(null);
              setStatus('unauthenticated');
            }
          }
        }
      } catch {}
    }, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [status]);

  useEffect(() => {
    if (initRanRef.current) return;
    initRanRef.current = true;

    (async () => {
      try {
        const restored = await tryRestoreSession();
        if (restored) {
          setSession(restored);
          setStatus('authenticated');
        } else {
          setSession(null);
          setStatus('unauthenticated');
        }
      } catch (e) {
        console.warn('[auth] init failed:', e);
        setSession(null);
        setStatus('unauthenticated');
      }
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    try {
      const next = await authLogin(email, password);
      setSession(next);
      setStatus('authenticated');
    } catch (e) {
      throw new Error(describeAuthError(e));
    }
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    try {
      const next = await authRegister(email, password);
      setSession(next);
      setStatus('authenticated');
    } catch (e) {
      throw new Error(describeAuthError(e));
    }
  }, []);

  const logout = useCallback(async () => {
    if (status !== 'authenticated') return;
    await authLogout();
    setSession(null);
    setStatus('unauthenticated');
  }, [status]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, session, login, register, logout, refreshSession }),
    [status, session, login, register, logout, refreshSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}
