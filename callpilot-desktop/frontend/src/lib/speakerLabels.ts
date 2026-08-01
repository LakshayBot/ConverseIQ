// Speaker label mapping for CallPilot.
//
// Meetily doesn't diarize - every transcript segment has only `text`. We
// infer a label from the originating audio source when available
// (`audio_source: 'mic' | 'system' | 'unknown'`) and otherwise render a
// neutral label.
//
// The hook exposes a toggle so users can hide/show labels.

import { useCallback } from 'react';
import {
  SETTINGS_KEY_SHOW_SPEAKER_LABELS,
} from '@/lib/callpilot';

export type SpeakerLabel = 'REP' | 'PROSPECT' | 'UNKNOWN';

export interface LabelOptions {
  showLabels: boolean;
  /** Override: force a specific label regardless of source. */
  forceLabel?: SpeakerLabel | null;
}

function labelFromSource(source: string | undefined | null): SpeakerLabel {
  if (source === 'mic') return 'REP';
  if (source === 'system') return 'PROSPECT';
  return 'UNKNOWN';
}

export function resolveSpeakerLabel(
  source: string | undefined | null,
  opts: LabelOptions = { showLabels: true },
): { label: SpeakerLabel | null; tone: 'rep' | 'prospect' | 'muted' } {
  if (!opts.showLabels) return { label: null, tone: 'muted' };
  const label = opts.forceLabel ?? labelFromSource(source);
  if (label === 'REP') return { label, tone: 'rep' };
  if (label === 'PROSPECT') return { label, tone: 'prospect' };
  return { label: 'UNKNOWN', tone: 'muted' };
}

export function useSpeakerLabelSettings() {
  const get = useCallback((): boolean => {
    try { return localStorage.getItem(SETTINGS_KEY_SHOW_SPEAKER_LABELS) !== 'false'; }
    catch { return true; }
  }, []);

  const set = useCallback((value: boolean) => {
    try { localStorage.setItem(SETTINGS_KEY_SHOW_SPEAKER_LABELS, value ? 'true' : 'false'); }
    catch {}
  }, []);

  return { get, set };
}
