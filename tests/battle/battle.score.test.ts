import { describe, it, expect } from "vitest";
import {
  BATTLE_TIME_LIMIT_MS,
  BATTLE_MAX_POINTS,
  computeBattleScore,
} from "../../worker/src/lib/battle-scoring";

// VALIDATION.md 04-08: speed-scoring formula is Kahoot-style exponential decay
//   score = round(BATTLE_MAX_POINTS × (1 − (rt / BATTLE_TIME_LIMIT_MS) / 2))
// for correct answers; 0 for wrong answers.

describe("computeBattleScore (D-13, 04-08)", () => {
  it("constants are the CONTEXT.md locked values", () => {
    expect(BATTLE_TIME_LIMIT_MS).toBe(15_000);
    expect(BATTLE_MAX_POINTS).toBe(1000);
  });

  it("correct answer at 0ms yields max points (1000)", () => {
    expect(computeBattleScore(0, true)).toBe(1000);
  });

  it("correct answer at half the time limit (7500ms) yields 750 points", () => {
    expect(computeBattleScore(7_500, true)).toBe(750);
  });

  it("correct answer at exactly the time limit (15000ms) yields 500 points", () => {
    expect(computeBattleScore(15_000, true)).toBe(500);
  });

  it("correct answer over the time limit (16000ms) is clamped to 500", () => {
    expect(computeBattleScore(16_000, true)).toBe(500);
  });

  it("correct answer with negative response time (clock skew) is clamped to 1000", () => {
    expect(computeBattleScore(-100, true)).toBe(1000);
  });

  it("wrong answer at any response time yields 0", () => {
    expect(computeBattleScore(0, false)).toBe(0);
    expect(computeBattleScore(7_500, false)).toBe(0);
    expect(computeBattleScore(15_000, false)).toBe(0);
    expect(computeBattleScore(42, false)).toBe(0);
  });

  it("result is always rounded to an integer", () => {
    // 7333 / 15000 / 2 = 0.244433…  →  1000 × (1 − 0.244433) = 755.567  →  round = 756
    expect(computeBattleScore(7_333, true)).toBe(756);
  });

  it("scoring is monotonically non-increasing in response time (for correct answers)", () => {
    let previous = Infinity;
    for (let rt = 0; rt <= BATTLE_TIME_LIMIT_MS; rt += 100) {
      const score = computeBattleScore(rt, true);
      expect(score).toBeLessThanOrEqual(previous);
      previous = score;
    }
  });
});
