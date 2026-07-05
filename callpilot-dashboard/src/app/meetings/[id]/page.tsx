"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { startConnection, stopConnection } from "@/lib/signalr";

interface TranscriptEntry {
  speaker?: string;
  text: string;
  timestamp: string;
}

export default function MeetingPage() {
  const { id } = useParams<{ id: string }>();
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [status, setStatus] = useState("Connecting...");

  useEffect(() => {
    if (!isAuthenticated) {
      router.push("/login");
      return;
    }

    let mounted = true;

    const init = async () => {
      try {
        const connection = await startConnection();

        connection.on("TranscriptUpdated", (entry: TranscriptEntry) => {
          if (mounted) {
            setTranscript((prev) => [...prev, entry]);
          }
        });

        connection.on("MeetingStatusChanged", (newStatus: string) => {
          if (mounted) setStatus(newStatus);
        });

        setStatus("Connected");
      } catch {
        setStatus("Connection failed");
      }
    };

    init();

    return () => {
      mounted = false;
      stopConnection();
    };
  }, [isAuthenticated, router]);

  return (
    <main>
      <nav>
        <h2>CallPilot AI</h2>
        <a href="/meetings">Back to Meetings</a>
      </nav>
      <div>
        <h1>Meeting {id?.slice(0, 8)}</h1>
        <p>Status: {status}</p>
        <div>
          <h2>Live Transcript</h2>
          {transcript.length === 0 && <p>Waiting for audio...</p>}
          {transcript.map((entry, i) => (
            <div key={i}>
              <strong>{entry.speaker || "Unknown"}:</strong> {entry.text}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
