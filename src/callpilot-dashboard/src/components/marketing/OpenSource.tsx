"use client";

// OpenSource — honest substitute for a "trusted by" wall: the actual tech
// stack scrolling through a Magic UI marquee, plus the GitHub CTA.

import Link from "next/link";
import { Marquee } from "@/components/magicui/marquee";

const STACK = [
  ".NET 10",
  "FastAPI",
  "Next.js 15",
  "PostgreSQL + pgvector",
  "Redis",
  "Nemotron STT",
  "Parakeet",
  "Docling",
  "GLiNER",
  "Aho-Corasick",
  "Tauri 2",
  "Docker Compose",
];

const GITHUB_URL = "https://github.com/LakshayBot/ConverseIQ";

export function OpenSource() {
  return (
    <section id="open-source" className="section">
      <div className="landing-container">
        <div className="section-head">
          <p className="section-eyebrow">07 — Open source</p>
          <h2 className="section-title">Built in the open</h2>
          <p className="section-sub">
            Star it, fork it, run it yourself. The full stack — server, AI
            engine, dashboard and desktop client — is MIT-licensed on GitHub.
          </p>
        </div>
      </div>

      <div className="landing-container">
        <Marquee className="[--duration:36s]" pauseOnHover>
          {STACK.map((item) => (
            <span key={item} className="tech-chip">
              <span className="dot" aria-hidden />
              {item}
            </span>
          ))}
        </Marquee>
      </div>

      <div className="landing-container mt-8">
        <Link href={GITHUB_URL} className="btn-ghost">
          Source on GitHub
        </Link>
      </div>
    </section>
  );
}
