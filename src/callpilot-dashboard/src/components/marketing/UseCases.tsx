"use client";

// UseCases — three realistic segments CallPilot actually serves.
// No industry-specific verticals — nothing vertical-specific has been
// built or validated yet.

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const SEGMENTS = [
  {
    value: "solo",
    label: "Solo / indie sales reps",
    headline: "Your notes, written for you",
    body: "One call at a time, CallPilot handles the notetaking and surfaces the facts you need mid-conversation. No CRM admin, no post-call transcription queue.",
    bullets: [
      "Live cards with talking points while you talk",
      "Knowledge-grounded answers from your own docs",
      "Summary and action items after every call",
    ],
  },
  {
    value: "small-teams",
    label: "Small sales teams",
    headline: "Consistent coverage across the team",
    body: "Every rep gets the same knowledge bank and the same detection pipeline — so a call with the founder covers the same ground as one with a senior AE.",
    bullets: [
      "Shared knowledge bank across the team",
      "Every call transcribed and searchable",
      "CRM sync so summaries land where the team works",
    ],
  },
  {
    value: "founders",
    label: "Founders doing their own sales calls",
    headline: "Run the first fifty calls like they count",
    body: "Early revenue calls are the ones you can't afford to lose detail on. CallPilot captures them fully and turns each one into searchable, quotable material.",
    bullets: [
      "Full transcripts for follow-ups and retrospectives",
      "Summaries you can paste into your pipeline",
      "Self-hosted, BYOK — no third-party call recording",
    ],
  },
];

export function UseCases() {
  return (
    <section id="use-cases" className="section">
      <div className="landing-container">
        <div className="section-head">
          <p className="section-eyebrow">Use cases</p>
          <h2 className="section-title">Who CallPilot is for</h2>
          <p className="section-sub">
            Three segments the product genuinely serves today.
          </p>
        </div>

        <Tabs defaultValue="solo">
          <TabsList className="w-full justify-start gap-6 border-b border-[var(--opaline-outline-variant)] bg-transparent p-0">
            {SEGMENTS.map((s) => (
              <TabsTrigger
                key={s.value}
                value={s.value}
                className="relative -mb-px border-b-2 border-transparent bg-transparent px-1 pb-3 text-[15px] font-semibold text-[var(--opaline-on-surface-variant)] transition-colors hover:text-[var(--opaline-on-surface)] data-[state=active]:border-[var(--opaline-primary)] data-[state=active]:bg-transparent data-[state=active]:text-[var(--opaline-on-surface)] data-[state=active]:shadow-none"
              >
                {s.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {SEGMENTS.map((s) => (
            <TabsContent key={s.value} value={s.value} className="pt-8">
              <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
                <div>
                  <h3 className="font-display text-xl font-bold tracking-[-0.01em] text-[var(--opaline-on-surface)]">
                    {s.headline}
                  </h3>
                  <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-[var(--opaline-on-surface-variant)]">
                    {s.body}
                  </p>
                </div>
                <ul className="space-y-2">
                  {s.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2 text-sm text-[var(--opaline-on-surface-variant)]">
                      <span className="mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--opaline-primary)]" aria-hidden />
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </section>
  );
}
