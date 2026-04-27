import { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "~/lib/utils";

interface ReconnectOverlayProps {
  /** Controls modal visibility. Caller derives from store phase. */
  open: boolean;
  /** Opponent name — empty string if unknown. Used in headings + toast. */
  opponentName: string;
  /**
   * Initial remaining 30s grace window in milliseconds captured on the
   * store event. The overlay owns the per-second countdown derived from
   * this initial value plus the mount timestamp — the parent does NOT
   * tick this prop down.
   */
  graceRemainingMs: number;
  /**
   * True when THE LOCAL USER is the one who dropped (we're trying to
   * reconnect ourselves). False when the OPPONENT dropped (we're waiting
   * on them).
   */
  isSelfDisconnect: boolean;
}

/**
 * Full-screen shadcn Dialog during the 30s reconnect grace window
 * (D-25 / UI-SPEC §Reconnect overlay).
 *
 * - Not dismissible: pointer-down-outside + escape-key + close-button
 *   handlers all call preventDefault. The user literally cannot close
 *   the modal — the battle is paused, they wait or leave via browser back.
 * - Copy varies by `isSelfDisconnect`:
 *   - own side: "Reconnecting…" / "Don't close this tab. We're restoring
 *     the battle."
 *   - opponent side: "{opponentName} disconnected" / "Waiting for them to
 *     reconnect. The battle is paused."
 * - Countdown: `{seconds}s before they forfeit` — Label 14 tabular-nums,
 *   turns destructive at ≤ 10s (UI-SPEC).
 * - Sonner toast fires on open for OPPONENT disconnects (second channel
 *   in case the user is on another tab). Dismisses automatically when
 *   the dialog closes.
 *
 * Uses the Radix `@radix-ui/react-dialog` primitives directly instead of
 * the shadcn `DialogContent` wrapper — the shadcn wrapper has a built-in
 * close (X) button we cannot disable from the outside.
 */
export function ReconnectOverlay({
  open,
  opponentName,
  graceRemainingMs,
  isSelfDisconnect,
}: ReconnectOverlayProps) {
  // Sonner toast lifecycle — only for opponent disconnects; self-side
  // already has the full-screen dialog blocking the UI.
  useEffect(() => {
    if (!open || isSelfDisconnect) {
      toast.dismiss("ws-disconnect");
      return;
    }
    toast(`${opponentName} disconnected — paused.`, {
      duration: Infinity,
      id: "ws-disconnect",
    });
    return () => {
      toast.dismiss("ws-disconnect");
    };
  }, [open, isSelfDisconnect, opponentName]);

  // Countdown — compute remaining every 250ms from `graceRemainingMs`
  // captured the moment the overlay opened. The parent's prop may mutate
  // if the store re-delivers a fresh value (e.g. a second disconnect) —
  // the `open`/`graceRemainingMs` dependency pair re-seeds the baseline.
  // WR-01: prior impl relied on the parent to tick; the store field was
  // set once on disconnect and never updated, so the number was frozen.
  const [remainingMs, setRemainingMs] = useState(graceRemainingMs);
  useEffect(() => {
    if (!open) {
      setRemainingMs(graceRemainingMs);
      return;
    }
    const startMs = Date.now();
    const initial = graceRemainingMs;
    setRemainingMs(initial);
    const id = window.setInterval(() => {
      const next = Math.max(0, initial - (Date.now() - startMs));
      setRemainingMs(next);
    }, 250);
    return () => window.clearInterval(id);
  }, [open, graceRemainingMs]);

  const seconds = Math.max(0, Math.ceil(remainingMs / 1_000));

  return (
    <DialogPrimitive.Root open={open}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[var(--bg-overlay)] backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          // All three escape hatches disabled — the user CANNOT dismiss.
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-xs -translate-x-1/2 -translate-y-1/2",
            "rounded-[var(--radius-lg)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] p-6 shadow-[var(--shadow-lg)]",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
          )}
        >
          <div className="flex flex-col items-center gap-4 text-center">
            <Loader2
              className="h-10 w-10 animate-spin text-[hsl(var(--dominant))]"
              aria-hidden="true"
            />
            <DialogPrimitive.Title className="text-[22px] font-semibold leading-[1.25] -tracking-[0.005em] text-foreground">
              {isSelfDisconnect
                ? "Reconnecting\u2026"
                : `${opponentName || "Opponent"} disconnected`}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-[14px] leading-[1.5] text-[hsl(var(--fg-muted))]">
              {isSelfDisconnect
                ? "Don\u2019t close this tab. We\u2019re restoring the battle."
                : "Waiting for them to reconnect. The battle is paused."}
            </DialogPrimitive.Description>
            <p
              className={cn(
                "text-[14px] tabular-nums leading-[1.5]",
                seconds <= 10
                  ? "text-[hsl(var(--destructive))]"
                  : "text-[hsl(var(--fg-muted))]",
              )}
              aria-live="polite"
            >
              {seconds}s before {isSelfDisconnect ? "you" : "they"} forfeit
            </p>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
