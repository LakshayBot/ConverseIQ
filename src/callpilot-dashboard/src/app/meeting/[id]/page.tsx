'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useSignalR } from '@/lib/signalr';

interface SpeakerGroup {
  speaker: string;
  text: string;
  isFinal: boolean;
  key: number;
}

function mergeTranscripts(transcripts: { speaker: string; text: string; isFinal: boolean; sequence: number }[]): SpeakerGroup[] {
  const groups: SpeakerGroup[] = [];
  let keyCounter = 0;

  for (const t of transcripts) {
    const compact = t.speaker === 'Customer-1' ? 'Customer' : t.speaker;
    const prev = groups[groups.length - 1];

    const isRefinement = prev && prev.speaker === compact && (
      // Text is growing (Nemotron refining same utterance)
      t.text.includes(prev.text) ||
      // OR some overlap at the start (Nemotron re-transcribed and extended)
      prev.text.length >= 10 && t.text.startsWith(prev.text.slice(0, Math.min(20, prev.text.length)))
    );

    if (t.isFinal) {
      // FINAL: promote the current live group
      if (prev && prev.speaker === compact && !prev.isFinal) {
        prev.text = t.text;
        prev.isFinal = true;
      } else if (prev && prev.speaker === compact && prev.isFinal) {
        prev.text += ' ' + t.text;
      } else {
        groups.push({ speaker: compact, text: t.text, isFinal: true, key: keyCounter++ });
      }
    } else {
      // PARTIAL: update if refining, otherwise new utterance
      if (isRefinement) {
        prev.text = t.text;
      } else {
        groups.push({ speaker: compact, text: t.text, isFinal: false, key: keyCounter++ });
      }
    }
  }

  return groups;
}

export default function MeetingPage() {
  const { id: meetingId } = useParams<{ id: string }>();
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const { transcripts: liveTranscripts, events, recommendations, isConnected, error: signalRError } = useSignalR(
    isLoading ? null : (meetingId ?? null)
  );
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/login');
    }
  }, [user, isLoading]);

  const groups = useMemo(() => mergeTranscripts(liveTranscripts), [liveTranscripts]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [groups.length]);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => router.push('/dashboard')} className="text-gray-500 hover:text-gray-700">← Back</button>
            <h1 className="text-lg font-semibold text-gray-900">Live Meeting</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className={`inline-flex items-center gap-1.5 text-sm ${isConnected ? 'text-green-600' : 'text-red-500'}`}>
              <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="p-4 border-b border-gray-100 bg-gray-50">
            <h2 className="font-semibold text-gray-700">Live Transcript</h2>
            <p className="text-xs text-gray-400 mt-0.5">Meeting ID: {meetingId}</p>
            {signalRError && <p className="text-xs text-red-500 mt-1">Connection error: {signalRError}</p>}
          </div>

          <div className="max-h-[calc(100vh-180px)] overflow-y-auto">
            {groups.length === 0 && liveTranscripts.length === 0 ? (
              <div className="p-12 text-center text-gray-400">
                <p className="text-lg">Waiting for audio...</p>
                <p className="text-sm mt-2">Start speaking to see live transcription</p>
              </div>
            ) : (
              <div className="p-4 leading-relaxed text-gray-800 whitespace-pre-wrap">
                {groups.map((g) => (
                  <span key={g.key}>
                    <span className={`font-semibold ${
                      g.speaker === 'Salesperson' ? 'text-blue-600' : 'text-purple-600'
                    }`}>
                      {g.speaker}:
                    </span>
                    <span className={g.isFinal ? 'text-gray-800' : 'text-blue-600'}>
                      {g.text}{' '}
                    </span>
                    {!g.isFinal && (
                      <span className="inline-block w-1.5 h-4 bg-blue-400 animate-pulse ml-0.5 align-middle rounded-sm" />
                    )}
                  </span>
                ))}
                <div ref={transcriptEndRef} />
              </div>
            )}
          </div>

          {events.length > 0 && (
            <div className="p-4 border-t border-gray-100 bg-amber-50/50">
              <h3 className="font-semibold text-gray-700 mb-2">Detected Events ({events.length})</h3>
              <div className="flex flex-wrap gap-2">
                {events.slice(-10).map((e, i) => (
                  <span key={i} className="text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-800">
                    {e.eventType}{e.entityName ? `: ${e.entityName}` : ''}
                  </span>
                ))}
              </div>
            </div>
          )}

          {recommendations.length > 0 && (
            <div className="p-4 border-t border-gray-100 bg-green-50/50">
              <h3 className="font-semibold text-gray-700 mb-2">Recommendations ({recommendations.length})</h3>
              <div className="space-y-2">
                {recommendations.slice(-5).map((r, i) => (
                  <div key={i} className="text-sm bg-white p-3 rounded-lg border border-green-200">
                    <p className="font-medium text-green-900">{r.title}</p>
                    <p className="text-gray-600 mt-1">{r.summary?.slice(0, 200)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
