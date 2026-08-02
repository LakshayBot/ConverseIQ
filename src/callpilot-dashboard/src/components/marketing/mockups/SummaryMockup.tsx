// SummaryMockup — static recreation of the meeting Summary / Transcript
// view: summary sections, action items, and a searchable transcript list.

import { Search, CheckSquare } from "lucide-react";

const SUMMARY_SECTIONS = [
  { title: "Overview", body: "Pricing review for a smart-metering rollout; prospect evaluating Apex 100 and Prodigy against an existing SCADA environment." },
  { title: "Key decisions", body: "Prospect wants OTA firmware updates and REST API access before a pilot." },
];

const ACTION_ITEMS = [
  "Send pricing sheet for 500-endpoint gateway tier",
  "Share SCADA integration docs with the prospect",
];

const TRANSCRIPTS = [
  { ts: "12:24:31", speaker: "Rep", text: "We're evaluating the Apex 100 and Prodigy for our rollout." },
  { ts: "12:24:43", speaker: "Prospect", text: "Can both integrate with our existing SCADA environment?" },
  { ts: "12:24:56", speaker: "Rep", text: "Yes — REST API and OPC-UA adapters, plus OTA firmware updates." },
];

export function SummaryMockup() {
  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden p-4">
      <div className="rounded-2xl border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-semibold text-[15px] text-[var(--opaline-on-surface)]">
            Call — Fri, Jul 31, 12:24 AM
          </p>
          <span className="font-mono text-[11px] text-[var(--opaline-on-surface-variant)] tabular-nums">
            4 segments · 12 min
          </span>
        </div>

        <div className="mt-4 space-y-3">
          {SUMMARY_SECTIONS.map((s) => (
            <div key={s.title}>
              <p className="font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--opaline-primary)]">
                {s.title}
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-[var(--opaline-on-surface)]">
                {s.body}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-4 border-t border-[var(--opaline-outline-variant)] pt-3">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--opaline-primary)]">
            Action items
          </p>
          <ul className="mt-1.5 space-y-1">
            {ACTION_ITEMS.map((a) => (
              <li key={a} className="flex items-start gap-2 text-[13px] text-[var(--opaline-on-surface-variant)]">
                <CheckSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--opaline-primary)]" strokeWidth={2} />
                {a}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Searchable transcript */}
      <div className="rounded-2xl border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] p-4">
        <div className="flex items-center gap-2 rounded-lg border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-low)] px-3 py-2">
          <Search className="h-3.5 w-3.5 text-[var(--opaline-on-surface-variant)]" strokeWidth={2} />
          <span className="font-mono text-[12px] text-[var(--opaline-on-surface-variant)]">SCADA</span>
          <span className="ml-auto rounded-full bg-[var(--opaline-primary)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--opaline-on-primary)] tabular-nums">
            1 match
          </span>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          {TRANSCRIPTS.map((t, i) => (
            <div key={i} className="flex items-start gap-2 text-[13px]">
              <span className="font-mono text-[11px] text-[var(--opaline-on-surface-variant)] tabular-nums">{t.ts}</span>
              <span className="w-14 shrink-0 font-mono text-[10px] font-medium uppercase tracking-wide text-[var(--opaline-on-surface-variant)]">
                {t.speaker}
              </span>
              <span className={i === 1 ? "rounded bg-[var(--opaline-primary)]/10 px-1 text-[var(--opaline-on-surface)]" : "text-[var(--opaline-on-surface-variant)]"}>
                {t.text}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
