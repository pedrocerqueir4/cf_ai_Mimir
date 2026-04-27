/**
 * Phase 06 Plan 1 — net-new gamification primitive.
 *
 * Imperative `showLevelUpToast(level)` API that mounts a celebratory
 * toast.custom() body with a gradient "Level N" heading, an overshoot
 * scale-in via framer-motion, and a `triggerConfetti({ palette: "jewel" })`
 * burst. Reduced-motion users see only an opacity fade and (because
 * canvas-confetti gates internally on `disableForReducedMotion`) no
 * confetti.
 *
 * Wired in later plans (e.g., XP-gain handler in lesson completion flow).
 * Plan 1 only ships the primitive.
 */
import { motion, useReducedMotion } from "framer-motion";
import { toast } from "sonner";

import { triggerConfetti } from "./CelebrationConfetti";

export interface LevelUpToastBodyProps {
  level: number;
}

function LevelUpToastBody({ level }: LevelUpToastBodyProps) {
  const prefersReducedMotion = useReducedMotion();

  // UI-SPEC § Motion vocabulary — `level-up` row.
  const variants = prefersReducedMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
      }
    : {
        initial: { opacity: 0, scale: 0.6 },
        animate: { opacity: 1, scale: [0.6, 1.05, 1] },
      };

  const transition = prefersReducedMotion
    ? { duration: 0.2 }
    : { duration: 0.8, ease: [0.34, 1.56, 0.64, 1] as const };

  return (
    <motion.div
      initial={variants.initial}
      animate={variants.animate}
      transition={transition}
      className="flex flex-col items-center gap-2 rounded-[var(--radius-lg)] bg-card border border-border px-6 py-4 shadow-[var(--shadow-lg)]"
      role="status"
    >
      <span className="text-sm font-medium text-[hsl(var(--fg-muted))] uppercase tracking-wide">
        Level Up
      </span>
      <span
        className="font-display text-[48px] leading-none lg:text-[64px] bg-gradient-to-r from-[hsl(var(--celebration-from))] to-[hsl(var(--celebration-to))] bg-clip-text text-transparent"
        aria-label={`Reached level ${level}`}
      >
        Level {level}
      </span>
    </motion.div>
  );
}

export function showLevelUpToast(level: number): void {
  toast.custom(() => <LevelUpToastBody level={level} />, {
    duration: 4000,
  });
  // Fire confetti in parallel with the toast mount. The function gates
  // internally on prefers-reduced-motion via canvas-confetti.
  triggerConfetti({ palette: "jewel" });
}
