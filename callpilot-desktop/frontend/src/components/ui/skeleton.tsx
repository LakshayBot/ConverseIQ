import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-[var(--opaline-surface-container-high)]",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
