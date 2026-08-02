"use client";

// HowItWorks — the 01/02/03 pipeline (Capture → Detect → Surface) as a
// sticky scroll reveal. Adapted from Aceternity's StickyScroll: dark
// backgrounds + gradients stripped, brand tokens throughout, mono step
// numbers, line icons in the sticky panel.

import { Mic, Radar, Layers } from "lucide-react";
import { StickyScroll } from "@/components/ui/sticky-scroll-reveal";

const STEPS = [
  {
    num: "01",
    title: "Capture",
    description:
      "Mic + system audio are transcribed locally by Parakeet — nothing leaves the machine.",
    icon: <Mic className="h-6 w-6" strokeWidth={1.75} />,
  },
  {
    num: "02",
    title: "Detect",
    description:
      "Each turn is checked against your knowledge bank and the event catalogue in real time.",
    icon: <Radar className="h-6 w-6" strokeWidth={1.75} />,
  },
  {
    num: "03",
    title: "Surface",
    description:
      "Cards land in the right rail the moment a competitor, objection, or pricing question is spoken.",
    icon: <Layers className="h-6 w-6" strokeWidth={1.75} />,
  },
];

export function HowItWorks() {
  const content = STEPS.map((step) => ({
    title: step.title,
    description: step.description,
    content: (
      <div className="flex h-full w-full items-center justify-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--opaline-surface-container-lowest)] text-[var(--opaline-primary)] ring-1 ring-[var(--opaline-outline-variant)]">
          {step.icon}
        </div>
      </div>
    ),
  }));

  return (
    <section id="how-it-works" className="section">
      <div className="landing-container">
        <div className="section-head">
          <p className="section-eyebrow">01 — How it works</p>
          <h2 className="section-title">A call becomes a card in three steps</h2>
        </div>
      </div>
      <StickyScroll content={content} contentClassName="light" />
    </section>
  );
}
