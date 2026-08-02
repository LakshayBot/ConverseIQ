"use client";

// FeatureTabs — the 3-tab product deep dive (Salesken-style), each tab
// pairing a headline + bullets with a Safari-framed mockup of the real
// surface.

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Safari } from "@/components/magicui/safari";
import { LiveCallMockup } from "./mockups/LiveCallMockup";
import { KnowledgeMockup } from "./mockups/KnowledgeMockup";
import { SummaryMockup } from "./mockups/SummaryMockup";

const TABS = [
  {
    value: "live",
    label: "Live Intelligence",
    eyebrow: "During the call",
    title: "Cards while the words are still in the air",
    description:
      "Entity detection runs on every final transcript turn — competitors, objections, pricing, product mentions — and each trigger produces a card in the rail.",
    bullets: [
      "Real-time cards matched to your knowledge trie",
      "Objection sub-types: price, security, migration, integration, timeline, competitor",
      "Priority signals (high / medium / low) on every card",
    ],
    mockup: <LiveCallMockup />,
    url: "app.callpilot.local/live",
  },
  {
    value: "knowledge",
    label: "Knowledge Bank",
    eyebrow: "Your documents",
    title: "Upload once, answer every call",
    description:
      "PDFs, brochures and battle cards become searchable product knowledge — entities extracted, chunks embedded, ready to ground every card.",
    bullets: [
      "Fast mode: in-process extraction, sub-second",
      "Structured mode: Docling layout parsing + LLM enrichment",
      "Every card cites the source document it came from",
    ],
    mockup: <KnowledgeMockup />,
    url: "app.callpilot.local/settings/knowledge",
  },
  {
    value: "history",
    label: "Meeting History",
    eyebrow: "After the call",
    title: "Every call, searchable",
    description:
      "Transcripts, summaries and action items are stored per meeting — search across all of them without rewinding a single recording.",
    bullets: [
      "Auto-generated summary sections per call",
      "Action items surfaced from the conversation",
      "Full-text transcript search across every meeting",
    ],
    mockup: <SummaryMockup />,
    url: "app.callpilot.local/meeting/…",
  },
];

export function FeatureTabs() {
  return (
    <section id="product" className="section">
      <div className="landing-container">
        <div className="section-head">
          <p className="section-eyebrow">Product tour</p>
          <h2 className="section-title">Three surfaces, one pipeline</h2>
        </div>

        <Tabs defaultValue="live">
          <TabsList className="w-full justify-start gap-6 border-b border-[var(--opaline-outline-variant)] bg-transparent p-0">
            {TABS.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="relative -mb-px border-b-2 border-transparent bg-transparent px-1 pb-3 text-[15px] font-semibold text-[var(--opaline-on-surface-variant)] transition-colors hover:text-[var(--opaline-on-surface)] data-[state=active]:border-[var(--opaline-primary)] data-[state=active]:bg-transparent data-[state=active]:text-[var(--opaline-on-surface)] data-[state=active]:shadow-none"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {TABS.map((tab) => (
            <TabsContent key={tab.value} value={tab.value} className="pt-8">
              <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2">
                <div>
                  <p className="section-eyebrow">{tab.eyebrow}</p>
                  <h3 className="font-display text-2xl font-bold tracking-[-0.02em] leading-tight text-[var(--opaline-on-surface)]">
                    {tab.title}
                  </h3>
                  <p className="mt-3 text-[15px] leading-relaxed text-[var(--opaline-on-surface-variant)]">
                    {tab.description}
                  </p>
                  <ul className="mt-5 space-y-2">
                    {tab.bullets.map((b) => (
                      <li key={b} className="flex items-start gap-2 text-sm text-[var(--opaline-on-surface-variant)]">
                        <span className="mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--opaline-primary)]" aria-hidden />
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
                <Safari url={tab.url} mode="default">
                  {tab.mockup}
                </Safari>
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </section>
  );
}
