import * as React from "react";
import { Input as KumoInput } from "@cloudflare/kumo/components/input";

import { cn } from "~/lib/utils";

type KumoInputProps = React.ComponentPropsWithoutRef<typeof KumoInput>;

export interface InputProps extends KumoInputProps {}

const Input = React.forwardRef<
  React.ElementRef<typeof KumoInput>,
  InputProps
>(({ className, ...props }, ref) => (
  <KumoInput
    ref={ref}
    // UX-03: enforce 48px tap target on inputs (CONTEXT addendum applies to all
    // interactive primitives — same enforcement pattern as the Button wrapper).
    className={cn("min-h-12", className)}
    {...props}
  />
));
Input.displayName = "Input";

export { Input };
