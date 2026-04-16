---
phase: 03-gamification
plan: "04"
subsystem: frontend-ui
tags: [dashboard, profile, gamification, tanstack-query, mobile-first]
dependency_graph:
  requires: [03-01, 03-02, 03-03]
  provides: [dashboard-page, profile-page]
  affects: [apps/web/app/routes/_app._index.tsx, apps/web/app/routes/_app.profile.tsx, apps/web/app/routes.ts]
tech_stack:
  added: []
  patterns:
    - TanStack Query shared cache key ["user", "stats"] with staleTime 30_000ms
    - Time-based greeting derived from new Date().getHours()
    - 2-column StatCard grid for profile stats display
key_files:
  created:
    - apps/web/app/routes/_app.profile.tsx
  modified:
    - apps/web/app/routes/_app._index.tsx
    - apps/web/app/routes.ts
decisions:
  - Shared ["user", "stats"] TanStack Query cache key between Home and Profile pages — single fetch populates both routes
  - pb-24 bottom padding on all page wrappers to clear the fixed BottomNav
  - Initials fallback for Avatar: first character of each name segment, uppercase, max 2 chars
metrics:
  duration: "~8 minutes"
  completed_date: "2026-04-16"
  tasks_completed: 2
  tasks_total: 3
  files_changed: 3
---

# Phase 3 Plan 04: Dashboard and Profile Pages Summary

**One-liner:** Stats dashboard at `/` with XP progress bar + streak counter + CTA, and profile page at `/profile` with 6-card stats grid — both consuming the shared `["user", "stats"]` TanStack Query cache.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Replace Home page with stats dashboard | 730fd70 | apps/web/app/routes/_app._index.tsx |
| 2 | Create Profile page and register route | f1429cf | apps/web/app/routes/_app.profile.tsx, apps/web/app/routes.ts |

## Task 3: Checkpoint — Awaiting Visual Verification

Task 3 is a `checkpoint:human-verify` gate. Automated checks were completed; visual verification requires human review.

### Automated Check Results (Task 3)

| Check | Result |
|-------|--------|
| `grep -c "XPProgressBar" apps/web/app/routes/_app._index.tsx` | 2 (PASS) |
| `grep -c "StatCard" apps/web/app/routes/_app.profile.tsx` | 7 (PASS) |
| `grep -c "profile" apps/web/app/routes.ts` | 1 (PASS) |

### Visual Verification Steps (for human)

1. Run `npm run dev` from project root and sign in
2. Navigate to Home (`/`) — verify:
   - Time-based greeting ("Good morning/afternoon/evening, {firstName}")
   - XP progress bar showing level badge and progress to next level
   - Streak counter with flame icon showing day count
   - "Continue Learning" button linking to last active roadmap (or "Start Your First Roadmap" → `/chat` if no roadmaps)
3. Navigate to Profile (`/profile`) via BottomNav — verify:
   - Avatar (or initials fallback), name, and email in header
   - 6 stat cards in 2-column grid: Level, Total XP, Current Streak, Best Streak, Lessons Done, Quizzes Passed
4. Check mobile viewport (375px width): content visible, touch targets ≥ 48px, BottomNav not overlapping content

## What Was Built

### Task 1: Stats Dashboard (Home Page)

Replaced the 23-line empty-state placeholder with a full stats dashboard:

- **Imports:** `XPProgressBar`, `StreakCounter` from gamification components; `fetchUserStats` from api-client; `Link`, `Button`, `Card`, `Skeleton`
- **Data fetching:** `useQuery({ queryKey: ["user", "stats"], queryFn: () => fetchUserStats(tz), staleTime: 30_000 })`
- **Timezone:** `Intl.DateTimeFormat().resolvedOptions().timeZone` passed to `fetchUserStats`
- **Greeting:** `hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"` + first name from `stats.name`
- **Loading state:** 4 skeleton blocks matching live content height
- **Data state:** Card with `XPProgressBar`, then `StreakCounter`, then CTA button
- **CTA logic:** `lastActiveRoadmapId` present → "Continue Learning" linking to `/roadmaps/{id}`; null → "Start Your First Roadmap" linking to `/chat`
- **Layout:** `px-4 pt-8 pb-24` (pb-24 clears BottomNav)
- **Touch target:** CTA button has `min-h-12` (48px)

### Task 2: Profile Page + Route Registration

Created `apps/web/app/routes/_app.profile.tsx` and registered it in `routes.ts`:

- **Three states:** loading (skeleton grid), error ("Couldn't load your stats"), data
- **Loading skeleton:** 6 skeleton cards in `grid grid-cols-2 gap-3`, plus avatar and title skeletons
- **User header:** `Avatar` with `AvatarImage` (when `stats.image` set) and `AvatarFallback` (initials); name + email
- **Stats grid:** 6 `StatCard` components in `grid grid-cols-2 gap-3` with labels exactly matching UI-SPEC: "Level", "Total XP", "Current Streak", "Best Streak", "Lessons Done", "Quizzes Passed"
- **Icons:** Trophy, Star, Flame, TrendingUp, BookOpen, HelpCircle from lucide-react
- **Shared cache:** Same `["user", "stats"]` query key as Home page — no double fetch when navigating between tabs
- **Route:** `route("profile", "routes/_app.profile.tsx")` added inside `_app.tsx` layout block after the quiz route

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — both pages fully wire to real data from `GET /api/user/stats`.

## Threat Flags

None — dashboard and profile are read-only pages consuming user's own data; all auth enforced at the API endpoint layer (Plan 01). No new trust boundaries introduced.

## Self-Check

### Files exist:
- apps/web/app/routes/_app._index.tsx: EXISTS (62 lines, full replacement)
- apps/web/app/routes/_app.profile.tsx: EXISTS (109 lines, new file)
- apps/web/app/routes.ts: MODIFIED (profile route added)

### Commits exist:
- 730fd70: feat(03-04): replace Home page with stats dashboard
- f1429cf: feat(03-04): create Profile page with stats grid and register route

## Self-Check: PASSED
