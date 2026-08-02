"use client";

// LiveCallDemo — the hero's signature moment: a simulated live call.
//
// Built on the Magic UI Terminal + TypingAnimation sequence machinery
// (components/magicui/terminal.tsx) with the transcript bubble UI taken
// from the real app (VirtualizedTranscriptView): speaker dot, monospace
// timestamp, 14px body. As each transcript line finishes typing, its
// Intelligence card slides into the right rail via the Magic UI
// AnimatedListItem spring — cards appear *because* the line completed.
//
// All colors/fonts come from the landing token block — no library default
// dark/gradient styling.

import { useRef, useState } from "react";
import { useInView } from "motion/react";
import { AnimatePresence, motion } from "motion/react";
import {
  Terminal,
  SequenceContext,
  ItemIndexContext,
  TypingAnimation,
} from "@/components/magicui/terminal";
import { AnimatedListItem } from "@/components/magicui/animated-list";
import { Package, HelpCircle } from "lucide-react";

interface DemoLine {
  speaker: "rep" | "prospect";
  ts: string;
  text: string;
}

interface DemoCard {
  kind: "Product match" | "Technical";
  severity: "high" | "medium" | "low";
  title: string;
  body: string;
}

const LINES: DemoLine[] = [
  {
    speaker: "rep",
    ts: "12:24:31",
    text: "We're evaluating the Apex 100 and Prodigy for our rollout.",
  },
  {
    speaker: "prospect",
    ts: "12:24:43",
    text: "Can both integrate with our existing SCADA environment?",
  },
  {
    speaker: "rep",
    ts: "12:24:56",
    text: "Yes — REST API and OPC-UA adapters, plus OTA firmware updates.",
  },
];

const CARDS: DemoCard[] = [
  {
    kind: "Product match",
    severity: "high",
    title: "Apex 100",
    body: "500+ endpoints per gateway · OTA firmware updates · API-based billing.",
  },
  {
    kind: "Technical",
    severity: "medium",
    title: "SCADA integration",
    body: "REST API + OPC-UA gateway adapters.",
  },
  {
    kind: "Product match",
    severity: "medium",
    title: "Prodigy",
    body: "Grid-scale gateway — 500+ endpoints per gateway.",
  },
];

const SEVERITY_BORDER: Record<DemoCard["severity"], string> = {
  high: "border-l-[var(--opaline-error)]",
  medium: "border-l-[var(--opaline-primary)]",
  low: "border-l-[var(--opaline-secondary)]",
};

function ProductMatchCard({ card }: { card: DemoCard }) {
  const Icon = card.kind === "Product match" ? Package : HelpCircle;
  return (
    <div
      className={`rounded-md border border-[var(--opaline-outline-variant)] border-l-4 ${SEVERITY_BORDER[card.severity]} bg-[var(--opaline-surface-container-lowest)] overflow-hidden`}
    >
      <div className="p-3">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-[var(--opaline-on-surface-variant)]">
          <Icon className="h-3 w-3" strokeWidth={2} />
          <span>{card.kind}</span>
          <span className="ml-auto text-[10px] font-semibold uppercase">
            {card.severity}
          </span>
        </div>
        <div className="mt-1 text-[13px] font-semibold text-[var(--opaline-on-surface)]">
          {card.title}
        </div>
        <div className="mt-0.5 text-xs leading-relaxed text-[var(--opaline-on-surface-variant)]">
          {card.body}
        </div>
      </div>
    </div>
  );
}

function TranscriptBubble({
  line,
  state,
}: {
  line: DemoLine;
  state: "idle" | "typing" | "done";
}) {
  const isRep = line.speaker === "rep";
  const dotColor = isRep
    ? "var(--grain-rep)"
    : "var(--grain-prospect)";
  return (
    <div className="flex items-start gap-3">
      <span
        className="mt-[2px] h-4 w-4 flex-shrink-0 rounded-full"
        style={{ backgroundColor: dotColor }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 font-mono text-[11px] text-[var(--opaline-on-surface-variant)] tabular-nums">
          <span className="text-[10px] font-medium uppercase tracking-wide">
            {isRep ? "Rep" : "Prospect"}
          </span>
          <span>{line.ts}</span>
        </div>
        {state === "typing" ? (
          <TypingAnimation
            children={line.text}
            duration={28}
            startOnView={false}
            className="text-[14px] leading-[22.75px] text-[var(--opaline-on-surface)]"
          />
        ) : (
          <p className="min-w-0 text-[14px] leading-[22.75px] text-[var(--opaline-on-surface)]">
            {line.text}
          </p>
        )}
      </div>
    </div>
  );
}

export function LiveCallDemo() {
  const [activeIndex, setActiveIndex] = useState(0);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const inView = useInView(frameRef, { amount: 0.3, once: true });

  return (
    <div ref={frameRef}>
      <Terminal
        title="CallPilot — live call"
        sequence
        startOnView
        className="border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] max-w-none max-h-none min-h-[24rem]"
      >
        <SequenceContext.Provider
          value={{
            activeIndex,
            sequenceStarted: inView,
            completeItem: (i: number) => {
              setActiveIndex((cur) => (i === cur ? cur + 1 : cur));
            },
          }}
        >
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,13.5rem)] gap-3">
            {/* Transcript pane */}
            <div className="flex flex-col gap-4">
              {LINES.map((line, i) => {
                const state =
                  i < activeIndex
                    ? "done"
                    : i === activeIndex
                      ? "typing"
                      : "idle";
                return (
                  // Terminal numbers its direct children with
                  // ItemIndexContext — our two-pane grid is one child, so
                  // every line would see index 0. Override per line so the
                  // sequence advances 0 → 1 → 2 correctly.
                  <ItemIndexContext.Provider key={i} value={i}>
                    <motion.div
                      initial={{ opacity: 0, y: -5 }}
                      animate={
                        state === "idle"
                          ? { opacity: 0, y: -5 }
                          : { opacity: 1, y: 0 }
                      }
                      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                    >
                      <TranscriptBubble line={line} state={state} />
                    </motion.div>
                  </ItemIndexContext.Provider>
                );
              })}
            </div>

            {/* Intelligence rail */}
            <div className="flex flex-col gap-2 border-l border-[var(--opaline-outline-variant)] pl-3">
              <AnimatePresence>
                {CARDS.slice(0, activeIndex).map((card, i) => (
                  <AnimatedListItem key={i}>
                    <ProductMatchCard card={card} />
                  </AnimatedListItem>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </SequenceContext.Provider>
      </Terminal>
    </div>
  );
}
