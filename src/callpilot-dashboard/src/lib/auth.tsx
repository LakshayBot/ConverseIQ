'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiLogin, apiRegister, setAccessToken, clearAccessToken, LoginResponse } from './api';

interface AuthUser {
  email: string;
  userId: string;
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

function isTokenExpiringSoon(token: string | null, bufferMs = 5 * 60 * 1000): boolean {
  if (!token) return true;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const exp = payload.exp;
    if (typeof exp === 'number') return Date.now() >= exp * 1000 - bufferMs;
  } catch {}
  return false;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const savedToken = localStorage.getItem('callpilot_token');
    const savedUser = localStorage.getItem('callpilot_user');
    if (savedToken && savedUser) {
      setToken(savedToken);
      setAccessToken(savedToken);
      try {
        setUser(JSON.parse(savedUser));
      } catch {
        localStorage.removeItem('callpilot_user');
      }
    }
    setIsLoading(false);
  }, []);

  // Global handler for session expired (emitted by api.ts interceptor)
  useEffect(() => {
    const handler = () => {
      setToken(null);
      setUser(null);
      clearAccessToken();
      localStorage.removeItem('callpilot_token');
      localStorage.removeItem('callpilot_refresh');
      localStorage.removeItem('callpilot_user');
      // Use hard redirect to ensure login page shows with message
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.href = '/login?expired=1';
      }
    };
    window.addEventListener('callpilot:session-expired', handler);
    return () => window.removeEventListener('callpilot:session-expired', handler);
  }, []);

  // Periodic token health check (every 10 min) — only refresh if actually expired
  useEffect(() => {
    if (!token) return;
    const interval = setInterval(async () => {
      const current = localStorage.getItem('callpilot_token');
      const refresh = localStorage.getItem('callpilot_refresh');
      // Only refresh if token is actually expired (0 buffer), not 5 min before
      if (!current) return;
      let isExpired = false;
      try {
        const payload = JSON.parse(atob(current.split('.')[1]));
        const exp = payload.exp;
        if (typeof exp === 'number') isExpired = Date.now() >= exp * 1000;
      } catch {}
      if (isExpired && refresh) {
        try {
          const { apiRefresh } = await import('./api');
          const result = await apiRefresh(refresh) as LoginResponse;
          setToken(result.accessToken);
          setAccessToken(result.accessToken);
          localStorage.setItem('callpilot_token', result.accessToken);
          if (result.refreshToken) localStorage.setItem('callpilot_refresh', result.refreshToken);
        } catch {
          // Refresh failed — will be handled on next 401
        }
      }
    }, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [token]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await apiLogin(email, password) as LoginResponse;
    setToken(result.accessToken);
    setAccessToken(result.accessToken);
    const userData = { email, userId: extractUserId(result.accessToken) };
    setUser(userData);
    localStorage.setItem('callpilot_token', result.accessToken);
    localStorage.setItem('callpilot_refresh', result.refreshToken);
    localStorage.setItem('callpilot_user', JSON.stringify(userData));
    localStorage.setItem('callpilot_token_exp', result.accessTokenExpiresAt);
    localStorage.setItem('callpilot_refresh_exp', result.refreshTokenExpiresAt);
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    await apiRegister(email, password);
    await login(email, password);
  }, [login]);

  const logout = useCallback(async () => {
    const refresh = localStorage.getItem('callpilot_refresh');
    const currentToken = localStorage.getItem('callpilot_token');
    // Best-effort server-side revocation
    if (refresh && currentToken) {
      try {
        await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001'}/api/v1/auth/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentToken}`,
          },
          body: JSON.stringify({ refreshToken: refresh }),
        });
      } catch {}
    }
    setToken(null);
    setUser(null);
    clearAccessToken();
    localStorage.removeItem('callpilot_token');
    localStorage.removeItem('callpilot_refresh');
    localStorage.removeItem('callpilot_user');
    localStorage.removeItem('callpilot_token_exp');
    localStorage.removeItem('callpilot_refresh_exp');
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

function extractUserId(token: string): string {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.userId || payload.sub || '';
  } catch {
    return '';
  }
}
