import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./landing.css";

// Inter is the single UI family — hierarchy comes from weight
// (400/500/600/700/800), not a second typeface. JetBrains Mono is the
// outlier, reserved for system-feeling data (timestamps, status badges).
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-inter",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains",
});

export const metadata: Metadata = {
  title: "CallPilot AI — Intelligence, live, in the meeting",
  description:
    "CallPilot listens to live sales calls, spots competitors, objections, pricing and product mentions as they're spoken, and grounds the rep's next move in your own knowledge base. Self-hosted, BYOK.",
};

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`${inter.variable} ${jetbrains.variable} landing`}>
      {children}
    </div>
  );
}
