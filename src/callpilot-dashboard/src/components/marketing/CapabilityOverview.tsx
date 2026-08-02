"use client";

// CapabilityOverview — the 6-card capability row. Uses the Magic UI
// BentoGrid container (auto-rows, 3-col) with MagicCard spotlight-border
// tiles, restyled to the Opaline tokens. Real-Time Detection is the 2x
// anchor; each card links "Learn more" to its section.

import { Radar, BookOpen, Mic, KeyRound, Plug, History } from "lucide-react";
import Link from "next/link";
import { BentoGrid } from "@/components/magicui/bento-grid";
import { MagicCard } from "@/components/magicui/magic-card";

const CARDS = [
  {
    name: "Real-Time Detection",
    description:
      "Competitors, objections, pricing, and product mentions surfaced the moment they're spoken.",
    icon: Radar,
    href: "#how-it-works",
    featured: true,
  },
  {
    name: "Knowledge-Grounded Cards",
    description: "Every recommendation pulls from your own uploaded docs, not a generic model guess.",
    icon: BookOpen,
    href: "#product",
  },
  {
    name: "Local Transcription",
    description: "Parakeet runs on-device; audio doesn't leave the machine by default.",
    icon: Mic,
    href: "#security",
  },
  {
    name: "Bring Your Own Model",
    description: "Connect Ollama, OpenAI, DeepSeek, or any provider you already use.",
    icon: KeyRound,
    href: "#security",
  },
  {
    name: "CRM Sync",
    description: "HubSpot and Salesforce integration for call summaries and logged activity.",
    icon: Plug,
    href: "#use-cases",
  },
  {
    name: "Meeting History & Summaries",
    description: "Every call transcribed, searchable, and summarized after the fact.",
    icon: History,
    href: "#for-founders",
  },
];

function CapabilityTile({
  card,
  featured,
}: {
  card: (typeof CARDS)[number];
  featured?: boolean;
}) {
  return (
    <MagicCard
      className={`border border-[var(--opaline-outline-variant)] ${
        featured ? "col-span-2" : ""
      }`}
    >
      <div className={`flex h-full flex-col justify-between p-6 ${featured ? "min-h-[20rem]" : "min-h-[14rem]"}`}>
        <div>
          <span className="feature-icon">
            <card.icon className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <h3 className="mt-4 font-display text-lg font-bold tracking-[-0.01em] text-[var(--opaline-on-surface)]">
            {card.name}
          </h3>
          <p className={`mt-2 text-sm leading-relaxed text-[var(--opaline-on-surface-variant)] ${featured ? "max-w-md" : ""}`}>
            {card.description}
          </p>
        </div>
        <Link
          href={card.href}
          className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--opaline-primary)] transition-colors hover:text-[var(--opaline-on-primary-container)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--opaline-primary)]"
        >
          Learn more
          <span aria-hidden>→</span>
        </Link>
      </div>
    </MagicCard>
  );
}

export function CapabilityOverview() {
  const anchor = CARDS[0];
  const rest = CARDS.slice(1);

  return (
    <section id="features" className="section">
      <div className="landing-container">
        <div className="section-head">
          <p className="section-eyebrow">Capabilities</p>
          <h2 className="section-title">What CallPilot does</h2>
          <p className="section-sub">
            Six capabilities, each grounded in the product as it exists today — no roadmap features.
          </p>
        </div>

        <BentoGrid className="auto-rows-[auto] gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <CapabilityTile card={anchor} featured />
          {rest.map((card) => (
            <CapabilityTile key={card.name} card={card} />
          ))}
        </BentoGrid>
      </div>
    </section>
  );
}
