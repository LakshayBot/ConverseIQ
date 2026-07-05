'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiLogin, apiRegister, setAccessToken, LoginResponse } from './api';

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
      setUser(JSON.parse(savedUser));
    }
    setIsLoading(false);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await apiLogin(email, password) as LoginResponse;
    setToken(result.accessToken);
    setAccessToken(result.accessToken);
    const userData = { email, userId: extractUserId(result.accessToken) };
    setUser(userData);
    localStorage.setItem('callpilot_token', result.accessToken);
    localStorage.setItem('callpilot_refresh', result.refreshToken);
    localStorage.setItem('callpilot_user', JSON.stringify(userData));
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    await apiRegister(email, password);
    await login(email, password);
  }, [login]);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setAccessToken(null);
    localStorage.removeItem('callpilot_token');
    localStorage.removeItem('callpilot_refresh');
    localStorage.removeItem('callpilot_user');
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
