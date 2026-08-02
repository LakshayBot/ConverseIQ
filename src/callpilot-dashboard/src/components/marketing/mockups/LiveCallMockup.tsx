// LiveCallMockup — a static recreation of the app's live call view
// (transcript + Intelligence rail), used inside the Safari frame in the
// Product section. Same markup as the real app: speaker dots, mono
// timestamps, Product Match cards with severity borders.

import { Package, HelpCircle } from "lucide-react";

const LINES = [
  { speaker: "rep", ts: "12:24:31", text: "We're evaluating the Apex 100 and Prodigy for our rollout." },
  { speaker: "prospect", ts: "12:24:43", text: "Can both integrate with our existing SCADA environment?" },
  { speaker: "rep", ts: "12:24:56", text: "Yes — REST API and OPC-UA adapters, plus OTA firmware updates." },
  { speaker: "prospect", ts: "12:25:07", text: "What does the pricing look like per gateway?" },
];

const CARDS = [
  { kind: "Product match", severity: "high", title: "Apex 100", body: "500+ endpoints per gateway · OTA firmware updates · API-based billing." },
  { kind: "Technical", severity: "medium", title: "SCADA integration", body: "REST API + OPC-UA gateway adapters." },
  { kind: "Product match", severity: "medium", title: "Prodigy", body: "Grid-scale gateway — 500+ endpoints per gateway." },
];

const SEVERITY_BORDER: Record<string, string> = {
  high: "border-l-[3px] border-l-[var(--intel-high)]",
  medium: "border-l-2 border-l-[var(--intel-medium)]",
  low: "border-l-2 border-l-[var(--intel-low)]",
};

const SEVERITY_ACCENT: Record<string, string> = {
  high: "text-[var(--intel-high)]",
  medium: "text-[var(--intel-medium)]",
  low: "text-[var(--intel-low)]",
};

const SEVERITY_DOT: Record<string, string> = {
  high: "bg-[var(--intel-high)]",
  medium: "bg-[var(--intel-medium)]",
  low: "bg-[var(--intel-low)]",
};

function Card({ card }: { card: (typeof CARDS)[number] }) {
  const Icon = card.kind === "Product match" ? Package : HelpCircle;
  return (
    <div
      className={`rounded-xl border border-black/[0.06] bg-[var(--opaline-surface-container-lowest)] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.06)] overflow-hidden ${SEVERITY_BORDER[card.severity]}`}
    >
      <div className="p-4">
        <div className="flex items-center justify-between gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full bg-[var(--intel-type-bg)] px-2.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] ${SEVERITY_ACCENT[card.severity]}`}
          >
            <Icon className="h-4 w-4" strokeWidth={2} />
            {card.kind}
          </span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] px-2.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.1em] ${SEVERITY_ACCENT[card.severity]}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${SEVERITY_DOT[card.severity]}`} aria-hidden />
            {card.severity}
          </span>
        </div>
        <div className="mt-2 text-[15px] font-bold leading-snug text-[var(--opaline-on-surface)]">
          {card.title}
        </div>
        <div className="mt-1.5 text-[13px] leading-[1.5] whitespace-pre-wrap text-[var(--opaline-on-surface-variant)]">
          {card.body}
        </div>
      </div>
    </div>
  );
}

export function LiveCallMockup() {
  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_minmax(0,13.5rem)] gap-3 p-4">
      {/* Transcript pane */}
      <div className="flex flex-col gap-4">
        {LINES.map((line, i) => (
          <div key={i} className="flex items-start gap-3">
            <span
              className="mt-[2px] h-4 w-4 flex-shrink-0 rounded-full"
              style={{ backgroundColor: line.speaker === "rep" ? "var(--grain-rep)" : "var(--grain-prospect)" }}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 font-mono text-[11px] text-[var(--opaline-on-surface-variant)] tabular-nums">
                <span className="text-[10px] font-medium uppercase tracking-wide">
                  {line.speaker === "rep" ? "Rep" : "Prospect"}
                </span>
                <span>{line.ts}</span>
              </div>
              <p className="min-w-0 text-[14px] leading-[22.75px] text-[var(--opaline-on-surface)]">{line.text}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Intelligence rail */}
      <div className="flex flex-col gap-2 border-l border-[var(--opaline-outline-variant)] pl-3">
        {CARDS.map((card, i) => (
          <Card key={i} card={card} />
        ))}
      </div>
    </div>
  );
}
