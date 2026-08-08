'use client';

// IdleMainPage - the workspace shown on the home page when no recording
// is active.
//
// A native-app command surface, not a dashboard: the primary action is a
// centered centerpiece, and the workspace beneath it is dense, hairline-
// separated lists sitting directly on the canvas (no floating cards).
// Layout (top → bottom):
//   1. Start centerpiece - orb + headline + unmissable CTA
//   2. Recent meetings - dense rows with real metadata
//   3. Knowledge bank - document rows with health + chunk metadata
//
// All colors from the Opaline token system (theme-aware light/dark).

import React, { useMemo } from 'react';
import { Mic, ArrowRight, FileText, History, Sparkles, FolderOpen } from 'lucide-react';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { useRouter } from 'next/navigation';
import { meetingDisplayTitle } from '@/lib/meetingTitle';
import { motion, useReducedMotion } from 'framer-motion';
import { fadeUp, motionProps } from '@/lib/motion';

interface IdleMainPageProps {
  onStartRecording: () => void;
  knowledgeDocs: KnowledgeDoc[];
  knowledgeLoading: boolean;
}

interface KnowledgeDoc {
  id: string;
  fileName: string;
  processingStatus: string;
  enrichmentStatus: string | null;
  chunkCount: number;
  createdAt: string;
  mode?: 'fast' | 'structured';
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function formatMeetingTimestamp(iso: string | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  if (sameDay) {
    return `Today ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  const yesterday = new Date(today.getTime() - 86_400_000);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();
  if (isYesterday) {
    return `Yesterday ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatDocTimestamp(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/**
 * Maps a doc's processing/enrichment status to a health chip. Uses the
 * same vocabulary as the Knowledge tab: 'Indexed' = done, 'Error:*' =
 * failed, 'No extractable text found' = warned; structured docs only
 * read as Ready once enrichment has settled ('enriched'/'enrichment_failed'
 * or a legacy doc that never started enrichment).
 */
function docStatus(
  doc: KnowledgeDoc,
): { label: string; tone: 'success' | 'info' | 'danger' | 'warning' } {
  const p = String(doc.processingStatus || '');
  const e = String(doc.enrichmentStatus || '');
  const indexed = p === 'Indexed';
  const failed = p.startsWith('Error:');

  if (failed) return { label: 'Failed', tone: 'danger' };
  if (p === 'No extractable text found') return { label: 'No text found', tone: 'warning' };
  if (!indexed) return { label: 'Indexing…', tone: 'info' };

  // Indexed - check the enrichment pass for structured docs.
  if (doc.mode === 'structured') {
    if (e === 'enrichment_failed') return { label: 'Enrichment failed', tone: 'danger' };
    if (e && e !== 'enriched') return { label: 'Enriching…', tone: 'info' };
  }
  return { label: 'Ready', tone: 'success' };
}

// ──────────────────────────────────────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────────────────────────────────────

export const IdleMainPage: React.FC<IdleMainPageProps> = ({
  onStartRecording,
  knowledgeDocs,
  knowledgeLoading,
}) => {
  const router = useRouter();
  const { meetings } = useSidebar();
  const reduceMotion = useReducedMotion();

  const recentMeetings = useMemo(() => meetings.slice(0, 5), [meetings]);
  const recentDocs = useMemo(() => knowledgeDocs.slice(0, 5), [knowledgeDocs]);

  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
      <div className="mx-auto max-w-2xl px-8 pb-10 pt-4">
        {/* ── 1. Start centerpiece ────────────────────────────────────── */}
        <motion.section
          className="flex flex-col items-center pb-10 pt-10 text-center"
          variants={motionProps(0.08).variants}
          initial="initial"
          animate="animate"
        >
          <motion.div variants={reduceMotion ? fadeUp : undefined} className="relative mb-7">
            <span
              aria-hidden
              className="orb-ring absolute inset-0 rounded-full"
              style={{ border: '2px solid var(--opaline-primary)', opacity: 0.4 }}
            />
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--opaline-primary)] text-primary-foreground shadow-lg">
              <Mic className="h-6 w-6" strokeWidth={1.75} />
            </div>
          </motion.div>

          <motion.p variants={fadeUp} className="text-overline mb-3">
            Ready when you are
          </motion.p>
          <motion.h2
            variants={fadeUp}
            className="font-display text-headline-lg text-[var(--opaline-on-surface)]"
          >
            Start a call
          </motion.h2>
          <motion.p
            variants={fadeUp}
            className="mt-2.5 max-w-sm text-body-sm leading-relaxed text-[var(--opaline-on-surface-variant)]"
          >
            Transcription runs locally. Competitors, objections, pricing, and
            product mentions surface in the intelligence rail as they&apos;re
            spoken.
          </motion.p>

          <motion.div variants={fadeUp} className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={onStartRecording}
              className="group inline-flex h-11 items-center gap-2.5 rounded-lg bg-[var(--opaline-primary)] px-7 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-fast ease-out hover:bg-[var(--opaline-primary-hover)] hover:shadow-md active:bg-[var(--opaline-primary-pressed)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--opaline-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <Mic className="h-4 w-4" strokeWidth={1.75} />
              <span>Start a call</span>
            </button>
            <button
              type="button"
              onClick={() => router.push('/meeting-details')}
              className="inline-flex h-11 items-center gap-2 rounded-lg px-4 text-sm font-medium text-[var(--opaline-on-surface-variant)] transition-colors duration-fast hover:bg-[var(--opaline-surface-container-low)] hover:text-[var(--opaline-on-surface)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--opaline-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <History className="h-4 w-4" strokeWidth={1.75} />
              Browse meetings
            </button>
          </motion.div>

          <motion.div variants={fadeUp} className="mt-5 flex items-center gap-2 text-caption">
            <kbd className="kbd">⌘ R</kbd>
            <span className="text-[var(--opaline-outline)]">starts from anywhere</span>
          </motion.div>
        </motion.section>

        {/* ── 2. Recent meetings ──────────────────────────────────────── */}
        <section className="border-t border-[var(--opaline-outline-variant)] pt-5">
          <div className="mb-1.5 flex items-center justify-between">
            <h2 className="text-overline">Recent meetings</h2>
            <button
              type="button"
              onClick={() => router.push('/meeting-details')}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--opaline-on-surface-variant)] transition-colors hover:text-[var(--opaline-on-surface)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--opaline-primary)]"
            >
              View all
              <ArrowRight className="h-3 w-3" strokeWidth={1.75} />
            </button>
          </div>

          {recentMeetings.length === 0 ? (
            <div className="flex flex-col items-start gap-1.5 py-4">
              <p className="text-body-sm text-[var(--opaline-on-surface-variant)]">
                No meetings yet.
              </p>
              <p className="text-caption">
                Recordings you make will show up here with their transcripts
                and intelligence.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--opaline-outline-variant)]">
              {recentMeetings.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => router.push(`/meeting-details?id=${encodeURIComponent(m.id)}`)}
                    className="group flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors duration-fast hover:bg-[var(--opaline-surface-container-low)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--opaline-primary)]"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--opaline-surface-container-low)] text-[var(--opaline-on-surface-variant)] transition-colors duration-fast group-hover:bg-[var(--opaline-primary-soft)] group-hover:text-[var(--opaline-primary)]">
                      <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className="block truncate text-body-md font-medium text-[var(--opaline-on-surface)]"
                        title={m.title && m.title !== 'Untitled session' ? m.title : undefined}
                      >
                        {meetingDisplayTitle(m)}
                      </span>
                      <span className="block text-data text-[var(--opaline-outline)]">
                        {formatMeetingTimestamp(m.createdAt)}
                      </span>
                    </span>
                    <ArrowRight
                      className="h-3.5 w-3.5 shrink-0 text-[var(--opaline-outline-variant)] transition-all duration-fast group-hover:translate-x-0.5 group-hover:text-[var(--opaline-on-surface-variant)]"
                      strokeWidth={1.75}
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── 3. Knowledge bank ───────────────────────────────────────── */}
        <section className="border-t border-[var(--opaline-outline-variant)] pt-5">
          <div className="mb-1.5 flex items-center justify-between">
            <h2 className="text-overline">Knowledge bank</h2>
            <button
              type="button"
              onClick={() => router.push('/settings')}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--opaline-on-surface-variant)] transition-colors hover:text-[var(--opaline-on-surface)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--opaline-primary)]"
            >
              Manage
              <ArrowRight className="h-3 w-3" strokeWidth={1.75} />
            </button>
          </div>

          {knowledgeLoading ? (
            <div className="flex flex-col gap-2 py-3">
              <div className="animate-shimmer h-9 rounded-lg" />
              <div className="animate-shimmer h-9 rounded-lg" />
            </div>
          ) : recentDocs.length === 0 ? (
            <div className="flex flex-col items-start gap-1.5 py-4">
              <p className="text-body-sm text-[var(--opaline-on-surface-variant)]">
                No documents yet.
              </p>
              <p className="text-caption">
                Upload pricing sheets, product docs, and playbooks — they power
                product matching and recommendations.
              </p>
              <button
                type="button"
                onClick={() => router.push('/settings')}
                className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] px-3 py-1.5 text-[13px] font-medium text-[var(--opaline-on-surface)] transition-colors duration-fast hover:bg-[var(--opaline-surface-container-low)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--opaline-primary)]"
              >
                <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.75} />
                Upload a document
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--opaline-outline-variant)]">
              {recentDocs.map((d) => {
                const status = docStatus(d);
                return (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => router.push('/settings')}
                      className="group flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors duration-fast hover:bg-[var(--opaline-surface-container-low)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--opaline-primary)]"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--opaline-surface-container-low)] text-[var(--opaline-on-surface-variant)] transition-colors duration-fast group-hover:bg-[var(--opaline-primary-soft)] group-hover:text-[var(--opaline-primary)]">
                        <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body-md font-medium text-[var(--opaline-on-surface)]">
                          {d.fileName}
                        </span>
                        <span className="block text-data text-[var(--opaline-outline)]">
                          {formatDocTimestamp(d.createdAt)}
                          {d.chunkCount > 0 ? ` · ${d.chunkCount} chunks` : ''}
                          {d.mode ? ` · ${d.mode}` : ''}
                        </span>
                      </span>
                      <span
                        className={`chip ${
                          status.tone === 'success'
                            ? 'chip-success'
                            : status.tone === 'info'
                              ? 'chip-info'
                              : status.tone === 'danger'
                                ? 'chip-danger'
                                : 'chip-warning'
                        }`}
                      >
                        {status.label}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Quiet footer hint - only when there is nothing to show yet */}
        {recentMeetings.length === 0 && recentDocs.length === 0 && (
          <div className="mt-6 flex items-center justify-center gap-1.5 text-caption">
            <Sparkles className="h-3.5 w-3.5 text-[var(--opaline-outline)]" strokeWidth={1.75} />
            <span className="text-[var(--opaline-outline)]">
              Everything you need is a call away
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
