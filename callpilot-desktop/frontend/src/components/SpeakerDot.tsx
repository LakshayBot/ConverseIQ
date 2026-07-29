'use client';

// SpeakerDot — tiny filled-circle indicator that replaces the old
// speaker chip (REP / PROSPECT) in the transcript row.
//
// Why a dot and not a chip: the Stitch "Grain" reference uses a single
// 8px filled circle as the speaker identifier. Dots are quieter than
// chips, scale better in dense transcript rows, and let the text
// breathe. Two distinct hues (green for REP, violet for PROSPECT) keep
// the visual mapping one-glance obvious without a label.

import React from 'react';

export type SpeakerSource = 'mic' | 'system' | 'unknown' | undefined;

interface SpeakerDotProps {
  source: SpeakerSource;
  /** Optional size override. Default 8px. */
  size?: number;
  className?: string;
}

const COLOR: Record<NonNullable<SpeakerSource>, string> = {
  mic: 'var(--rep-circle)',
  system: 'var(--prospect-circle)',
  unknown: 'var(--nav-dim-text)',
};

const LABEL: Record<NonNullable<SpeakerSource>, string> = {
  mic: 'REP',
  system: 'PROSPECT',
  unknown: '',
};

export const SpeakerDot: React.FC<SpeakerDotProps> = ({ source, size = 8, className }) => {
  if (!source) return <span className="inline-block flex-shrink-0" style={{ width: size }} aria-hidden />;

  const color = COLOR[source];
  const label = LABEL[source];

  return (
    <span
      className={`inline-flex flex-shrink-0 items-center justify-center ${className ?? ''}`}
      style={{ width: size, height: size }}
      aria-label={label || undefined}
    >
      <span
        className="rounded-full"
        style={{ width: size, height: size, backgroundColor: color }}
      />
    </span>
  );
};