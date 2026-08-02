"use client";

// WhyTeams — four benefit rows in alternating layout. Images reveal with
// a light rotate-in on scroll (the ContainerScroll visual language
// without a pinned 30rem block per row).

import { motion } from "motion/react";
import { BookOpen, Cpu, KeyRound, Layers } from "lucide-react";

const ROWS = [
  {
    icon: BookOpen,
    title: "Answers grounded in your own docs, not generic AI guesses",
    body: "Every recommendation cites the document it came from. When a prospect asks about a product, the card quotes your material — not a model's guess about what you sell.",
    bullets: ["Source citations on every card", "Entity trie built from your uploads", "No generic sales advice"],
  },
  {
    icon: Cpu,
    title: "Nothing leaves your machine by default",
    body: "Transcription runs locally with Parakeet. The intelligence stack is self-hosted — your calls aren't the training data for someone else's model.",
    bullets: ["On-device speech recognition", "Self-hosted via Docker Compose", "Postgres + pgvector + Redis under your control"],
  },
  {
    icon: KeyRound,
    title: "No vendor lock-in on the AI layer",
    body: "The synthesis step is bring-your-own-key: Ollama, OpenAI, DeepSeek — whatever you already use. Swap providers without touching your data.",
    bullets: ["DeepSeek · Ollama · OpenAI · Claude · Gemini", "Provider configured per account", "Local models supported"],
  },
  {
    icon: Layers,
    title: "One tool instead of juggling recording, notes, and docs",
    body: "Capture, transcription, entity detection, knowledge retrieval and recommendations live in one pipeline — no stitching five tools together after the call.",
    bullets: ["Live transcript + intelligence rail in one view", "Knowledge bank feeding every card", "Post-call summaries in the same place"],
  },
];

export function WhyTeams() {
  return (
    <section id="why" className="section">
      <div className="landing-container">
        <div className="section-head">
          <p className="section-eyebrow">Why teams choose CallPilot</p>
          <h2 className="section-title">Plain benefits, no invented percentages</h2>
          <p className="section-sub">
            Four reasons, stated as claims we can actually back — not
            conversion lifts nobody has measured.
          </p>
        </div>

        <div className="flex flex-col gap-14">
          {ROWS.map((row, i) => (
            <motion.div
              key={row.title}
              initial={{ opacity: 0, rotateX: 10, y: 24 }}
              whileInView={{ opacity: 1, rotateX: 0, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              style={{ perspective: 800 }}
              className={`grid grid-cols-1 items-center gap-8 lg:grid-cols-2 ${
                i % 2 === 1 ? "lg:[&>*:first-child]:order-2" : ""
              }`}
            >
              <div>
                <span className="feature-icon">
                  <row.icon className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <h3 className="font-display text-xl font-bold tracking-[-0.01em] text-[var(--opaline-on-surface)]">
                  {row.title}
                </h3>
                <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-[var(--opaline-on-surface-variant)]">
                  {row.body}
                </p>
                <ul className="mt-4 space-y-1.5">
                  {row.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2 text-sm text-[var(--opaline-on-surface-variant)]">
                      <span className="mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--opaline-primary)]" aria-hidden />
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-2xl border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] p-8 text-center">
                <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--opaline-surface-container-low)] text-[var(--opaline-primary)]">
                  <row.icon className="h-6 w-6" strokeWidth={1.75} />
                </span>
                <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--opaline-outline)]">
                  {["01", "02", "03", "04"][i]}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
