"use client";

// CapabilityOverview — the 6-card capability row (Salesken-style product
// card grid). Real-Time Detection is the 2x anchor; each card links
// "Learn more" to the relevant section further down the page.

import { Radar, BookOpen, Mic, KeyRound, Plug, History } from "lucide-react";
import Link from "next/link";

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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="feature-card featured sm:col-span-2">
            <div>
              <span className="feature-icon">
                <anchor.icon className="h-5 w-5" strokeWidth={1.75} />
              </span>
              <h3>{anchor.name}</h3>
              <p className="max-w-md">{anchor.description}</p>
            </div>
            <Link
              href={anchor.href}
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--opaline-primary)] transition-colors hover:text-[var(--opaline-on-primary-container)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--opaline-primary)]"
            >
              Learn more
              <span aria-hidden>→</span>
            </Link>
          </div>

          {rest.map((f) => (
            <div key={f.name} className="feature-card">
              <div>
                <span className="feature-icon">
                  <f.icon className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <h3>{f.name}</h3>
                <p>{f.description}</p>
              </div>
              <Link
                href={f.href}
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--opaline-primary)] transition-colors hover:text-[var(--opaline-on-primary-container)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--opaline-primary)]"
              >
                Learn more
                <span aria-hidden>→</span>
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
