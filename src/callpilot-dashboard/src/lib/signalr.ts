'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { HubConnectionBuilder, HubConnection, LogLevel } from '@microsoft/signalr';
import { getAccessToken } from './api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001';

interface TranscriptEvent {
  speaker: string;
  text: string;
  confidence: number;
  isFinal: boolean;
  sequence: number;
}

export interface EventPayload {
  id: string;
  eventType: string;
  entityName: string | null;
  confidence: number;
  detectedAt: string;
  /** GLiNER label / internal entity_type — e.g. "product", "feature", "integration" */
  category: string | null;
  /** The transcript segment that triggered the event, capped at 1000 chars */
  supportingTranscript: string | null;
}

interface RecommendationPayload {
  id: string;
  type: string;
  title: string;
  summary: string;
  confidence: number;
  references: string[];
  generatedAt: string;
}

/**
 * Dedupe window — within this many seconds, the same (eventType, entityName)
 * pair is treated as a single event.  Without dedupe the trie's substring
 * match can fire on every partial transcript update and flood the badge list
 * with copies of the same product.
 */
const DEDUPE_WINDOW_MS = 15_000;

function isDuplicate(
  existing: EventPayload[],
  incoming: EventPayload,
  now: number,
): boolean {
  for (const e of existing) {
    if (e.eventType !== incoming.eventType) continue;
    if ((e.entityName ?? '') !== (incoming.entityName ?? '')) continue;
    const ts = Date.parse(e.detectedAt);
    if (!Number.isNaN(ts) && now - ts < DEDUPE_WINDOW_MS) return true;
  }
  return false;
}

export function useSignalR(meetingId: string | null) {
  const [transcripts, setTranscripts] = useState<TranscriptEvent[]>([]);
  const [events, setEvents] = useState<EventPayload[]>([]);
  const [recommendations, setRecommendations] = useState<RecommendationPayload[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connectionRef = useRef<HubConnection | null>(null);

  const connect = useCallback(async () => {
    if (!meetingId) return;

    const token = getAccessToken();
    if (!token) {
      setError('Not authenticated — please log in first');
      return;
    }

    const hubUrl = `${API_BASE}/hubs/desktop-agent`;
    console.log(`SignalR connecting to ${hubUrl} for meeting ${meetingId}`);

    const connection = new HubConnectionBuilder()
      .withUrl(hubUrl, {
        accessTokenFactory: () => token,
        transport: 0,
      })
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Information)
      .build();

    connection.on('TranscriptReceived', (data: TranscriptEvent) => {
      setTranscripts(prev => [...prev, data]);
    });

    connection.on('EventDetected', (data: EventPayload) => {
      setEvents(prev => {
        // Dedupe floods of the same (eventType, entityName) pair.  Keeps the
        // list clean for the salesperson and prevents the badge row from
        // getting pushed out by repeated "ProductMentioned: prodigy" copies.
        if (isDuplicate(prev, data, Date.now())) return prev;
        return [...prev, data];
      });
    });

    connection.on('RecommendationGenerated', (data: RecommendationPayload) => {
      setRecommendations(prev => [...prev, data]);
    });

    connection.onreconnecting(() => {
      console.log('SignalR reconnecting...');
      setIsConnected(false);
    });

    connection.onreconnected(async (connectionId) => {
      console.log('SignalR reconnected:', connectionId);
      setIsConnected(true);
      if (meetingId) {
        try { await connection.invoke('JoinMeeting', meetingId); } catch {}
      }
    });

    connection.onclose((err) => {
      console.log('SignalR closed:', err?.message);
      setIsConnected(false);
      setError(err?.message || 'Connection closed');
    });

    try {
      await connection.start();
      console.log('SignalR connected');
      await connection.invoke('JoinMeeting', meetingId);
      setIsConnected(true);
      setError(null);
      connectionRef.current = connection;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('SignalR connection failed:', msg);
      setError(msg);
      setIsConnected(false);
    }
  }, [meetingId]);

  useEffect(() => {
    if (meetingId) {
      connect();
    }
    return () => {
      if (connectionRef.current) {
        connectionRef.current.stop();
      }
    };
  }, [meetingId, connect]);

  return { transcripts, events, recommendations, isConnected, error };
}
