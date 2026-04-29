import * as React from "react";
import { ScrollArea as KumoScrollArea } from "@cloudflare/kumo/primitives/scroll-area";
import { cn } from "~/lib/utils";

export const ScrollArea = React.forwardRef<
  React.ElementRef<typeof KumoScrollArea.Root>,
  React.ComponentPropsWithoutRef<typeof KumoScrollArea.Root>
>(({ className, children, ...props }, ref) => (
  <KumoScrollArea.Root
    ref={ref}
    className={cn("relative overflow-hidden", className)}
    {...props}
  >
    <KumoScrollArea.Viewport className="h-full w-full rounded-[inherit]">
      {children}
    </KumoScrollArea.Viewport>
    <ScrollBar />
    <KumoScrollArea.Corner />
  </KumoScrollArea.Root>
));
ScrollArea.displayName = "ScrollArea";

export const ScrollBar = React.forwardRef<
  React.ElementRef<typeof KumoScrollArea.Scrollbar>,
  React.ComponentPropsWithoutRef<typeof KumoScrollArea.Scrollbar>
>(({ className, orientation = "vertical", ...props }, ref) => (
  <KumoScrollArea.Scrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      "flex touch-none select-none transition-colors",
      orientation === "vertical" &&
        "h-full w-1.5 border-l border-l-transparent p-[1px]",
      orientation === "horizontal" &&
        "h-1.5 flex-col border-t border-t-transparent p-[1px]",
      className
    )}
    {...props}
  >
    <KumoScrollArea.Thumb className="relative flex-1 rounded-full bg-kumo-line/60" />
  </KumoScrollArea.Scrollbar>
));
ScrollBar.displayName = "ScrollBar";
