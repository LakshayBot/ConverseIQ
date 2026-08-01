import Link from "next/link";
import type React from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const GITHUB_URL = "https://github.com/LakshayBot/ConverseIQ";

const SIGNALS = [
  {
    name: "Product mentions",
    value: "matched live against your knowledge trie, as they're spoken",
  },
  {
    name: "Competitor mentions",
    value: "flagged and cross-checked with current web intelligence",
  },
  {
    name: "Objections",
    value: "six sub-types — price, security, migration, integration, timeline, competitor",
  },
  {
    name: "Pricing discussions",
    value: "plans, tiers, budget, per-seat language",
  },
  {
    name: "Technical questions",
    value: "integration, SSO, API, SLA, deployment",
  },
  {
    name: "Recommendations",
    value: "synthesized by the LLM you choose — bring your own key",
  },
];

const STEPS = [
  {
    num: "01",
    title: "Capture",
    body: "Mic and system audio are transcribed locally by the desktop client — nothing leaves the machine.",
  },
  {
    num: "02",
    title: "Detect",
    body: "Each turn is checked against your knowledge bank and the event catalogue in real time.",
  },
  {
    num: "03",
    title: "Surface",
    body: "Cards land in the right rail the moment a competitor, objection, or pricing question is spoken.",
  },
];

const FAQ = [
  {
    q: "Is my call audio sent to the cloud?",
    a: "In the desktop client, transcription runs locally on your machine. Intelligence is served from your own self-hosted instance — Docker Compose, Postgres + pgvector, Redis. No third party records your calls.",
  },
  {
    q: "Which LLM writes the recommendations?",
    a: "Whichever you configure. CallPilot is bring-your-own-key — DeepSeek, Ollama, OpenAI, Claude and Gemini are supported.",
  },
  {
    q: "What can it detect in a call?",
    a: "Competitor mentions, pricing discussions, objections (price, security, migration, integration, timeline, competitor) and technical questions — detected as they're spoken, not after the call.",
  },
  {
    q: "How does the knowledge base work?",
    a: "Upload product docs, battle cards or objection guides — PDF, DOCX, Markdown or plain text. CallPilot extracts entities and matches live mentions against them, so recommendations are grounded in your material, not generic advice.",
  },
  {
    q: "Can I run it on my own infrastructure?",
    a: "Yes — that's the default. The whole platform ships as Docker Compose and runs on your own Postgres and Redis.",
  },
  {
    q: "Is it open source?",
    a: "Yes — MIT-licensed on GitHub.",
  },
];

export default function LandingPage() {
  return (
    <>
      {/* Nav — N9 edge-aligned minimal: wordmark left, one CTA right, silence between. */}
      <header className="landing-nav">
        <Link href="/" className="wordmark">
          CallPilot
        </Link>
        <Link href="/login" className="cta-link">
          Sign in <span className="arrow">→</span>
        </Link>
      </header>

      {/* Hero — 01 · THE PRODUCT. */}
      <section className="hero">
        <p className="ordinal" style={ { "--i": 0 } as React.CSSProperties }>
          01 — The product.
        </p>
        <h1 className="display reveal" style={ { "--i": 1 } as React.CSSProperties }>
          The meeting, read as it happens.
        </h1>
        <p className="lede reveal" style={ { "--i": 2 } as React.CSSProperties }>
          CallPilot listens to live sales calls, spots competitors, objections,
          pricing and product mentions as they’re spoken, and grounds the rep’s
          next move in your own knowledge base.
        </p>
        <div className="hero-ctas reveal" style={ { "--i": 3 } as React.CSSProperties }>
          <Link href="/login" className="cta-link">
            Open the dashboard <span className="arrow">→</span>
          </Link>
          <Link href={GITHUB_URL} className="cta-link">
            Source on GitHub <span className="arrow">↗</span>
          </Link>
        </div>

        {/* The product's own output, set as a teletype specimen. */}
        <div className="specimen reveal" style={ { "--i": 4 } as React.CSSProperties }>
          <p className="specimen-caption">A live call, as CallPilot reads it</p>
          <div className="specimen-line">
            <span className="specimen-tag">rep</span>
            <span className="specimen-text">
              “we’re evaluating apex 100 and prodigy for the rollout”
            </span>
          </div>
          <div className="specimen-line">
            <span className="specimen-tag accent">detected</span>
            <span className="specimen-text">ProductMentioned · apex 100</span>
          </div>
          <div className="specimen-line">
            <span className="specimen-tag accent">talking point</span>
            <span className="specimen-text">
              Recommend apex 100 — ask which endpoints they need covered first
            </span>
          </div>
        </div>
      </section>

      {/* 02 · THE SIGNALS — F3 tabular spec sheet. */}
      <section className="landing-section">
        <p className="ordinal">02 — The signals.</p>
        <div>
          <h2 className="section-title">What CallPilot hears</h2>
          <table className="spec-sheet">
            <tbody>
              {SIGNALS.map((s) => (
                <tr key={s.name}>
                  <th>{s.name}</th>
                  <td className="spec-value">{s.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 03 · THE SEQUENCE — F4 steps. */}
      <section className="landing-section">
        <p className="ordinal">03 — The sequence.</p>
        <div>
          <h2 className="section-title">How a call becomes a card</h2>
          <div className="step-list">
            {STEPS.map((step) => (
              <div className="step" key={step.num}>
                <span className="step-num">{step.num}</span>
                <div>
                  <h3 className="step-title">{step.title}</h3>
                  <p className="step-body">{step.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 04 · THE DEPLOYMENT — asymmetric prose. */}
      <section className="landing-section">
        <p className="ordinal">04 — The deployment.</p>
        <div>
          <h2 className="section-title">Your calls. Your stack.</h2>
          <div className="section-body">
            <p>
              CallPilot is self-hosted by design. The platform ships as Docker
              Compose with Postgres + pgvector and Redis — your meeting data
              stays in a database you control.
            </p>
            <p style={{ marginTop: "var(--space-md)" }}>
              The synthesis model is bring-your-own-key: DeepSeek, Ollama,
              OpenAI, Claude or Gemini. The desktop client runs speech
              recognition on-device, so the live transcript never has to leave
              the machine it was recorded on.
            </p>
          </div>
        </div>
      </section>

      {/* 05 · THE QUESTIONS — shadcn Accordion. */}
      <section className="landing-section">
        <p className="ordinal">05 — The questions.</p>
        <div>
          <h2 className="section-title">Asked in every evaluation</h2>
          <div className="faq-wrap">
            <Accordion type="single" collapsible>
              {FAQ.map((item, i) => (
                <AccordionItem key={item.q} value={`item-${i}`}>
                  <AccordionTrigger>{item.q}</AccordionTrigger>
                  <AccordionContent>{item.a}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </div>
      </section>

      {/* Final CTA — one line, two typographic links. */}
      <section className="final-cta">
        <p className="display">Start with your next call.</p>
        <div className="hero-ctas">
          <Link href="/login" className="cta-link">
            Open the dashboard <span className="arrow">→</span>
          </Link>
          <Link href={GITHUB_URL} className="cta-link">
            Source on GitHub <span className="arrow">↗</span>
          </Link>
        </div>
      </section>

      {/* Footer — Ft1 mast-headed. */}
      <footer className="landing-footer">
        <span className="wordmark">CallPilot</span>
        <span className="tagline">Open-source meeting intelligence.</span>
        <span className="links">
          <Link href={GITHUB_URL}>GitHub</Link>
          <Link href="/login">Dashboard</Link>
          <span>MIT License</span>
        </span>
      </footer>
    </>
  );
}
