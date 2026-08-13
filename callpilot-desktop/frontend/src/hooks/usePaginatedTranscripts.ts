import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { authedApiCall } from "@/lib/auth";
import { Transcript, MeetingMetadata, PaginatedTranscriptsResponse, TranscriptSegmentData } from "@/types";

const DEFAULT_PAGE_SIZE = 100;

interface UsePaginatedTranscriptsProps {
    meetingId: string | null;
    /** Optional initial timestamp (in seconds) from URL for loading the correct page */
    initialTimestamp?: number;
}

interface UsePaginatedTranscriptsReturn {
    metadata: MeetingMetadata | null;
    segments: TranscriptSegmentData[];
    transcripts: Transcript[];
    isLoading: boolean;
    isLoadingMore: boolean;
    hasMore: boolean;
    totalCount: number;
    loadedCount: number;
    error: string | null;

    // Actions
    loadMore: () => Promise<void>;
    reset: () => void;
    refetch: () => Promise<void>;
}

/**
 * Convert Transcript array to TranscriptSegmentData for virtualized display
 */
function convertTranscriptsToSegments(transcripts: Transcript[]): TranscriptSegmentData[] {
    return transcripts.map(t => ({
        id: t.id,
        timestamp: t.audio_start_time ?? 0,
        endTime: t.audio_end_time,
        text: t.text,
        confidence: t.confidence,
        speakerLabel: t.speaker,
    }));
}

export function usePaginatedTranscripts({
    meetingId,
    initialTimestamp,
}: UsePaginatedTranscriptsProps): UsePaginatedTranscriptsReturn {
    const [metadata, setMetadata] = useState<MeetingMetadata | null>(null);
    const [transcripts, setTranscripts] = useState<Transcript[]>([]);
    const [totalCount, setTotalCount] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const offsetRef = useRef(0);
    const loadedMeetingIdRef = useRef<string | null>(null);
    const isLoadingRef = useRef(false);
    const lastLoadTimeRef = useRef(0); // Debounce protection

    // Reset state when meeting changes
    const reset = useCallback(() => {
        setMetadata(null);
        setTranscripts([]);
        setTotalCount(0);
        setIsLoading(true);
        setIsLoadingMore(false);
        setHasMore(false);
        setError(null);
        offsetRef.current = 0;
    }, []);

    // Load meeting metadata via the .NET Gateway (replaces the old
    // Tauri `api_get_meeting_metadata` shortcut which read from local SQLite).
    const loadMetadata = useCallback(async (): Promise<MeetingMetadata | null> => {
        if (!meetingId) return null;

        try {
            const detail = await authedApiCall<{
                id: string;
                title: string | null;
                status: string;
                createdAt: string;
                startedAt: string | null;
                endedAt: string | null;
                folderPath: string | null;
                transcriptCount: number;
            }>('GET', `/api/v1/meetings/${meetingId}`);

            const meta: MeetingMetadata = {
                id: detail.id,
                title: detail.title ?? 'Untitled session',
                created_at: detail.createdAt,
                updated_at: detail.endedAt ?? detail.startedAt ?? detail.createdAt,
                folder_path: detail.folderPath ?? undefined,
            };
            setMetadata(meta);
            return meta;
        } catch (err) {
            console.error('Failed to load meeting metadata:', err);
            setError('Failed to load meeting details');
            return null;
        }
    }, [meetingId]);

    // Load transcripts at specific offset - fetches all segments in one shot
    // since the .NET endpoint is not paginated server-side. For typical
    // meeting sizes (<5k segments) this is fine; if a meeting ever exceeds
    // this, we can add a `?offset=&limit=` query string later.
    const loadTranscriptsAtOffset = useCallback(async (
        offset: number,
        append: boolean = true
    ): Promise<Transcript[]> => {
        if (!meetingId) return [];

        try {
            const rawSegments = await authedApiCall<Array<{
                id?: string;
                speaker: string;
                speakerId?: string | null;
                text: string;
                confidence: number;
                isFinal: boolean;
                sequence: number;
                createdAt: string;
                startOffset: number;
                endOffset: number;
            }>>('GET', `/api/v1/meetings/${meetingId}/transcripts`);

            // Map .NET TranscriptSegment -> local Transcript shape used by
            // the virtualised transcript view. The .NET response gives us
            // ordered sequence numbers, so we use them as ids and ordering.
            const newTranscripts: Transcript[] = rawSegments.map((s) => ({
                id: String(s.sequence),
                text: s.text,
                timestamp: s.createdAt,
                sequence_id: s.sequence,
                is_partial: !s.isFinal,
                confidence: s.confidence,
                audio_start_time: s.startOffset,
                audio_end_time: s.endOffset,
                duration: s.endOffset - s.startOffset,
                speaker: s.speaker,
                speakerId: s.speakerId ?? undefined,
            }));

            if (append) {
                setTranscripts(prev => {
                    const existingIds = new Set(prev.map(t => t.id));
                    const uniqueNew = newTranscripts.filter(t => !existingIds.has(t.id));
                    return [...prev, ...uniqueNew].sort((a, b) =>
                        (a.audio_start_time ?? 0) - (b.audio_start_time ?? 0)
                    );
                });
            } else {
                setTranscripts(newTranscripts);
            }

            // The .NET endpoint returns the full list - there's no server-side
            // pagination, so we mark has_more=false once we've loaded everything
            // and store the total count for the "Showing X of Y" footer.
            setHasMore(false);
            setTotalCount(rawSegments.length);
            offsetRef.current = offset + newTranscripts.length;

            return newTranscripts;
        } catch (err) {
            console.error('Failed to load transcripts:', err);
            setError('Failed to load transcripts');
            return [];
        }
    }, [meetingId]);

    // Load next page with debounce protection
    const loadMore = useCallback(async () => {
        const now = Date.now();
        if (now - lastLoadTimeRef.current < 100) {
            return;
        }
        if (isLoadingRef.current || !hasMore || !meetingId || isLoading) return;

        lastLoadTimeRef.current = now;
        isLoadingRef.current = true;
        setIsLoadingMore(true);
        try {
            await loadTranscriptsAtOffset(offsetRef.current, true);
        } finally {
            setIsLoadingMore(false);
            isLoadingRef.current = false;
        }
    }, [hasMore, meetingId, loadTranscriptsAtOffset, isLoading]);

    // Force refetch of data (e.g., after retranscription)
    const refetch = useCallback(async () => {
        if (!meetingId) return;

        reset();
        setIsLoading(true);
        try {
            await loadMetadata();
            await loadTranscriptsAtOffset(0, false);
        } finally {
            setIsLoading(false);
        }
    }, [meetingId, reset, loadMetadata, loadTranscriptsAtOffset]);

    // Initial load
    useEffect(() => {
        if (!meetingId) {
            reset();
            return;
        }

        if (loadedMeetingIdRef.current === meetingId) return;
        loadedMeetingIdRef.current = meetingId;

        reset();

        const loadInitial = async () => {
            setIsLoading(true);
            try {
                await loadMetadata();
                await loadTranscriptsAtOffset(0, false);
            } finally {
                setIsLoading(false);
            }
        };

        loadInitial();
    }, [meetingId, reset, loadMetadata, loadTranscriptsAtOffset]);

    const segments = useMemo(() =>
        convertTranscriptsToSegments(transcripts),
        [transcripts]
    );

    return {
        metadata,
        segments,
        transcripts,
        isLoading,
        isLoadingMore,
        hasMore,
        totalCount,
        loadedCount: transcripts.length,
        error,
        loadMore,
        reset,
        refetch,
    };
}
