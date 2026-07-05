'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { apiCreateMeeting, apiGetMeetings, Meeting, apiGetProviders } from '@/lib/api';

export default function DashboardPage() {
  const { user, logout, isLoading } = useAuth();
  const router = useRouter();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/login');
      return;
    }
    loadMeetings();
  }, [user, isLoading]);

  const loadMeetings = async () => {
    try {
      const data = await apiGetMeetings();
      setMeetings(data);
    } catch {
      // meetings list may not be fully implemented yet
    }
  };

  const handleCreateMeeting = async () => {
    setLoading(true);
    try {
      const result = await apiCreateMeeting();
      router.push(`/meeting/${result.meetingId}`);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to create meeting');
    } finally {
      setLoading(false);
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">CallPilot AI</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">{user?.email}</span>
            <button
              onClick={() => router.push('/providers')}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              Providers
            </button>
            <button
              onClick={logout}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Meetings</h2>
            <p className="text-gray-500 mt-1">Start a meeting and get real-time AI assistance</p>
          </div>
          <button
            onClick={handleCreateMeeting}
            disabled={loading}
            className="bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Creating...' : 'New Meeting'}
          </button>
        </div>

        {meetings.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <p className="text-gray-500 text-lg">No meetings yet</p>
            <p className="text-gray-400 mt-2">Click &quot;New Meeting&quot; to start your first session</p>
          </div>
        ) : (
          <div className="space-y-3">
            {meetings.map((meeting) => (
              <div
                key={meeting.id}
                onClick={() => router.push(`/meeting/${meeting.id}`)}
                className="bg-white rounded-xl border border-gray-200 p-4 hover:border-blue-300 cursor-pointer transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">
                      Meeting {meeting.id.slice(0, 8)}...
                    </p>
                    <p className="text-sm text-gray-500 mt-1">
                      {new Date(meeting.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                    meeting.status === 'Streaming' ? 'bg-green-100 text-green-700' :
                    meeting.status === 'Completed' ? 'bg-gray-100 text-gray-600' :
                    'bg-yellow-100 text-yellow-700'
                  }`}>
                    {meeting.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
