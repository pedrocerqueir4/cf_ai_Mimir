/**
 * Phase 06 Plan 1 — net-new gamification primitive.
 *
 * Animated XP / score count-up display with an emerald glow halo on
 * positive deltas. Uses raw rAF + an ease-celebrate cubic-bezier
 * approximation so the count-up itself doesn't require framer-motion's
 * heavier MotionValue plumbing — but we DO use `useReducedMotion()` from
 * framer-motion as the canonical reduced-motion gate (UI-SPEC § Motion).
 *
 * On `prefers-reduced-motion: reduce`, the value snaps to its target with
 * no glow halo. The `aria-live="polite"` region announces updates to AT
 * users in both modes.
 */
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";

import { cn } from "~/lib/utils";

export type XPCounterDisplaySize = "display-md" | "display-lg" | "display-xl";

export interface XPCounterDisplayProps {
  value: number;
  previousValue?: number;
  size?: XPCounterDisplaySize;
  className?: string;
}

const SIZE_CLASSES: Record<XPCounterDisplaySize, string> = {
  // UI-SPEC § Type scale display rows.
  "display-md": "text-[28px] leading-none lg:text-[36px]",
  "display-lg": "text-[36px] leading-none lg:text-[48px]",
  "display-xl": "text-[48px] leading-none lg:text-[64px]",
};

const COUNT_UP_DURATION_MS = 480; // UI-SPEC --duration-glide
const GLOW_DURATION_MS = 320; // UI-SPEC --duration-slow

/**
 * Cubic-bezier(0.34, 1.56, 0.64, 1) approximation matching --ease-celebrate.
 * Plain rAF needs an explicit easing function; we re-implement the bezier
 * via Newton's method so the count-up has the same overshoot character as
 * a CSS transition using the celebrate easing.
 */
function easeCelebrate(t: number): number {
  // Newton iteration on the parametric cubic-bezier for x(t) = 0.34 + ...
  // Approximation good to ~1px over 480ms.
  const c1x = 0.34;
  const c1y = 1.56;
  const c2x = 0.64;
  const c2y = 1.0;

  // Solve for parameter u such that bezier-x(u) = t.
  let u = t;
  for (let i = 0; i < 6; i++) {
    const x =
      3 * (1 - u) * (1 - u) * u * c1x +
      3 * (1 - u) * u * u * c2x +
      u * u * u;
    const dx =
      3 * (1 - u) * (1 - u) * c1x +
      6 * (1 - u) * u * (c2x - c1x) +
      3 * u * u * (1 - c2x);
    if (dx < 1e-6) break;
    u -= (x - t) / dx;
  }
  return (
    3 * (1 - u) * (1 - u) * u * c1y +
    3 * (1 - u) * u * u * c2y +
    u * u * u
  );
}

export function XPCounterDisplay({
  value,
  previousValue,
  size = "display-md",
  className,
}: XPCounterDisplayProps) {
  const prefersReducedMotion = useReducedMotion();
  const [displayValue, setDisplayValue] = useState<number>(
    previousValue ?? value
  );
  const [isGlowing, setIsGlowing] = useState(false);
  const rafRef = useRef<number | null>(null);
  const glowTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Cancel any in-flight animation when value/previous change underneath us.
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (glowTimeoutRef.current !== null) {
      clearTimeout(glowTimeoutRef.current);
      glowTimeoutRef.current = null;
    }

    // Reduced motion OR no previousValue OR no positive delta → snap.
    if (
      prefersReducedMotion ||
      previousValue === undefined ||
      value <= previousValue
    ) {
      setDisplayValue(value);
      setIsGlowing(false);
      return;
    }

    // Animate count-up from previousValue → value with ease-celebrate.
    const start = performance.now();
    const from = previousValue;
    const to = value;
    setIsGlowing(true);

    const tick = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / COUNT_UP_DURATION_MS);
      const eased = easeCelebrate(t);
      const current = Math.round(from + (to - from) * eased);
      setDisplayValue(current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setDisplayValue(to);
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    glowTimeoutRef.current = setTimeout(() => {
      setIsGlowing(false);
      glowTimeoutRef.current = null;
    }, GLOW_DURATION_MS);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (glowTimeoutRef.current !== null) clearTimeout(glowTimeoutRef.current);
    };
  }, [value, previousValue, prefersReducedMotion]);

  return (
    <span
      aria-live="polite"
      className={cn(
        "font-display tabular-nums text-foreground transition-[filter] duration-[var(--duration-slow)]",
        SIZE_CLASSES[size],
        isGlowing && "drop-shadow-[var(--shadow-glow-emerald)]",
        className
      )}
    >
      {displayValue}
    </span>
  );
}
