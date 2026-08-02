// Source: registry/magicui/bento-grid.tsx — container only.
// BentoCard is intentionally not used here: the capability tiles are
// built on MagicCard (spotlight border) so hover treatment stays
// consistent across every surface on the page.

import { type ComponentPropsWithoutRef, type ReactNode } from "react"

import { cn } from "@/lib/utils"

interface BentoGridProps extends ComponentPropsWithoutRef<"div"> {
  children: ReactNode
  className?: string
}

const BentoGrid = ({ children, className, ...props }: BentoGridProps) => {
  return (
    <div
      className={cn(
        "grid w-full auto-rows-[22rem] grid-cols-3 gap-4",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export { BentoGrid }
