'use client';

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Analytics from '@/lib/analytics';
import { authedApiCall } from '@/lib/auth';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { useAuth } from '@/contexts/AuthContext';


interface SidebarItem {
  id: string;
  title: string;
  type: 'folder' | 'file';
  children?: SidebarItem[];
}

export interface CurrentMeeting {
  id: string;
  title: string;
  createdAt?: string;
}

// Search result type for transcript search
interface TranscriptSearchResult {
  id: string;
  title: string;
  matchContext: string;
  timestamp: string;
};

interface SidebarContextType {
  currentMeeting: CurrentMeeting | null;
  setCurrentMeeting: (meeting: CurrentMeeting | null) => void;
  sidebarItems: SidebarItem[];
  isCollapsed: boolean;
  toggleCollapse: () => void;
  meetings: CurrentMeeting[];
  setMeetings: (meetings: CurrentMeeting[]) => void;
  isMeetingActive: boolean;
  setIsMeetingActive: (active: boolean) => void;
  handleRecordingToggle: () => void;
  searchTranscripts: (query: string) => Promise<void>;
  searchResults: TranscriptSearchResult[];
  isSearching: boolean;
  setServerAddress: (address: string) => void;
  serverAddress: string;
  transcriptServerAddress: string;
  setTranscriptServerAddress: (address: string) => void;
  // Summary polling management
  activeSummaryPolls: Map<string, NodeJS.Timeout>;
  startSummaryPolling: (meetingId: string, processId: string, onUpdate: (result: any) => void) => void;
  stopSummaryPolling: (meetingId: string) => void;
  // Refetch meetings from backend
  refetchMeetings: () => Promise<void>;

}

const SidebarContext = createContext<SidebarContextType | null>(null);

export const useSidebar = () => {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return context;
};

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [currentMeeting, setCurrentMeeting] = useState<CurrentMeeting | null>({ id: 'intro-call', title: '+ New Call' });
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [meetings, setMeetings] = useState<CurrentMeeting[]>([]);
  const [sidebarItems, setSidebarItems] = useState<SidebarItem[]>([]);
  const [isMeetingActive, setIsMeetingActive] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [serverAddress, setServerAddress] = useState('');
  const [transcriptServerAddress, setTranscriptServerAddress] = useState('');
  const [activeSummaryPolls, setActiveSummaryPolls] = useState<Map<string, NodeJS.Timeout>>(new Map());

  // Use recording state from RecordingStateContext (single source of truth)
  const { isRecording } = useRecordingState();

  // Auth status is what really determines whether an authenticated request
  // will succeed — serverAddress alone is not enough. The backend rejects
  // requests with no Authorization header, so firing fetchMeetings before
  // AuthContext has finished restoring the session used to 401 and silently
  // wipe the meetings list (SidebarProvider legacy bug). We gate on auth
  // status and add a single retry for the cold-start race.
  const { status: authStatus } = useAuth();

  const pathname = usePathname();
  const router = useRouter();

  // Track whether the last failure was a transient auth-startup flake so we
  // can retry once. Once a retry is scheduled we set this ref; on success or
  // on logout we clear it.
  const retryScheduledRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Extract fetchMeetings as a reusable function. Gated on auth rather than
  // on serverAddress — the backend doesn't care about serverAddress, it
  // cares about the bearer token.
  const fetchMeetings = React.useCallback(async () => {
    if (authStatus !== 'authenticated') {
      return;
    }
    try {
      const meetings = await authedApiCall<Array<{ id: string, title: string | null, createdAt: string }>>(
        'GET',
        '/api/v1/meetings',
      );
      const transformedMeetings = meetings.map((meeting) => ({
        id: meeting.id,
        title: meeting.title ?? 'Untitled session',
        createdAt: meeting.createdAt,
      }));
      setMeetings(transformedMeetings);
      Analytics.trackBackendConnection(true);
      retryScheduledRef.current = false;
    } catch (error) {
      // Don't clobber existing meetings on a transient 401/race. The list
      // may have been populated by a previous successful fetch, or a local
      // recording finish may have just added one. Wiping the array here is
      // what caused the "empty on restart, appears when you record again"
      // bug. Leave existing entries in place; the retry effect below will
      // repopulate when the backend accepts the request.
      console.error('[sidebar] meetings fetch failed:', error);
      Analytics.trackBackendConnection(false, error instanceof Error ? error.message : 'Unknown error');

      // Schedule one retry for the cold-start race (backend not ready yet,
      // refresh token still being exchanged, etc.). Cancel any existing
      // pending retry so we don't double-fire.
      if (!retryScheduledRef.current) {
        retryScheduledRef.current = true;
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          // Re-enter through fetchMeetings — it re-reads authStatus from
          // closure. If auth flipped to unauthenticated in the meantime the
          // guard at the top will skip.
          void fetchMeetings();
        }, 1500);
      }
    }
  }, [authStatus]);

  // Fire when auth flips to 'authenticated' — both cold-start restore and
  // a fresh login go through this transition. The retry inside fetchMeetings
  // covers the case where the very first attempt races with token refresh.
  useEffect(() => {
    if (authStatus === 'authenticated') {
      void fetchMeetings();
    } else if (authStatus === 'unauthenticated') {
      // Logged out — cancel any pending retry and leave the meetings list
      // as it is (the next authenticated login will refresh it).
      retryScheduledRef.current = false;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    }
  }, [authStatus, fetchMeetings]);

  // Cleanup any pending retry on unmount.
  useEffect(() => {
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const fetchSettings = async () => {
      setServerAddress('http://localhost:5001');
      setTranscriptServerAddress('http://127.0.0.1:8178/stream');
    };
    fetchSettings();
  }, []);

  const baseItems: SidebarItem[] = [
    {
      id: 'meetings',
      title: 'Meetings',
      type: 'folder' as const,
      children: [
        ...meetings.map(meeting => ({ id: meeting.id, title: meeting.title, type: 'file' as const }))
      ]
    },
  ];


  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  // Update current meeting when on home page
  useEffect(() => {
    if (pathname === '/') {
      setCurrentMeeting({ id: 'intro-call', title: '+ New Call' });
    }
    setSidebarItems(baseItems);
  }, [pathname]);

  // Update sidebar items when meetings change
  useEffect(() => {
    setSidebarItems(baseItems);
  }, [meetings]);

  // Function to handle recording toggle from sidebar
  const handleRecordingToggle = () => {
    if (!isRecording) {
      // Check if already on home page
      if (pathname === '/') {
        // Already on home - trigger recording directly via custom event
        console.log('Triggering recording from sidebar (already on home page)');
        window.dispatchEvent(new CustomEvent('start-recording-from-sidebar'));
      } else {
        // Not on home - navigate and use auto-start mechanism
        console.log('Navigating to home page with auto-start flag');
        sessionStorage.setItem('autoStartRecording', 'true');
        router.push('/');
      }

      // Track recording initiation from sidebar
      Analytics.trackButtonClick('start_recording', 'sidebar');
    }
    // The actual recording start/stop is handled in the Home component
  };

  // Function to search through meeting transcripts
  const searchTranscripts = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    try {
      setIsSearching(true);

      const results = await authedApiCall<TranscriptSearchResult[]>(
        'GET',
        `/api/v1/search?q=${encodeURIComponent(query.trim())}`,
      );
      setSearchResults(results);
    } catch (error) {
      console.error('Error searching transcripts:', error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  // Summary polling management
  const startSummaryPolling = React.useCallback((
    meetingId: string,
    processId: string,
    onUpdate: (result: any) => void
  ) => {
    // Stop existing poll for this meeting if any
    if (activeSummaryPolls.has(meetingId)) {
      clearInterval(activeSummaryPolls.get(meetingId)!);
    }

    console.log(`📊 Starting polling for meeting ${meetingId}, process ${processId}`);

    let pollCount = 0;
    const MAX_POLLS = 200; // ~16.5 minutes at 5-second intervals (slightly longer than backend's 15-min timeout to avoid race conditions)

    const pollInterval = setInterval(async () => {
      pollCount++;

      // Timeout safety: Stop after 10 minutes
      if (pollCount >= MAX_POLLS) {
        console.warn(`⏱️ Polling timeout for ${meetingId} after ${MAX_POLLS} iterations`);
        clearInterval(pollInterval);
        setActiveSummaryPolls(prev => {
          const next = new Map(prev);
          next.delete(meetingId);
          return next;
        });
        onUpdate({
          status: 'error',
          error: 'Summary generation timed out after 15 minutes. Please try again or check your model configuration.'
        });
        return;
      }
      try {
        const result = await authedApiCall<{ status: string; data?: any; error?: string }>(
          'GET',
          `/api/v1/meetings/${meetingId}/summary`,
        );

        console.log(`📊 Polling update for ${meetingId}:`, result.status);

        // Call the update callback with result
        onUpdate(result);

        // Stop polling if completed, error, failed, cancelled, or idle (after initial processing)
        if (result.status === 'completed' || result.status === 'error' || result.status === 'failed' || result.status === 'cancelled') {
          console.log(`Polling completed for ${meetingId}, status: ${result.status}`);
          clearInterval(pollInterval);
          setActiveSummaryPolls(prev => {
            const next = new Map(prev);
            next.delete(meetingId);
            return next;
          });
        } else if (result.status === 'idle' && pollCount > 1) {
          // If we get 'idle' after polling started, process completed/disappeared
          console.log(`Process completed or not found for ${meetingId}, stopping poll`);
          clearInterval(pollInterval);
          setActiveSummaryPolls(prev => {
            const next = new Map(prev);
            next.delete(meetingId);
            return next;
          });
        }
      } catch (error) {
        console.error(`Polling error for ${meetingId}:`, error);
        // Report error to callback
        onUpdate({
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        clearInterval(pollInterval);
        setActiveSummaryPolls(prev => {
          const next = new Map(prev);
          next.delete(meetingId);
          return next;
        });
      }
    }, 5000); // Poll every 5 seconds

    setActiveSummaryPolls(prev => new Map(prev).set(meetingId, pollInterval));
  }, [activeSummaryPolls]);

  const stopSummaryPolling = React.useCallback((meetingId: string) => {
    const pollInterval = activeSummaryPolls.get(meetingId);
    if (pollInterval) {
      console.log(`⏹️ Stopping polling for meeting ${meetingId}`);
      clearInterval(pollInterval);
      setActiveSummaryPolls(prev => {
        const next = new Map(prev);
        next.delete(meetingId);
        return next;
      });
    }
  }, [activeSummaryPolls]);

  // Cleanup all polling intervals on unmount
  useEffect(() => {
    return () => {
      console.log('🧹 Cleaning up all summary polling intervals');
      activeSummaryPolls.forEach(interval => clearInterval(interval));
    };
  }, [activeSummaryPolls]);



  return (
    <SidebarContext.Provider value={{
      currentMeeting,
      setCurrentMeeting,
      sidebarItems,
      isCollapsed,
      toggleCollapse,
      meetings,
      setMeetings,
      isMeetingActive,
      setIsMeetingActive,
      handleRecordingToggle,
      searchTranscripts,
      searchResults,
      isSearching,
      setServerAddress,
      serverAddress,
      transcriptServerAddress,
      setTranscriptServerAddress,
      activeSummaryPolls,
      startSummaryPolling,
      stopSummaryPolling,
      refetchMeetings: fetchMeetings,

    }}>
      {children}
    </SidebarContext.Provider>
  );
}
