"use client";

import dynamic from "next/dynamic";

// The landing (copied verbatim from the /landing app) is a GSAP/Three.js
// client composition — never server-rendered (document/window access at
// render time). The layout carries fonts, metadata and theme bootstrap.
const LandingApp = dynamic(() => import("@/App"), { ssr: false });

export default function LandingPage() {
  return <LandingApp />;
}
