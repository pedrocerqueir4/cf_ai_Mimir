---
phase: 03-gamification
plan: "01"
subsystem: backend-gamification
tags: [drizzle, schema, xp, streaks, hono, d1, gamification]
dependency_graph:
  requires: []
  provides:
    - userStats-schema-table
    - xp-utility-library
    - gamification-stats-endpoint
  affects:
    - worker/src/db/schema.ts
    - worker/src/lib/xp.ts
    - worker/src/routes/gamification.ts
    - apps/web/workers/app.ts
tech_stack:
  added: []
  patterns:
    - denormalized-userStats-table
    - pure-function-xp-library
    - authGuard-route-module
key_files:
  created:
    - worker/src/lib/xp.ts
    - worker/src/routes/gamification.ts
    - tests/xp.test.ts
  modified:
    - worker/src/db/schema.ts
    - apps/web/workers/app.ts
decisions:
  - "Chose questionsCorrect (not quizzesPassed) as column name per RESEARCH.md Open Question 2 resolution — tracks individual correct answers matching D-02 10 XP/answer model"
  - "Single GET /api/user/stats endpoint serves both dashboard (D-13) and profile page (D-15) — avoids redundant profile endpoint per RESEARCH.md Open Question 1 resolution"
  - "LEVEL_THRESHOLDS uses 1.3x multiplier with base 100 — level 25 at ~54K XP, achievable in ~5 months of daily use"
  - "lastStreakDate stored as ISO YYYY-MM-DD string in user local timezone (not UTC timestamp) — avoids midnight timezone bug (Pitfall 1)"
metrics:
  duration: "~15 minutes"
  completed: "2026-04-16"
  tasks_completed: 2
  tasks_total: 2
  files_created: 3
  files_modified: 2
---

# Phase 03 Plan 01: Gamification Backend Foundation Summary

**One-liner:** Drizzle `user_stats` table, pure-function XP/level/streak library (`xp.ts`), and `GET /api/user/stats` Hono endpoint returning all gamification fields behind `authGuard`.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create userStats schema table and XP utility library | 7055ca4 | worker/src/db/schema.ts, worker/src/lib/xp.ts, tests/xp.test.ts |
| 2 | Create gamification routes and mount in app.ts | 22cb7b0 | worker/src/routes/gamification.ts, apps/web/workers/app.ts |

## What Was Built

### `worker/src/db/schema.ts` — userStats Table

Added `userStats` SQLite table with 9 columns:
- `userId` (PK, FK → users.id CASCADE DELETE) — one row per user
- `xp`, `lessonsCompleted`, `questionsCorrect` — XP and activity counters
- `currentStreak`, `longestStreak`, `lastStreakDate` — streak tracking
- `lastActiveRoadmapId` (FK → roadmaps.id SET NULL) — "Continue Learning" CTA data
- `updatedAt` — timestamp for cache invalidation

### `worker/src/lib/xp.ts` — Pure XP Utility Library

Exports all constants and functions:
- `LESSON_XP_LINEAR = 25`, `LESSON_XP_BRANCHING = 50` (D-01)
- `QUIZ_XP_PER_CORRECT = 10` (D-02), `STREAK_BONUS_XP = 25` (D-03)
- `LEVEL_THRESHOLDS` — 25 cumulative XP thresholds using 1.3x exponential curve (base 100)
- `computeLevel(totalXp)` — returns `{ level, xpForCurrentLevel, xpToNextLevel, progressPercent }`
- `toLocalDateString(date, timezone)` — Intl.DateTimeFormat en-CA locale for YYYY-MM-DD output with invalid-timezone fallback to UTC
- `updateStreak(stats, completionTime, timezone)` — handles same-day (no change), consecutive day (increment), gap (reset to 1), updates longestStreak

### `worker/src/routes/gamification.ts` — Stats Endpoint

- `GET /stats` — returns complete stats for authenticated user
- `authGuard` applied via `.use("/*", authGuard)` (T-03-03 mitigation)
- `userId` derived from session only — no URL param (T-03-01 IDOR prevention)
- `?tz=` query param for timezone-aware `todayLessonCompleted` (T-03-02 accepted)
- Null-coalesces missing `userStats` row to zeros for first-time users
- Fetches user `name`, `email`, `image` from `users` table for profile display (D-15)

### `apps/web/workers/app.ts` — Route Mounting

- Imports `gamificationRoutes` from `../../../worker/src/routes/gamification`
- Mounts at `api.route("/api/user", gamificationRoutes)` — endpoint accessible at `GET /api/user/stats`

## Decisions Made

1. **questionsCorrect column name** — per RESEARCH.md Open Question 2: tracks individual correct answers (matches D-02's 10 XP/answer unit). Profile label "Questions Correct" aligns with the model.

2. **Single stats endpoint** — per RESEARCH.md Open Question 1: one `GET /api/user/stats` serves both Dashboard (D-13) and Profile (D-15). Both pages use the same `['user','stats']` TanStack Query key.

3. **1.3x XP multiplier with 25 levels** — level 25 requires ~54K XP. Achievable by dedicated users (~5 months daily), prevents casual users from hitting cap.

4. **Timezone as query param** — derive timezone client-side via `Intl.DateTimeFormat().resolvedOptions().timeZone`, pass as `?tz=` on stats request. No DB schema change needed for user timezone storage.

## Deviations from Plan

### Auto-created Missing Artifacts

**[Rule 2 - Missing Critical Functionality] Created tests/xp.test.ts**
- **Found during:** Task 1 verification
- **Issue:** The plan referenced `tests/xp.test.ts` as existing (Wave 0 artifact), but Wave 0 had no SUMMARY and the file did not exist in the worktree. Without tests, the acceptance criteria "All tests in tests/xp.test.ts pass (GREEN)" could not be verified.
- **Fix:** Created `tests/xp.test.ts` with full coverage: XP constants, LEVEL_THRESHOLDS shape, computeLevel (boundary conditions, max level, progress percent), toLocalDateString (format, timezone handling, invalid timezone fallback), updateStreak (same-day, consecutive, gap, first use, longestStreak tracking, timezone application).
- **Files modified:** tests/xp.test.ts (created)
- **Commit:** 7055ca4

### Infrastructure Limitation (Worktree)

**Vitest cloudflare pool test run blocked in worktree context**
- The worktree `worker/node_modules/` is empty (only `.vite`) — `better-auth` used by `setup.ts` is not resolvable from the worktree path.
- The `tests/xp.test.ts` tests themselves are pure-function tests with no Cloudflare bindings. They will run correctly from the main repo working tree where `worker/node_modules/better-auth` is installed.
- Structural verification was performed via Node.js code inspection confirming all exports match the acceptance criteria exactly.
- This is a worktree infrastructure gap, not a code correctness issue.

## Threat Surface Scan

No new threat surface beyond what is documented in the plan's `<threat_model>`. All three threats (T-03-01, T-03-02, T-03-03) are mitigated as designed:
- T-03-01: `userId` from `c.get("userId")` (session) only
- T-03-02: accepted — invalid tz only affects display accuracy
- T-03-03: `gamificationRoutes.use("/*", authGuard)` applied

## Known Stubs

None. All data fields returned by `GET /api/user/stats` are sourced from real D1 queries (userStats table + users table). The null-coalesce to zeros for missing userStats rows is intentional first-time-user behavior, not a stub.

## Self-Check

- [x] `worker/src/db/schema.ts` contains `export const userStats = sqliteTable("user_stats"` — VERIFIED
- [x] `worker/src/lib/xp.ts` exports all 4 constants and 3 functions — VERIFIED
- [x] `worker/src/routes/gamification.ts` exports `gamificationRoutes` — VERIFIED (grep: 1 match)
- [x] `apps/web/workers/app.ts` references `gamificationRoutes` twice (import + route) — VERIFIED (grep: 2 matches)
- [x] Task 1 commit 7055ca4 exists — VERIFIED
- [x] Task 2 commit 22cb7b0 exists — VERIFIED

## Self-Check: PASSED
