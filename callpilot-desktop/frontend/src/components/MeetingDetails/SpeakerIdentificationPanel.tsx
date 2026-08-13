'use client';

// SpeakerIdentificationPanel - per-meeting speaker management for the
// meeting-details Transcript tab:
//   - "Identify Speakers" (with optional speaker-count hint) for meetings
//     transcribed without speaker labels - runs as a background job
//   - processing progress with cancel
//   - failed state with retry (the transcript is never modified on failure)
//   - speaker list with speaking time, rename, and merge

import { useCallback, useState } from 'react';
import { LoaderIcon, Mic2, Pencil, RefreshCw, Check, Users, X, AlertTriangle, Sparkles } from 'lucide-react';
import {
  formatSpeakingTime,
  useMeetingSpeakers,
  type MeetingSpeaker,
} from '@/hooks/useMeetingSpeakers';
import { cn } from '@/lib/utils';

interface Props {
  meetingId: string | null;
  /** Called after identification completes or speakers change, so the
   *  transcript labels re-fetch. */
  onSpeakersChanged?: () => void;
}

const SPEAKER_HINTS: Array<{ value: number | null; label: string }> = [
  { value: null, label: 'Detect automatically' },
  { value: 2, label: '2 speakers' },
  { value: 3, label: '3 speakers' },
  { value: 4, label: '4 speakers' },
  { value: 5, label: '5+ speakers' },
];

function SpeakerRow({
  speaker,
  mergeCandidates,
  onRename,
  onMerge,
}: {
  speaker: MeetingSpeaker;
  mergeCandidates: MeetingSpeaker[];
  onRename: (name: string) => Promise<void>;
  onMerge: (targetId: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(speaker.displayName);
  const [saving, setSaving] = useState(false);
  const [mergeTarget, setMergeTarget] = useState('');

  const commit = async () => {
    setSaving(true);
    try {
      const trimmed = name.trim();
      if (trimmed && trimmed !== speaker.displayName) {
        await onRename(trimmed);
      }
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-lg border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] px-3 py-2">
      <Mic2 className="h-3.5 w-3.5 shrink-0 text-[var(--opaline-primary)]" aria-hidden />
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commit();
              if (e.key === 'Escape') setEditing(false);
            }}
            className="w-full rounded-md border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-low)] px-2 py-1 text-[13px] text-[var(--opaline-on-surface)] outline-none focus:border-[var(--opaline-primary)]"
            placeholder="Speaker name"
          />
        ) : (
          <span className="block truncate text-[13px] font-medium text-[var(--opaline-on-surface)]">
            {speaker.displayName}
          </span>
        )}
        <span className="mt-0.5 block text-caption text-[var(--opaline-on-surface-variant)]">
          {formatSpeakingTime(speaker.totalSpeakingTime)} speaking
          {speaker.segmentCount > 0 ? ` · ${speaker.segmentCount} segment(s)` : ''}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {editing ? (
          <>
            <button
              type="button"
              onClick={() => void commit()}
              disabled={saving}
              className="rounded-md p-1.5 text-[var(--opaline-success)] hover:bg-[var(--opaline-surface-container-low)] disabled:opacity-50"
              aria-label="Save name"
            >
              {saving ? <LoaderIcon className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md p-1.5 text-[var(--opaline-on-surface-variant)] hover:bg-[var(--opaline-surface-container-low)]"
              aria-label="Cancel edit"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <>
            <select
              value={mergeTarget}
              onChange={(e) => {
                const target = e.target.value;
                setMergeTarget('');
                if (target) void onMerge(target);
              }}
              className="rounded-md border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] px-1.5 py-1 text-[11px] text-[var(--opaline-on-surface-variant)] outline-none"
              aria-label="Merge this speaker into another"
            >
              <option value="">Merge into…</option>
              {mergeCandidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                setName(speaker.displayName);
                setEditing(true);
              }}
              className="rounded-md p-1.5 text-[var(--opaline-on-surface-variant)] hover:bg-[var(--opaline-surface-container-low)]"
              aria-label={`Rename ${speaker.displayName}`}
              title="Rename"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export const SpeakerIdentificationPanel: React.FC<Props> = ({ meetingId, onSpeakersChanged }) => {
  const {
    speakers,
    identifyState,
    identifyProgress,
    identifyError,
    identify,
    cancel,
    renameSpeaker,
    mergeSpeaker,
  } = useMeetingSpeakers(meetingId);

  const [numSpeakers, setNumSpeakers] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);

  const hasLabels = speakers.length > 0;

  const startIdentify = useCallback(
    async (hint?: number | null) => {
      setStarting(true);
      try {
        await identify(hint ?? numSpeakers);
      } finally {
        setStarting(false);
      }
    },
    [identify, numSpeakers],
  );

  const merged = useCallback(
    async (fromId: string, intoId: string) => {
      await mergeSpeaker(fromId, intoId);
      onSpeakersChanged?.();
    },
    [mergeSpeaker, onSpeakersChanged],
  );

  if (identifyState === 'processing') {
    return (
      <div className="rounded-xl border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] p-5 shadow-xs">
        <div className="flex items-center gap-2 text-body-md font-medium text-[var(--opaline-on-surface)]">
          <LoaderIcon className="h-4 w-4 animate-spin text-[var(--opaline-primary)]" aria-hidden />
          Identifying speakers…
        </div>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--opaline-surface-container-low)]">
          <div
            className="h-full rounded-full bg-[var(--opaline-primary)] transition-[width] duration-300"
            style={{ width: `${Math.max(2, identifyProgress)}%` }}
          />
        </div>
        <p className="mt-1.5 text-caption tabular-nums text-[var(--opaline-on-surface-variant)]">
          {identifyProgress}% · runs in the background - the transcript stays usable
        </p>
        <button
          type="button"
          onClick={() => void cancel()}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[var(--opaline-outline-variant)] px-2.5 py-1 text-[11px] font-medium text-[var(--opaline-on-surface)] transition-colors hover:bg-[var(--opaline-surface-container-low)]"
        >
          <X className="h-3 w-3" aria-hidden /> Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] p-5 shadow-xs">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 text-overline text-[var(--opaline-on-surface-variant)]">
              <Users className="h-3.5 w-3.5 text-[var(--opaline-primary)]" aria-hidden />
              Speakers
            </div>
            <p className="mt-1 text-body-sm text-[var(--opaline-on-surface)]">
              {hasLabels
                ? `${speakers.length} speaker${speakers.length === 1 ? '' : 's'} identified in this meeting.`
                : 'This meeting has no speaker labels yet.'}
            </p>
            {!hasLabels && (
              <p className="mt-0.5 text-caption text-[var(--opaline-on-surface-variant)]">
                Speaker identification runs locally on your machine against the saved recording — no
                re-transcription, no cloud.
              </p>
            )}
          </div>
          {identifyState === 'failed' && (
            <span className="inline-flex items-center gap-1 text-caption text-[var(--opaline-danger)]">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Failed
            </span>
          )}
        </div>

        {identifyState === 'failed' && identifyError && (
          <p className="mt-2 rounded-md border border-[var(--opaline-danger-border)] bg-[var(--opaline-danger-soft)] px-3 py-2 text-caption text-[var(--opaline-on-surface-variant)]">
            {identifyError}
          </p>
        )}

        {!hasLabels && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              value={numSpeakers === null ? 'auto' : String(numSpeakers)}
              onChange={(e) => setNumSpeakers(e.target.value === 'auto' ? null : Number(e.target.value))}
              className="rounded-lg border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] px-2 py-1.5 text-[12px] text-[var(--opaline-on-surface-variant)] outline-none"
              aria-label="Number of speakers"
            >
              {SPEAKER_HINTS.map((h) => (
                <option key={h.label} value={h.value === null ? 'auto' : String(h.value)}>
                  {h.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={starting}
              onClick={() => void startIdentify()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--opaline-primary)] px-3 py-1.5 text-xs font-medium text-[var(--opaline-on-primary)] transition-colors hover:bg-[var(--opaline-primary-hover)] disabled:opacity-50"
            >
              {starting ? (
                <LoaderIcon className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : identifyState === 'failed' ? (
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
              )}
              {identifyState === 'failed' ? 'Retry' : 'Identify Speakers'}
            </button>
            {hasLabels && identifyState === 'completed' && (
              <span className="inline-flex items-center gap-1 text-caption text-[var(--opaline-success)]">
                <Check className="h-3.5 w-3.5" aria-hidden /> Done
              </span>
            )}
          </div>
        )}
      </div>

      {hasLabels && (
        <div className="space-y-1.5">
          {speakers.map((s) => (
            <SpeakerRow
              key={s.id}
              speaker={s}
              mergeCandidates={speakers.filter((o) => o.id !== s.id)}
              onRename={async (name) => {
                await renameSpeaker(s.id, name);
                onSpeakersChanged?.();
              }}
              onMerge={(targetId) => merged(s.id, targetId)}
            />
          ))}
        </div>
      )}
    </div>
  );
};
