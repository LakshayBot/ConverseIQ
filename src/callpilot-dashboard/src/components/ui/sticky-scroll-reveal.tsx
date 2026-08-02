"use client";
import React, { useRef } from "react";
import { useMotionValueEvent, useScroll } from "motion/react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

// CallPilot adaptation of Aceternity's StickyScroll:
//   - light theme (opaline surfaces), no dark backgrounds or gradients
//   - left column scrolls through the steps; right panel is sticky and
//     shows the active step's content
//   - inactive steps dim to 0.35, active steps full opacity
export const StickyScroll = ({
  content,
  contentClassName,
}: {
  content: {
    title: string;
    description: string;
    content?: React.ReactNode | any;
  }[];
  contentClassName?: string;
}) => {
  const [activeCard, setActiveCard] = React.useState(0);
  const ref = useRef<any>(null);
  const { scrollYProgress } = useScroll({
    container: ref,
    offset: ["start start", "end start"],
  });
  const cardLength = content.length;

  useMotionValueEvent(scrollYProgress, "change", (latest) => {
    const cardsBreakpoints = content.map((_, index) => index / cardLength);
    const closestBreakpointIndex = cardsBreakpoints.reduce(
      (acc, breakpoint, index) => {
        const distance = Math.abs(latest - breakpoint);
        if (distance < Math.abs(latest - cardsBreakpoints[acc])) {
          return index;
        }
        return acc;
      },
      0,
    );
    setActiveCard(closestBreakpointIndex);
  });

  return (
    <div
      ref={ref}
      className="landing-container relative flex h-[30rem] justify-center gap-10 overflow-y-auto md:space-x-10"
      style={{ scrollbarWidth: "thin" }}
    >
      <div className="relative flex items-start px-4">
        <div className="max-w-2xl">
          {content.map((item, index) => (
            <div key={item.title + index} className="my-20">
              <div className="flex items-baseline gap-3">
                <span
                  className={cn(
                    "font-mono text-sm tabular-nums transition-opacity duration-300",
                    activeCard === index
                      ? "text-[var(--opaline-primary)]"
                      : "text-[var(--opaline-outline)]",
                  )}
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <motion.h2
                  initial={{ opacity: 0 }}
                  animate={{ opacity: activeCard === index ? 1 : 0.35 }}
                  className="font-display text-2xl font-bold tracking-[-0.02em] text-[var(--opaline-on-surface)]"
                >
                  {item.title}
                </motion.h2>
              </div>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: activeCard === index ? 1 : 0.35 }}
                className="mt-6 max-w-md text-[15px] leading-relaxed text-[var(--opaline-on-surface-variant)]"
              >
                {item.description}
              </motion.p>
            </div>
          ))}
          <div className="h-40" />
        </div>
      </div>

      {/* Sticky visual panel */}
      <div
        className={cn(
          "sticky top-16 hidden h-64 w-80 overflow-hidden rounded-2xl border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] lg:block",
          contentClassName,
        )}
      >
        {content[activeCard].content ?? null}
      </div>
    </div>
  );
};
