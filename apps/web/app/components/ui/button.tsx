import * as React from "react";
import {
  Button as KumoButton,
  buttonVariants as kumoButtonVariants,
} from "@cloudflare/kumo/components/button";
import { cn } from "~/lib/utils";

// Preserve old shadcn-style variant names so the 22 consumer files don't break en masse.
// Per CONTEXT D-01: jewel retired, falls back to primary. Per CONTEXT D-01a: Kumo "primary"
// resolves to its blue-purple brand by default — wholesale Kumo identity, no override layer.
const VARIANT_MAP = {
  default: "primary",
  destructive: "destructive",
  outline: "outline",
  secondary: "secondary",
  ghost: "ghost",
  link: "ghost", // No Kumo equivalent — closest is ghost. Audit returned 0 consumers; map preserved for type-safety.
  jewel: "primary", // CONTEXT D-01 retirement.
} as const;

const SIZE_MAP = {
  default: "base",
  sm: "sm",
  lg: "lg",
  icon: "base", // For icon-only, callers should add shape="square" separately.
} as const;

type LegacyVariant = keyof typeof VARIANT_MAP;
type LegacySize = keyof typeof SIZE_MAP;

// Kumo's ButtonProps is a discriminated union (text vs icon-only) that requires aria-label
// when shape="square"|"circle". Our wrapper accepts the broad text-button shape since shadcn
// consumers never used the icon-only narrow form; callers needing icon-only should reach for
// Kumo directly. We extend React.ButtonHTMLAttributes to forward all native button props plus
// Kumo's extension props (icon, loading, title) without inheriting the discriminated narrowing.
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: LegacyVariant;
  size?: LegacySize;
  asChild?: boolean; // Deprecated; warns in dev. Per RESEARCH Pattern 1 — Button has no render prop.
  /** Icon from `@phosphor-icons/react` or a React element. Forwarded to Kumo Button. */
  icon?: React.ReactNode;
  /** Shows a loading spinner and disables interaction. Forwarded to Kumo Button. */
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant = "default", size = "default", asChild, ...props },
    ref,
  ) => {
    if (asChild && import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn(
        "[Button] `asChild` is deprecated post-Phase 07. Use <Link to={...} className={cn(buttonVariants({...}), 'min-h-12')}>...</Link> instead.",
      );
    }
    return (
      <KumoButton
        ref={ref}
        variant={VARIANT_MAP[variant]}
        size={SIZE_MAP[size]}
        // UX-03 (CONTEXT addendum): wrapper enforces 48px tap target on every size.
        // Kumo size="lg" = h-10 = 40px, below our mobile contract (RESEARCH P-04).
        className={cn("min-h-12", className)}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

/**
 * `buttonVariants` — callable wrapper preserving the cva-style ergonomics that consumers
 * (alert-dialog.tsx + 13 asChild→<Link> sites) rely on. Delegates to Kumo's native
 * buttonVariants() and merges UX-03 min-h-12 + caller className via cn().
 */
function buttonVariants(opts?: {
  variant?: LegacyVariant;
  size?: LegacySize;
  className?: string;
}) {
  const variant = opts?.variant ?? "default";
  const size = opts?.size ?? "default";
  return cn(
    kumoButtonVariants({
      variant: VARIANT_MAP[variant],
      size: SIZE_MAP[size],
    }),
    "min-h-12", // Apply UX-03 here too so <Link className={buttonVariants(...)}> sites get the contract.
    opts?.className,
  );
}

export { Button, buttonVariants };
