"use client";

// FeatureGrid — bento-style capability grid. The real-time detection card
// is the 2x2 anchor (the core differentiator); the rest are 1x1. Built on
// the Magic UI bento-grid scaffold, restyled to the Opaline system.

import { Radar, BookOpen, Plug, Mic, KeyRound, FileText } from "lucide-react";

const FEATURES = [
  {
    name: "Real-time entity detection",
    description:
      "Product mentions, competitors, objections and pricing questions surface the moment they're spoken — grounded in your own knowledge trie.",
    icon: Radar,
    featured: true,
  },
  {
    name: "Knowledge-grounded answers",
    description: "Cards pull from your own uploaded documents, not a generic model's guess.",
    icon: BookOpen,
  },
  {
    name: "CRM integration",
    description: "HubSpot and Salesforce sync, so notes land where your team works.",
    icon: Plug,
  },
  {
    name: "Local-first transcription",
    description: "Parakeet runs on-device — the transcript doesn't need the cloud.",
    icon: Mic,
  },
  {
    name: "Bring-your-own-LLM",
    description: "Ollama or your own provider key — no vendor lock-in on the synthesis step.",
    icon: KeyRound,
  },
  {
    name: "Structured document ingestion",
    description: "Upload PDFs and brochures; they're auto-extracted into searchable product knowledge.",
    icon: FileText,
  },
];

export function FeatureGrid() {
  const anchor = FEATURES[0];
  const rest = FEATURES.slice(1);

  return (
    <section id="features" className="section">
      <div className="landing-container">
        <div className="section-head">
          <p className="section-eyebrow">02 — What it does</p>
          <h2 className="section-title">Built for the live call</h2>
          <p className="section-sub">
            Every card is grounded in material you uploaded — not a model's guess about your product.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* 2x2 anchor card */}
          <div className="feature-card featured sm:col-span-2">
            <div>
              <span className="feature-icon">
                <anchor.icon className="h-5 w-5" strokeWidth={1.75} />
              </span>
              <h3>{anchor.name}</h3>
              <p className="max-w-md">{anchor.description}</p>
            </div>
            <div className="mt-4 flex items-center gap-2 font-mono text-[11px] text-[var(--opaline-primary)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--opaline-primary)]" />
              <span>detected as spoken · not after the call</span>
            </div>
          </div>

          {/* 1x1 cards */}
          {rest.map((f) => (
            <div key={f.name} className="feature-card">
              <div>
                <span className="feature-icon">
                  <f.icon className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <h3>{f.name}</h3>
                <p>{f.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
