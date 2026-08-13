/**
 * Sonner-shaped imperative toast API backed by Kumo's toast manager.
 *
 * Phase 07 D-03: this shim preserves the existing `import { toast } from "sonner"`
 * call surface (toast/.success/.error/.info/.warning/.dismiss/.promise/.custom)
 * so the consumer files only need a single-line import path swap.
 *
 * ── Why this forwards to a live manager instead of owning one ──────────────
 *
 * The original implementation held a module-scope `createKumoToastManager()`
 * singleton and handed it to `<Toast.Provider toastManager={...}>`. That could
 * never work: Kumo's `<Toasty>` renders its OWN `Toast.Provider` internally
 * (its `ToastProvider` and `Toasty` exports are literally the same component),
 * and `ToastyProps` is only `{ children, container? }` — there is no prop to
 * bind an external manager. Kumo's inner provider always shadowed the outer
 * one, so the viewport read an empty context and the singleton was orphaned:
 * every `toast.*()` call was accepted and silently dropped, app-wide, from the
 * Phase 07 Kumo migration until this was fixed.
 *
 * Kumo's supported API is the `useKumoToastManager()` hook, which only works
 * inside a component under `<Toasty>`. To keep the ~20 imperative call sites
 * (event handlers, mutation callbacks) working without a hook refactor,
 * `~/components/Toasty.tsx` renders a bridge that publishes the live hook
 * manager here via `setLiveToastManager`. Calls made before that bridge mounts
 * are queued and flushed on registration.
 */
import type * as React from "react";
import type { useKumoToastManager } from "@cloudflare/kumo/components/toast";

/** The shape `useKumoToastManager()` returns, minus the reactive `toasts` list. */
export type LiveToastManager = Omit<
  ReturnType<typeof useKumoToastManager>,
  "toasts"
>;

/**
 * A getter rather than the manager itself: `useKumoToastManager()` returns a
 * fresh object on every render, so the bridge registers a stable accessor that
 * always reads the newest one.
 */
let getLive: (() => LiveToastManager) | null = null;

/**
 * Calls made before the bridge mounts (module-eval-time toasts, or a toast
 * fired during the same tick as hydration). Bounded so a misbehaving caller
 * on a page that never mounts `<Toasty>` can't grow this without limit.
 */
const pending: Array<(m: LiveToastManager) => void> = [];
const MAX_PENDING = 20;

/**
 * Registers the live manager from Kumo's context. Called by the bridge in
 * `~/components/Toasty.tsx` — not part of the public toast API.
 */
export function setLiveToastManager(
  accessor: (() => LiveToastManager) | null,
): void {
  getLive = accessor;
  if (!accessor) return;
  // splice() first so a toast fired from within a flushed callback re-queues
  // rather than mutating the array we're iterating.
  for (const run of pending.splice(0)) run(accessor());
}

function dispatch(run: (m: LiveToastManager) => void): void {
  if (getLive) {
    run(getLive());
    return;
  }
  if (pending.length < MAX_PENDING) pending.push(run);
}

let seq = 0;
/** Ids must be allocated up front so `toast.dismiss(id)` works on queued calls. */
const nextId = (): string => `toast-${++seq}`;

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

type KumoVariant = "success" | "error" | "info" | "warning";

/** Shared add path — allocates the id, queues or forwards, returns the id. */
function add(
  options: Record<string, unknown>,
  explicitId: string | undefined,
): string {
  const id = explicitId ?? nextId();
  dispatch((m) => m.add({ ...options, id }));
  return id;
}

const withVariant =
  (variant: KumoVariant) =>
  (msg: string, opts?: ToastOptions): string =>
    add(
      {
        variant,
        title: msg,
        description: opts?.description,
        timeout: normalizeTimeout(opts?.duration),
      },
      opts?.id,
    );

export const toast = Object.assign(
  // toast(message, opts) — generic
  (message: string, opts?: ToastOptions): string =>
    add(
      {
        title: message,
        description: opts?.description,
        timeout: normalizeTimeout(opts?.duration),
      },
      opts?.id,
    ),
  {
    success: withVariant("success"),
    error: withVariant("error"),
    info: withVariant("info"),
    warning: withVariant("warning"),
    /**
     * sonner-shaped `toast.custom(() => <JSX/>, opts)` — render arbitrary JSX
     * as the toast body. Maps to Kumo's `manager.add({ content })` (per
     * KumoToastOptionsBase.content). Used by the Phase 06 LevelUpToast
     * primitive for the gradient "Level N" celebration body.
     */
    custom: (render: () => React.ReactNode, opts?: ToastOptions): string =>
      add(
        {
          content: render(),
          timeout: normalizeTimeout(opts?.duration),
        },
        opts?.id,
      ),
    dismiss: (id?: string): void => {
      if (id) dispatch((m) => m.close(id));
    },
    promise: <T,>(
      p: Promise<T>,
      opts: Parameters<LiveToastManager["promise"]>[1],
    ): Promise<T> => {
      // Unlike add/close, promise toasts can't be meaningfully deferred — the
      // promise is already in flight, so a queued call would attach its
      // loading state after the fact. Forward when live, otherwise return the
      // promise untouched so callers still get their value.
      if (getLive) return getLive().promise(p, opts) as Promise<T>;
      return p;
    },
  },
);
