import { motion, useReducedMotion } from "framer-motion";
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
 * Phase 06 Plan 03 — UI-SPEC § Battle Room ConnectionDot.
 *
 * Token-driven palette:
 *   - `connected` → emerald `--success` with `connection-pulse` motion
 *     (2s linear loop, opacity 1→0.6→1). Reduced motion: static dot.
 *   - `reconnecting` → ruby `--destructive` (jewel palette swap from the
 *     legacy `bg-amber-500`).
 *   - `forfeit-imminent` → ruby `--destructive` with destructive-soft
 *     halo pulse to escalate the visual urgency.
 *
 * `aria-label` carries the human-readable state so the colour isn't the
 * only signal (UI-SPEC §Accessibility — Colour-only signal rule).
 */
export function ConnectionDot({ state, className }: ConnectionDotProps) {
  const prefersReducedMotion = useReducedMotion();

  const colourClass =
    state === "connected"
      ? "bg-[hsl(var(--success))]"
      : state === "reconnecting"
        ? "bg-[hsl(var(--destructive))]"
        : "bg-[hsl(var(--destructive))]";

  // UI-SPEC § Motion `connection-pulse` — 2s linear loop on the connected
  // state. Reduced motion: pulse disabled (static dot).
  const pulseAnim =
    state === "connected" && !prefersReducedMotion
      ? {
          opacity: [1, 0.6, 1],
          transition: {
            duration: 2,
            repeat: Infinity,
            ease: "linear" as const,
          },
        }
      : state === "forfeit-imminent" && !prefersReducedMotion
        ? {
            opacity: [1, 0.5, 1],
            transition: {
              duration: 0.8,
              repeat: Infinity,
              ease: [0.4, 0, 0.6, 1] as const,
            },
          }
        : undefined;

  return (
    <motion.span
      role="status"
      aria-label={LABEL_BY_STATE[state]}
      animate={pulseAnim}
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        colourClass,
        className,
      )}
    />
  );
}
