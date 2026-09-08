// ActionItemsPanel component tests (bun:test + @testing-library/react).
import './dom-setup';

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// Neutralise the .NET Gateway client - the panel persists through
// useActionItems; these tests only assert UI behaviour.
mock.module('@/lib/auth', () => ({
  authedApiCall: mock(async () => ({ status: 'completed' })),
}));

// The panel renders useActionItemExtraction which needs ConfigContext and
// may invoke the Tauri command - neither is exercised here (no extraction
// clicks), but both modules must resolve.
mock.module('@/contexts/ConfigContext', () => ({
  useConfig: () => ({ summarizationModel: 'qwen3.5-2b-q4', isAutoSummary: true }),
}));
mock.module('@tauri-apps/api/core', () => ({
  invoke: mock(async () => []),
}));

import { ActionItemsPanel } from '../../src/components/MeetingDetails/ActionItemsPanel';
import type { LocalSummary } from '../../src/lib/llm';

function structuredSummary(): LocalSummary {
  return {
    summary: 'Discussed accuracy drift and pricing.',
    actionItems: [
      { title: 'Send the accuracy benchmark report', assignee: 'you', priority: 'high', source: 'action_item' },
      { title: 'Schedule the follow-up call', assignee: 'team_member', priority: 'medium', source: 'follow_up' },
    ],
    generatedAt: '2026-09-08T10:00:00.000Z',
  };
}

beforeEach(() => {
  cleanup();
});

describe('ActionItemsPanel', () => {
  test('renders the no-summary empty state with the exact copy', () => {
    render(<ActionItemsPanel meetingId="meeting-1" summary={null} />);

    expect(screen.getByText(/Generate a summary first/i)).toBeTruthy();
    expect(screen.queryByTestId('add-to-board')).toBeNull();
  });

  test('renders rows with priority badges and Add Today buttons', () => {
    render(
      <ActionItemsPanel
        meetingId="meeting-1"
        summary={structuredSummary()}
        transcriptText="Rep: text\nBuyer: text"
      />,
    );

    expect(screen.getByText('Action Items from the Call')).toBeTruthy();
    expect(screen.getByTestId('add-to-board')).toBeTruthy();
    expect(screen.getByText(/calls\.reppify\.live\/meeting-1/)).toBeTruthy();

    // Two item rows.
    expect(screen.getByTestId('action-title-0').textContent).toBe('Send the accuracy benchmark report');
    expect(screen.getByTestId('action-title-1').textContent).toBe('Schedule the follow-up call');

    // Priority badges present with severity labels.
    expect(screen.getByTestId('action-priority-0').textContent).toBe('High');
    expect(screen.getByTestId('action-priority-1').textContent).toBe('Medium');

    // Add Today buttons for both rows.
    expect(screen.getByTestId('add-today-0').textContent).toBe('+ Add Today');
    expect(screen.getByTestId('add-today-1').textContent).toBe('+ Add Today');

    // Structured schema present → Re-extract link, not the primary button.
    expect(screen.getByTestId('re-extract-link')).toBeTruthy();
    expect(screen.queryByTestId('extract-action-items')).toBeNull();
  });

  test('clicking the checkbox marks the title completed (line-through)', () => {
    render(
      <ActionItemsPanel
        meetingId="meeting-1"
        summary={structuredSummary()}
        transcriptText="Rep: text"
      />,
    );

    const title = screen.getByTestId('action-title-0');
    expect(title.className).not.toContain('line-through');

    fireEvent.click(screen.getByTestId('action-checkbox-0'));

    expect(screen.getByTestId('action-checkbox-0').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('action-title-0').className).toContain('line-through');
  });

  test('legacy string[] summaries show the Extract Action Items button', () => {
    const legacy = {
      summary: 'Old summary',
      actionItems: ['Send the deck', 'Follow up with procurement'],
    } as unknown as LocalSummary;

    render(
      <ActionItemsPanel
        meetingId="meeting-1"
        summary={legacy}
        transcriptText="Rep: text"
      />,
    );

    expect(screen.getByTestId('extract-action-items')).toBeTruthy();
    expect(screen.getByTestId('extract-action-items').textContent).toBe('Extract Action Items');
    expect(screen.queryByTestId('re-extract-link')).toBeNull();
    expect(screen.getByText(/No action items detected\. Try extracting them manually\./)).toBeTruthy();
    // Legacy trigger-sentence highlight is structured-only - never a <mark>.
    expect(screen.queryByTestId('trigger-span-highlight')).toBeNull();
  });

  test('structured empty actionItems show Re-extract link, not the Extract button', () => {
    const empty = {
      summary: 'Nothing actionable.',
      actionItems: [] as any[],
    } as unknown as LocalSummary;

    render(
      <ActionItemsPanel
        meetingId="meeting-1"
        summary={empty}
        transcriptText="Rep: text"
      />,
    );

    expect(screen.getByTestId('re-extract-link')).toBeTruthy();
    expect(screen.queryByTestId('extract-action-items')).toBeNull();
  });

  test('Extract button is disabled with a tooltip when transcriptText is undefined', () => {
    const legacy = {
      summary: 'Old summary',
      actionItems: ['Send the deck'],
    } as unknown as LocalSummary;

    render(<ActionItemsPanel meetingId="meeting-1" summary={legacy} />);

    const btn = screen.getByTestId('extract-action-items');
    expect(btn.hasAttribute('disabled')).toBe(true);
    expect(btn.getAttribute('title')).toBe('Transcript still loading');
  });
});
