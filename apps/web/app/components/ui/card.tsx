import * as React from "react";
import { LayerCard } from "@cloudflare/kumo/components/layer-card";
import { cn } from "~/lib/utils";

// Card root → Kumo LayerCard. LayerCard ships its own surface + ring + radius treatment,
// so we only override radius (`rounded-lg` matches the Phase 06 visual contract). Legacy
// shadcn surface/foreground/border classes are dropped — LayerCard owns the surface styling.
const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <LayerCard ref={ref} className={cn("rounded-lg", className)} {...props} />
));
Card.displayName = "Card";

// Header / Title / Description / Content / Footer remain plain styled forwardRef'd divs —
// Kumo doesn't ship sub-parts beyond LayerCard.Primary / LayerCard.Secondary (which we don't use).
// Phase 06 muted-foreground class retargeted to Kumo's text-kumo-subtle (PATTERNS S-4).

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    {...props}
  />
));
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "text-2xl font-semibold leading-none tracking-tight",
      className,
    )}
    {...props}
  />
));
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm text-kumo-subtle", className)}
    {...props}
  />
));
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
));
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-6 pt-0", className)}
    {...props}
  />
));
CardFooter.displayName = "CardFooter";

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
};
