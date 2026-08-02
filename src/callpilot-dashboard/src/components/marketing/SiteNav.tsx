"use client";

// SiteNav — scroll-aware nav bar. Built on the Aceternity FloatingNav
// scaffold (adapted: sticky, gains blur + hairline border past the hero)
// + shadcn Sheet for the mobile menu.

import Link from "next/link";
import { Menu } from "lucide-react";
import { FloatingNav } from "@/components/ui/floating-navbar";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const GITHUB_URL = "https://github.com/LakshayBot/ConverseIQ";

const NAV_ITEMS = [
  { name: "Product", link: "#features" },
  { name: "How it works", link: "#how-it-works" },
  { name: "Open source", link: "#open-source" },
  { name: "GitHub", link: GITHUB_URL },
];

export function SiteNav() {
  return (
    <FloatingNav navItems={NAV_ITEMS}>
      {/* Mobile menu — links collapse into a Sheet below md */}
      <Sheet>
        <SheetTrigger
          aria-label="Open menu"
          className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[var(--opaline-on-surface)] transition-colors hover:bg-[var(--opaline-surface-container-low)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--opaline-primary)] md:hidden"
        >
          <Menu className="h-5 w-5" strokeWidth={2} />
        </SheetTrigger>
        <SheetContent side="right" className="w-72">
          <SheetHeader>
            <SheetTitle className="font-display text-lg font-bold tracking-tight">
              CallPilot
            </SheetTitle>
          </SheetHeader>
          <nav className="mt-4 flex flex-col gap-1">
            {NAV_ITEMS.map((item) => (
              <a
                key={item.name}
                href={item.link}
                className="rounded-md px-3 py-2.5 text-[15px] font-medium text-[var(--opaline-on-surface-variant)] transition-colors hover:bg-[var(--opaline-surface-container-low)] hover:text-[var(--opaline-on-surface)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--opaline-primary)]"
              >
                {item.name}
              </a>
            ))}
          </nav>
          <div className="mt-6 flex flex-col gap-2 border-t border-[var(--opaline-outline-variant)] pt-5">
            <Link href="/login" className="btn-ghost">
              Sign in
            </Link>
            <Link href="/login" className="btn-primary">
              Open dashboard
            </Link>
          </div>
        </SheetContent>
      </Sheet>

      <Link
        href="/login"
        className="btn-ghost hidden sm:inline-flex"
        style={{ minHeight: 40, padding: "0.5rem 1.25rem" }}
      >
        Sign in
      </Link>
      <Link
        href="/login"
        className="btn-primary"
        style={{ minHeight: 40, padding: "0.5rem 1.25rem" }}
      >
        <span className="hidden sm:inline">Open dashboard</span>
        <span className="sm:hidden">Open</span>
      </Link>
    </FloatingNav>
  );
}
