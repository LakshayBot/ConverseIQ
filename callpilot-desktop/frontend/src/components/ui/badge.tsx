"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap transition-colors",
  {
    variants: {
      variant: {
        neutral:
          "bg-[var(--opaline-surface-container)] text-[var(--opaline-on-surface-variant)]",
        primary:
          "bg-[var(--opaline-primary-soft)] text-[var(--opaline-primary)]",
        success:
          "bg-[var(--opaline-success-soft)] text-[var(--opaline-success)]",
        warning:
          "bg-[var(--opaline-warning-soft)] text-[var(--opaline-warning)]",
        info: "bg-[var(--opaline-info-soft)] text-[var(--opaline-info)]",
        danger: "bg-[var(--opaline-danger-soft)] text-[var(--opaline-danger)]",
        outline:
          "border border-[var(--opaline-outline-variant)] text-[var(--opaline-on-surface-variant)]",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
