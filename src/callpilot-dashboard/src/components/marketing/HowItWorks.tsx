"use client";

// HowItWorks — the 3-stage pipeline with "issue → how CallPilot handles
// it" framing, as a sticky scroll reveal (Aceternity StickyScroll,
// light-adapted).

import { Mic, Radar, Layers } from "lucide-react";
import { StickyScroll } from "@/components/ui/sticky-scroll-reveal";

const STAGES = [
  {
    num: "01",
    title: "Capture",
    issue: "Reps forget to take notes mid-call.",
    handling:
      "Local mic + system audio transcription via Parakeet — nothing leaves the machine.",
    icon: <Mic className="h-6 w-6" strokeWidth={1.75} />,
  },
  {
    num: "02",
    title: "Detect",
    issue: "Important moments get missed in the moment.",
    handling:
      "Every turn is checked against your knowledge bank and event catalogue in real time.",
    icon: <Radar className="h-6 w-6" strokeWidth={1.75} />,
  },
  {
    num: "03",
    title: "Surface",
    issue: "Reps don't have the right answer on hand.",
    handling:
      "Cards land in the right rail the instant a competitor, objection, or pricing question is spoken.",
    icon: <Layers className="h-6 w-6" strokeWidth={1.75} />,
  },
];

export function HowItWorks() {
  const content = STAGES.map((stage) => ({
    title: stage.title,
    description: (
      <>
        <span className="font-medium text-[var(--opaline-on-surface)]">
          The problem:{" "}
        </span>
        {stage.issue}
        <br className="hidden sm:block" />
        <span className="mt-1 block font-medium text-[var(--opaline-on-surface)]">
          How CallPilot handles it:{" "}
        </span>
        {stage.handling}
      </>
    ),
    content: (
      <div className="flex h-full w-full items-center justify-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--opaline-surface-container-lowest)] text-[var(--opaline-primary)] ring-1 ring-[var(--opaline-outline-variant)]">
          {stage.icon}
        </div>
      </div>
    ),
  }));

  return (
    <section id="how-it-works" className="section">
      <div className="landing-container">
        <div className="section-head">
          <p className="section-eyebrow">How it works</p>
          <h2 className="section-title">Three stages, zero note-taking</h2>
          <p className="section-sub">
            The same pipeline every call goes through — from audio to a card
            in the rail.
          </p>
        </div>
      </div>
      <StickyScroll content={content} contentClassName="light" />
    </section>
  );
}
