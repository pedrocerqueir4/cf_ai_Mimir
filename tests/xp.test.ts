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

describe("LEVEL_THRESHOLDS", () => {
  it("has 25 entries", () => {
    expect(LEVEL_THRESHOLDS).toHaveLength(25);
  });

  it("starts at 0 (level 1)", () => {
    expect(LEVEL_THRESHOLDS[0]).toBe(0);
  });

  it("level 2 threshold is 100", () => {
    expect(LEVEL_THRESHOLDS[1]).toBe(100);
  });

  it("thresholds are monotonically increasing", () => {
    for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) {
      expect(LEVEL_THRESHOLDS[i]).toBeGreaterThan(LEVEL_THRESHOLDS[i - 1]);
    }
  });
});

describe("computeLevel", () => {
  it("returns level 1 for 0 XP", () => {
    const result = computeLevel(0);
    expect(result.level).toBe(1);
    expect(result.progressPercent).toBe(0);
  });

  it("returns level 2 for exactly 100 XP", () => {
    const result = computeLevel(100);
    expect(result.level).toBe(2);
    expect(result.xpForCurrentLevel).toBe(0);
  });

  it("returns level 1 with progress for 50 XP", () => {
    const result = computeLevel(50);
    expect(result.level).toBe(1);
    expect(result.xpForCurrentLevel).toBe(50);
    expect(result.xpToNextLevel).toBe(50);
    expect(result.progressPercent).toBe(50);
  });

  it("returns max level (25) for very high XP", () => {
    const result = computeLevel(999999);
    expect(result.level).toBe(25);
    expect(result.progressPercent).toBe(100);
    expect(result.xpToNextLevel).toBe(0);
  });

  it("returns correct progress mid-level", () => {
    // Level 2 range: 100 to 230 (130 XP span)
    const result = computeLevel(165);
    expect(result.level).toBe(2);
    expect(result.xpForCurrentLevel).toBe(65);
    expect(result.xpToNextLevel).toBe(65);
    expect(result.progressPercent).toBe(50);
  });
});

describe("toLocalDateString", () => {
  it("returns YYYY-MM-DD format", () => {
    const date = new Date("2026-04-16T12:00:00Z");
    const result = toLocalDateString(date, "UTC");
    expect(result).toBe("2026-04-16");
  });

  it("converts to user timezone correctly", () => {
    // Midnight UTC = previous day in UTC-5
    const date = new Date("2026-04-16T03:00:00Z");
    const result = toLocalDateString(date, "America/New_York");
    // 3:00 AM UTC = 11:00 PM April 15 in EDT (UTC-4 during DST)
    expect(result).toBe("2026-04-15");
  });

  it("falls back to UTC on invalid timezone", () => {
    const date = new Date("2026-04-16T12:00:00Z");
    const result = toLocalDateString(date, "Invalid/Timezone");
    expect(result).toBe("2026-04-16");
  });
});

describe("updateStreak", () => {
  it("returns streak 1 on first-ever completion (no prior date)", () => {
    const result = updateStreak(
      { currentStreak: 0, longestStreak: 0, lastStreakDate: null },
      new Date("2026-04-16T12:00:00Z"),
      "UTC"
    );
    expect(result.newStreak).toBe(1);
    expect(result.newLongestStreak).toBe(1);
    expect(result.lastStreakDate).toBe("2026-04-16");
  });

  it("does not change streak on same-day second completion", () => {
    const result = updateStreak(
      { currentStreak: 3, longestStreak: 5, lastStreakDate: "2026-04-16" },
      new Date("2026-04-16T18:00:00Z"),
      "UTC"
    );
    expect(result.newStreak).toBe(3);
    expect(result.newLongestStreak).toBe(5);
    expect(result.lastStreakDate).toBe("2026-04-16");
  });

  it("increments streak on consecutive day", () => {
    const result = updateStreak(
      { currentStreak: 3, longestStreak: 5, lastStreakDate: "2026-04-15" },
      new Date("2026-04-16T12:00:00Z"),
      "UTC"
    );
    expect(result.newStreak).toBe(4);
    expect(result.newLongestStreak).toBe(5);
    expect(result.lastStreakDate).toBe("2026-04-16");
  });

  it("updates longestStreak when current exceeds it", () => {
    const result = updateStreak(
      { currentStreak: 5, longestStreak: 5, lastStreakDate: "2026-04-15" },
      new Date("2026-04-16T12:00:00Z"),
      "UTC"
    );
    expect(result.newStreak).toBe(6);
    expect(result.newLongestStreak).toBe(6);
  });

  it("hard resets to 1 on gap (missed day)", () => {
    const result = updateStreak(
      { currentStreak: 10, longestStreak: 10, lastStreakDate: "2026-04-13" },
      new Date("2026-04-16T12:00:00Z"),
      "UTC"
    );
    expect(result.newStreak).toBe(1);
    expect(result.newLongestStreak).toBe(10);
    expect(result.lastStreakDate).toBe("2026-04-16");
  });

  it("respects user timezone for day boundary", () => {
    // 2:00 AM UTC on April 16 = 10:00 PM April 15 in NYC (EDT, UTC-4)
    const result = updateStreak(
      { currentStreak: 3, longestStreak: 5, lastStreakDate: "2026-04-15" },
      new Date("2026-04-16T02:00:00Z"),
      "America/New_York"
    );
    // In NYC it's still April 15, so same-day — no change
    expect(result.newStreak).toBe(3);
    expect(result.lastStreakDate).toBe("2026-04-15");
  });
});
