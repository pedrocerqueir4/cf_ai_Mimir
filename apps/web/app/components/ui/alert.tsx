import * as React from "react";
import { Banner } from "@cloudflare/kumo/components/banner";

import { cn } from "~/lib/utils";

// Map old shadcn-style Alert variants to Kumo Banner variants.
// Per CONTEXT D-01: variants follow Kumo's semantic palette wholesale.
// Kumo Banner ships only `default | alert | error` (verified against banner.d.ts);
// there is no `success` variant. Phase 06 `success` had zero call sites in code (verified
// via `grep <Alert .* variant="success"` returning no hits) but we keep the type-safe key
// and map it to "default" (info) so any future surprise caller compiles cleanly.
const VARIANT_MAP = {
  default: "default", // Kumo: informational banner
  destructive: "error", // Kumo: error banner for critical issues
  success: "default", // Kumo has no success variant — fall back to info; documented in 07-04 SUMMARY
} as const;

type LegacyVariant = keyof typeof VARIANT_MAP;

type BannerProps = React.ComponentPropsWithoutRef<typeof Banner>;

// Phase 06 Alert accepted React.HTMLAttributes<HTMLDivElement> (e.g., `role="alert"`,
// `aria-*`). Kumo's BannerProps intentionally narrows to a few known props (icon, title,
// description, action, variant, className), so we widen back via intersection with
// HTMLAttributes<HTMLDivElement> to preserve the public surface consumers depend on.
export interface AlertProps
  extends Omit<BannerProps, "variant">,
    Omit<React.HTMLAttributes<HTMLDivElement>, keyof BannerProps | "title"> {
  variant?: LegacyVariant;
}

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant = "default", ...props }, ref) => (
    <Banner
      ref={ref}
      variant={VARIANT_MAP[variant]}
      className={className}
      {...(props as BannerProps)}
    />
  )
);
Alert.displayName = "Alert";

const AlertTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn("mb-1 font-medium leading-none tracking-tight", className)}
    {...props}
  />
));
AlertTitle.displayName = "AlertTitle";

const AlertDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm [&_p]:leading-relaxed", className)}
    {...props}
  />
));
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertTitle, AlertDescription };
