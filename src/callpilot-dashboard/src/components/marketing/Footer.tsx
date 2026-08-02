import Link from "next/link";

const GITHUB_URL = "https://github.com/LakshayBot/ConverseIQ";

const PRODUCT_LINKS = [
  { name: "Product", href: "#features" },
  { name: "How it works", href: "#how-it-works" },
  { name: "In the call", href: "#product" },
  { name: "Privacy", href: "#privacy" },
];

const RESOURCE_LINKS = [
  { name: "GitHub", href: GITHUB_URL },
  { name: "Open source", href: "#open-source" },
  { name: "Dashboard", href: "/login" },
];

export function Footer() {
  return (
    <footer className="landing-footer">
      <div className="landing-container py-12">
        <div className="footer-grid">
          <div>
            <p className="font-display text-xl font-bold tracking-[-0.02em] text-[var(--opaline-on-surface)]">
              CallPilot
            </p>
            <p className="mt-2 max-w-xs text-sm leading-relaxed text-[var(--opaline-on-surface-variant)]">
              Open-source meeting intelligence — live transcription, entity
              detection and knowledge-grounded recommendations for sales calls.
            </p>
          </div>

          <div className="footer-col">
            <h4>Product</h4>
            {PRODUCT_LINKS.map((l) => (
              <Link key={l.name} href={l.href}>
                {l.name}
              </Link>
            ))}
          </div>

          <div className="footer-col">
            <h4>Resources</h4>
            {RESOURCE_LINKS.map((l) => (
              <Link key={l.name} href={l.href}>
                {l.name}
              </Link>
            ))}
          </div>

          <div className="footer-col">
            <h4>Legal</h4>
            <Link href={GITHUB_URL}>MIT License</Link>
            <span className="block pt-1 text-xs text-[var(--opaline-outline)]">
              Self-hosted · BYOK · no lock-in
            </span>
          </div>
        </div>

        <div className="footer-bottom">
          <span>© 2026 CallPilot. Open-source meeting intelligence.</span>
          <span className="font-mono text-[11px]">MIT Licensed</span>
        </div>
      </div>
    </footer>
  );
}
