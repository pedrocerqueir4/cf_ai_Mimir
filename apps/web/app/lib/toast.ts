/**
 * Sonner-shaped imperative toast API backed by Kumo's toast manager.
 *
 * Phase 07 D-03: this shim preserves the existing `import { toast } from "sonner"`
 * call surface (toast/.success/.error/.info/.warning/.dismiss/.promise/.custom)
 * so the 11 consumer files only need a single-line import path swap. Internally
 * the shim forwards to a module-scope `createKumoToastManager()` singleton,
 * which `~/components/Toasty.tsx` wires into a `Toast.Provider` paired with
 * Kumo's `<Toasty>` viewport (research § Pattern 3).
 *
 * The composition relies on Kumo's `<Toasty>` viewport reading from the OUTER
 * `Toast.Provider` (research A1). Validated by the smoke test in this wave.
 */
import * as React from "react";
import { createKumoToastManager } from "@cloudflare/kumo/components/toast";

// Module-scope singleton — created once when this module is first imported.
const manager = createKumoToastManager();

interface ToastOptions {
  description?: string;
  /**
   * Duration in milliseconds before auto-dismiss. Sonner uses `Infinity` to
   * mean "no auto-dismiss"; Base UI/Kumo use `0` for the same semantic. The
   * shim translates `Infinity` → `0` so existing call sites keep working.
   */
  duration?: number;
  /**
   * Stable identity for a toast. Re-using the same `id` updates the existing
   * toast in place (sonner parity, backed by Base UI ToastManagerAddOptions.id).
   */
  id?: string;
}

/** Translate sonner's `Infinity` "sticky toast" sentinel to Base UI's `0`. */
const normalizeTimeout = (duration: number | undefined): number | undefined =>
  duration === Infinity ? 0 : duration;

export const toast = Object.assign(
  // toast(message, opts) — generic
  (message: string, opts?: ToastOptions) =>
    manager.add({
      title: message,
      description: opts?.description,
      timeout: normalizeTimeout(opts?.duration),
      id: opts?.id,
    }),
  {
    success: (msg: string, opts?: ToastOptions) =>
      manager.add({
        variant: "success",
        title: msg,
        description: opts?.description,
        timeout: normalizeTimeout(opts?.duration),
        id: opts?.id,
      }),
    error: (msg: string, opts?: ToastOptions) =>
      manager.add({
        variant: "error",
        title: msg,
        description: opts?.description,
        timeout: normalizeTimeout(opts?.duration),
        id: opts?.id,
      }),
    info: (msg: string, opts?: ToastOptions) =>
      manager.add({
        variant: "info",
        title: msg,
        description: opts?.description,
        timeout: normalizeTimeout(opts?.duration),
        id: opts?.id,
      }),
    warning: (msg: string, opts?: ToastOptions) =>
      manager.add({
        variant: "warning",
        title: msg,
        description: opts?.description,
        timeout: normalizeTimeout(opts?.duration),
        id: opts?.id,
      }),
    /**
     * sonner-shaped `toast.custom(() => <JSX/>, opts)` — render arbitrary JSX
     * as the toast body. Maps to Kumo's `manager.add({ content })` (per
     * KumoToastOptionsBase.content). Used by the Phase 06 LevelUpToast
     * primitive for the gradient "Level N" celebration body.
     */
    custom: (
      render: () => React.ReactNode,
      opts?: ToastOptions,
    ) =>
      manager.add({
        content: render(),
        timeout: normalizeTimeout(opts?.duration),
        id: opts?.id,
      }),
    dismiss: (id?: string) => {
      if (id) manager.close(id);
    },
    promise: <T,>(
      p: Promise<T>,
      opts: Parameters<typeof manager.promise<T>>[1],
    ) => manager.promise(p, opts),
  },
);

// Export the raw manager so the provider component can wire it.
export { manager as kumoToastManager };
