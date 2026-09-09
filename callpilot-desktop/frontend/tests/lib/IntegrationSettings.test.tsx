// IntegrationSettings component tests (bun:test + @testing-library/react).
import './dom-setup';

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

// ── .NET Gateway client mock ────────────────────────────────────────────────
const apiCalls: Array<{ method: string; path: string; body?: any }> = [];
let apiResponse: any = { connected: false };

mock.module('@/lib/auth', () => ({
  authedApiCall: mock(async (method: string, path: string, body?: any) => {
    apiCalls.push({ method, path, body });
    if (path === '/api/v1/integrations/slack' && method === 'GET') {
      return apiResponse;
    }
    if (path === '/api/v1/integrations/slack/connect') {
      return { url: 'https://slack.com/oauth/v2/authorize?client_id=x' };
    }
    return { ok: true };
  }),
}));

// ── Tauri invoke mock (open_external_url) ───────────────────────────────────
const invokeMock = mock(async (_cmd: string, _args?: any) => null);
mock.module('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

import { IntegrationSettings } from '../../src/components/IntegrationSettings';

const CONNECTED = {
  connected: true,
  teamName: 'Tata Power Deals',
  teamId: 'T123',
  maskedToken: 'xoxb****oken',
  installedAt: '2026-09-09T00:00:00.000Z',
  defaultChannelId: null,
  notifyBattleCards: true,
  notifyLiveSignals: true,
  notifySummary: true,
  notifyActionItems: true,
};

beforeEach(() => {
  apiCalls.length = 0;
  apiResponse = { connected: false };
  cleanup();
});

describe('IntegrationSettings (Slack)', () => {
  test('not connected: Connect button visible, toggle rows absent', async () => {
    render(<IntegrationSettings />);

    await waitFor(() => expect(screen.getByTestId('connect-slack')).toBeTruthy());
    expect(screen.queryByTestId('disconnect-slack')).toBeNull();
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
  });

  test('connected: team name, 4 toggles, Disconnect visible; token masked', async () => {
    apiResponse = CONNECTED;
    render(<IntegrationSettings />);

    await waitFor(() => expect(screen.getByTestId('slack-team-name')).toBeTruthy());
    expect(screen.getByTestId('slack-team-name').textContent).toBe('Tata Power Deals');
    expect(screen.getByText(/Connected on/)).toBeTruthy();
    expect(screen.getByText(/xoxb\*\*\*\*oken/)).toBeTruthy();
    expect(screen.getAllByRole('switch')).toHaveLength(4);
    expect(screen.getByTestId('disconnect-slack')).toBeTruthy();
  });

  test('Disconnect shows confirmation before DELETE is called', async () => {
    apiResponse = CONNECTED;
    render(<IntegrationSettings />);

    await waitFor(() => expect(screen.getByTestId('disconnect-slack')).toBeTruthy());
    fireEvent.click(screen.getByTestId('disconnect-slack'));

    // Confirmation modal appears first, no DELETE yet.
    expect(screen.getByText(/Disconnect Tata Power Deals/)).toBeTruthy();
    expect(apiCalls.some(c => c.method === 'DELETE')).toBe(false);

    fireEvent.click(screen.getByText('Delete'));
    await waitFor(() => expect(apiCalls.some(c => c.method === 'DELETE')).toBe(true));
  });

  test('toggling a notification PUTs settings with the new value after debounce', async () => {
    apiResponse = CONNECTED;
    render(<IntegrationSettings />);

    await waitFor(() => expect(screen.getAllByRole('switch')).toHaveLength(4));
    fireEvent.click(screen.getAllByRole('switch')[0]); // NotifyBattleCards off

    // Debounced — not yet on the wire.
    expect(apiCalls.some(c => c.path.includes('/slack/settings'))).toBe(false);

    await Bun.sleep(700);
    const put = apiCalls.find(c => c.path.includes('/slack/settings'));
    expect(put).toBeDefined();
    expect(put!.body.notifyBattleCards).toBe(false);
    expect(put!.body.notifyLiveSignals).toBe(true);
  });

  test('Connect opens the server-built OAuth URL in the system browser', async () => {
    render(<IntegrationSettings />);

    await waitFor(() => expect(screen.getByTestId('connect-slack')).toBeTruthy());
    fireEvent.click(screen.getByTestId('connect-slack'));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('open_external_url', {
        url: 'https://slack.com/oauth/v2/authorize?client_id=x',
      }));
  });
});
