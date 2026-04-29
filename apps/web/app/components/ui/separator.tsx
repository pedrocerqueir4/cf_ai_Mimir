import * as React from "react";

import { cn } from "~/lib/utils";

// Inline thin styled-div separator (per RESEARCH § Recommended Project Structure).
// Kumo's @cloudflare/kumo/primitives/separator is a Base UI re-export and would also work,
// but the inline approach is simpler — no dependency on Base UI's prop discriminator —
// and matches PATTERNS.md's "(b) is simpler" recommendation. Phase 06 contract preserved:
// orientation + decorative props with proper role/aria-orientation a11y semantics.
export interface SeparatorProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: "horizontal" | "vertical";
  decorative?: boolean;
}

const Separator = React.forwardRef<HTMLDivElement, SeparatorProps>(
  (
    { className, orientation = "horizontal", decorative = true, ...props },
    ref
  ) => (
    <div
      ref={ref}
      role={decorative ? "none" : "separator"}
      aria-orientation={decorative ? undefined : orientation}
      className={cn(
        "shrink-0 bg-kumo-line",
        orientation === "horizontal" ? "h-[1px] w-full" : "h-full w-[1px]",
        className
      )}
      {...props}
    />
  )
);
Separator.displayName = "Separator";

export { Separator };
