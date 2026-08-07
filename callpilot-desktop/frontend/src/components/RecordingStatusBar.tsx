'use client';

import { motion } from 'framer-motion';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { useEffect, useState } from 'react';

interface RecordingStatusBarProps {
  isPaused?: boolean;
}

export const RecordingStatusBar: React.FC<RecordingStatusBarProps> = ({ isPaused = false }) => {
  // Get recording duration from backend-synced context (in seconds)
  // Backend polls every 500ms, providing smooth updates
  const { activeDuration, isRecording, status } = useRecordingState();

  // Defensive: never render during a clean idle state. The parent
  // (VirtualizedTranscriptView) gates this on the same condition, but a
  // stray re-render or stale context value would otherwise show
  // "Recording • 0:00" on every page load.
  const sessionActive =
    isRecording ||
    isPaused ||
    status === 'processing' ||
    status === 'saving' ||
    status === 'stopping';
  if (!sessionActive) return null;

  // Display state synced from backend
  const [displaySeconds, setDisplaySeconds] = useState(0);

  // Sync with backend duration when it changes (handles refresh/navigation)
  useEffect(() => {
    if (activeDuration !== null) {
      // Round to nearest second to avoid decimal issues
      setDisplaySeconds(Math.floor(activeDuration));
    }
  }, [activeDuration]);

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
      className="flex items-center gap-2.5 rounded-full border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] px-3.5 py-1.5 shadow-xs mb-2"
    >
      <div
        className={`h-2 w-2 rounded-full ${isPaused ? 'bg-warning' : 'bg-danger animate-pulse'}`}
        aria-hidden
      />
      <span className={`text-[13px] font-medium ${isPaused ? 'text-warning' : 'text-[var(--opaline-on-surface)]'}`}>
        {isPaused ? 'Paused' : 'Recording'}
      </span>
      <span className="text-data text-[var(--opaline-outline)] tabular-nums">
        {formatDuration(displaySeconds)}
      </span>
    </motion.div>
  );
};
