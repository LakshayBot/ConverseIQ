"use client";

// SecuritySection — honest substitute for compliance badges: three
// MagicCard surfaces (subtle spotlight border on hover, brand tokens),
// calm and non-flashy. No SOC2/ISO/GDPR logos — no certification is
// held yet.

import { Cpu, KeyRound, ShieldCheck } from "lucide-react";
import { MagicCard } from "@/components/magicui/magic-card";

const CARDS = [
  {
    icon: Cpu,
    title: "Local-first transcription",
    body: "Parakeet runs on-device — the raw audio never leaves the machine by default.",
  },
  {
    icon: KeyRound,
    title: "Bring your own model",
    body: "You control which LLM provider handles synthesis — Ollama, OpenAI, DeepSeek, whatever you configure.",
  },
  {
    icon: ShieldCheck,
    title: "Self-managed knowledge bank",
    body: "Your documents on your own Postgres — not a shared or pooled model.",
  },
];

export function SecuritySection() {
  return (
    <section id="security" className="section">
      <div className="landing-container">
        <div className="section-head">
          <p className="section-eyebrow">Security & architecture</p>
          <h2 className="section-title">Your calls stay yours</h2>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {CARDS.map((card) => (
            <MagicCard
              key={card.title}
              className="border border-[var(--opaline-outline-variant)]"
            >
              <div className="flex h-full min-h-[14rem] flex-col p-6">
                <span className="privacy-icon">
                  <card.icon className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <h3 className="font-display text-lg font-bold tracking-[-0.01em] text-[var(--opaline-on-surface)]">
                  {card.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--opaline-on-surface-variant)]">
                  {card.body}
                </p>
              </div>
            </MagicCard>
          ))}
        </div>
      </div>
    </section>
  );
}
