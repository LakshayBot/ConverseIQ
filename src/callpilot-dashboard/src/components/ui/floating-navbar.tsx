"use client";
import React, { useState } from "react";
import {
  motion,
  useScroll,
  useMotionValueEvent,
} from "motion/react";
import { cn } from "@/lib/utils";

// CallPilot adaptation of Aceternity's FloatingNav:
//   - sticky full-width bar at the top (fixed, z-[5000])
//   - transparent over the hero; on scroll past ~80px it gains a subtle
//     backdrop blur + hairline border (the "scrolled" state)
//   - navItems render as inline links on desktop; children (CTAs / mobile
//     menu trigger) render right-aligned
// All colors come from the landing token block — no library dark styling.
export const FloatingNav = ({
  navItems,
  children,
  className,
}: {
  navItems: {
    name: string;
    link: string;
  }[];
  children?: React.ReactNode;
  className?: string;
}) => {
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);

  useMotionValueEvent(scrollY, "change", (current) => {
    setScrolled((current ?? 0) > 80);
  });

  return (
    <motion.header
      initial={false}
      className={cn(
        "fixed inset-x-0 top-0 z-[5000] transition-[background-color,border-color,backdrop-filter] duration-300 ease-out",
        scrolled
          ? "border-b border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface)]/80 backdrop-blur-md"
          : "border-b border-transparent bg-transparent",
        className
      )}
    >
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-3">
        <a
          href="#top"
          className="font-display text-[1.25rem] font-bold tracking-[-0.02em] text-[var(--opaline-on-surface)]"
        >
          CallPilot
        </a>

        {/* Desktop links — hidden below sm */}
        <nav className="hidden items-center gap-1 md:flex">
          {navItems.map((item) => (
            <a
              key={item.name}
              href={item.link}
              className="rounded-full px-4 py-2 text-sm font-medium text-[var(--opaline-on-surface-variant)] transition-colors hover:bg-[var(--opaline-surface-container-low)] hover:text-[var(--opaline-on-surface)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--opaline-primary)]"
            >
              {item.name}
            </a>
          ))}
        </nav>

        {/* CTAs + mobile menu */}
        <div className="flex items-center gap-2">{children}</div>
      </div>
    </motion.header>
  );
};
