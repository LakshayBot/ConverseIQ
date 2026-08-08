// transcriptEntities.ts - maps detected product entities to their
// transcript occurrences. Pure and dependency-free so it is unit-testable
// and reusable for future entity categories (contextual, objections,
// pricing, technical, competitors) without touching the transcript
// renderer.
//
// The product ENTITY (from the Intelligence rail) is the source of truth:
// occurrences are located by word-boundary matching of the entity name
// inside the RENDERED display text (after the transcript's filler
// cleanup), so offsets always align with what the user sees. Matching is
// precomputed per segments/products change - never per render.

import type { TranscriptSegmentData } from '@/types';

export interface TranscriptEntityOccurrence {
  /** The rail's shared entity id - the display name of the entity. */
  entityId: string;
  entityName: string;
  segmentId: string;
  segmentIndex: number;
  /** audio_start_time of the segment (seconds). */
  timestamp: number;
  startOffset: number;
  endOffset: number;
}

export interface TranscriptEntityMap {
  occurrences: TranscriptEntityOccurrence[];
  bySegmentId: Map<string, TranscriptEntityOccurrence[]>;
  byEntityName: Map<string, TranscriptEntityOccurrence[]>;
  /** Most relevant occurrence per entity: latest timestamp, ties broken
   *  by segment order. */
  latestByEntityName: Map<string, TranscriptEntityOccurrence>;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildTranscriptEntityMap(
  segments: TranscriptSegmentData[],
  entityNames: string[],
  displayTextOf: (segment: TranscriptSegmentData) => string,
): TranscriptEntityMap {
  const occurrences: TranscriptEntityOccurrence[] = [];
  const bySegmentId = new Map<string, TranscriptEntityOccurrence[]>();
  const byEntityName = new Map<string, TranscriptEntityOccurrence[]>();
  const latestByEntityName = new Map<string, TranscriptEntityOccurrence>();

  for (const name of entityNames) {
    byEntityName.set(name, []);
  }

  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si];
    const display = displayTextOf(seg);
    if (!display) continue;
    const segOcc: TranscriptEntityOccurrence[] = [];

    for (const name of entityNames) {
      if (!name) continue;
      // Word-boundary match: not preceded/followed by a word character, so
      // "Prodigy" matches inside "the Prodigy meter" but "apex" never
      // matches "apexpredator". Case-insensitive; the original casing is
      // preserved for rendering.
      const re = new RegExp(`(^|[^A-Za-z0-9])(${escapeRegExp(name)})(?![A-Za-z0-9])`, 'gi');
      let m: RegExpExecArray | null;
      while ((m = re.exec(display)) !== null) {
        const start = m.index + m[1].length;
        const occ: TranscriptEntityOccurrence = {
          entityId: name,
          entityName: name,
          segmentId: seg.id,
          segmentIndex: si,
          timestamp: seg.timestamp ?? 0,
          startOffset: start,
          endOffset: start + m[2].length,
        };
        occurrences.push(occ);
        segOcc.push(occ);
        const byName = byEntityName.get(name) ?? [];
        byName.push(occ);
        byEntityName.set(name, byName);

        const latest = latestByEntityName.get(name);
        if (
          !latest ||
          occ.timestamp > latest.timestamp ||
          (occ.timestamp === latest.timestamp && occ.segmentIndex > latest.segmentIndex)
        ) {
          latestByEntityName.set(name, occ);
        }

        // Resume after the matched name so multi-word names don't match
        // their own tail.
        re.lastIndex = start + m[2].length;
      }
    }

    if (segOcc.length > 0) bySegmentId.set(seg.id, segOcc);
  }

  return { occurrences, bySegmentId, byEntityName, latestByEntityName };
}

/** Render parts: plain text alternating with entity spans. Offsets are
 *  guaranteed to be inside `text` because they were computed on it. */
export interface TextPart {
  text: string;
  occurrence?: TranscriptEntityOccurrence;
}

export function splitTextByOccurrences(
  text: string,
  occurrences: TranscriptEntityOccurrence[] | undefined,
): TextPart[] {
  if (!occurrences || occurrences.length === 0) return [{ text }];
  const parts: TextPart[] = [];
  const sorted = [...occurrences].sort((a, b) => a.startOffset - b.startOffset);
  let cursor = 0;
  for (const occ of sorted) {
    if (occ.startOffset < cursor) continue; // overlapping spans - keep the first
    if (occ.startOffset > cursor) {
      parts.push({ text: text.slice(cursor, occ.startOffset) });
    }
    parts.push({ text: text.slice(occ.startOffset, occ.endOffset), occurrence: occ });
    cursor = occ.endOffset;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts;
}
