// useIntelligenceStream — opens a WebSocket to the CallPilot AI engine and
// surfaces `IntelligenceCard` events for the live meeting view.
//
// URL pattern (per task spec): ws://<CALLPILOT_AI_ENGINE_URL>/ws/intelligence/{session_id}
//
// Engine protocol (routers/intelligence_router.py):
//   Server → Client: { type: "ready",   session_id }
//   Server → Client: { type: "ping",    ts: <unix_ms> }
//   Server → Client: { type: "card",    card: <IntelligenceCard> }
//   Client → Server: { type: "pong" }
//
// The hook now actually reconnects on abnormal close (was a no-op before —
// the UI would stay "Connecting…" forever if the engine 404'd or rebooted).

import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_CALLPILOT_AI_ENGINE_URL,
  normalizeWsBaseUrl,
  SETTINGS_KEY_AI_ENGINE_URL,
} from '@/lib/callpilot';
import type { IntelligenceCard } from '@/lib/callpilotApi';

const MAX_CARDS_VISIBLE = 5;
const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_MS = 500;
const MAX_RECONNECT_MS = 8000;

export function useIntelligenceStream(sessionId: string | null) {
  const [cards, setCards] = useState<IntelligenceCard[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped on every (re)connect attempt so the connect effect re-runs.
  const [connectNonce, setConnectNonce] = useState(0);

  useEffect(() => {
    if (!sessionId) {
      setCards([]);
      setConnected(false);
      setError(null);
      reconnectAttemptRef.current = 0;
      return;
    }

    let cancelled = false;
    let baseUrl = DEFAULT_CALLPILOT_AI_ENGINE_URL;
    try {
      const stored = localStorage.getItem(SETTINGS_KEY_AI_ENGINE_URL);
      if (stored) baseUrl = stored;
    } catch {}

    const wsBase = normalizeWsBaseUrl(baseUrl).replace(/\/+$/, '');
    const url = `${wsBase}/ws/intelligence/${encodeURIComponent(sessionId)}`;
    // eslint-disable-next-line no-console
    console.log('[DIAG] useIntelligenceStream connecting →', url);

    let socket: WebSocket | null = null;
    try {
      socket = new WebSocket(url);
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.warn('[callpilot] intelligence WS construct failed', e?.message ?? e);
      setError('Intelligence stream unavailable');
      setConnected(false);
      return;
    }

    wsRef.current = socket;

    socket.onopen = () => {
      if (cancelled) return;
      // eslint-disable-next-line no-console
      console.log('[DIAG] intelligence WS OPEN', url);
      setConnected(true);
      setError(null);
      reconnectAttemptRef.current = 0;
    };

    socket.onmessage = (ev) => {
      if (cancelled) return;
      try {
        // Discriminated union: control frames (ping/ready/pong) and card frames.
        const parsed = JSON.parse(ev.data) as
          | { type: 'ping' | 'ready' | 'pong'; ts?: number; session_id?: string }
          | { type: 'card'; card: Partial<IntelligenceCard> }
          | (Partial<IntelligenceCard> & { type?: undefined });

        // Server keepalive — ignore. If the server ever starts requiring pongs,
        // we'd reply here.
        if (
          parsed &&
          (parsed.type === 'ping' || parsed.type === 'ready' || parsed.type === 'pong')
        ) {
          return;
        }

        // Card payload shape (matches server `broadcast_card`):
        //   { type: "card", card: { type, title, body, severity, chunks } }
        // Accept the bare-card shape too in case the server emits it flat.
        let cardSource: Partial<IntelligenceCard> | undefined;
        if (parsed && (parsed as { type?: string }).type === 'card') {
          cardSource = (parsed as { card?: Partial<IntelligenceCard> }).card;
        } else {
          cardSource = parsed as Partial<IntelligenceCard>;
        }
        if (!cardSource || !cardSource.type || !cardSource.title) return;
        const card: IntelligenceCard = {
          type: cardSource.type,
          title: cardSource.title,
          body: cardSource.body ?? '',
          severity: cardSource.severity ?? 'low',
          chunks: Array.isArray(cardSource.chunks) ? cardSource.chunks : [],
        };
        setCards((prev) => [card, ...prev].slice(0, 50));
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[callpilot] bad intelligence card payload', e);
      }
    };

    socket.onerror = (ev) => {
      if (cancelled) return;
      // eslint-disable-next-line no-console
      console.warn('[callpilot] intelligence WS error', ev);
      setError('Intelligence stream unavailable');
    };

    socket.onclose = (ev) => {
      if (cancelled) return;
      // eslint-disable-next-line no-console
      console.log('[DIAG] intelligence WS CLOSE code=', ev?.code, 'reason=', ev?.reason);
      setConnected(false);
      try { wsRef.current = null; } catch {}

      // Clean unmount — don't retry, don't show "offline".
      if (ev?.code === 1000) return;

      // Surface failure so the UI doesn't stay stuck on "Connecting…".
      setError((prev) => prev ?? 'Intelligence stream offline');

      // Auto-reconnect with capped exponential backoff. After MAX_RECONNECT_ATTEMPTS
      // give up until the sessionId changes (e.g. user starts a new meeting).
      if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
        // eslint-disable-next-line no-console
        console.warn('[callpilot] intelligence WS giving up after', MAX_RECONNECT_ATTEMPTS, 'attempts');
        return;
      }
      reconnectAttemptRef.current += 1;
      const delay = Math.min(MAX_RECONNECT_MS, BASE_RECONNECT_MS * 2 ** reconnectAttemptRef.current);
      // eslint-disable-next-line no-console
      console.info(`[callpilot] intelligence WS reconnect in ${delay}ms (attempt ${reconnectAttemptRef.current})`);
      reconnectTimerRef.current = setTimeout(() => {
        if (cancelled) return;
        setConnectNonce((n) => n + 1);
      }, delay);
    };

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      try { socket?.close(1000, 'unmount'); } catch {}
      wsRef.current = null;
    };
  }, [sessionId, connectNonce]);

  const visible = cards.slice(0, MAX_CARDS_VISIBLE);

  return { cards, visible, connected, error };
}
