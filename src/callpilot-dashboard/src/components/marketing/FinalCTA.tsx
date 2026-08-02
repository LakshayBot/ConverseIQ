import Link from "next/link";

const GITHUB_URL = "https://github.com/LakshayBot/ConverseIQ";

export function FinalCTA() {
  return (
    <section className="section">
      <div className="landing-container text-center">
        <h2 className="mx-auto max-w-3xl font-display text-[clamp(2rem,4vw+0.5rem,3rem)] font-bold leading-[1.08] tracking-[-0.03em] text-[var(--opaline-on-surface)]">
          Start with your next call.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-[var(--opaline-on-surface-variant)]">
          Self-hosted, bring-your-own-model, open source. The demo above was
          real pipeline output — this is what the call looks like live.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/login" className="btn-primary">
            Open the dashboard
          </Link>
          <Link href={GITHUB_URL} className="btn-ghost">
            Source on GitHub
          </Link>
        </div>
      </div>
    </section>
  );
}
