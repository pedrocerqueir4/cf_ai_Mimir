"use client";

import * as React from "react";
// Use the Base UI Meter namespace re-exported by Kumo's primitives layer.
// The high-level @cloudflare/kumo/components/meter renders label + percentage chip
// and requires a mandatory `label: string` prop, which doesn't match Phase 06 Progress's
// bare-bar visual contract (RoadmapListItem, _app.roadmaps.$id, XPProgressBar all
// pass only `value` + className). The primitives entry exposes Root/Track/Indicator
// — a structural match for the prior Radix Progress shape.
import { Meter } from "@cloudflare/kumo/primitives/meter";

import { cn } from "~/lib/utils";

export interface ProgressProps
  extends Omit<React.ComponentPropsWithoutRef<typeof Meter.Root>, "value"> {
  value?: number | null;
  /**
   * Phase 06 legacy variant. Accepted for back-compat but no longer changes
   * the indicator color — per CONTEXT D-01 the xp emerald-glow gradient is
   * retired wholesale in favor of Kumo's brand fill. Keep the prop to avoid
   * forcing churn on `components/gamification/*` (out of Phase 07 migration scope).
   */
  variant?: "default" | "xp";
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value, variant: _variant, ...props }, ref) => (
    <Meter.Root
      ref={ref}
      value={value ?? 0}
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-kumo-fill",
        className
      )}
      {...props}
    >
      <Meter.Track className="h-full w-full">
        <Meter.Indicator
          className="h-full bg-kumo-brand transition-[width] duration-150"
          style={{ width: `${value ?? 0}%` }}
        />
      </Meter.Track>
    </Meter.Root>
  )
);
Progress.displayName = "Progress";

export { Progress };
