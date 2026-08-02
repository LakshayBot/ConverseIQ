"use client";

// ProductShots — two real app views recreated as mockups inside Safari
// window frames (Magic UI). The live-call view gets the Container Scroll
// 3D reveal; the Knowledge view sits in an alternating copy/screenshot
// block. All styling mirrors the actual app (badges, pills, metadata).

import { Safari } from "@/components/magicui/safari";
import { ContainerScroll } from "@/components/ui/container-scroll-animation";
import { LiveCallMockup } from "./mockups/LiveCallMockup";
import { KnowledgeMockup } from "./mockups/KnowledgeMockup";

export function ProductShots() {
  return (
    <section id="product" className="section">
      {/* Block 1 — live call view, 3D scroll reveal */}
      <ContainerScroll
        titleComponent={
          <>
            <p className="section-eyebrow">03 — In the call</p>
            <h2 className="mx-auto max-w-3xl font-display text-[clamp(1.75rem,3vw+0.5rem,2.5rem)] font-bold leading-[1.12] tracking-[-0.02em] text-[var(--opaline-on-surface)]">
              The transcript and the intelligence rail, together
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-[var(--opaline-on-surface-variant)]">
              As each line is transcribed, the matching card lands beside it —
              competitors, objections and product matches in the moment they
              are spoken.
            </p>
          </>
        }
      >
        <Safari url="app.callpilot.local/live" mode="default">
          <LiveCallMockup />
        </Safari>
      </ContainerScroll>

      {/* Block 2 — Knowledge documents view, alternating layout */}
      <div className="landing-container">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
          <div>
            <p className="section-eyebrow">04 — The knowledge bank</p>
            <h2 className="section-title">Your documents become the answer key</h2>
            <p className="section-sub">
              Upload product docs, battle cards and objection guides. CallPilot
              extracts entities and matches live mentions against them — so a
              product mention surfaces the facts from your own material, not a
              generic answer.
            </p>
            <ul className="mt-6 space-y-2">
              {[
                "Fast mode — in-process extraction, sub-second",
                "Structured mode — Docling layout parsing + LLM enrichment",
                "PDF, DOCX, Markdown and plain text",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-[var(--opaline-on-surface-variant)]">
                  <span className="mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--opaline-primary)]" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="relative">
            <Safari url="app.callpilot.local/settings/knowledge" mode="default">
              <KnowledgeMockup />
            </Safari>
          </div>
        </div>
      </div>
    </section>
  );
}
