import { cn } from "~/lib/utils";

export type ConnectionDotState =
  | "connected"
  | "reconnecting"
  | "forfeit-imminent";

interface ConnectionDotProps {
  state: ConnectionDotState;
  className?: string;
}

const LABEL_BY_STATE: Record<ConnectionDotState, string> = {
  connected: "Connected",
  reconnecting: "Reconnecting",
  "forfeit-imminent": "About to forfeit",
};

/**
 * 8px circular status dot (UI-SPEC §Score display pattern — Connection
 * indicator). Three states:
 *
 * - `connected` → `bg-muted-foreground` (neutral; the expected state does
 *   not burn the accent colour).
 * - `reconnecting` → `bg-amber-500` (Tailwind default preset; the ONLY
 *   non-token colour in Phase 4, justified in UI-SPEC §Score display).
 * - `forfeit-imminent` → `bg-destructive animate-pulse` (used when the
 *   30s grace window is more than two-thirds elapsed — Plan 08 wires the
 *   time-based transition).
 *
 * `aria-label` carries the human-readable state so the colour isn't the
 * only signal (UI-SPEC §Accessibility Baseline — Colour-only signal rule).
 */
export function ConnectionDot({ state, className }: ConnectionDotProps) {
  const colourClass =
    state === "connected"
      ? "bg-muted-foreground"
      : state === "reconnecting"
        ? "bg-amber-500"
        : "bg-destructive animate-pulse";

  return (
    <span
      role="status"
      aria-label={LABEL_BY_STATE[state]}
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        colourClass,
        className,
      )}
    />
  );
}
