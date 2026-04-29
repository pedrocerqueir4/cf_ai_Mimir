/**
 * Sonner-shaped imperative toast API backed by Kumo's toast manager.
 *
 * Phase 07 D-03: this shim preserves the existing `import { toast } from "sonner"`
 * call surface (toast.success/.error/.info/.warning/.dismiss/.promise) so the 11
 * consumer files only need a single-line import path swap. Internally the shim
 * forwards to a module-scope `createKumoToastManager()` singleton, which
 * `~/components/Toasty.tsx` wires into a `Toast.Provider` paired with Kumo's
 * `<Toasty>` viewport (research § Pattern 3).
 *
 * The composition relies on Kumo's `<Toasty>` viewport reading from the OUTER
 * `Toast.Provider` (research A1). Validated by the smoke test in this wave.
 */
import { createKumoToastManager } from "@cloudflare/kumo/components/toast";

// Module-scope singleton — created once when this module is first imported.
const manager = createKumoToastManager();

interface ToastOptions {
  description?: string;
  duration?: number;
}

export const toast = Object.assign(
  // toast(message) — generic
  (message: string, opts?: ToastOptions) =>
    manager.add({
      title: message,
      description: opts?.description,
      timeout: opts?.duration,
    }),
  {
    success: (msg: string, opts?: ToastOptions) =>
      manager.add({
        variant: "success",
        title: msg,
        description: opts?.description,
        timeout: opts?.duration,
      }),
    error: (msg: string, opts?: ToastOptions) =>
      manager.add({
        variant: "error",
        title: msg,
        description: opts?.description,
        timeout: opts?.duration,
      }),
    info: (msg: string, opts?: ToastOptions) =>
      manager.add({
        variant: "info",
        title: msg,
        description: opts?.description,
        timeout: opts?.duration,
      }),
    warning: (msg: string, opts?: ToastOptions) =>
      manager.add({
        variant: "warning",
        title: msg,
        description: opts?.description,
        timeout: opts?.duration,
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
