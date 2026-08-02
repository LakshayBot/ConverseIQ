"use client";

// PersonaCards — two personas matched to real product surfaces, in
// alternating rows with the Container Scroll reveal.

import { Safari } from "@/components/magicui/safari";
import { ContainerScroll } from "@/components/ui/container-scroll-animation";
import { LiveCallMockup } from "./mockups/LiveCallMockup";
import { SummaryMockup } from "./mockups/SummaryMockup";

export function PersonaCards() {
  return (
    <section id="personas" className="section">
      {/* Persona 1 — reps, mid-call */}
      <div id="for-reps" className="scroll-mt-24">
        <ContainerScroll
          heightClass="h-[40rem] md:h-[48rem]"
          titleComponent={
            <>
              <p className="section-eyebrow">For reps, mid-call</p>
              <h2 className="mx-auto max-w-2xl font-display text-[clamp(1.75rem,3vw+0.5rem,2.5rem)] font-bold leading-[1.12] tracking-[-0.02em] text-[var(--opaline-on-surface)]">
                Live coaching while the call is still happening
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-[var(--opaline-on-surface-variant)]">
                The intelligence rail runs beside the transcript. A competitor
                is named, an objection lands, a pricing question comes up —
                the card is already there with a talking point.
              </p>
            </>
          }
        >
          <Safari url="app.callpilot.local/live" mode="default">
            <LiveCallMockup />
          </Safari>
        </ContainerScroll>
      </div>

      {/* Persona 2 — anyone reviewing after */}
      <div id="for-founders" className="landing-container scroll-mt-24">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
          <div className="order-2 lg:order-1">
            <Safari url="app.callpilot.local/meeting/…" mode="default">
              <SummaryMockup />
            </Safari>
          </div>
          <div className="order-1 lg:order-2">
            <p className="section-eyebrow">For anyone reviewing after</p>
            <h2 className="section-title">The call, searchable the next day</h2>
            <p className="section-sub">
              Every call is transcribed and summarized — key decisions, action
              items, and a full-text transcript you can search. No more
              rewinding a recording to find what was actually agreed.
            </p>
            <ul className="mt-6 space-y-2">
              {[
                "Auto-generated summary sections per call",
                "Action items surfaced from the conversation",
                "Full transcript search across every meeting",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-[var(--opaline-on-surface-variant)]">
                  <span className="mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--opaline-primary)]" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
