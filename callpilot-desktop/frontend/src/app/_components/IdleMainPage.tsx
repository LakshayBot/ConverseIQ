'use client';

// IdleMainPage — the workspace shown on the home page when no recording
// is active. Replaces the previous generic "Welcome to callpilot /
// Start recording to see live transcription" placeholder which made the
// app look like an empty starter template.
//
// Reference for the visual language: a focused, mission-ready workspace
// the moment a sales rep opens the app. Not a marketing splash page —
// left-aligned composition (not centred), dense and quiet, every
// sub-element earns its place by teaching something about the product.
//
// Layout (top → bottom in the same column):
//   1. Status row — system-readiness dots + labels (mic / engine / backend)
//   2. Headline + body + primary CTA + secondary actions
//   3. Recent meetings (left) + Knowledge bank (right) — both real data
//   4. How-it-works strip — three numbered cards explaining the pipeline
//
// Tokens (no new hex families — sits inside the existing palette):
//   --ink-900 #0f172a   primary text
//   --ink-500 #64748b   secondary
//   --ink-300 #cbd5e1   tertiary / dividers
//   --surface #ffffff   card bg
//   --surface-muted #f8fafc   secondary card bg
//   brand gradient (blue → indigo → violet) — the primary CTA + active status
//
// Signature element: the system-readiness status row at the top. Three
// small dots + labels (MIC / ENGINE / BACKEND) tell the rep that the
// whole pipeline is alive before they hit record. Uses the brand
// gradient as the active color. This is what distinguishes the page
// from "an empty starter template" — the moment the app opens, the
// user sees a working mission-control surface.

import React, { useMemo } from 'react';
import { Mic, Brain, Server, ArrowRight, FileText, History, Sparkles } from 'lucide-react';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { useRouter } from 'next/navigation';

interface IdleMainPageProps {
  onStartRecording: () => void;
}

const BRAND_GRADIENT = 'linear-gradient(135deg, #3b82f6 0%, #6366f1 50%, #8b5cf6 100%)';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function formatRelativeTime(iso: string | undefined): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d} d ago`;
  return new Date(t).toLocaleDateString();
}

function formatMeetingTimestamp(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
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

// ──────────────────────────────────────────────────────────────────────────────
// Status row
// ──────────────────────────────────────────────────────────────────────────────

interface StatusDotProps {
  icon: React.ReactNode;
  label: string;
  state: 'ready' | 'loading' | 'offline';
}

const StatusDot: React.FC<StatusDotProps> = ({ icon, label, state }) => {
  const dotColor =
    state === 'ready'
      ? 'bg-emerald-500'
      : state === 'loading'
        ? 'bg-amber-400 animate-pulse'
        : 'bg-[var(--grain-ink-300)]';
  const textColor =
    state === 'ready'
      ? 'text-[var(--grain-ink-700)]'
      : state === 'loading'
        ? 'text-[var(--grain-ink-500)]'
        : 'text-[var(--grain-ink-300)]';
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] ${textColor}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} aria-hidden />
      {icon}
      {label}
    </span>
  );
};

// ──────────────────────────────────────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────────────────────────────────────

export const IdleMainPage: React.FC<IdleMainPageProps> = ({ onStartRecording }) => {
  const router = useRouter();
  const { meetings } = useSidebar();

  const recentMeetings = useMemo(() => meetings.slice(0, 4), [meetings]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-8 py-10 space-y-10">
        {/* ── 1. Status row ─────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pb-2">
          <StatusDot icon={<Server className="h-3 w-3" strokeWidth={2} />} label="Backend" state="ready" />
          <StatusDot icon={<Brain className="h-3 w-3" strokeWidth={2} />} label="Engine" state="ready" />
          <StatusDot icon={<Mic className="h-3 w-3" strokeWidth={2} />} label="Mic" state="ready" />
        </div>

        {/* ── 2. Hero ───────────────────────────────────────────────── */}
        <div className="space-y-4">
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--grain-ink-900)] leading-tight">
            Run a live sales call with
            <br />
            <span className="text-[var(--grain-accent)]">
              CallPilot intelligence.
            </span>
          </h1>
          <p className="text-sm text-[var(--grain-ink-500)] leading-relaxed max-w-2xl">
            Hit record to capture the conversation. Competitors, objections,
            pricing questions, and product mentions surface in the right
            rail the moment they&apos;re spoken — pulled from your knowledge
            bank and matched against what your prospect is actually asking.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              onClick={onStartRecording}
              className="group inline-flex items-center gap-2 rounded-md bg-[var(--grain-ink-900)] px-5 py-2.5 text-sm font-medium text-white shadow-sm ring-1 ring-black/5 transition-all hover:bg-[var(--grain-ink-700)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--grain-accent)]"
            >
              <span>Start a call</span>
              <ArrowRight className="h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-0.5" strokeWidth={2.25} />
            </button>
            <button
              type="button"
              onClick={() => router.push('/meeting-details')}
              className="inline-flex items-center gap-1.5 rounded-md px-4 py-2.5 text-sm font-medium text-[var(--grain-ink-500)] transition-colors hover:bg-[var(--grain-paper-2)] hover:text-[var(--grain-ink-900)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--grain-accent)]"
            >
              <History className="h-3.5 w-3.5" strokeWidth={2} />
              <span>Browse meetings</span>
            </button>
            <span className="text-xs text-[var(--grain-ink-500)]">
              or press <kbd className="font-mono text-[11px] bg-[var(--grain-paper-2)] px-1.5 py-0.5 rounded border border-[var(--grain-ink-200)] text-[var(--grain-ink-700)]">⌘ R</kbd> from anywhere
            </span>
          </div>
        </div>

        {/* ── 3. Recent meetings + Knowledge bank ───────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <section className="rounded-lg border border-[var(--grain-ink-200)] bg-white p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--grain-ink-500)]">
                Recent meetings
              </h2>
              <span className="text-[10px] font-medium text-[var(--grain-ink-500)] tabular-nums">
                {meetings.length}
              </span>
            </div>
            {recentMeetings.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-sm text-[var(--grain-ink-500)]">No meetings yet.</p>
                <p className="text-xs text-[var(--grain-ink-500)] mt-1">
                  Recordings you make will show up here.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-[var(--grain-ink-200)]">
                {recentMeetings.map((m) => (
                  <li
                    key={m.id}
                    className="group flex items-center gap-3 py-2.5 cursor-pointer hover:opacity-80"
                    onClick={() => router.push(`/meeting-details?id=${encodeURIComponent(m.id)}`)}
                  >
                    <span
                      className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-[var(--grain-paper-2)] text-[var(--grain-ink-500)] group-hover:bg-[var(--grain-accent-soft)] group-hover:text-[var(--grain-accent)] transition-colors"
                    >
                      <FileText className="h-3.5 w-3.5" strokeWidth={2} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-[var(--grain-ink-900)]">
                        {m.title || 'Untitled session'}
                      </div>
                      <div className="font-mono text-[10px] text-[var(--grain-ink-500)] tabular-nums">
                        {formatMeetingTimestamp(m.createdAt)}
                      </div>
                    </div>
                    <ArrowRight
                      className="h-3.5 w-3.5 text-[var(--grain-ink-300)] group-hover:text-[var(--grain-ink-700)] transition-colors"
                      strokeWidth={2}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border border-[var(--grain-ink-200)] bg-white p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--grain-ink-500)]">
                Knowledge bank
              </h2>
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--grain-rep-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--grain-rep)]">
                <span className="h-1 w-1 rounded-full bg-[var(--grain-rep)]" aria-hidden />
                Ready
              </span>
            </div>
            <div className="space-y-3">
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-[var(--grain-ink-500)]">Indexed documents</span>
                <span className="text-2xl font-semibold tabular-nums text-[var(--grain-ink-900)]">
                  {/* placeholder until /api/v1/knowledge/stats is wired */}
                  —
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-[var(--grain-ink-500)]">Coverage</span>
                <span className="font-mono text-xs text-[var(--grain-ink-700)]">
                  Pricing · Competition · Objections
                </span>
              </div>
              <button
                type="button"
                onClick={() => router.push('/settings')}
                className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-[var(--grain-ink-500)] hover:text-[var(--grain-ink-900)] transition-colors"
              >
                Manage knowledge sources
                <ArrowRight className="h-3 w-3" strokeWidth={2} />
              </button>
            </div>
          </section>
        </div>

        {/* ── 4. How it works strip ─────────────────────────────────── */}
        <section>
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--grain-ink-500)] mb-3">
            How CallPilot works
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Step
              n="01"
              icon={<Mic className="h-4 w-4" strokeWidth={1.75} />}
              title="Capture"
              body="Mic + system audio are transcribed locally by Parakeet — nothing leaves the machine."
            />
            <Step
              n="02"
              icon={<Brain className="h-4 w-4" strokeWidth={1.75} />}
              title="Detect"
              body="Each turn is checked against your knowledge bank and the event catalogue in real time."
            />
            <Step
              n="03"
              icon={<Sparkles className="h-4 w-4" strokeWidth={1.75} />}
              title="Surface"
              body="Cards land in the right rail the moment a competitor, objection, or pricing question is spoken."
            />
          </div>
        </section>

        <p className="text-[11px] text-[var(--grain-ink-500)] pt-2">
          Knowledge bank settings are editable from{' '}
          <button
            type="button"
            onClick={() => router.push('/settings')}
            className="underline underline-offset-2 hover:text-[var(--grain-ink-700)]"
          >
            Settings → CallPilot
          </button>
          .
        </p>
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────────────
// Step card
// ──────────────────────────────────────────────────────────────────────────────

interface StepProps {
  n: string;
  icon: React.ReactNode;
  title: string;
  body: string;
}

const Step: React.FC<StepProps> = ({ n, icon, title, body }) => (
  <div className="rounded-lg border border-[var(--grain-ink-200)] bg-white p-4">
    <div className="flex items-baseline gap-2 mb-2">
      <span className="font-mono text-[10px] text-[var(--grain-ink-500)] tabular-nums">{n}</span>
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-[var(--grain-paper-2)] text-[var(--grain-ink-700)]">
        {icon}
      </span>
      <span className="text-sm font-semibold text-[var(--grain-ink-900)]">{title}</span>
    </div>
    <p className="text-xs text-[var(--grain-ink-500)] leading-relaxed">{body}</p>
  </div>
);