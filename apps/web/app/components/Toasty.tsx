"use client"; // Defensive — Toasty uses portal/DOM measurement
import * as React from "react";
import {
  Toasty as KumoToastyViewport,
  useKumoToastManager,
} from "@cloudflare/kumo/components/toast";
import { setLiveToastManager } from "~/lib/toast";

/**
 * Bridges Kumo's hook-only toast manager to the imperative `toast.*()` shim.
 *
 * Kumo's `<Toasty>` owns its `Toast.Provider` internally and exposes no
 * `toastManager` prop (`ToastyProps` is `{ children, container? }`), so an
 * externally-created manager can never be bound to it — the supported API is
 * `useKumoToastManager()` from inside a child. This component is that child:
 * it grabs the live manager and publishes it to `~/lib/toast`, which lets the
 * ~20 imperative call sites keep working unchanged.
 *
 * It registers a stable accessor (once, on mount) that reads a ref holding the
 * newest manager — `useKumoToastManager()` returns a fresh object every render,
 * so registering that object directly would re-run the effect on every toast
 * state change.
 */
function ToastManagerBridge() {
  const manager = useKumoToastManager();
  const latest = React.useRef(manager);
  latest.current = manager;

  React.useEffect(() => {
    setLiveToastManager(() => latest.current);
    return () => setLiveToastManager(null);
  }, []);

  return null;
}

/**
 * Toast host. `<Toasty>` supplies both the provider and the portalled
 * viewport, so it is the only wrapper needed — do NOT add a
 * `<Toast.Provider>` around it. An outer provider is shadowed by Kumo's
 * inner one, which is what silently swallowed every toast in the app before
 * this was rewritten (see the comment block in `~/lib/toast.ts`).
 *
 * Related trap: Kumo bundles its own copy of Base UI (a relative import into
 * `dist/chunks/vendor-base-ui-*.js`), so Base UI primitives imported from the
 * app's `@base-ui/react` land on a different React context than Kumo's
 * components read. Always source them from `@cloudflare/kumo/*`.
 */
export function Toasty({ children }: { children: React.ReactNode }) {
  return (
    <KumoToastyViewport>
      <ToastManagerBridge />
      {children}
    </KumoToastyViewport>
  );
}
