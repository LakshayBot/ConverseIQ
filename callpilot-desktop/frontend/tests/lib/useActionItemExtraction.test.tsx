// useActionItemExtraction hook tests (bun:test + @testing-library/react).
//
// Extraction re-runs ONLY action items via the local Tauri command and
// merges the result into the saved summary blob - full summary fields must
// survive untouched, and the blob must be untouched on error.
import './dom-setup';

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { renderHook, act } from '@testing-library/react';

// ── Tauri command mock ──────────────────────────────────────────────────────
let invokeResult: Array<any> | Error = [];
const invokeMock = mock(async (_cmd: string, _args?: any) => {
  if (invokeResult instanceof Error) throw invokeResult;
  return invokeResult;
});

mock.module('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

// ── .NET Gateway client mock ────────────────────────────────────────────────
const putCalls: Array<{ path: string; body: any }> = [];

mock.module('@/lib/auth', () => ({
  authedApiCall: mock(async (method: string, path: string, body?: any) => {
    if (method === 'PUT') putCalls.push({ path, body });
    return { status: 'completed' };
  }),
}));

// ── Config context mock (useConfig throws outside a provider) ───────────────
mock.module('@/contexts/ConfigContext', () => ({
  useConfig: () => ({ summarizationModel: 'qwen3.5-2b-q4', isAutoSummary: true }),
}));

import { useActionItemExtraction } from '../../src/hooks/useActionItemExtraction';
import type { LocalSummary } from '../../src/lib/llm';

const TRANSCRIPT = 'Buyer: how accurate after six months?\nRep: I will send the benchmark report.';

beforeEach(() => {
  putCalls.length = 0;
  invokeResult = [];
});

describe('useActionItemExtraction', () => {
  test('merges extracted items into an existing summary and PUTs the blob', async () => {
    invokeResult = [
      { title: 'Send the accuracy benchmark report', assignee: 'you', priority: 'high', source: 'action_item' },
      { title: 'Schedule the follow-up call', assignee: 'team_member', priority: 'medium', source: 'follow_up' },
    ];
    const existing = {
      summary: 'Discussed accuracy drift.',
      keyPoints: ['Accuracy holds at 99.2%'],
      decisions: ['Pilot approved'],
      actionItems: [] as any[],
      objections: ['Accuracy concern'],
      generatedAt: '2026-01-01T00:00:00.000Z',
    } as unknown as LocalSummary;

    const { result } = renderHook(() => useActionItemExtraction('meeting-1', existing));

    await act(async () => {
      await result.current.extractActionItemsOnly(TRANSCRIPT);
    });

    expect(result.current.extractionState).toBe('done');
    expect(result.current.extractionError).toBeNull();
    expect(invokeMock).toHaveBeenCalledWith('extract_action_items', {
      transcript: TRANSCRIPT,
      model: 'qwen3.5-2b-q4',
    });

    expect(putCalls).toHaveLength(1);
    expect(putCalls[0].path).toBe('/api/v1/meetings/meeting-1/summary');
    // PATCH semantics: actionItems replaced, every other field untouched.
    expect(putCalls[0].body.data.actionItems).toHaveLength(2);
    expect(putCalls[0].body.data.summary).toBe('Discussed accuracy drift.');
    expect(putCalls[0].body.data.keyPoints).toEqual(['Accuracy holds at 99.2%']);
    expect(putCalls[0].body.data.decisions).toEqual(['Pilot approved']);
    expect(putCalls[0].body.data.objections).toEqual(['Accuracy concern']);
    expect(putCalls[0].body.status).toBe('completed');
  });

  test('creates a minimal blob when no summary exists', async () => {
    invokeResult = [
      { title: 'Send pricing sheet', assignee: 'unassigned', priority: 'low', source: 'follow_up' },
    ];

    const { result } = renderHook(() => useActionItemExtraction('meeting-1', null));

    await act(async () => {
      await result.current.extractActionItemsOnly(TRANSCRIPT);
    });

    expect(result.current.extractionState).toBe('done');
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0].body.data).toEqual({
      actionItems: [{ title: 'Send pricing sheet', assignee: 'unassigned', priority: 'low', source: 'follow_up' }],
      actionItemState: {},
    });
  });

  test('command failure sets error state and leaves the saved blob untouched', async () => {
    invokeResult = new Error('model not downloaded');
    const existing = {
      summary: 'Original summary text.',
      actionItems: [] as any[],
    } as unknown as LocalSummary;

    const { result } = renderHook(() => useActionItemExtraction('meeting-1', existing));

    await act(async () => {
      await result.current.extractActionItemsOnly(TRANSCRIPT);
    });

    expect(result.current.extractionState).toBe('error');
    expect(result.current.extractionError).toContain('model not downloaded');
    // No PUT, no blob mutation.
    expect(putCalls).toHaveLength(0);
  });
});
