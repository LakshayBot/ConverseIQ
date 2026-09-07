'use client';

// ActionItemsPanel - the interactive surface of the meeting's Actions tab.
//
// Renders the structured action items extracted by the local summary (the
// LLM output is read-only) with per-item completion / assignee / "Add Today"
// state persisted via useActionItems (Meeting.SummaryJson blob, debounced).
//
// For meetings recorded before the structured schema, an "Extract Action
// Items" button re-runs ONLY action-item extraction on the already-loaded
// transcript (useActionItemExtraction → local llama-helper sidecar) and
// merges the result into the saved summary blob - the full summary is never
// regenerated.
//
// Legacy summaries (string[] actionItems) and summaries without any items
// fall back to calm empty states - no fake interactivity.

import React from 'react';
import { ListTodo, CalendarDays, Link2, LoaderIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { LocalSummary, ActionItemAssignee } from '@/lib/llm';
import { useActionItems } from '@/hooks/useActionItems';
import { useActionItemExtraction } from '@/hooks/useActionItemExtraction';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Props {
  meetingId: string;
  summary: LocalSummary | null;
  /** Already-loaded transcript text (loaded pages only - the panel never
   *  triggers additional fetches). Undefined disables extraction. */
  transcriptText?: string;
  /** Reports the uncompleted structured-item count (drives the tab badge). */
  onUncompletedChange?: (count: number) => void;
  /** Refetch the summary blob after extraction merges new items. */
  onSummaryChanged?: () => void;
  /** Switch to the Summary tab (offered in the no-summary empty state). */
  onSwitchToSummary?: () => void;
}

const ASSIGNEE_OPTIONS: Array<{ value: ActionItemAssignee; label: string }> = [
  { value: 'you', label: 'You' },
  { value: 'team_member', label: 'Team Member' },
  { value: 'unassigned', label: 'Unassigned' },
];

/** Same severity tokens the Intelligence rail uses for confidence badges. */
const PRIORITY_BADGE: Record<string, { dot: string; text: string; label: string }> = {
  high: { dot: 'bg-[var(--intel-high)]', text: 'text-[var(--intel-high)]', label: 'High' },
  medium: { dot: 'bg-[var(--intel-medium)]', text: 'text-[var(--intel-medium)]', label: 'Medium' },
  low: { dot: 'bg-[var(--intel-low)]', text: 'text-[var(--intel-low)]', label: 'Low' },
};

function isStructuredActionItems(summary: LocalSummary | null): boolean {
  const items = summary?.actionItems;
  // Structured shape = an array that isn't the legacy string[] form. An
  // empty structured array counts (post-extraction "nothing found" still
  // means the Re-extract link, not the primary CTA).
  if (!Array.isArray(items)) return false;
  return items.length === 0 || typeof items[0] !== 'string';
}

function formatMeetingDate(generatedAt?: string): string | null {
  if (!generatedAt) return null;
  const date = new Date(generatedAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** The extract CTA. Variants: header button / body button / loading / link. */
function ExtractControl({
  variant,
  extracting,
  disabled,
  onExtract,
}: {
  variant: 'button' | 'link';
  extracting: boolean;
  disabled: boolean;
  onExtract: () => void;
}) {
  if (extracting) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--opaline-on-surface-variant)]">
        <LoaderIcon className="h-3.5 w-3.5 animate-spin text-[var(--opaline-primary)]" aria-hidden />
        Extracting…
      </span>
    );
  }
  if (variant === 'link') {
    return (
      <button
        type="button"
        data-testid="re-extract-link"
        onClick={onExtract}
        disabled={disabled}
        title={disabled ? 'Transcript still loading' : undefined}
        className="text-caption text-[var(--opaline-outline)] hover:text-[var(--opaline-on-surface-variant)] disabled:opacity-50"
      >
        Re-extract
      </button>
    );
  }
  return (
    <Button
      variant="outline"
      size="sm"
      data-testid="extract-action-items"
      onClick={onExtract}
      disabled={disabled}
      title={disabled ? 'Transcript still loading' : undefined}
    >
      Extract Action Items
    </Button>
  );
}

export const ActionItemsPanel: React.FC<Props> = ({
  meetingId,
  summary,
  transcriptText,
  onUncompletedChange,
  onSummaryChanged,
  onSwitchToSummary,
}) => {
  const { items, pendingSave, toggleComplete, setAssignee, addToday, uncompletedCount } =
    useActionItems(meetingId, summary);
  const { extractionState, extractionError, extractActionItemsOnly } = useActionItemExtraction(
    meetingId,
    summary,
  );

  const extracting = extractionState === 'extracting';
  // Whether the saved summary carries the structured shape at all - drives
  // the Extract-button-vs-Re-extract-link distinction in the header.
  const structuredSchema = isStructuredActionItems(summary);
  const structuredItems = items.filter((i) => !i.isLegacy);

  // Keep the tab badge in sync (page-content owns the badge display; this
  // panel owns the hook).
  React.useEffect(() => {
    onUncompletedChange?.(uncompletedCount);
  }, [uncompletedCount, onUncompletedChange]);

  const handleExtract = async () => {
    if (!transcriptText || extracting) return;
    await extractActionItemsOnly(transcriptText);
    // Refetch the summary blob so freshly merged items flow into the panel
    // (and the legacy/structured UI states re-resolve). Idempotent on error.
    onSummaryChanged?.();
  };

  const extractDisabled = !transcriptText || extracting;

  // ── No summary at all ────────────────────────────────────────────────────
  if (!summary) {
    return (
      <div className="rounded-xl border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] p-6 text-center shadow-xs">
        <ListTodo className="mx-auto h-6 w-6 text-[var(--opaline-outline)]" aria-hidden />
        <p className="mt-2 text-body-md font-medium text-[var(--opaline-on-surface)]">
          Generate a summary first to see action items.
        </p>
        <p className="mx-auto mt-1 max-w-sm text-caption leading-relaxed text-[var(--opaline-on-surface-variant)]">
          Action items are extracted from the meeting summary — nothing to act on until it runs.
        </p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <ExtractControl
            variant="button"
            extracting={extracting}
            disabled={extractDisabled}
            onExtract={handleExtract}
          />
          {onSwitchToSummary && (
            <Button variant="ghost" size="sm" onClick={onSwitchToSummary}>
              Go to Summary
            </Button>
          )}
        </div>
      </div>
    );
  }

  const meetingDate = formatMeetingDate(summary.generatedAt);

  return (
    <div className="rounded-xl border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] shadow-xs">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-[var(--hairline)] p-5">
        <div className="flex items-center gap-2 text-body-md font-medium text-[var(--opaline-on-surface)]">
          <ListTodo className="h-4 w-4 text-[var(--opaline-primary)]" aria-hidden />
          Action Items from the Call
          {pendingSave && (
            <span className="text-caption text-[var(--opaline-outline)]">Saving…</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {extracting ? (
            <ExtractControl variant="button" extracting disabled={false} onExtract={() => {}} />
          ) : structuredSchema ? (
            // Structured schema present (even a post-extraction empty array):
            // retry stays available but is not the primary CTA.
            <ExtractControl
              variant="link"
              extracting={false}
              disabled={extractDisabled}
              onExtract={handleExtract}
            />
          ) : (
            <ExtractControl
              variant="button"
              extracting={false}
              disabled={extractDisabled}
              onExtract={handleExtract}
            />
          )}
          <button
            type="button"
            data-testid="add-to-board"
            disabled={extracting}
            onClick={() => {
              console.warn('Board integration not yet implemented');
              toast('Board integration not yet implemented');
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--opaline-outline-variant)] px-3 py-1.5 text-xs font-medium text-[var(--opaline-on-surface)] transition-colors hover:bg-[var(--opaline-surface-container-low)] disabled:opacity-50"
          >
            Add to Board
          </button>
        </div>
      </div>

      {/* Extraction error */}
      {extractionState === 'error' && (
        <p className="border-b border-[var(--hairline)] px-5 py-2 text-caption text-[var(--opaline-error)]" data-testid="extraction-error">
          Extraction failed — try again.{extractionError ? ` (${extractionError})` : ''}
        </p>
      )}

      {/* Meta row - meeting date + shareable link, styled like the segment-count row */}
      <div className="flex items-center gap-3 border-b border-[var(--hairline)] px-5 py-2.5">
        {meetingDate && (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--nav-muted-text)]">
            <CalendarDays className="h-3 w-3" aria-hidden />
            {meetingDate}
          </span>
        )}
        <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--nav-muted-text)]">
          <Link2 className="h-3 w-3" aria-hidden />
          calls.reppify.live/{meetingId}
        </span>
      </div>

      {/* Items */}
      {structuredItems.length > 0 ? (
        <ul>
          {structuredItems.map((item, i) => {
            const badge = PRIORITY_BADGE[item.priority] ?? PRIORITY_BADGE.low;
            return (
              <li
                key={item.index}
                className={i > 0 ? 'border-t border-dashed border-[var(--opaline-outline-variant)]' : ''}
              >
                <div className="flex items-center gap-3 px-5 py-3.5">
                  {/* Circular checkbox */}
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={item.completed}
                    aria-label={`Mark "${item.title}" ${item.completed ? 'incomplete' : 'complete'}`}
                    data-testid={`action-checkbox-${item.index}`}
                    onClick={() => toggleComplete(item.index)}
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
                      item.completed
                        ? 'border-[var(--opaline-primary)] bg-[var(--opaline-primary)] text-[var(--opaline-on-primary)]'
                        : 'border-[var(--opaline-outline)] text-transparent hover:border-[var(--opaline-primary)]'
                    }`}
                  >
                    ✓
                  </button>

                  {/* Title */}
                  <span
                    data-testid={`action-title-${item.index}`}
                    className={`min-w-0 flex-1 truncate text-[13px] leading-[1.5] text-[var(--opaline-on-surface)] ${
                      item.completed ? 'line-through opacity-50' : ''
                    }`}
                  >
                    {item.title}
                  </span>

                  {/* Priority badge */}
                  <span
                    data-testid={`action-priority-${item.index}`}
                    className={`inline-flex shrink-0 items-center gap-1 text-[11px] font-medium ${badge.text}`}
                  >
                    <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} />
                    {badge.label}
                  </span>

                  {/* Assignee selector */}
                  <Select
                    value={item.assignee}
                    onValueChange={(value) => setAssignee(item.index, value as ActionItemAssignee)}
                  >
                    <SelectTrigger
                      className="h-7 w-[124px] shrink-0 rounded-md px-2 text-[12px]"
                      aria-label={`Assignee for "${item.title}"`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ASSIGNEE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value} className="text-[12px]">
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Add Today */}
                  {item.addedToday ? (
                    <span className="shrink-0 text-[12px] text-[var(--opaline-outline)]">Added ✓</span>
                  ) : (
                    <button
                      type="button"
                      data-testid={`add-today-${item.index}`}
                      onClick={() => addToday(item.index)}
                      className="shrink-0 text-[12px] font-medium text-[var(--opaline-primary)] hover:underline"
                    >
                      + Add Today
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        /* Empty body - copy depends on extraction state. The Extract CTA
           lives in the header (single source of truth). */
        <div className="p-6 text-center">
          {extractionState === 'done' ? (
            <p className="text-body-sm text-[var(--opaline-on-surface-variant)]">
              No actionable items found in this meeting.
            </p>
          ) : (
            <p className="text-body-sm text-[var(--opaline-on-surface-variant)]">
              No action items detected. Try extracting them manually.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default ActionItemsPanel;
