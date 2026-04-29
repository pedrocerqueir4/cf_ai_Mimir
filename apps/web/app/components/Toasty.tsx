"use client"; // Defensive — Toasty uses portal/DOM measurement
import * as React from "react";
import { Toast } from "@base-ui/react/toast";
import { Toasty as KumoToastyViewport } from "@cloudflare/kumo/components/toast";
import { kumoToastManager } from "~/lib/toast";

/**
 * Composite provider per Phase 07 RESEARCH § Pattern 3 / A1:
 *   <Toast.Provider toastManager={kumoToastManager}>  -- our singleton manager
 *     <KumoToastyViewport>{children}</KumoToastyViewport>  -- Kumo's styled viewport
 *
 * The outer provider binds the manager so module-scope `toast.add(...)` calls
 * from `~/lib/toast` are read by Kumo's viewport hook (`useKumoToastManager`).
 * Validated by smoke test in Wave 3 — toast.success("smoke") must render DOM.
 *
 * Kumo doesn't re-export `Toast.Provider`, so this is the ONE file in Phase 07
 * that imports directly from `@base-ui/react`.
 */
export function Toasty({ children }: { children: React.ReactNode }) {
  return (
    <Toast.Provider toastManager={kumoToastManager}>
      <KumoToastyViewport>{children}</KumoToastyViewport>
    </Toast.Provider>
  );
}
