'use client';

// useActionItems - interactive state for the meeting's action items.
//
// The LLM output (summary.actionItems) is READ-ONLY: it is derived once and
// never written back. What the user owns lives in a separate
// `actionItemState` map (keyed by array index - items are generated once and
// never reordered): completed / assignee override / addedToday. That map is
// persisted INSIDE the same Meeting.SummaryJson blob as the summary itself
// (no new tables), via the existing PUT /api/v1/meetings/{id}/summary
// endpoint with an 800ms debounce so rapid toggles don't hammer the gateway.
//
// Legacy compat: summaries saved before the structured schema carry
// actionItems as string[] - the hook surfaces them as read-only legacy items
// (no throw, no state ops) so the Actions tab can fall back gracefully.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { authedApiCall } from '@/lib/auth';
import type {
  ActionItemAssignee,
  LocalSummary,
  StructuredActionItem,
} from '@/lib/llm';

const SAVE_DEBOUNCE_MS = 800;

export interface ActionItemRow {
  index: number;
  title: string;
  assignee: ActionItemAssignee;
  priority: 'high' | 'medium' | 'low';
  source: 'action_item' | 'follow_up';
  completed: boolean;
  addedToday: boolean;
  /** Legacy summaries carry plain-string items - state ops are inert. */
  isLegacy: boolean;
}

interface ItemState {
  completed: boolean;
  assignee: ActionItemAssignee;
  addedToday: boolean;
}

function emptyState(assignee: ActionItemAssignee): ItemState {
  return { completed: false, assignee, addedToday: false };
}

function isStructured(item: unknown): item is StructuredActionItem {
  return typeof item === 'object' && item !== null && typeof (item as StructuredActionItem).title === 'string';
}

export function useActionItems(meetingId: string | null, summary: LocalSummary | null) {
  const [itemState, setItemState] = useState<Record<number, ItemState>>({});
  const [pendingSave, setPendingSave] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const summaryRef = useRef(summary);
  summaryRef.current = summary;
  const stateRef = useRef(itemState);
  stateRef.current = itemState;

  // Initialise from the saved blob once per summary.
  useEffect(() => {
    setItemState(summary?.actionItemState ?? {});
  }, [summary?.actionItemState]);

  const scheduleSave = useCallback(() => {
    if (!meetingId) return;
    setPendingSave(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      saveTimer.current = null;
      const currentSummary = summaryRef.current;
      if (!currentSummary) {
        setPendingSave(false);
        return;
      }
      try {
        await authedApiCall('PUT', `/api/v1/meetings/${meetingId}/summary`, {
          status: 'completed',
          data: {
            ...currentSummary,
            actionItemState: stateRef.current,
          },
        });
      } catch (e) {
        console.warn('[useActionItems] failed to persist action item state:', e);
      } finally {
        setPendingSave(false);
      }
    }, SAVE_DEBOUNCE_MS);
  }, [meetingId]);

  // Cancel any in-flight debounced write on unmount - prevents both a
  // setState-after-unmount and a write with stale closure state.
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
    };
  }, []);

  const items = useMemo<ActionItemRow[]>(() => {
    const raw = summary?.actionItems ?? [];
    if (!Array.isArray(raw)) return [];
    return raw.map((item, index) => {
      const structured = isStructured(item);
      const base = structured
        ? {
            assignee: item.assignee,
            priority: item.priority,
            source: item.source,
          }
        : {
            assignee: 'unassigned' as ActionItemAssignee,
            priority: 'medium' as const,
            source: 'action_item' as const,
          };
      const saved = itemState[index] ?? emptyState(base.assignee);
      return {
        index,
        title: structured ? item.title : String(item),
        assignee: saved.assignee,
        priority: base.priority,
        source: base.source,
        completed: saved.completed,
        addedToday: saved.addedToday,
        isLegacy: !structured,
      };
    });
  }, [summary?.actionItems, itemState]);

  const toggleComplete = useCallback(
    (index: number) => {
      if (items[index]?.isLegacy) return;
      setItemState((prev) => {
        const current = prev[index] ?? emptyState(items[index]?.assignee ?? 'unassigned');
        return { ...prev, [index]: { ...current, completed: !current.completed } };
      });
      scheduleSave();
    },
    [items, scheduleSave],
  );

  const setAssignee = useCallback(
    (index: number, assignee: ActionItemAssignee) => {
      if (items[index]?.isLegacy) return;
      setItemState((prev) => {
        const current = prev[index] ?? emptyState(assignee);
        return { ...prev, [index]: { ...current, assignee } };
      });
      scheduleSave();
    },
    [items, scheduleSave],
  );

  const addToday = useCallback(
    (index: number) => {
      if (items[index]?.isLegacy) return;
      setItemState((prev) => {
        const current = prev[index] ?? emptyState(items[index]?.assignee ?? 'unassigned');
        return { ...prev, [index]: { ...current, addedToday: true } };
      });
      scheduleSave();
    },
    [items, scheduleSave],
  );

  /** Uncompleted STRUCTURED items - drives the tab count badge. */
  const uncompletedCount = useMemo(
    () => items.filter((i) => !i.isLegacy && !i.completed).length,
    [items],
  );

  return { items, pendingSave, toggleComplete, setAssignee, addToday, uncompletedCount };
}
