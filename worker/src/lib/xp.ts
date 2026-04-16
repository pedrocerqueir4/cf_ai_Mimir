// ─── XP Constants ─────────────────────────────────────────────────────────────

export const LESSON_XP_LINEAR = 25;
export const LESSON_XP_BRANCHING = 50;
export const QUIZ_XP_PER_CORRECT = 10; // D-02: 10 XP per correct answer
export const STREAK_BONUS_XP = 25; // D-03: flat +25 bonus

// ─── Level Computation ────────────────────────────────────────────────────────

const XP_BASE = 100;
const XP_MULTIPLIER = 1.3;
const MAX_LEVELS = 25;

// Pre-compute cumulative thresholds at module load (25 entries, negligible memory)
export const LEVEL_THRESHOLDS: number[] = (() => {
  const thresholds = [0]; // Level 1 starts at 0
  let cumulative = 0;
  for (let n = 1; n < MAX_LEVELS; n++) {
    cumulative += Math.round(XP_BASE * Math.pow(XP_MULTIPLIER, n - 1));
    thresholds.push(cumulative);
  }
  return thresholds;
})();

export function computeLevel(totalXp: number): {
  level: number;
  xpForCurrentLevel: number;
  xpToNextLevel: number;
  progressPercent: number;
} {
  let level = 1;
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (totalXp >= LEVEL_THRESHOLDS[i]) {
      level = i + 1;
      break;
    }
  }
  // Cap at max level
  if (level >= MAX_LEVELS) {
    return { level: MAX_LEVELS, xpForCurrentLevel: 0, xpToNextLevel: 0, progressPercent: 100 };
  }
  const currentThreshold = LEVEL_THRESHOLDS[level - 1];
  const nextThreshold = LEVEL_THRESHOLDS[level];
  const xpIntoLevel = totalXp - currentThreshold;
  const xpNeeded = nextThreshold - currentThreshold;
  return {
    level,
    xpForCurrentLevel: xpIntoLevel,
    xpToNextLevel: xpNeeded - xpIntoLevel,
    progressPercent: Math.round((xpIntoLevel / xpNeeded) * 100),
  };
}

// ─── Timezone Utility ─────────────────────────────────────────────────────────

export function toLocalDateString(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date); // Returns "YYYY-MM-DD" in en-CA locale
  } catch {
    // Invalid timezone — fallback to UTC
    return date.toISOString().slice(0, 10);
  }
}

// ─── Streak Logic ─────────────────────────────────────────────────────────────

export function updateStreak(
  stats: { currentStreak: number; longestStreak: number; lastStreakDate: string | null },
  completionTime: Date,
  userTimezone: string
): { newStreak: number; newLongestStreak: number; lastStreakDate: string } {
  const today = toLocalDateString(completionTime, userTimezone);
  const yesterday = toLocalDateString(
    new Date(completionTime.getTime() - 86_400_000),
    userTimezone
  );

  if (stats.lastStreakDate === today) {
    // Already completed today — no change to streak
    return {
      newStreak: stats.currentStreak,
      newLongestStreak: stats.longestStreak,
      lastStreakDate: stats.lastStreakDate,
    };
  } else if (stats.lastStreakDate === yesterday) {
    // Consecutive day — increment streak
    const newStreak = stats.currentStreak + 1;
    return {
      newStreak,
      newLongestStreak: Math.max(newStreak, stats.longestStreak),
      lastStreakDate: today,
    };
  } else {
    // Gap detected — hard reset (D-10)
    return { newStreak: 1, newLongestStreak: Math.max(1, stats.longestStreak), lastStreakDate: today };
  }
}
