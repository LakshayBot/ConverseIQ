'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { apiGetTranscripts, TranscriptEntry } from '@/lib/api';
import { useSignalR } from '@/lib/signalr';

export default function MeetingPage() {
  const { id: meetingId } = useParams<{ id: string }>();
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [initialTranscripts, setInitialTranscripts] = useState<TranscriptEntry[]>([]);
  const { transcripts: liveTranscripts, isConnected } = useSignalR(meetingId ?? null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/login');
    }
  }, [user, isLoading]);

  useEffect(() => {
    if (meetingId) {
      apiGetTranscripts(meetingId).then(setInitialTranscripts).catch(() => {});
    }
  }, [meetingId]);

  const allTranscripts = [
    ...initialTranscripts.map(t => ({ ...t, fromServer: true })),
    ...liveTranscripts,
  ];

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [allTranscripts.length]);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/dashboard')}
              className="text-gray-500 hover:text-gray-700"
            >
              ← Back
            </button>
            <h1 className="text-lg font-semibold text-gray-900">Live Meeting</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className={`inline-flex items-center gap-1.5 text-sm ${
              isConnected ? 'text-green-600' : 'text-red-500'
            }`}>
              <span className={`w-2 h-2 rounded-full ${
                isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'
              }`} />
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
          </div>

          <div className="divide-y divide-gray-100 max-h-[calc(100vh-180px)] overflow-y-auto">
            {allTranscripts.length === 0 ? (
              <div className="p-12 text-center text-gray-400">
                <p className="text-lg">Waiting for audio...</p>
                <p className="text-sm mt-2">Start speaking to see live transcription</p>
              </div>
            ) : (
              allTranscripts.map((entry, i) => (
                <div key={i} className={`p-4 ${!entry.isFinal ? 'bg-blue-50/50' : ''}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      entry.speaker === 'Salesperson'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-purple-100 text-purple-700'
                    }`}>
                      {entry.speaker}
                    </span>
                    {!entry.isFinal && (
                      <span className="text-xs text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded-full">
                        Live
                      </span>
                    )}
                    {entry.confidence != null && (
                      <span className="text-xs text-gray-400">
                        {(entry.confidence * 100).toFixed(0)}% confidence
                      </span>
                    )}
                  </div>
                  <p className="text-gray-800 leading-relaxed">{entry.text}</p>
                </div>
              ))
            )}
            <div ref={transcriptEndRef} />
          </div>
        </div>
      </main>
    </div>
  );
}
