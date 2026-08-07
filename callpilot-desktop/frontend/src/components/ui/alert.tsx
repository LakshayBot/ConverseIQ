import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const alertVariants = cva(
  "relative w-full rounded-lg border px-4 py-3 text-sm shadow-xs [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:size-4 [&>svg~*]:pl-7",
  {
    variants: {
      variant: {
        default:
          "border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-low)] text-[var(--opaline-on-surface)] [&>svg]:text-[var(--opaline-on-surface-variant)]",
        destructive:
          "border-[var(--opaline-danger-border)] bg-[var(--opaline-danger-soft)] text-[var(--opaline-danger)] [&>svg]:text-[var(--opaline-danger)]",
        warning:
          "border-[var(--opaline-warning-border)] bg-[var(--opaline-warning-soft)] text-[var(--opaline-warning)] [&>svg]:text-[var(--opaline-warning)]",
        info:
          "border-[var(--opaline-info-border)] bg-[var(--opaline-info-soft)] text-[var(--opaline-info)] [&>svg]:text-[var(--opaline-info)]",
        success:
          "border-[var(--opaline-success-border)] bg-[var(--opaline-success-soft)] text-[var(--opaline-success)] [&>svg]:text-[var(--opaline-success)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
))
Alert.displayName = "Alert"

const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn("mb-1 font-semibold leading-tight tracking-tight", className)}
    {...props}
  />
))
AlertTitle.displayName = "AlertTitle"

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm [&_p]:leading-relaxed", className)}
    {...props}
  />
))
AlertDescription.displayName = "AlertDescription"

export { Alert, AlertTitle, AlertDescription }
