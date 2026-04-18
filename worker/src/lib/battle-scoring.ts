// Phase 4 scoring + wager pure utilities (D-12, D-13, D-16, D-19).
// Pure functions only — no I/O, no external state. Imported by:
//   - worker/src/durable-objects/BattleRoom.ts (Plan 02) inside the synchronous critical section
//   - worker/src/routes/battle.ts (Plan 04) for wager-proposal validation
//   - tests in tests/battle/*.test.ts

export const BATTLE_TIME_LIMIT_MS = 15_000;

export const BATTLE_MAX_POINTS = 1_000;

export const WAGER_TIERS = [10, 15, 20] as const;

export type WagerTier = typeof WAGER_TIERS[number];

export const WAGER_MINIMUM_XP = 10;

// Kahoot-style exponential decay per D-13.
// score = round(MAX × (1 − (clamped_rt / T) / 2)) for correct; 0 for wrong.
// Range: [500, 1000] for correct, 0 for wrong.
export function computeBattleScore(
  responseTimeMs: number,
  correct: boolean,
): number {
  if (!correct) return 0;
  const clamped = Math.max(0, Math.min(responseTimeMs, BATTLE_TIME_LIMIT_MS));
  return Math.round(
    BATTLE_MAX_POINTS * (1 - (clamped / BATTLE_TIME_LIMIT_MS) / 2),
  );
}

// Per-user wager amount from D-17 (each player pays % of own XP) + D-19 floor.
// New users with 0 XP still wager 10 XP; balance can briefly go negative on a loss.
export function computeWagerAmount(
  currentXp: number,
  tierPercent: WagerTier,
): number {
  const pct = Math.floor((currentXp * tierPercent) / 100);
  return Math.max(WAGER_MINIMUM_XP, pct);
}
