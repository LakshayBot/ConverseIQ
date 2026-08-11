import type { Metadata, Viewport } from "next";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import "./landing.css";

// The landing type system: Fraunces for display (the voice), Inter for
// body, JetBrains Mono for system-feeling data. Mapped onto the CSS
// `--font-*` tokens consumed by the ported landing stylesheet.
const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-fraunces",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-inter",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-jetbrains",
});

export const metadata: Metadata = {
  title: "CallPilot — Live intelligence during sales calls",
  description:
    "CallPilot — live intelligence during sales calls. Real-time transcription, competitor detection, pricing surfacing and grounded talking points, ~300 ms after the trigger. Self-hosted, bring your own model, MIT-licensed.",
  openGraph: {
    type: "website",
    siteName: "CallPilot",
    title: "CallPilot — Live intelligence during sales calls",
    description:
      "Real-time transcription, competitor detection, pricing surfacing and grounded talking points, ~300 ms after the trigger. Self-hosted, bring your own model, MIT-licensed.",
  },
  twitter: {
    card: "summary",
    title: "CallPilot — Live intelligence during sales calls",
    description:
      "The answer, mid-question. Real-time sales intelligence, on your machine, with your model.",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0b10",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className={`${fraunces.variable} ${inter.variable} ${jetbrains.variable} landing`}
    >
      {/* Theme bootstrap — runs before first paint so the correct theme is
          on <html> before CSS or React touch the page. No flash, no reload. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `(function () {
            try {
              var saved = localStorage.getItem('callpilot-theme')
              var theme =
                saved === 'nocturne' || saved === 'light'
                  ? saved
                  : window.matchMedia('(prefers-color-scheme: light)').matches
                    ? 'light'
                    : 'nocturne'
              document.documentElement.dataset.theme = theme
            } catch (e) {
              document.documentElement.dataset.theme = 'nocturne'
            }
          })()`,
        }}
      />
      {children}
    </div>
  );
}
