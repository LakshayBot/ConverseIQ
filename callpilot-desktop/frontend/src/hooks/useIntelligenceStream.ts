// useIntelligenceStream - connects to the .NET Gateway's
// /hubs/desktop-agent SignalR hub and surfaces `IntelligenceCard`
// events for the live meeting view.
//
// SignalR protocol (matches `src/callpilot-dashboard/src/lib/signalr.ts`):
//   Server → Client: "EventDetected"            (from /process broadcast)
//   Server → Client: "RecommendationGenerated"  (from /process broadcast)
//   Client → Server: "JoinMeeting"  <meetingId>   (subscribe to group)
//
// Cards arrive with the same payload shape that the dashboard consumes
// (see DesktopAgentHub.cs:157-166 and :183-192) - we map them to
// `IntelligenceCard` for the panel.
//
// NOTE: this previously opened a WebSocket to the Python engine's
// /ws/intelligence/{session_id} endpoint (now removed). The .NET
// Gateway is the single intelligence surface - both this desktop and
// the web dashboard receive the same SignalR broadcasts.

import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  HubConnectionBuilder,
  HubConnection,
  HubConnectionState,
  LogLevel,
  HttpTransportType,
} from '@microsoft/signalr';
import { getCallPilotApiBaseUrl } from '@/lib/callpilotApi';
import { authedApiCall } from '@/lib/auth';
import type { IntelligenceCard } from '@/lib/callpilotApi';

const MAX_CARDS_VISIBLE = 5;
const MAX_CARDS_STORED = 50;

interface EventPayload {
  id?: string;
  eventType?: string;
  entityName?: string | null;
  confidence?: number;
  detectedAt?: string;
  category?: string | null;
  supportingTranscript?: string | null;
}

interface RecommendationPayload {
  id?: string;
  type?: string;
  title?: string;
  summary?: string;
  confidence?: number;
  references?: string[] | null;
  generatedAt?: string;
}

const CARD_TYPE_BY_EVENT: Record<string, IntelligenceCard['type']> = {
  ProductMentioned: 'product_match',
  CompetitorMentioned: 'competitor_detected',
  Objection: 'objection',
  PricingDiscussion: 'pricing_discussion',
  PricingQuestion: 'pricing_discussion',
  TechnicalQuestion: 'technical_question',
};

const CARD_TYPE_BY_REC: Record<string, IntelligenceCard['type']> = {
  product_match: 'product_match',
  competitor: 'competitor_detected',
  objection: 'objection',
  pricing: 'pricing_discussion',
  technical: 'technical_question',
};

function severityFromConfidence(c: number | undefined): IntelligenceCard['severity'] {
  const v = typeof c === 'number' ? c : 0;
  if (v >= 0.9) return 'high';
  if (v >= 0.7) return 'medium';
  return 'low';
}

function cardFromEvent(p: EventPayload): IntelligenceCard | null {
  const eventType = p.eventType ?? '';
  const cardType = CARD_TYPE_BY_EVENT[eventType];
  if (!cardType) return null;
  const titleEntity = p.entityName ? `: ${p.entityName}` : '';
  return {
    type: cardType,
    title: `${eventType}${titleEntity}`,
    body: p.supportingTranscript ?? '',
    severity: severityFromConfidence(p.confidence),
    chunks: p.supportingTranscript ? [p.supportingTranscript] : [],
  };
}

function cardFromRecommendation(p: RecommendationPayload): IntelligenceCard | null {
  const recType = (p.type ?? '').toLowerCase();
  const cardType = CARD_TYPE_BY_REC[recType] ?? 'product_match';
  if (!p.title) return null;
  return {
    type: cardType,
    title: p.title,
    body: p.summary ?? '',
    severity: severityFromConfidence(p.confidence),
    chunks: Array.isArray(p.references) ? p.references : [],
  };
}

let _lastSeenSessionId: string | null | undefined = undefined;
let _effectRunCount = 0;

export function useIntelligenceStream(sessionId: string | null) {
  const [cards, setCards] = useState<IntelligenceCard[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signalRUrl, setSignalRUrl] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<HubConnectionState | null>(null);
  const connRef = useRef<HubConnection | null>(null);

  useEffect(() => {
    const currentSessionId = sessionId;
    let cancelled = false;

    _effectRunCount += 1;
    if (currentSessionId !== _lastSeenSessionId) {
      console.log(
        '[DIAG] useIntelligenceStream prop CHANGED: was =',
        JSON.stringify(_lastSeenSessionId),
        'now =',
        JSON.stringify(currentSessionId),
        'effect run #',
        _effectRunCount,
      );
      _lastSeenSessionId = currentSessionId;
    } else {
      console.log(
        '[DIAG] useIntelligenceStream effect run (same sessionId=',
        JSON.stringify(currentSessionId),
        '), # ',
        _effectRunCount,
      );
    }

    // Tear down any prior connection before re-attaching.
    if (connRef.current) {
      connRef.current.stop().catch(() => {});
      connRef.current = null;
    }

    if (!currentSessionId) {
      console.log('[DIAG] useIntelligenceStream: no sessionId, skipping SignalR open');
      setCards([]);
      setConnected(false);
      setError(null);
      setSignalRUrl(null);
      setConnectionState(null);
      return;
    }

    (async () => {
      const token = await invoke<string | null>('get_auth_access_token');
      if (cancelled || !token) {
        if (!token) setError('Not authenticated - please log in first');
        setConnected(false);
        return;
      }

      const base = getCallPilotApiBaseUrl();
      const url = `${base.replace(/\/+$/, '')}/hubs/desktop-agent`;
      console.log('[DIAG] useIntelligenceStream connecting →', url);
      setSignalRUrl(url);

      const conn = new HubConnectionBuilder()
        .withUrl(url, {
          accessTokenFactory: () => token,
          transport: HttpTransportType.WebSockets,
        })
        .withAutomaticReconnect()
        .configureLogging(LogLevel.Information)
        .build();

      const addCard = (card: IntelligenceCard) => {
        console.log('[DIAG] intelligence CARD added:', card.type, card.title);
        setCards((prev) => [card, ...prev].slice(0, MAX_CARDS_STORED));
      };

      conn.on('EventDetected', (p: EventPayload) => {
        const card = cardFromEvent(p);
        if (card) addCard(card);
      });

      conn.on('RecommendationGenerated', (p: RecommendationPayload) => {
        const card = cardFromRecommendation(p);
        if (card) addCard(card);
      });

      const refreshState = () => {
        if (cancelled) return;
        setConnectionState(conn.state);
        setConnected(conn.state === HubConnectionState.Connected);
      };
      conn.onclose(refreshState);
      conn.onreconnecting(refreshState);
      conn.onreconnected(async () => {
        refreshState();
        try {
          await conn.invoke('JoinMeeting', currentSessionId);
        } catch (e) {
          console.warn('[callpilot] re-JoinMeeting failed', e);
        }
      });

      try {
        await conn.start();
        if (cancelled) {
          conn.stop().catch(() => {});
          return;
        }
        refreshState();
        await conn.invoke('JoinMeeting', currentSessionId);
        console.log('[DIAG] intelligence SignalR CONNECTED, joined meeting', currentSessionId);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('[DIAG] SignalR start failed:', msg);
        setError(`SignalR: ${msg}`);
        setConnected(false);
        return;
      }

      connRef.current = conn;
    })();

    return () => {
      cancelled = true;
      const liveSessionId = currentSessionId;
      const conn = connRef.current;
      connRef.current = null;
      if (!conn) return;
      (async () => {
        try {
          if (conn.state === HubConnectionState.Connected) {
            await conn.invoke('LeaveMeeting', liveSessionId);
          }
        } catch {}
        try {
          await conn.stop();
        } catch {}
      })();
    };
  }, [sessionId]);

  const visible = cards.slice(0, MAX_CARDS_VISIBLE);

  return { cards, visible, connected, error, signalRUrl, connectionState };
}

// Re-export authedApiCall so adjacent call sites can colocate with the
// hook without a second import statement.
export { authedApiCall };
