'use client';

// Avatar - deterministic, professional user avatar.
//
// Derived from the user's name/email: the same identity always renders
// the same initials + background pair, with no external avatar service
// and no per-render randomization. Palettes are muted Opaline-tinted
// tones (Linear/Notion-style, not social-media colors) with white text
// contrast guaranteed in both themes. Falls back to a person glyph when
// no name/email is available instead of rendering a blank circle.

import React from 'react';
import { UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';

// Deterministic gradient pairs - dark tones with guaranteed white-text
// contrast, drawn from the Opaline vocabulary.
const AVATAR_PALETTES: ReadonlyArray<readonly [string, string]> = [
  ['#93483c', '#5e2418'], // terracotta
  ['#6b3221', '#3f1c10'], // deep ember
  ['#545f72', '#2c3547'], // slate
  ['#3c475a', '#1f2735'], // dusk blue-slate
  ['#5b5f61', '#33363b'], // stone
  ['#7a3325', '#46190f'], // maroon
];

const SIZES = {
  sm: { box: 'h-6 w-6', text: 'text-[10px]', icon: 'h-3 w-3' },
  md: { box: 'h-8 w-8', text: 'text-[13px]', icon: 'h-4 w-4' },
  lg: { box: 'h-10 w-10', text: 'text-[15px]', icon: 'h-5 w-5' },
} as const;

export type AvatarSize = keyof typeof SIZES;

/** FNV-1a - small, fast, stable across platforms. */
export function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Up to two initials from a name or email local-part ("John Doe" → JD,
 *  "rep@acme.com" → R, "jane.smith@x.com" → JS). */
export function avatarInitials(name: string): string {
  const local = (name.split('@')[0] ?? '').trim();
  const words = local.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0].charAt(0).toUpperCase();
  const first = words[0].charAt(0);
  const last = words[words.length - 1].charAt(0);
  return (first + last).toUpperCase();
}

interface AvatarProps {
  /** Name or email - deterministically maps to initials + colors. */
  name: string;
  size?: AvatarSize;
  className?: string;
  /** Optional explicit gradient override (keeps callers' mappings stable). */
  gradient?: readonly [string, string];
}

export const Avatar: React.FC<AvatarProps> = ({ name, size = 'md', className, gradient }) => {
  const s = SIZES[size];
  const initials = avatarInitials(name);
  const [from, to] =
    gradient ?? AVATAR_PALETTES[hashString(name.toLowerCase()) % AVATAR_PALETTES.length];

  return (
    <span
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold tracking-wide text-white ring-1 ring-[var(--opaline-tone-4)]',
        s.box,
        s.text,
        className,
      )}
      style={{ backgroundImage: `linear-gradient(135deg, ${from}, ${to})` }}
      aria-hidden="true"
    >
      {initials ? (
        initials
      ) : (
        <UserRound className={s.icon} strokeWidth={1.75} aria-hidden />
      )}
    </span>
  );
};
