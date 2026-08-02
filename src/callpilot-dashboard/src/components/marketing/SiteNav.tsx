"use client";

// SiteNav — SaaS nav bar: sticky + backdrop blur past the hero (Aceternity
// FloatingNav scaffold), shadcn NavigationMenu for Product / Use Cases
// dropdowns, shadcn Sheet for the mobile menu.

import Link from "next/link";
import { Menu } from "lucide-react";
import { FloatingNav } from "@/components/ui/floating-navbar";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const GITHUB_URL = "https://github.com/LakshayBot/ConverseIQ";

const PRODUCT_LINKS = [
  { title: "How it works", href: "#how-it-works" },
  { title: "Features", href: "#features" },
  { title: "Security", href: "#security" },
];

const USE_CASE_LINKS = [
  {
    title: "For reps",
    href: "#for-reps",
    desc: "Live cards and talking points during the call.",
  },
  {
    title: "For founders & solo sellers",
    href: "#for-founders",
    desc: "Searchable transcripts and summaries after the call.",
  },
];

const ALL_LINKS = [
  ...PRODUCT_LINKS.map((l) => ({ name: l.title, link: l.href })),
  ...USE_CASE_LINKS.map((l) => ({ name: l.title, link: l.href })),
  { name: "GitHub", link: GITHUB_URL },
];

const MENU_STYLES = {
  trigger:
    "rounded-full px-4 py-2 text-sm font-medium text-[var(--opaline-on-surface-variant)] transition-colors hover:bg-[var(--opaline-surface-container-low)] hover:text-[var(--opaline-on-surface)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--opaline-primary)] data-[state=open]:text-[var(--opaline-on-surface)]",
  content:
    "top-[calc(100%+0.5rem)] rounded-xl border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface)]/95 p-2 shadow-lg shadow-[oklch(20%_0.01_55/0.06)] backdrop-blur-md",
  item: "block rounded-lg px-3 py-2 text-sm font-medium text-[var(--opaline-on-surface-variant)] transition-colors hover:bg-[var(--opaline-surface-container-low)] hover:text-[var(--opaline-on-surface)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--opaline-primary)]",
};

export function SiteNav() {
  return (
    <FloatingNav navItems={[]}>
      {/* Desktop nav — hidden below md */}
      <NavigationMenu className="hidden md:block">
        <NavigationMenuList>
          <NavigationMenuItem>
            <NavigationMenuTrigger className={MENU_STYLES.trigger}>
              Product
            </NavigationMenuTrigger>
            <NavigationMenuContent className={MENU_STYLES.content}>
              <div className="w-52">
                {PRODUCT_LINKS.map((l) => (
                  <NavigationMenuLink key={l.href} href={l.href} className={MENU_STYLES.item}>
                    {l.title}
                  </NavigationMenuLink>
                ))}
              </div>
            </NavigationMenuContent>
          </NavigationMenuItem>

          <NavigationMenuItem>
            <NavigationMenuTrigger className={MENU_STYLES.trigger}>
              Use cases
            </NavigationMenuTrigger>
            <NavigationMenuContent className={MENU_STYLES.content}>
              <div className="w-64">
                {USE_CASE_LINKS.map((l) => (
                  <NavigationMenuLink key={l.href} href={l.href} className="block rounded-lg p-3 transition-colors hover:bg-[var(--opaline-surface-container-low)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--opaline-primary)]">
                    <span className="block text-sm font-semibold text-[var(--opaline-on-surface)]">
                      {l.title}
                    </span>
                    <span className="mt-0.5 block text-xs text-[var(--opaline-on-surface-variant)]">
                      {l.desc}
                    </span>
                  </NavigationMenuLink>
                ))}
              </div>
            </NavigationMenuContent>
          </NavigationMenuItem>

          <NavigationMenuItem>
            <NavigationMenuLink
              href={GITHUB_URL}
              className={MENU_STYLES.trigger}
            >
              Docs
            </NavigationMenuLink>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>

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
            <SheetTitle className="text-lg font-bold tracking-tight">
              CallPilot
            </SheetTitle>
          </SheetHeader>
          <nav className="mt-4 flex flex-col gap-1">
            {ALL_LINKS.map((item) => (
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

      {/* Sign in is hidden below sm via a plain wrapper (Tailwind utilities
          would lose to .btn-ghost's display in the cascade) */}
      <div className="hidden sm:block">
        <Link
          href="/login"
          className="btn-ghost"
          style={{ minHeight: 40, padding: "0.5rem 1.25rem" }}
        >
          Sign in
        </Link>
      </div>
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
