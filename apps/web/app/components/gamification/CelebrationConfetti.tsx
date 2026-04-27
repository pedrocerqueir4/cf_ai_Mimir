/**
 * Phase 06 Plan 1 — net-new gamification primitive.
 *
 * Imperative wrapper around `canvas-confetti` for celebration moments
 * (level-up toasts, perfect-quiz reveals, battle results). Uses literal
 * hex palettes — never reads from CSS variables — because canvas-confetti
 * passes `colors` straight to a 2D canvas fillStyle, and HSL triplets like
 * `"262 83% 58%"` (without the `hsl()` wrapper) are not valid CSS color
 * strings, so they would fail silently. (RESEARCH.md Pitfall 4.)
 *
 * Reduced-motion gating is delegated to canvas-confetti via
 * `disableForReducedMotion: true` — the library short-circuits when the
 * user has the OS setting on, so we don't need a separate JS-side
 * `useReducedMotion()` check here.
 *
 * Code-split: this module is intentionally only imported by
 * `LevelUpToast.tsx` (and, in a future plan, `_app.battle.results.$id.tsx`).
 * Importing it from a non-celebration surface would pull canvas-confetti
 * into a non-celebration bundle and violate the UI-SPEC § Performance
 * Budget.
 */
import confetti from "canvas-confetti";

const JEWEL_PALETTE = ["#A78BFA", "#F87171", "#34D399"]; // amethyst, ruby, emerald
const EMERALD_PALETTE = ["#34D399", "#10B981", "#6EE7B7"]; // emerald, deep emerald, mint

export type ConfettiPalette = "jewel" | "emerald";

export interface TriggerConfettiOptions {
  palette: ConfettiPalette;
}

export function triggerConfetti({ palette }: TriggerConfettiOptions): void {
  if (typeof window === "undefined") return;
  try {
    confetti({
      particleCount: 80,
      spread: 90,
      origin: { y: 0.55 },
      colors: palette === "jewel" ? JEWEL_PALETTE : EMERALD_PALETTE,
      disableForReducedMotion: true,
    });
  } catch {
    // canvas-confetti throws in some locked-down environments
    // (CSP without `style-src 'unsafe-inline'`, jsdom, headless rendering).
    // Non-fatal — celebration is purely cosmetic.
  }
}
