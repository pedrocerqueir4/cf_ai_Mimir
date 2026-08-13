"use client"; // Defensive — Toasty uses portal/DOM measurement
import * as React from "react";
import {
  Toast,
  Toasty as KumoToastyViewport,
} from "@cloudflare/kumo/components/toast";
import { kumoToastManager } from "~/lib/toast";

/**
 * Composite provider per Phase 07 RESEARCH § Pattern 3 / A1:
 *   <Toast.Provider toastManager={kumoToastManager}>  -- our singleton manager
 *     <KumoToastyViewport>{children}</KumoToastyViewport>  -- Kumo's styled viewport
 *
 * The outer provider binds the manager so module-scope `toast.add(...)` calls
 * from `~/lib/toast` are read by Kumo's viewport hook (`useKumoToastManager`).
 *
 * CRITICAL — `Toast` MUST come from `@cloudflare/kumo/components/toast`, never
 * from `@base-ui/react/toast`. Kumo ships its own copy of Base UI bundled into
 * `dist/chunks/vendor-base-ui-*.js` (a relative import, so it is NOT deduped
 * against the app's `@base-ui/react`). A `Toast.Provider` taken from the app's
 * copy writes to a different React context than the one Kumo's viewport reads,
 * so every toast is swallowed silently — the manager accepts the call, the
 * viewport's `toasts` array stays empty, and nothing renders anywhere in the
 * app. Kumo re-exports the whole Base UI `Toast` namespace (Provider included)
 * from its own copy, which is what keeps provider and viewport on one context.
 */
export function Toasty({ children }: { children: React.ReactNode }) {
  return (
    <Toast.Provider toastManager={kumoToastManager}>
      <KumoToastyViewport>{children}</KumoToastyViewport>
    </Toast.Provider>
  );
}
