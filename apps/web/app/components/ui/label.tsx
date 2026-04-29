import * as React from "react";
import { Label as KumoLabel } from "@cloudflare/kumo/components/label";

import { cn } from "~/lib/utils";

// Kumo's Label is a plain function component (not forwardRef) that renders an
// HTMLLabelElement. The wrapper keeps a forwardRef shape so existing call sites
// that forward refs (notably form.tsx's FormLabel) continue to typecheck without
// architecture churn. The ref does not attach to the underlying <label> at
// runtime because Kumo's component does not accept a ref prop — current
// consumers (FormLabel) do not read the ref's .current, so this is a no-op
// in practice. If a future caller needs the ref, swap to <label asContent>.

type KumoLabelOwnProps = React.ComponentProps<typeof KumoLabel>;

// children is required by Kumo Label's typing. We mirror that requirement so
// callers (FormLabel passes children through {...props}) keep their existing
// contract.
export interface LabelProps extends KumoLabelOwnProps {}

const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, ...props }, _ref) => (
    <KumoLabel className={cn(className)} {...props} />
  )
);
Label.displayName = "Label";

export { Label };
