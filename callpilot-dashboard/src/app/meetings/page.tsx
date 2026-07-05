"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";

interface Meeting {
  id: string;
  state: string;
  startedAt?: string;
}

export default function MeetingsPage() {
  const { isAuthenticated, logout } = useAuth();
  const router = useRouter();
  const [meetings, setMeetings] = useState<Meeting[]>([]);

  useEffect(() => {
    if (!isAuthenticated) {
      router.push("/login");
      return;
    }
    api.meetings.list().then(setMeetings).catch(console.error);
  }, [isAuthenticated, router]);

  const createMeeting = async () => {
    try {
      const meeting = await api.meetings.create();
      router.push(`/meetings/${meeting.meetingId}`);
    } catch (err) {
      console.error("Failed to create meeting", err);
    }
  };

  return (
    <main>
      <nav>
        <h2>CallPilot AI</h2>
        <div>
          <a href="/meetings">Meetings</a>
          <a href="/providers">Providers</a>
          <button onClick={logout}>Sign Out</button>
        </div>
      </nav>
      <div>
        <h1>Meetings</h1>
        <button onClick={createMeeting}>Start Meeting</button>
        <ul>
          {meetings.map((m) => (
            <li key={m.id}>
              <a href={`/meetings/${m.id}`}>
                {m.id.slice(0, 8)}... - {m.state}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
