"use client";

// SecuritySection — honest substitute for compliance badges: three
// plain cards, one Border Beam accent max. No SOC2/ISO/GDPR logos —
// no certification is held yet.

import { Cpu, KeyRound, ShieldCheck } from "lucide-react";
import { BorderBeam } from "@/components/magicui/border-beam";

const CARDS = [
  {
    icon: Cpu,
    title: "Local-first transcription",
    body: "Parakeet runs on-device — the raw audio never leaves the machine by default.",
    beam: true,
  },
  {
    icon: KeyRound,
    title: "Bring your own model",
    body: "You control which LLM provider handles synthesis — Ollama, OpenAI, DeepSeek, whatever you configure.",
    beam: false,
  },
  {
    icon: ShieldCheck,
    title: "Self-managed knowledge bank",
    body: "Your documents on your own Postgres — not a shared or pooled model.",
    beam: false,
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
            <div key={card.title} className="privacy-card">
              {card.beam && (
                <BorderBeam
                  size={160}
                  borderWidth={1.5}
                  colorFrom="#e58a7b"
                  colorTo="#93483c"
                />
              )}
              <span className="privacy-icon">
                <card.icon className="h-5 w-5" strokeWidth={1.75} />
              </span>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
