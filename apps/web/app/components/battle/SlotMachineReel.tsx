import {
  motion,
  useAnimate,
  useReducedMotion,
  type AnimationSequence,
} from "framer-motion";
import confetti from "canvas-confetti";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "~/lib/utils";

/**
 * Generic slot-machine reel used for the pre-battle roadmap + wager reveals
 * (Plan 04-06). Implements the UI-SPEC §Slot-machine reveal animation contract:
 *
 *   - 3 rows visible (itemHeight × 3 = 216px default)
 *   - Phase 1 (fast spin, ~1200ms) — cubic-bezier ease
 *   - Phase 2 (spring settle, ~800ms) — overshoots and springs back
 *   - onAnimationComplete: removes blur, fires confetti (80 particles / 90°
 *     spread / CSS-var colors), pulses the settled row (scale 1→1.08→1),
 *     fires `navigator.vibrate?.(20)` on mobile, holds ~1s, then calls
 *     onAnimationComplete prop
 *
 *   Reduced-motion path: if `prefers-reduced-motion: reduce` is set, skips the
 *   spin entirely — renders the winning item with a 200ms opacity fade-in and
 *   calls onAnimationComplete after ~800ms. No confetti, no vibrate.
 *
 * Accessibility:
 *   - Container: `role="status" aria-live="polite"`
 *   - aria-label toggles from `spinningLabel` → `lockedLabel(finalItem)` on settle
 */
export interface SlotMachineReelItemBase {
  id: string;
}

export interface SlotMachineReelProps<T extends SlotMachineReelItemBase> {
  /** All reel items. `items[finalIndex]` lands in the center on settle. */
  items: T[];
  /** Index of the winning item in `items[]`. Must be >= 1 and < items.length. */
  finalIndex: number;
  /** Renderer for a single row. `isActive` is true only for the locked row after settle. */
  renderItem: (item: T, isActive: boolean) => ReactNode;
  /** Called ~1s after the reel settles (or ~800ms in reduced-motion mode). */
  onAnimationComplete: () => void;
  /** Reel row height. Defaults to 72px per UI-SPEC (8 × 9 = 72). */
  itemHeight?: number;
  /** aria-label while the reel is spinning (e.g. "Picking topic"). */
  spinningLabel: string;
  /** aria-label once the reel has locked (e.g. `Topic locked: ${item.title}`). */
  lockedLabel: (item: T) => string;
}

// ─── Animation constants (UI-SPEC §Slot-machine reveal animation) ────────────

const PHASE_1_DURATION_S = 1.2;
const PHASE_2_DURATION_S = 0.8;
const IDLE_HOLD_MS = 1_000;
const REDUCED_MOTION_FADE_MS = 200;
const REDUCED_MOTION_HOLD_MS = 800;
const OVERSHOOT_PX = 16;
const SPIN_REVOLUTIONS = 4; // number of full item-list revolutions before landing

// Fallback confetti colors when CSS custom props can't be resolved.
// Accent-adjacent palette sourced from the Phase 1 zinc+blue token family.
const CONFETTI_FALLBACK_COLORS = ["#0ea5e9", "#6366f1", "#f59e0b", "#10b981"];

function resolveConfettiColors(): string[] {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return CONFETTI_FALLBACK_COLORS;
  }
  try {
    const root = document.documentElement;
    const style = getComputedStyle(root);
    const pick = (name: string) => style.getPropertyValue(name).trim();
    // Best-effort: CSS vars may be in `oklch(...)` / `hsl(...)` / raw color
    // format depending on Tailwind v4 theme config. canvas-confetti accepts
    // any CSS color string, so pass them through verbatim when non-empty.
    const primary = pick("--primary");
    const accent = pick("--accent");
    const foreground = pick("--foreground");
    const resolved = [primary, accent, foreground].filter(Boolean);
    if (resolved.length === 0) return CONFETTI_FALLBACK_COLORS;
    return resolved;
  } catch {
    return CONFETTI_FALLBACK_COLORS;
  }
}

function fireConfettiBurst(): void {
  if (typeof window === "undefined") return;
  try {
    confetti({
      particleCount: 80,
      spread: 90,
      origin: { y: 0.55 },
      colors: resolveConfettiColors(),
      disableForReducedMotion: true,
    });
  } catch {
    // canvas-confetti can throw on server or locked-down browsers — non-fatal.
  }
}

function fireHapticBuzz(): void {
  if (typeof navigator === "undefined") return;
  // Feature-detect — SSR, desktop browsers, and iOS Safari all lack vibrate().
  if (typeof navigator.vibrate === "function") {
    try {
      navigator.vibrate?.(20);
    } catch {
      // no-op
    }
  }
}

export function SlotMachineReel<T extends SlotMachineReelItemBase>({
  items,
  finalIndex,
  renderItem,
  onAnimationComplete,
  itemHeight = 72,
  spinningLabel,
  lockedLabel,
}: SlotMachineReelProps<T>) {
  const reducedMotion = useReducedMotion();
  const [scope, animate] = useAnimate();
  const [settled, setSettled] = useState(false);
  const completionFiredRef = useRef(false);

  // Guard rails — finalIndex must be valid.
  const safeFinalIndex = Math.max(
    1,
    Math.min(finalIndex, Math.max(0, items.length - 1)),
  );
  const finalItem = items[safeFinalIndex];

  // The reel is a vertical list. We want items[finalIndex] to land in the
  // CENTER row of the visible 3-row window → translateY = -(finalIndex - 1) * itemHeight.
  const finalY = -(safeFinalIndex - 1) * itemHeight;
  // During phase 1 we over-travel by several revolutions so the reel visibly
  // spins before settling. items.length × itemHeight × SPIN_REVOLUTIONS.
  const phase1Y =
    finalY - items.length * itemHeight * SPIN_REVOLUTIONS;

  const containerHeight = itemHeight * 3;
  const ariaLabel = settled && finalItem
    ? lockedLabel(finalItem)
    : spinningLabel;

  const settledItemId = finalItem?.id;

  useEffect(() => {
    if (!finalItem) return;
    // Prevent double-fire if props change mid-animation.
    if (completionFiredRef.current) return;

    let cancelled = false;

    async function runSpin() {
      try {
        if (reducedMotion) {
          // Reduced-motion path: fade the winning row in; no reel motion, no
          // confetti, no haptic.
          await animate(
            scope.current,
            { opacity: [0, 1] },
            { duration: REDUCED_MOTION_FADE_MS / 1000 },
          );
          setSettled(true);
          await new Promise((r) => setTimeout(r, REDUCED_MOTION_HOLD_MS));
          if (!cancelled && !completionFiredRef.current) {
            completionFiredRef.current = true;
            onAnimationComplete();
          }
          return;
        }

        // Full motion path — two-phase spin with overshoot + spring settle.
        const sequence: AnimationSequence = [
          [
            scope.current,
            { y: phase1Y, filter: "blur(1px)" },
            {
              duration: PHASE_1_DURATION_S,
              ease: [0.17, 0.67, 0.83, 0.67],
            },
          ],
          [
            scope.current,
            { y: [finalY - OVERSHOOT_PX, finalY], filter: "blur(0px)" },
            {
              duration: PHASE_2_DURATION_S,
              type: "spring",
              stiffness: 120,
              damping: 14,
            },
          ],
        ];
        await animate(sequence);

        if (cancelled) return;
        setSettled(true);
        fireConfettiBurst();
        fireHapticBuzz();

        await new Promise((r) => setTimeout(r, IDLE_HOLD_MS));
        if (!cancelled && !completionFiredRef.current) {
          completionFiredRef.current = true;
          onAnimationComplete();
        }
      } catch {
        // Animation can throw on unmount — swallow. Parent handles timeout.
      }
    }

    runSpin();
    return () => {
      cancelled = true;
    };
    // `animate` / `scope` are stable ref-like callables; excluding them is safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion, finalY, phase1Y, settledItemId]);

  if (!finalItem) {
    // Items empty — render nothing (caller should guard but don't crash).
    return null;
  }

  // ─── Reduced-motion render: a single static row ─────────────────────────
  if (reducedMotion) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label={ariaLabel}
        className="mx-auto w-full max-w-md overflow-hidden"
        style={{ height: containerHeight }}
      >
        <motion.div
          ref={scope}
          initial={{ opacity: 0 }}
          className={cn(
            "flex w-full items-center justify-center",
            "transition-[box-shadow,transform] duration-200",
            settled && "ring-4 ring-primary",
          )}
          style={{ height: containerHeight }}
        >
          {renderItem(finalItem, true)}
        </motion.div>
      </div>
    );
  }

  // ─── Full motion render ─────────────────────────────────────────────────
  return (
    <ActiveRowBand
      ariaLabel={ariaLabel}
      containerHeight={containerHeight}
      itemHeight={itemHeight}
      settled={settled}
    >
      <motion.div
        ref={scope}
        initial={{ y: 0, filter: "blur(0px)" }}
        style={{ willChange: "transform" }}
      >
        {items.map((item, i) => (
          <div
            key={`${item.id}-${i}`}
            style={{ height: itemHeight }}
            className="flex w-full items-center justify-center"
          >
            {renderItem(item, settled && i === safeFinalIndex)}
          </div>
        ))}
      </motion.div>
    </ActiveRowBand>
  );
}

// Wraps the reel with the visible window + accent band on the active (middle)
// row. The band is visual-only (no interaction, no aria role).
function ActiveRowBand({
  children,
  ariaLabel,
  containerHeight,
  itemHeight,
  settled,
}: {
  children: ReactNode;
  ariaLabel: string;
  containerHeight: number;
  itemHeight: number;
  settled: boolean;
}) {
  // Use useMemo so the inline style object is stable across re-renders.
  const bandStyle = useMemo(
    () => ({
      top: itemHeight,
      height: itemHeight,
    }),
    [itemHeight],
  );

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={ariaLabel}
      className="relative mx-auto w-full max-w-md overflow-hidden"
      style={{ height: containerHeight }}
    >
      {/* Active-row band — accent background behind middle row. UI-SPEC
          reserves accent for this exact purpose (Dim 3, item 5). Faded
          during settle so the ring-4 on the row itself becomes the focus. */}
      <div
        aria-hidden
        className={cn(
          "absolute left-0 right-0 z-0 bg-primary/10 transition-opacity duration-300",
          settled ? "opacity-50" : "opacity-100",
        )}
        style={bandStyle}
      />
      {/* The translating column of items. */}
      <div className="relative z-10">{children}</div>
      {/* Accent ring overlay on the active row after settle — appears above
          the reel to avoid re-layout. UI-SPEC reserves accent for the tier
          lock ring (Dim 3, item 6). */}
      {settled && (
        <motion.div
          aria-hidden
          initial={{ opacity: 0, scale: 1 }}
          animate={{ opacity: 1, scale: [1, 1.08, 1] }}
          transition={{ duration: 0.28, ease: "easeOut" }}
          className="pointer-events-none absolute left-0 right-0 z-20 rounded-md ring-4 ring-primary"
          style={bandStyle}
        />
      )}
    </div>
  );
}
