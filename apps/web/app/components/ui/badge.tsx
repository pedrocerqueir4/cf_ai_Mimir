import * as React from "react";
import { Badge as KumoBadge } from "@cloudflare/kumo/components/badge";
import { cn } from "~/lib/utils";

// Map old shadcn-style variants to Kumo's color-named variants.
// Per CONTEXT D-01: amethyst retires to Kumo's purple (closest perceptual match for old "default").
// `outline` maps directly — Kumo ships an `outline` variant (bordered, transparent bg).
const VARIANT_MAP = {
  default: "purple",
  secondary: "neutral",
  destructive: "red",
  success: "green",
  outline: "outline",
} as const;

type LegacyVariant = keyof typeof VARIANT_MAP;

type KumoBadgeProps = React.ComponentProps<typeof KumoBadge>;

export interface BadgeProps extends Omit<KumoBadgeProps, "variant"> {
  variant?: LegacyVariant;
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <KumoBadge
      variant={VARIANT_MAP[variant]}
      className={className}
      {...props}
    />
  );
}

/**
 * `badgeVariants` — passthrough shim. The shadcn cva-style helper produced a className
 * string for direct use in className props; Kumo Badge encapsulates its variant styling
 * internally and exposes no public class string. Audit returned 0 non-badge.tsx callers,
 * so this stub exists purely to keep the legacy import surface type-safe; if any caller
 * surfaces post-Phase 07 they should migrate to <Badge variant=...> JSX form.
 */
function badgeVariants(opts?: {
  variant?: LegacyVariant;
  className?: string;
}) {
  return cn(opts?.className);
}

export { Badge, badgeVariants };
