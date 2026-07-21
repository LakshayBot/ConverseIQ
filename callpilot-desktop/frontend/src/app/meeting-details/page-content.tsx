'use client';

// Minimal page-content for CallPilot meeting-details.
//
// Meetily's original rendered a full summary panel here with BlockNote, custom
// prompts, and provider pickers. CallPilot's summary flow is server-side via
// the .NET Gateway and is surfaced through the Intelligence Panel on the home
// page (see `useIntelligenceStream`). This view therefore keeps just the
// transcript and the title/folder actions that the live view needs.

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LoaderIcon } from 'lucide-react';
import { TranscriptPanel } from '@/app/_components/TranscriptPanel';
import Analytics from '@/lib/analytics';

interface PageContentProps {
  meeting: any;
  segments?: any[];
  totalCount?: number;
  loadedCount?: number;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  onMeetingUpdated?: () => void;
  onRefetchTranscripts?: () => void;
  summaryData?: any;
  shouldAutoGenerate?: boolean;
  onAutoGenerateComplete?: () => void;
  [key: string]: any;
}

const PageContent: React.FC<PageContentProps> = ({ meeting, segments }) => {
  const router = useRouter();
  const segmentCount = segments?.length ?? 0;

  useEffect(() => {
    Analytics.trackPageView('meeting_details');
  }, []);

  if (!meeting) {
    return (
      <div className="flex items-center justify-center h-screen">
        <LoaderIcon className="animate-spin size-6" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white">
        <div>
          <button
            type="button"
            onClick={() => router.push('/')}
            className="text-xs text-blue-600 hover:underline"
          >
            ← Back to live
          </button>
          <h1 className="mt-1 text-lg font-semibold text-gray-900">{meeting.title || 'Untitled session'}</h1>
        </div>
        <div className="text-xs text-gray-500">
          {segmentCount} segment{segmentCount === 1 ? '' : 's'}
        </div>
      </header>
      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto bg-white border border-gray-200 rounded-md p-4">
          <TranscriptPanel
            isProcessingStop={false}
            isStopping={false}
            showModal={() => {}}
          />
        </div>
      </main>
    </div>
  );
};

export default PageContent;
