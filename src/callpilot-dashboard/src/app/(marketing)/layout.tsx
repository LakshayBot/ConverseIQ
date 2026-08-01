import type { Metadata } from "next";
import { Bodoni_Moda, Geist, JetBrains_Mono } from "next/font/google";
import "./landing.css";

const bodoni = Bodoni_Moda({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-bodoni",
});

const geist = Geist({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-geist",
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
    <div className={`${bodoni.variable} ${geist.variable} ${jetbrains.variable} landing`}>
      {children}
    </div>
  );
}
