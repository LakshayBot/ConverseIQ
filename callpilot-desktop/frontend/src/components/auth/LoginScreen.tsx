'use client';

import React, { useEffect, useState } from 'react';
import { LogIn, Loader2, Mail, Lock, UserPlus, AlertCircle, Settings as SettingsIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { OnboardingContainer } from '@/components/onboarding/OnboardingContainer';
import { useAuth } from '@/contexts/AuthContext';
import { getCallPilotApiBaseUrl } from '@/lib/callpilotApi';
import { toast } from 'sonner';

type Mode = 'login' | 'register';

// RFC-5322-ish but pragmatic — matches the .NET validator's intent.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginScreen() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>('login');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState('');

  // Pull the live server URL on mount so the caption matches what's
  // configured (the user may have just edited it in Settings).
  useEffect(() => {
    setServerUrl(getCallPilotApiBaseUrl());
  }, []);

  const validate = (): string | null => {
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) return 'Please enter a valid email address.';
    if (password.length < 8) return 'Password must be at least 8 characters.';
    if (mode === 'register' && password !== confirmPassword) {
      return 'Passwords do not match.';
    }
    return null;
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const err = validate();
    if (err) {
      setFormError(err);
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register(email, password);
      }
      // AuthContext flips status to 'authenticated', which makes <AuthGate>
      // unmount this screen and show the rest of the app.
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong.';
      setFormError(msg);
      toast.error(mode === 'login' ? 'Sign in failed' : 'Sign up failed', {
        description: msg,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const toggleMode = () => {
    setFormError(null);
    setMode((m) => (m === 'login' ? 'register' : 'login'));
  };

  const isLogin = mode === 'login';
  const title = isLogin ? 'Sign in to CallPilot' : 'Create your account';
  const description = isLogin
    ? 'Use your CallPilot account to sync meetings and intelligence.'
    : 'You will use this email to sign in on every device.';

  return (
    <OnboardingContainer
      title={title}
      description={description}
      hideProgress
    >
      <form
        onSubmit={onSubmit}
        className="flex flex-col items-center space-y-6"
        noValidate
      >
        {/* Divider */}
        <div className="w-16 h-px bg-gray-300" />

        {/* Form card */}
        <div className="w-full max-w-md bg-white rounded-lg border border-gray-200 shadow-sm p-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-sm font-medium text-gray-700">
              Email
            </Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="pl-9 h-10"
                disabled={submitting}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" className="text-sm font-medium text-gray-700">
              Password
            </Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              <Input
                id="password"
                type="password"
                autoComplete={isLogin ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="pl-9 h-10"
                disabled={submitting}
                required
              />
            </div>
          </div>

          {!isLogin && (
            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-sm font-medium text-gray-700">
                Confirm password
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <Input
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  className="pl-9 h-10"
                  disabled={submitting}
                  required
                />
              </div>
            </div>
          )}

          {formError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{formError}</span>
            </div>
          )}
        </div>

        {/* CTA + toggle */}
        <div className="w-full max-w-xs space-y-3">
          <Button
            type="submit"
            disabled={submitting}
            className="w-full h-11 bg-gray-900 hover:bg-gray-800 text-white"
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : isLogin ? (
              <LogIn className="w-4 h-4 mr-2" />
            ) : (
              <UserPlus className="w-4 h-4 mr-2" />
            )}
            {submitting
              ? isLogin
                ? 'Signing in…'
                : 'Creating account…'
              : isLogin
              ? 'Sign in'
              : 'Create account'}
          </Button>

          <button
            type="button"
            onClick={toggleMode}
            disabled={submitting}
            className="w-full text-sm text-gray-600 hover:text-gray-900 transition-colors disabled:opacity-50"
          >
            {isLogin
              ? "Don't have an account? Sign up"
              : 'Already have an account? Sign in'}
          </button>

          <div className="flex items-center justify-center gap-1.5 text-xs text-gray-500 pt-2">
            <SettingsIcon className="w-3 h-3" />
            <span>Server:</span>
            <code className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-700 max-w-[16rem] truncate">
              {serverUrl || 'http://localhost:5001'}
            </code>
          </div>
        </div>
      </form>
    </OnboardingContainer>
  );
}
