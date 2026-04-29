import * as React from "react";
import { Drawer } from "@cloudflare/kumo/primitives/drawer";
import { cn } from "~/lib/utils";

// Preserve the shadcn-shaped API for InLessonQASheet.tsx — no consumer rewrite.
export const Sheet = Drawer.Root;
export const SheetTrigger = Drawer.Trigger;
export const SheetClose = Drawer.Close;
export const SheetPortal = Drawer.Portal;

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof Drawer.Popup> {
  side?: "top" | "right" | "bottom" | "left";
}

export const SheetContent = React.forwardRef<
  React.ElementRef<typeof Drawer.Popup>,
  SheetContentProps
>(({ className, children, side = "bottom", ...props }, ref) => (
  <Drawer.Portal>
    <Drawer.Backdrop className="fixed inset-0 z-50 bg-kumo-overlay/80 backdrop-blur-sm" />
    <Drawer.Popup
      ref={ref}
      className={cn(
        "fixed z-50 bg-kumo-base shadow-lg ring ring-kumo-line",
        side === "bottom" && "inset-x-0 bottom-0 max-h-[60vh] rounded-t-xl",
        side === "top" && "inset-x-0 top-0 max-h-[60vh] rounded-b-xl",
        side === "right" && "inset-y-0 right-0 max-w-md rounded-l-xl",
        side === "left" && "inset-y-0 left-0 max-w-md rounded-r-xl",
        className
      )}
      {...props}
    >
      {children}
    </Drawer.Popup>
  </Drawer.Portal>
));
SheetContent.displayName = "SheetContent";

export const SheetTitle = React.forwardRef<
  React.ElementRef<typeof Drawer.Title>,
  React.ComponentPropsWithoutRef<typeof Drawer.Title>
>(({ className, ...props }, ref) => (
  <Drawer.Title
    ref={ref}
    className={cn("text-lg font-semibold text-kumo-default", className)}
    {...props}
  />
));
SheetTitle.displayName = "SheetTitle";

export const SheetDescription = React.forwardRef<
  React.ElementRef<typeof Drawer.Description>,
  React.ComponentPropsWithoutRef<typeof Drawer.Description>
>(({ className, ...props }, ref) => (
  <Drawer.Description
    ref={ref}
    className={cn("text-sm text-kumo-subtle", className)}
    {...props}
  />
));
SheetDescription.displayName = "SheetDescription";

// Header + Footer are styled divs (no Drawer equivalent).
export const SheetHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-2 text-center sm:text-left p-6",
      className
    )}
    {...props}
  />
);
SheetHeader.displayName = "SheetHeader";

export const SheetFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
);
SheetFooter.displayName = "SheetFooter";

// SheetOverlay is an alias for legacy callers — Drawer's Backdrop is the same role.
export const SheetOverlay = Drawer.Backdrop;
