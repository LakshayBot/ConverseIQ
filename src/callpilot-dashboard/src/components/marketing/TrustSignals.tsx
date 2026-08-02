import Link from "next/link";
import { Marquee } from "@/components/magicui/marquee";
import { NumberTicker } from "@/components/magicui/number-ticker";
import { Star } from "lucide-react";

const GITHUB_URL = "https://github.com/LakshayBot/ConverseIQ";
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
  "Tauri 2",
];

/** Real star count from the GitHub API — revalidated hourly. Returns null
 *  when the repo is unreachable, so the stat block never shows a guess. */
async function fetchStarCount(): Promise<number | null> {
  try {
    const res = await fetch(
      "https://api.github.com/repos/LakshayBot/ConverseIQ",
      {
        next: { revalidate: 3600 },
        headers: { Accept: "application/vnd.github+json" },
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.stargazers_count === "number" ? data.stargazers_count : null;
  } catch {
    return null;
  }
}

export async function TrustSignals() {
  const stars = await fetchStarCount();

  return (
    <section id="open-source" className="section">
      <div className="landing-container">
        <div className="section-head">
          <p className="section-eyebrow">Open source</p>
          <h2 className="section-title">Built in the open</h2>
          <p className="section-sub">
            No customer logos to show yet — CallPilot is new. What it does
            have is the whole stack on GitHub, MIT-licensed, with no
            marketing asterisks.
          </p>
        </div>

        {/* Real, live star count — fetched, never hardcoded */}
        {stars !== null && stars > 0 && (
          <div className="mb-8 flex items-center gap-3 rounded-xl border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] px-5 py-4">
            <Star className="h-5 w-5 text-[var(--opaline-on-surface)]" strokeWidth={1.75} />
            <NumberTicker
              value={stars}
              className="font-display text-2xl font-bold tabular-nums text-[var(--opaline-on-surface)]"
            />
            <span className="text-sm text-[var(--opaline-on-surface-variant)]">
              GitHub stars — from the repo, live
            </span>
          </div>
        )}
      </div>

      {/* Tech stack marquee */}
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

      {/* Founder note — honest substitute for enterprise social proof */}
      <div className="landing-container mt-10">
        <div className="max-w-2xl rounded-xl border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] p-6">
          <p className="text-[15px] leading-relaxed text-[var(--opaline-on-surface)]">
            Built by{" "}
            <span className="font-semibold">Lakshay</span>, an indie
            developer — no sales team, no venture round. CallPilot started
            because the meeting-intelligence tools that existed were
            either enterprise-priced or phone-home SaaS. This one runs on
            your machine, uses your model keys, and is open enough to fork.
          </p>
          <Link
            href={GITHUB_URL}
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--opaline-primary)] transition-colors hover:text-[var(--opaline-on-primary-container)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--opaline-primary)]"
          >
            Star it on GitHub
            <span aria-hidden>→</span>
          </Link>
        </div>
      </div>
    </section>
  );
}
