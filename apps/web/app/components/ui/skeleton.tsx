import { cn } from "~/lib/utils"

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "skeleton-shimmer rounded-[var(--radius-md)] bg-[hsl(var(--bg-subtle))]",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
