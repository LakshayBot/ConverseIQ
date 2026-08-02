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
import { useInView, useMotionValue, useSpring } from "motion/react";
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
  high: "border-l-[3px] border-l-[var(--intel-high)]",
  medium: "border-l-2 border-l-[var(--intel-medium)]",
  low: "border-l-2 border-l-[var(--intel-low)]",
};

const SEVERITY_ACCENT: Record<DemoCard["severity"], string> = {
  high: "text-[var(--intel-high)]",
  medium: "text-[var(--intel-medium)]",
  low: "text-[var(--intel-low)]",
};

const SEVERITY_DOT: Record<DemoCard["severity"], string> = {
  high: "bg-[var(--intel-high)]",
  medium: "bg-[var(--intel-medium)]",
  low: "bg-[var(--intel-low)]",
};

function ProductMatchCard({ card }: { card: DemoCard }) {
  const Icon = card.kind === "Product match" ? Package : HelpCircle;
  return (
    <div
      className={`rounded-xl border border-black/[0.06] bg-[var(--opaline-surface-container-lowest)] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.06)] overflow-hidden ${SEVERITY_BORDER[card.severity]}`}
    >
      <div className="p-4">
        <div className="flex items-center justify-between gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full bg-[var(--intel-type-bg)] px-2.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] ${SEVERITY_ACCENT[card.severity]}`}
          >
            <Icon className="h-4 w-4" strokeWidth={2} />
            {card.kind}
          </span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] px-2.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.1em] ${SEVERITY_ACCENT[card.severity]}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${SEVERITY_DOT[card.severity]}`} aria-hidden />
            {card.severity}
          </span>
        </div>
        <div className="mt-2 text-[15px] font-bold leading-snug text-[var(--opaline-on-surface)]">
          {card.title}
        </div>
        <div className="mt-1.5 text-[13px] leading-[1.5] whitespace-pre-wrap text-[var(--opaline-on-surface-variant)]">
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

  // Subtle 3D presentation: static tilt (rotateX 4° / rotateY −6°) plus a
  // few degrees of mouse parallax on hover-capable devices. Disabled for
  // touch and prefers-reduced-motion — the static tilt stays either way.
  // The reduced-motion check reads the media query directly per event
  // (motion's useReducedMotion hook doesn't update reactively here).
  const rotateX = useMotionValue(4);
  const rotateY = useMotionValue(-6);
  const springX = useSpring(rotateX, { stiffness: 120, damping: 20 });
  const springY = useSpring(rotateY, { stiffness: 120, damping: 20 });

  const canParallax =
    typeof window !== "undefined" &&
    window.matchMedia("(hover: hover) and (pointer: fine)").matches &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canParallax) return;
    // Live check too — covers mid-session preference changes.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    rotateX.set(4 - py * 6);
    rotateY.set(-6 + px * 6);
  };

  const resetTilt = () => {
    rotateX.set(4);
    rotateY.set(-6);
  };

  return (
    <div
      ref={frameRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={resetTilt}
      style={{ perspective: 1200 }}
      className="relative"
    >
      <motion.div
        style={{ rotateX: springX, rotateY: springY, transformStyle: "preserve-3d" }}
        className="relative"
      >
        {/* Ambient maroon glow radiating from behind the window — barely
            there atmosphere, not a beam. Sits back in 3D space. */}
        <div aria-hidden className="demo-glow" />

        <Terminal
          title="CallPilot — live call"
          sequence
          startOnView
          className="border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] max-w-none max-h-none min-h-[24rem] shadow-[0_2px_8px_rgba(139,58,58,0.06),0_16px_40px_rgba(139,58,58,0.08),0_32px_80px_rgba(0,0,0,0.10)]"
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
      </motion.div>
    </div>
  );
}
