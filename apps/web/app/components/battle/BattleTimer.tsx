import { useEffect, useRef } from "react";
import { cn } from "~/lib/utils";

const DEFAULT_TOTAL_MS = 15_000;

interface BattleTimerProps {
  /** Remaining time in milliseconds (driven by the store's tickTimer loop). */
  timeRemainingMs: number;
  /** Optional override for the full duration. Defaults to 15_000ms per D-12. */
  totalMs?: number;
}

/**
 * Circular SVG countdown ring with centred digit.
 *
 * - Diameter: 96px mobile / 128px desktop (UI-SPEC §Battle timer visual).
 * - Stroke: 6px mobile / 8px desktop.
 * - `pathLength=100` makes the offset math simple: offset 0 → full ring,
 *   100 → empty ring.
 * - Stroke colour transitions from primary → destructive in the LAST 3
 *   seconds (UI-SPEC). The flip is a colour swap — no animation on the
 *   colour itself so the tension is in the stroke shrinkage, not
 *   rainbow-churn.
 * - Digit: Display role (28/40, weight 600) + tabular-nums; `aria-hidden`
 *   so screen readers don't read every tick. A separate `sr-only`
 *   `aria-live="polite"` announces 10s/5s/0s bucket crossings only.
 */
export function BattleTimer({
  timeRemainingMs,
  totalMs = DEFAULT_TOTAL_MS,
}: BattleTimerProps) {
  const clampedMs = Math.max(0, Math.min(timeRemainingMs, totalMs));
  const elapsedPct = 1 - clampedMs / totalMs;
  // `strokeDasharray` = 100, so `strokeDashoffset` = 0..100 equates to
  // "fraction of ring hidden". Full ring visible at t=0 (offset=0),
  // empty ring at t=totalMs (offset=100).
  const strokeDashoffset = Math.max(0, Math.min(100, elapsedPct * 100));
  const seconds = Math.ceil(clampedMs / 1000);
  const isCritical = clampedMs <= 3_000;

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
            isCritical ? "hsl(var(--destructive))" : "hsl(var(--primary))"
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

      {/* Digit */}
      <div
        aria-hidden="true"
        className={cn(
          "absolute inset-0 flex items-center justify-center font-semibold tabular-nums leading-none",
          "text-[28px] lg:text-[40px]",
          isCritical ? "text-destructive" : "text-foreground",
        )}
      >
        {seconds}
      </div>

      {/* Screen-reader-only live region — fires on bucket crossings */}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}
