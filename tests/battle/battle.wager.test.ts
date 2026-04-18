import { describe, it, expect } from "vitest";
import {
  WAGER_TIERS,
  WAGER_MINIMUM_XP,
  computeWagerAmount,
} from "../../worker/src/lib/battle-scoring";

// VALIDATION.md 04-12 + 04-13: wager tier validation + 10 XP floor (D-16, D-19).

describe("wager tier + amount (D-16, D-19, 04-12, 04-13, T-04-03)", () => {
  it("WAGER_TIERS is exactly [10, 15, 20]", () => {
    expect(WAGER_TIERS).toEqual([10, 15, 20]);
  });

  it("WAGER_MINIMUM_XP floor is 10", () => {
    expect(WAGER_MINIMUM_XP).toBe(10);
  });

  it("enforces 10-XP floor when tier*xp rounds to 0 (new user)", () => {
    // D-19: "Minimum wager floor: 10 XP regardless of percentage math."
    expect(computeWagerAmount(0, 20)).toBe(10);
  });

  it("enforces 10-XP floor when tier*xp < 10 (low-XP user)", () => {
    // 30 XP × 10% = 3 → floor wins → 10
    expect(computeWagerAmount(30, 10)).toBe(10);
  });

  it("floor ties the computed value (100 XP × 10% = 10)", () => {
    expect(computeWagerAmount(100, 10)).toBe(10);
  });

  it("computes 20% of 100 XP = 20", () => {
    expect(computeWagerAmount(100, 20)).toBe(20);
  });

  it("computes 15% of 1000 XP = 150", () => {
    expect(computeWagerAmount(1_000, 15)).toBe(150);
  });

  it("negative XP balance returns the floor (edge case: D-19 allows transient negatives)", () => {
    expect(computeWagerAmount(-50, 20)).toBe(10);
  });

  it("rounds-down on non-integer percentages (Math.floor semantics)", () => {
    // 33 × 10% = 3.3 → floor = 3 → clamped to 10-XP floor = 10
    expect(computeWagerAmount(33, 10)).toBe(10);
    // 333 × 15% = 49.95 → floor = 49 → above the 10-XP floor → 49
    expect(computeWagerAmount(333, 15)).toBe(49);
  });
});
