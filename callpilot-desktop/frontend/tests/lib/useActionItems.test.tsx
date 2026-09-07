// useActionItems hook tests (bun:test + @testing-library/react renderHook).
//
// Covers: initial derivation from a structured summary, debounced PUT on
// toggleComplete, and legacy string[] backward compatibility.

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { renderHook, act } from '@testing-library/react';

// Mock the .NET Gateway client - the hook must PUT the summary blob through
// the existing endpoint, and the test observes it here.
const putCalls: Array<{ path: string; body: any }> = [];

mock.module('@/lib/auth', () => ({
  authedApiCall: mock(async (method: string, path: string, body?: any) => {
    if (method === 'PUT') putCalls.push({ path, body });
    return { status: 'completed' };
  }),
}));

import { useActionItems } from '../../src/hooks/useActionItems';
import type { LocalSummary } from '../../src/lib/llm';

function structuredSummary(): LocalSummary {
  return {
    summary: 'Discussed accuracy drift and pricing.',
    actionItems: [
      {
        title: 'Send the accuracy benchmark report',
        assignee: 'you',
        priority: 'high',
        source: 'action_item',
      },
      {
        title: 'Schedule the follow-up call',
        assignee: 'team_member',
        priority: 'medium',
        source: 'follow_up',
      },
    ],
    generatedAt: '2026-09-08T10:00:00.000Z',
  };
}

beforeEach(() => {
  putCalls.length = 0;
});

describe('useActionItems', () => {
  test('initialises items from a structured summary with no saved state', () => {
    const { result } = renderHook(() => useActionItems('meeting-1', structuredSummary()));

    expect(result.current.items).toHaveLength(2);
    expect(result.current.items[0].completed).toBe(false);
    expect(result.current.items[0].addedToday).toBe(false);
    expect(result.current.items[0].title).toBe('Send the accuracy benchmark report');
    expect(result.current.items[0].priority).toBe('high');
    expect(result.current.pendingSave).toBe(false);
  });

  test('toggleComplete flips completion and PUTs the blob after the debounce', async () => {
    const { result } = renderHook(() => useActionItems('meeting-1', structuredSummary()));

    act(() => {
      result.current.toggleComplete(0);
    });

    expect(result.current.items[0].completed).toBe(true);
    // Debounced: nothing on the wire yet.
    expect(putCalls).toHaveLength(0);

    // 800ms debounce + margin - wrapped in act so the deferred
    // setPendingSave updates land inside React's act environment.
    await act(async () => {
      await Bun.sleep(1000);
    });

    expect(putCalls).toHaveLength(1);
    expect(putCalls[0].path).toBe('/api/v1/meetings/meeting-1/summary');
    expect(putCalls[0].body.status).toBe('completed');
    expect(putCalls[0].body.data.actionItemState[0].completed).toBe(true);
    // The LLM output is preserved untouched - only actionItemState is added.
    expect(putCalls[0].body.data.actionItems[0].title).toBe('Send the accuracy benchmark report');
  });

  test('setAssignee overrides the LLM assignee and addToday is sticky', async () => {
    const { result } = renderHook(() => useActionItems('meeting-1', structuredSummary()));

    act(() => {
      result.current.setAssignee(1, 'you');
      result.current.addToday(1);
    });

    expect(result.current.items[1].assignee).toBe('you');
    expect(result.current.items[1].addedToday).toBe(true);

    await act(async () => {
      await Bun.sleep(1000);
    });

    expect(putCalls).toHaveLength(1);
    expect(putCalls[0].body.data.actionItemState[1]).toEqual({
      completed: false,
      assignee: 'you',
      addedToday: true,
    });
  });

  test('legacy string[] actionItems do not throw and render as legacy items', () => {
    const legacy = {
      summary: 'Old summary',
      actionItems: ['Send the deck', 'Follow up with procurement'],
      followUps: ['Check back next quarter'],
    } as unknown as LocalSummary;

    const { result } = renderHook(() => useActionItems('meeting-1', legacy));

    expect(result.current.items).toHaveLength(2);
    expect(result.current.items[0].isLegacy).toBe(true);
    expect(result.current.items[0].title).toBe('Send the deck');
    // Legacy items are inert - toggling is a no-op, not a crash.
    act(() => {
      result.current.toggleComplete(0);
    });
    expect(result.current.items[0].completed).toBe(false);
  });

  test('initialises completed state from the saved actionItemState blob', () => {
    const summary = {
      ...structuredSummary(),
      actionItemState: { 0: { completed: true, assignee: 'you', addedToday: false } },
    } as LocalSummary;

    const { result } = renderHook(() => useActionItems('meeting-1', summary));

    expect(result.current.items[0].completed).toBe(true);
    expect(result.current.items[1].completed).toBe(false);
    expect(result.current.uncompletedCount).toBe(1);
  });
});
