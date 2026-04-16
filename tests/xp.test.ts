import { describe, it, expect } from "vitest";
import {
  computeLevel,
  updateStreak,
  toLocalDateString,
  LEVEL_THRESHOLDS,
  LESSON_XP_LINEAR,
  LESSON_XP_BRANCHING,
  QUIZ_XP_PER_CORRECT,
  STREAK_BONUS_XP,
} from "../worker/src/lib/xp";

// ─── XP Constants ─────────────────────────────────────────────────────────────

describe("XP constants", () => {
  it("LESSON_XP_LINEAR is 25", () => {
    expect(LESSON_XP_LINEAR).toBe(25);
  });

  it("LESSON_XP_BRANCHING is 50", () => {
    expect(LESSON_XP_BRANCHING).toBe(50);
  });

  it("QUIZ_XP_PER_CORRECT is 10", () => {
    expect(QUIZ_XP_PER_CORRECT).toBe(10);
  });

  it("STREAK_BONUS_XP is 25", () => {
    expect(STREAK_BONUS_XP).toBe(25);
  });
});

// ─── LEVEL_THRESHOLDS ─────────────────────────────────────────────────────────

describe("LEVEL_THRESHOLDS", () => {
  it("has 25 entries", () => {
    expect(LEVEL_THRESHOLDS).toHaveLength(25);
  });

  it("starts at 0 (Level 1 threshold)", () => {
    expect(LEVEL_THRESHOLDS[0]).toBe(0);
  });

  it("Level 2 threshold is 100", () => {
    expect(LEVEL_THRESHOLDS[1]).toBe(100);
  });

  it("each threshold is greater than the previous", () => {
    for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) {
      expect(LEVEL_THRESHOLDS[i]).toBeGreaterThan(LEVEL_THRESHOLDS[i - 1]);
    }
  });
});

// ─── computeLevel ─────────────────────────────────────────────────────────────

describe("computeLevel", () => {
  it("returns level 1 at 0 XP", () => {
    const result = computeLevel(0);
    expect(result.level).toBe(1);
    expect(result.xpForCurrentLevel).toBe(0);
    expect(result.progressPercent).toBe(0);
  });

  it("returns level 2 at 100 XP (exact threshold)", () => {
    const result = computeLevel(100);
    expect(result.level).toBe(2);
    expect(result.xpForCurrentLevel).toBe(0);
  });

  it("returns level 1 at 99 XP (just below threshold)", () => {
    const result = computeLevel(99);
    expect(result.level).toBe(1);
  });

  it("returns level 2 at 101 XP (just above threshold)", () => {
    const result = computeLevel(101);
    expect(result.level).toBe(2);
    expect(result.xpForCurrentLevel).toBe(1);
  });

  it("progressPercent is 0 at start of level", () => {
    const result = computeLevel(LEVEL_THRESHOLDS[1]); // exactly level 2
    expect(result.progressPercent).toBe(0);
  });

  it("progressPercent is 100 at max level", () => {
    const result = computeLevel(LEVEL_THRESHOLDS[24] + 9999);
    expect(result.progressPercent).toBe(100);
    expect(result.level).toBe(25);
    expect(result.xpToNextLevel).toBe(0);
  });

  it("xpToNextLevel + xpForCurrentLevel equals XP needed for that level", () => {
    const xp = 150; // somewhere in level 2
    const result = computeLevel(xp);
    const levelStart = LEVEL_THRESHOLDS[result.level - 1];
    const levelEnd = LEVEL_THRESHOLDS[result.level];
    const levelSpan = levelEnd - levelStart;
    expect(result.xpForCurrentLevel + result.xpToNextLevel).toBe(levelSpan);
  });

  it("returns level 25 when XP exceeds max threshold", () => {
    const result = computeLevel(999_999);
    expect(result.level).toBe(25);
  });

  it("progressPercent is between 0 and 100 for mid-level XP", () => {
    const midXp = Math.floor((LEVEL_THRESHOLDS[1] + LEVEL_THRESHOLDS[2]) / 2);
    const result = computeLevel(midXp);
    expect(result.progressPercent).toBeGreaterThanOrEqual(0);
    expect(result.progressPercent).toBeLessThanOrEqual(100);
  });
});

// ─── toLocalDateString ────────────────────────────────────────────────────────

describe("toLocalDateString", () => {
  it("returns YYYY-MM-DD format", () => {
    const date = new Date("2026-04-16T12:00:00Z");
    const result = toLocalDateString(date, "UTC");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result).toBe("2026-04-16");
  });

  it("handles invalid timezone by falling back to UTC", () => {
    const date = new Date("2026-04-16T12:00:00Z");
    const result = toLocalDateString(date, "Invalid/Timezone");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns correct local date for America/New_York (UTC-4 in April)", () => {
    // 2026-04-16 at 00:30 UTC = 2026-04-15 at 20:30 EST (UTC-4)
    const date = new Date("2026-04-16T00:30:00Z");
    const result = toLocalDateString(date, "America/New_York");
    expect(result).toBe("2026-04-15");
  });

  it("returns correct UTC date when timezone is UTC", () => {
    const date = new Date("2026-04-16T23:59:00Z");
    const result = toLocalDateString(date, "UTC");
    expect(result).toBe("2026-04-16");
  });
});

// ─── updateStreak ─────────────────────────────────────────────────────────────

describe("updateStreak", () => {
  const BASE_STATS = {
    currentStreak: 3,
    longestStreak: 5,
    lastStreakDate: null as string | null,
  };

  it("increments streak on consecutive day", () => {
    const stats = { ...BASE_STATS, lastStreakDate: "2026-04-15" };
    const completionTime = new Date("2026-04-16T12:00:00Z");
    const result = updateStreak(stats, completionTime, "UTC");
    expect(result.newStreak).toBe(4);
    expect(result.lastStreakDate).toBe("2026-04-16");
  });

  it("does not change streak on same-day completion", () => {
    const stats = { ...BASE_STATS, lastStreakDate: "2026-04-16" };
    const completionTime = new Date("2026-04-16T15:00:00Z");
    const result = updateStreak(stats, completionTime, "UTC");
    expect(result.newStreak).toBe(3); // unchanged
    expect(result.lastStreakDate).toBe("2026-04-16");
  });

  it("resets streak to 1 when a day is missed", () => {
    const stats = { ...BASE_STATS, lastStreakDate: "2026-04-13" }; // 3 days ago
    const completionTime = new Date("2026-04-16T12:00:00Z");
    const result = updateStreak(stats, completionTime, "UTC");
    expect(result.newStreak).toBe(1);
    expect(result.lastStreakDate).toBe("2026-04-16");
  });

  it("starts streak at 1 when lastStreakDate is null (first ever lesson)", () => {
    const stats = { currentStreak: 0, longestStreak: 0, lastStreakDate: null };
    const completionTime = new Date("2026-04-16T12:00:00Z");
    const result = updateStreak(stats, completionTime, "UTC");
    expect(result.newStreak).toBe(1);
    expect(result.lastStreakDate).toBe("2026-04-16");
  });

  it("updates longestStreak when newStreak exceeds previous longest", () => {
    const stats = { currentStreak: 5, longestStreak: 5, lastStreakDate: "2026-04-15" };
    const completionTime = new Date("2026-04-16T12:00:00Z");
    const result = updateStreak(stats, completionTime, "UTC");
    expect(result.newStreak).toBe(6);
    expect(result.newLongestStreak).toBe(6);
  });

  it("preserves longestStreak when newStreak does not exceed it", () => {
    const stats = { currentStreak: 3, longestStreak: 10, lastStreakDate: "2026-04-15" };
    const completionTime = new Date("2026-04-16T12:00:00Z");
    const result = updateStreak(stats, completionTime, "UTC");
    expect(result.newStreak).toBe(4);
    expect(result.newLongestStreak).toBe(10); // preserved
  });

  it("correctly applies timezone when determining 'today'", () => {
    // 2026-04-16 at 01:00 UTC = 2026-04-15 at 21:00 EST (UTC-4)
    // So in America/New_York, lastStreakDate of "2026-04-14" is yesterday → increment
    const stats = { currentStreak: 2, longestStreak: 2, lastStreakDate: "2026-04-14" };
    const completionTime = new Date("2026-04-16T01:00:00Z");
    const result = updateStreak(stats, completionTime, "America/New_York");
    // In New York, this is April 15, and last date was April 14 — consecutive
    expect(result.newStreak).toBe(3);
    expect(result.lastStreakDate).toBe("2026-04-15");
  });

  it("on reset, longestStreak remains max of 1 and previous longest", () => {
    const stats = { currentStreak: 3, longestStreak: 7, lastStreakDate: "2026-04-10" };
    const completionTime = new Date("2026-04-16T12:00:00Z");
    const result = updateStreak(stats, completionTime, "UTC");
    expect(result.newStreak).toBe(1);
    expect(result.newLongestStreak).toBe(7); // preserved, not reset
  });
});
