'use client';

// UserChip - the bottom-of-sidebar identity card.
//
// Two states:
//   - Collapsed (64px rail): 32px avatar circle only.
//   - Expanded (256px rail): avatar + email + chevron, click opens a small
//     popover containing Sign out.
//
// The avatar uses a deterministic gradient derived from the email hash so
// every account gets a stable, distinct colour without an uploaded avatar
// or Gravatar hop. Letter glyph is the first character of the local-part.
//
// Popover surface: the default PopoverContent uses `bg-popover` which
// isn't a Tailwind color in this project (the Opaline override only
// exposed the tokens we actually use). Without an explicit background
// the popover renders transparent. `bg-[var(--opaline-surface-container-lowest)]` + a 1px hairline + a
// soft shadow give the menu a clear opaque surface that matches the
// rest of the sidebar.

import React, { useMemo, useState } from 'react';
import { LogOut, ChevronUp, Monitor, Sun, Moon, Check } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAuth } from '@/contexts/AuthContext';
import {
  type ThemePreference,
  getThemePreference,
  setThemePreference,
} from '@/lib/theme';

// Opaline-tinted avatar palettes. The first entry is the primary brand
// gradient (terracotta → on-primary-container dark). The alternates
// are chosen from the Opaline tonal vocabulary so no avatar ever clashes
// with the muted terracotta theme.
const AVATAR_PALETTES: ReadonlyArray<readonly [string, string]> = [
  ['#93483c', '#64241b'], // primary → on-primary-container (brand)
  ['#e58a7b', '#93483c'], // primary-container → primary
  ['#ffb4a7', '#763227'], // inverse-primary → on-primary-fixed-variant
  ['#545f72', '#223144'], // secondary → inverse-surface
  ['#bcc7dd', '#545f72'], // secondary-fixed-dim → secondary
  ['#5b5f61', '#35393b'], // tertiary → on-tertiary-container
];

// Opaque surface for the popover. Centralised so the same treatment
// applies to both collapsed and expanded popover surfaces.
const POPOVER_SURFACE_CLASS =
  'w-64 p-0 overflow-hidden rounded-md border border-[var(--opaline-outline-variant)] ' +
  'bg-[var(--opaline-surface-container-lowest)] shadow-md';

function hashEmail(email: string): number {
  // FNV-1a - small, fast, stable across platforms.
  let h = 2166136261;
  for (let i = 0; i < email.length; i++) {
    h ^= email.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pickGradient(email: string): readonly [string, string] {
  return AVATAR_PALETTES[hashEmail(email.toLowerCase()) % AVATAR_PALETTES.length];
}

function avatarInitial(email: string): string {
  const local = email.split('@')[0] ?? '';
  const first = local.trim().charAt(0);
  return first ? first.toUpperCase() : '?';
}

interface UserChipProps {
  collapsed: boolean;
}

export const UserChip: React.FC<UserChipProps> = ({ collapsed }) => {
  const { session, logout } = useAuth();
  const [open, setOpen] = useState(false);

  const email = session?.email ?? '';
  const [from, to] = useMemo(() => pickGradient(email), [email]);
  const initial = useMemo(() => avatarInitial(email), [email]);

  // Collapsed: pure avatar circle, centered in the 64px rail.
  if (collapsed) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={email ? `Account: ${email}` : 'Account menu'}
            title={email || 'Account'}
            className="group mx-auto flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold text-white shadow-sm ring-1 ring-[var(--opaline-tone-4)] transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{
              backgroundImage: `linear-gradient(135deg, ${from}, ${to})`,
            }}
          >
            {initial}
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="end"
          sideOffset={8}
          className={POPOVER_SURFACE_CLASS}
        >
          <UserMenu email={email} initial={initial} from={from} to={to} onSignOut={logout} />
        </PopoverContent>
      </Popover>
    );
  }

  // Expanded: a full-width pill at the bottom of the footer.
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="group mt-2 flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors hover:border-[var(--opaline-outline-variant)] hover:bg-[var(--opaline-surface-container-low)] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white shadow-sm ring-1 ring-[var(--opaline-tone-4)]"
            style={{ backgroundImage: `linear-gradient(135deg, ${from}, ${to})` }}
          >
            {initial}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-[var(--opaline-on-surface-variant)]">
            {email || 'Signed in'}
          </span>
          <ChevronUp
            className={`h-3.5 w-3.5 flex-shrink-0 text-[var(--opaline-outline)] transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className={POPOVER_SURFACE_CLASS}
      >
        <UserMenu email={email} initial={initial} from={from} to={to} onSignOut={logout} />
      </PopoverContent>
    </Popover>
  );
};

interface UserMenuProps {
  email: string;
  initial: string;
  from: string;
  to: string;
  onSignOut: () => Promise<void>;
}

const UserMenu: React.FC<UserMenuProps> = ({ email, initial, from, to, onSignOut }) => {
  const [theme, setTheme] = useState<ThemePreference>(() => getThemePreference());

  const appearanceOptions: Array<{
    value: ThemePreference;
    label: string;
    icon: React.ReactNode;
  }> = [
    { value: 'system', label: 'System', icon: <Monitor className="h-4 w-4" /> },
    { value: 'light', label: 'Light', icon: <Sun className="h-4 w-4" /> },
    { value: 'dark', label: 'Dark', icon: <Moon className="h-4 w-4" /> },
  ];

  return (
    <div className="flex flex-col bg-[var(--opaline-surface-container-lowest)]">
      <div className="flex items-center gap-3 px-3 py-3">
        <span
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white shadow-sm ring-1 ring-[var(--opaline-tone-4)]"
          style={{ backgroundImage: `linear-gradient(135deg, ${from}, ${to})` }}
        >
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-[var(--opaline-on-surface)]">
            {email || 'Signed in'}
          </div>
          <div className="text-[11px] uppercase tracking-wider text-[var(--opaline-outline)]">
            CallPilot account
          </div>
        </div>
      </div>
      <div className="h-px bg-[var(--opaline-surface-container-low)]" />
      <div className="px-3 pb-1 pt-2.5">
        <p className="text-overline">Appearance</p>
      </div>
      <div className="px-2 pb-1">
        {appearanceOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={theme === option.value}
            onClick={() => {
              setTheme(option.value);
              setThemePreference(option.value);
            }}
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-[var(--opaline-on-surface-variant)] transition-colors hover:bg-[var(--opaline-surface-container-low)] hover:text-[var(--opaline-on-surface)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--opaline-primary)]"
          >
            <span className="text-[var(--opaline-outline)]">{option.icon}</span>
            <span className="flex-1 text-left">{option.label}</span>
            {theme === option.value && (
              <Check className="h-4 w-4 text-[var(--opaline-primary)]" />
            )}
          </button>
        ))}
      </div>
      <div className="h-px bg-[var(--opaline-surface-container-low)]" />
      <button
        type="button"
        onClick={() => {
          void onSignOut();
        }}
        className="flex items-center gap-2 px-3 py-2.5 text-sm text-[var(--opaline-on-surface-variant)] transition-colors hover:bg-[var(--opaline-surface-container-low)] focus:outline-none focus-visible:bg-[var(--opaline-surface-container-low)]"
      >
        <LogOut className="h-4 w-4 text-[var(--opaline-outline)]" />
        Sign out
      </button>
    </div>
  );
};