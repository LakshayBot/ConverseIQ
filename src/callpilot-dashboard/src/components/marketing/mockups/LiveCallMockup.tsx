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
  high: "border-l-[var(--opaline-error)]",
  medium: "border-l-[var(--opaline-primary)]",
  low: "border-l-[var(--opaline-secondary)]",
};

function Card({ card }: { card: (typeof CARDS)[number] }) {
  const Icon = card.kind === "Product match" ? Package : HelpCircle;
  return (
    <div className={`rounded-md border border-[var(--opaline-outline-variant)] border-l-4 ${SEVERITY_BORDER[card.severity]} bg-[var(--opaline-surface-container-lowest)] overflow-hidden`}>
      <div className="p-3">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-[var(--opaline-on-surface-variant)]">
          <Icon className="h-3 w-3" strokeWidth={2} />
          <span>{card.kind}</span>
          <span className="ml-auto text-[10px] font-semibold uppercase">{card.severity}</span>
        </div>
        <div className="mt-1 text-[13px] font-semibold text-[var(--opaline-on-surface)]">{card.title}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-[var(--opaline-on-surface-variant)]">{card.body}</div>
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
