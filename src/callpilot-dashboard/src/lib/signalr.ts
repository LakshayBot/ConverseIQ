'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { HubConnectionBuilder, HubConnection, LogLevel } from '@microsoft/signalr';
import { getAccessToken } from './api';

const HUB_URL = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/hubs/desktop-agent`;

interface TranscriptEvent {
  speaker: string;
  text: string;
  confidence: number;
  isFinal: boolean;
  sequence: number;
}

export function useSignalR(meetingId: string | null) {
  const [transcripts, setTranscripts] = useState<TranscriptEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const connectionRef = useRef<HubConnection | null>(null);

  const connect = useCallback(async () => {
    if (!meetingId) return;

    const token = getAccessToken();
    if (!token) return;

    const connection = new HubConnectionBuilder()
      .withUrl(`${HUB_URL}`, {
        accessTokenFactory: () => token,
      })
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build();

    connection.on('TranscriptReceived', (data: TranscriptEvent) => {
      setTranscripts(prev => [...prev, data]);
    });

    connection.on('AudioFrameAcknowledged', () => {});

    connection.onreconnecting(() => setIsConnected(false));
    connection.onreconnected(() => setIsConnected(true));
    connection.onclose(() => setIsConnected(false));

    try {
      await connection.start();
      setIsConnected(true);
      connectionRef.current = connection;
    } catch (err) {
      console.error('SignalR connection failed:', err);
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

  return { transcripts, isConnected };
}
