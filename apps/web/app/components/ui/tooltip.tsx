"use client";

import * as React from "react";
// Use the Base UI Tooltip namespace re-exported by Kumo's primitives layer.
// The high-level @cloudflare/kumo/components/tooltip is a single function with
// `content`/`render` props — incompatible with shadcn's compound 4-name API.
// The primitives entry provides the compound shape (Root, Provider, Trigger, Popup, Portal, Positioner).
import { Tooltip as KumoTooltip } from "@cloudflare/kumo/primitives/tooltip";

import { cn } from "~/lib/utils";

export const Tooltip = KumoTooltip.Root;
export const TooltipProvider = KumoTooltip.Provider;
export const TooltipTrigger = KumoTooltip.Trigger;

type TooltipSide = "top" | "right" | "bottom" | "left";

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof KumoTooltip.Popup>,
  React.ComponentPropsWithoutRef<typeof KumoTooltip.Popup> & {
    sideOffset?: number;
    /** Side of the trigger to anchor the tooltip against. Forwarded to Base UI Positioner. */
    side?: TooltipSide;
  }
>(({ className, sideOffset = 4, side = "top", children, ...props }, ref) => (
  <KumoTooltip.Portal>
    <KumoTooltip.Positioner sideOffset={sideOffset} side={side}>
      <KumoTooltip.Popup
        ref={ref}
        className={cn(
          "z-50 overflow-hidden rounded-md bg-kumo-base px-3 py-1.5 text-sm text-kumo-default shadow-md ring ring-kumo-line",
          "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
      </KumoTooltip.Popup>
    </KumoTooltip.Positioner>
  </KumoTooltip.Portal>
));
TooltipContent.displayName = "TooltipContent";

export { TooltipContent };
