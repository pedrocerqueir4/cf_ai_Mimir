---
phase: 03-gamification
plan: "02"
subsystem: frontend-gamification
tags: [gamification, ui-components, api-client, react, tailwind]
dependency_graph:
  requires: [03-00]
  provides: [XPProgressBar, StreakCounter, StatCard, LevelBadge, UserStats, LessonCompleteResult, fetchUserStats]
  affects: [03-04]
tech_stack:
  added: []
  patterns:
    - shadcn Progress + Badge composition for XP display
    - lucide-react Flame icon for streak visualization
    - useRef + useEffect for level-up pulse animation with motion-reduce accessibility
    - api-client typed fetch functions with credentials: include
key_files:
  created:
    - apps/web/app/components/gamification/XPProgressBar.tsx
    - apps/web/app/components/gamification/StreakCounter.tsx
    - apps/web/app/components/gamification/StatCard.tsx
    - apps/web/app/components/gamification/LevelBadge.tsx
  modified:
    - apps/web/app/lib/api-client.ts
decisions:
  - "LevelBadge uses useRef to track previous level and triggers 1500ms animate-pulse only on level increase — no modal, subtle per D-06"
  - "completeLesson updated to return LessonCompleteResult (not void) — breaking change callers must handle; timezone optional param adds X-User-Timezone header"
  - "fetchUserStats uses tz query param to allow server-side streak computation in user timezone"
metrics:
  duration: "1 minute"
  completed_date: "2026-04-16"
  tasks_completed: 2
  files_created: 4
  files_modified: 1
---

# Phase 03 Plan 02: Gamification UI Components and API Client Types Summary

**One-liner:** Four gamification components (XPProgressBar, StreakCounter, StatCard, LevelBadge) with shadcn composition and pulse animation, plus UserStats/LessonCompleteResult types and fetchUserStats added to api-client.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create four gamification components | a8bf1bc | XPProgressBar.tsx, StreakCounter.tsx, StatCard.tsx, LevelBadge.tsx |
| 2 | Extend api-client.ts with gamification types and functions | 5bbf13c | api-client.ts |

## What Was Built

### Task 1: Gamification Components

Four components in `apps/web/app/components/gamification/`:

- **XPProgressBar** — shadcn `Progress` (h-2, 400ms width transition) with `Badge` level label and XP counts. Props: `xp`, `level`, `xpToNextLevel`, `progressPercent`.
- **StreakCounter** — lucide-react `Flame` icon (orange `hsl(30 80% 55%)` when active, muted when zero) in a `Card` with conditional messages for active/today-complete/zero streak states. Props: `streak`, `longestStreak`, `todayCompleted`.
- **StatCard** — reusable `Card` + `CardContent` metric display with optional icon slot, `min-h-12` for touch target compliance. Props: `label`, `value`, `icon?`.
- **LevelBadge** — `Badge` with `useRef`/`useEffect` level-increase detection, triggers `animate-pulse` for 1500ms on level-up, `motion-reduce:animate-none` for accessibility. Props: `level`.

### Task 2: API Client Extensions

Modified `apps/web/app/lib/api-client.ts`:

- Added `LessonCompleteResult` interface: `completed`, `xpEarned`, `streakBonus`, `newXp`, `newLevel`, `levelUp`
- Added `UserStats` interface: 13 fields covering XP, level, streak, progress, profile info
- Added `xpEarned: number` to `QuizAnswerResult` interface
- Updated `completeLesson` return type: `Promise<void>` → `Promise<LessonCompleteResult>`, added optional `timezone?: string` param that sends `X-User-Timezone` header
- Added `fetchUserStats(tz: string): Promise<UserStats>` function calling `/api/user/stats?tz=` with `credentials: "include"`

## Deviations from Plan

None — plan executed exactly as written. All component code matched plan specifications precisely.

## Known Stubs

None. All components render the data passed via props. No hardcoded placeholder values or TODO comments.

## Threat Surface Scan

No new network endpoints, auth paths, or trust boundary crossings introduced. Components are client-side render only; api-client types are compile-time only with actual validation server-side per T-03-05 (accepted in threat model).

## Self-Check: PASSED

- apps/web/app/components/gamification/XPProgressBar.tsx: FOUND
- apps/web/app/components/gamification/StreakCounter.tsx: FOUND
- apps/web/app/components/gamification/StatCard.tsx: FOUND
- apps/web/app/components/gamification/LevelBadge.tsx: FOUND
- export interface UserStats in api-client.ts: FOUND (1 match)
- export interface LessonCompleteResult in api-client.ts: FOUND (1 match)
- export async function fetchUserStats in api-client.ts: FOUND (1 match)
- xpEarned in api-client.ts: FOUND (2 occurrences — QuizAnswerResult field + LessonCompleteResult field)
- Commits a8bf1bc and 5bbf13c: FOUND in git log
