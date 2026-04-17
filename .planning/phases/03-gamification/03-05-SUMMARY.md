---
phase: 03-gamification
plan: 05
subsystem: ui
tags: [sonner, toast, react-router-v7, shadcn, gamification]

# Dependency graph
requires:
  - phase: 03-gamification
    provides: "handleCompleteLesson toast.success call-sites, QuizQuestion toast.success, verify-email toast.success, shadcn sonner wrapper at components/ui/sonner.tsx"
provides:
  - "Mounted <Toaster /> host in root.tsx Layout, giving all sonner toast() calls a render target"
  - "Fix for UAT Test 2 gap (XP toast on lesson completion) and restoration of UAT Test 3 toast (quiz correct)"
  - "verify-email toast surface now functional alongside app-route toasts"
affects: [04-multiplayer, future-ui-work, any-phase-using-sonner-toasts]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Mount global UI providers (Toaster, future portals) in root.tsx Layout — not _app.tsx — so auth routes outside the _app group also benefit"

key-files:
  created: []
  modified:
    - apps/web/app/root.tsx

key-decisions:
  - "Mount <Toaster /> in root.tsx Layout rather than _app.tsx — _auth.verify-email.tsx lives outside the _app route group and also calls toast.success; root.tsx is the single HTML shell for every route in React Router v7 framework mode"
  - "Use default shadcn sonner wrapper props (no explicit position/theme overrides) — the wrapper at components/ui/sonner.tsx is already fully configured"
  - "No tests added — sonner is a third-party library and the gap is structural (missing mount), not behavioral; adding a unit test for a library's render host would not catch this class of bug"

patterns-established:
  - "Global UI providers mount point: root.tsx Layout body, after {children}, before <ScrollRestoration /> — canonical React Router v7 framework-mode equivalent of Next.js _app.tsx"

requirements-completed: [GAME-01, GAME-02, GAME-05]

# Metrics
duration: ~10min
completed: 2026-04-17
---

# Phase 03 Plan 05: Mount Sonner Toaster in Root Layout Summary

**Two-line mount of sonner `<Toaster />` in root.tsx Layout, restoring XP/streak/quiz/verify-email toast rendering across every route.**

## Performance

- **Duration:** ~10 min (including human UAT re-verification)
- **Completed:** 2026-04-17
- **Tasks:** 2 (1 auto + 1 human-verify checkpoint)
- **Files modified:** 1

## Accomplishments

- Mounted sonner `<Toaster />` host inside `<body>` of the `Layout` component in `apps/web/app/root.tsx`, giving every route in the app a shared toast render target.
- Closed UAT Test 2 gap from `03-HUMAN-UAT.md`: `+25 XP earned` toast on lesson completion (plus the ~300ms-delayed `+25 XP bonus — Streak active — keep it up!` toast when streak ≥ 2) now renders as specified.
- Restored UAT Test 3 toast visibility: `+10 XP earned — Correct answer` toast now appears on correct quiz answers (previously cosmetically masked by `QuizQuestion.tsx` inline `role="alert"` feedback card).
- Passively restored the `_auth.verify-email.tsx` toast surface (same root-cause fix, no additional work).
- User browser-verified both Test 2 and Test 3 pass at runtime; approval signal received.

## Task Commits

Each task was committed atomically:

1. **Task 1: Mount sonner Toaster in root.tsx Layout** - `0557c75` (feat) — +2 lines (1 import, 1 JSX element)
2. **Task 2: Re-run UAT Test 2 and re-verify Test 3 toast visibility** - no commit (human-verify checkpoint, runtime verification only)

**Plan metadata:** this SUMMARY commit (docs: complete plan)

## Files Created/Modified

- `apps/web/app/root.tsx` — Added `import { Toaster } from "~/components/ui/sonner"` and rendered `<Toaster />` inside `<body>`, between `{children}` and `<ScrollRestoration />`. Diff is exactly +2 lines / -0 lines.

## Decisions Made

- **Mount in root.tsx, not _app.tsx:** Auth routes (`_auth.verify-email.tsx`) live outside the `_app` route group. `_app.tsx` would leave them without a Toaster. `root.tsx` is the single HTML shell wrapping every route in React Router v7 framework mode — analogous to Next.js `_app.tsx` or an SPA `index.html`. One mount covers every surface.
- **No Toaster props:** The shadcn wrapper at `apps/web/app/components/ui/sonner.tsx` already configures theme, icons, and toastOptions; passing props would override curated defaults without benefit.
- **No tests:** Sonner is third-party; the bug was a missing mount, not a logic error. A unit test would not have caught it, and an end-to-end test for toast rendering is out of scope for a 2-LOC structural fix.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. The 2-LOC edit landed cleanly; `tsc --noEmit` was clean post-edit; grep matched exactly 2 `Toaster` references (import + JSX); `git diff --stat` showed `1 file changed, 2 insertions(+)`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 03 (Gamification) UAT gap is fully closed. All four UAT tests now pass at runtime per user confirmation.
- **Recommended follow-up (orchestrator-owned, not part of this plan):** Update `.planning/phases/03-gamification/03-HUMAN-UAT.md` to flip Test 2 status from `issue` → `pass`, clear the Gaps section, and mark `.planning/debug/xp-toast-not-appearing-lesson.md` as `resolved` with `files_changed: [apps/web/app/root.tsx]` and the commit hash `0557c75`. Alternatively, a fresh `/gsd-verify-phase 3` run will regenerate both documents with current state.
- No blockers for downstream phases. Phase 04 (Multiplayer) and any future UI work now inherit a working global toast surface without additional mount work.

## Self-Check: PASSED

- File `.planning/phases/03-gamification/03-05-SUMMARY.md` created at write time (this file).
- Commit `0557c75` exists: confirmed in `git log --oneline -5` showing `0557c75 feat(03-05): mount sonner Toaster in root Layout`.
- File `apps/web/app/root.tsx` exists and contains the Toaster mount (verified during Task 1 automated check: grep matched exactly 2 references, tsc clean, diff +2/-0).
- User approval captured at Task 2 checkpoint ("approved" after browser-verifying Tests 2 and 3).

---
*Phase: 03-gamification*
*Completed: 2026-04-17*
