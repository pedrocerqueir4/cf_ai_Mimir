/**
 * Phase 06 Plan 1 — net-new gamification primitive.
 *
 * Lucide Flame icon + day-count number with `streak-tick` motion on the
 * flame. Tints emerald when `alive`, ruby-soft when `!alive`. This is
 * the canonical streak surface across Dashboard + Profile (Phase 06
 * Plan 03 retired the legacy `StreakCounter` wrapper; Plan 06-06
 * deleted the unused file).
 */
import { motion, useReducedMotion } from "framer-motion";
import { Flame } from "lucide-react";

import { cn } from "~/lib/utils";

export interface StreakFlameProps {
  days: number;
  /**
   * When true, plays the streak-tick scale + rotate motion on mount /
   * when the prop transitions from false → true. Reduced-motion users
   * see only the opacity fade.
   */
  animate?: boolean;
  /**
   * `true` (default): emerald palette + active glow.
   * `false`: ruby-soft palette signalling a broken streak.
   */
  alive?: boolean;
  className?: string;
}

export function StreakFlame({
  days,
  animate = false,
  alive = true,
  className,
}: StreakFlameProps) {
  const prefersReducedMotion = useReducedMotion();

  // UI-SPEC § Motion vocabulary — `streak-tick` row.
  const tickAnim = animate
    ? prefersReducedMotion
      ? { opacity: [0.6, 1] }
      : { scale: [1, 1.2, 1], rotate: [-4, 4, 0] }
    : undefined;

  const tickTransition = prefersReducedMotion
    ? { duration: 0.2 }
    : { duration: 0.48, ease: [0.34, 1.56, 0.64, 1] as const };

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <motion.span
        animate={tickAnim}
        transition={tickTransition}
        className={cn(
          "inline-flex",
          alive
            ? "text-[hsl(var(--success))]"
            : "text-[hsl(var(--destructive-soft))]"
        )}
        aria-hidden="true"
      >
        <Flame className="h-6 w-6" />
      </motion.span>
      <span className="font-display tabular-nums text-foreground">{days}</span>
    </span>
  );
}
