import { useEffect, useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "~/lib/utils";

const DEFAULT_TOTAL_MS = 15_000;

interface BattleTimerProps {
  /** Remaining time in milliseconds (driven by the store's tickTimer loop). */
  timeRemainingMs: number;
  /** Optional override for the full duration. Defaults to 15_000ms per D-12. */
  totalMs?: number;
}

/**
 * Phase 06 Plan 03 — UI-SPEC § Battle Room timer:
 *   display-sm (22 mobile / 28 lg) Rubik Mono One digits with
 *   tabular-nums; turns ruby + 1Hz scale pulse below 5s.
 *
 * The circular SVG ring chassis is preserved (Phase 04 timing lock).
 * Critical-state threshold widened from 3s → 5s per UI-SPEC. The pulse is
 * gated on useReducedMotion — reduced users see the static digits + ruby
 * tint with no scale animation.
 */
export function BattleTimer({
  timeRemainingMs,
  totalMs = DEFAULT_TOTAL_MS,
}: BattleTimerProps) {
  const prefersReducedMotion = useReducedMotion();

  const clampedMs = Math.max(0, Math.min(timeRemainingMs, totalMs));
  const elapsedPct = 1 - clampedMs / totalMs;
  // `strokeDasharray` = 100, so `strokeDashoffset` = 0..100 equates to
  // "fraction of ring hidden". Full ring visible at t=0 (offset=0),
  // empty ring at t=totalMs (offset=100).
  const strokeDashoffset = Math.max(0, Math.min(100, elapsedPct * 100));
  const seconds = Math.ceil(clampedMs / 1000);
  const isCritical = clampedMs <= 5_000;

  // Track the last-announced bucket so we only emit at 10s / 5s / 0s.
  const lastAnnouncedRef = useRef<number | null>(null);
  useEffect(() => {
    let bucket: number | null = null;
    if (seconds === 10 || seconds === 5 || seconds === 0) bucket = seconds;
    if (bucket !== null && lastAnnouncedRef.current !== bucket) {
      lastAnnouncedRef.current = bucket;
    }
  }, [seconds]);

  const announcement =
    lastAnnouncedRef.current === 0
      ? "Time's up"
      : lastAnnouncedRef.current !== null
        ? `${lastAnnouncedRef.current} seconds left`
        : "";

  // UI-SPEC § Motion — ruby pulse below 5s. Reduced motion: no pulse.
  const pulseAnim =
    isCritical && !prefersReducedMotion
      ? {
          scale: [1, 1.05, 1],
          transition: {
            duration: 1,
            repeat: Infinity,
            ease: [0.4, 0, 0.6, 1] as const,
          },
        }
      : undefined;

  return (
    <div className="relative h-24 w-24 lg:h-32 lg:w-32">
      <svg
        className="h-full w-full -rotate-90"
        viewBox="0 0 100 100"
        aria-hidden="true"
      >
        {/* Static track */}
        <circle
          cx={50}
          cy={50}
          r={46}
          fill="none"
          stroke="hsl(var(--border))"
          strokeWidth={6}
          className="lg:[stroke-width:8]"
        />
        {/* Animated progress ring */}
        <circle
          cx={50}
          cy={50}
          r={46}
          fill="none"
          pathLength={100}
          strokeDasharray={100}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          strokeWidth={6}
          stroke={
            isCritical
              ? "hsl(var(--destructive))"
              : "hsl(var(--dominant))"
          }
          className={cn(
            "transition-[stroke] duration-150 lg:[stroke-width:8]",
          )}
          style={{
            // Smooth the offset so it appears linear even though we only
            // update from a 100ms React tick.
            transition: "stroke-dashoffset 150ms linear, stroke 150ms",
          }}
        />
      </svg>

      {/* Digit — display-sm Rubik Mono One. */}
      <motion.div
        aria-hidden="true"
        animate={pulseAnim}
        className={cn(
          "absolute inset-0 flex items-center justify-center font-display tabular-nums leading-[1.2]",
          "text-[22px] lg:text-[28px] lg:leading-[1.15]",
          isCritical
            ? "text-[hsl(var(--destructive))]"
            : "text-foreground",
        )}
      >
        {seconds}
      </motion.div>

      {/* Screen-reader-only live region — fires on bucket crossings */}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}
