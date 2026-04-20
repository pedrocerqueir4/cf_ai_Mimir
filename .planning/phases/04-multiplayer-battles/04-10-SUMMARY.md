---
phase: 04-multiplayer-battles
plan: 10
subsystem: multiplayer-battles
status: complete
started: 2026-04-20
completed: 2026-04-20
gap_closure: true
gap_source: .planning/phases/04-multiplayer-battles/04-UAT.md#workflow-failure-gap
tags: [multiplayer, wave-7, gap-closure, workflow-resilience, lobby-timeout, nyquist]
requirements_addressed:
  - MULT-01
  - MULT-02
threat_refs:
  - T-04-gap-04
  - T-04-gap-05
  - T-04-gap-06
dependency_graph:
  requires:
    - 04-03 (BattleQuestionGenerationWorkflow step helpers — Option B testing pattern)
    - 04-09 (join-path pool-failure gap closure — precedent fix pattern)
  provides:
    - wall-clock-bounded failure surfacing for workflow-level AI upstream drops
    - recoverable UX state (stuck-pane) for workflow failures that don't promptly flip poolStatus='failed'
    - regression coverage for markPoolTopicFailed compositional contract
  affects:
    - BattleQuestionGenerationWorkflow step-1 retry budget (~105s → ~9s)
    - _app.battle.pre.$id.tsx Phase state machine (adds 'stuck' recoverable variant)
    - 04-VALIDATION.md Per-Task Verification Map + Manual-Only Verifications table
tech_stack:
  added: []
  patterns:
    - tightened retry budget (limit:2, delay:"3 seconds", exponential backoff) for upstream-sensitive steps
    - useRef wall-clock tracker (not useState) for render-phase elapsed-time gates
    - recoverable "stuck" phase distinct from terminal "error" — user agency preserved
    - simulated outer-catch testing (Option B) for Workflow helpers miniflare cannot drive
key_files:
  created:
    - tests/battle/battle.workflow.failure.test.ts
  modified:
    - worker/src/workflows/BattleQuestionGenerationWorkflow.ts
    - apps/web/app/routes/_app.battle.pre.$id.tsx
    - .planning/phases/04-multiplayer-battles/04-VALIDATION.md
decisions:
  - "Tightened step-1 retry to limit:2 delay:3s (~9s window) rather than adding regex-based fail-fast marker logic — regex matching on error messages is fragile, the retry budget is sufficient, and the frontend 45s stuck-pane has 5x headroom"
  - "useRef over useState for loadingStartedAtRef — a wall-clock anchor must not trigger re-renders; setting it inside the watchdog useEffect keeps render phase pure"
  - "Stuck-pane is recoverable (not terminal) — 'Keep waiting' resets the ref and drops back to 'loading', restoring polling. Distinct from ErrorPane which is terminal on poolStatus='failed'"
  - "Cancel CTA swallows 403 (guest has no host-only cancel permission) — the navigation is the primary outcome; documented as best-effort per-plan-04-09 precedent"
  - "DO pool-ready watchdog (original Task 3) deferred to Phase 5 — adding another BattleRoom alarm without an alarmReason discriminator would conflict with the 4 existing alarm purposes (disconnect-grace, lobby-timeout, question-timer, post-end grace); tightened workflow retries + frontend 45s timeout already bound the user-visible failure window"
  - "Regression test skips wall-clock retry-window assertion (Workflow runtime not drivable from miniflare) — tests Option B helper composition + static source review locks the retry config for future regressions"
metrics:
  duration_minutes: 7
  tasks: 4
  files_modified: 3
  files_created: 1
  commits: 4
---

# Phase 04 Plan 10: Workflow-Failure + Lobby-Recovery UX Gap Closure Summary

**One-liner:** Tightened BattleQuestionGenerationWorkflow step-1 retry budget from ~105s to ~9s and added a 45s stuck-pane with Cancel/Keep-waiting CTAs to the pre-battle page — closes the UAT Phase 04 Test 5 SECOND gap where a persistent "Network connection lost" from Workers AI left both players on an infinite lobby spinner with no recovery path.

---

## Gap Closed

**Source:** `.planning/phases/04-multiplayer-battles/04-UAT.md` Test 5 (SECOND gap — `status: failed`, not the `status: resolved` join-path gap that Plan 04-09 closed).

**User-reported symptom:** After Plan 04-09 fixed the synchronous join-path crash, Test 5 was re-verified: guest join mechanically succeeded, both players landed in the lobby. But on the lobby → pre-battle transition, logs showed `[BattleQuestionGenerationWorkflow] START poolTopicId="..." topic="..."` immediately followed by `Network connection lost`. Both players stuck on "Preparing your battle…" spinner forever. No user-facing error, no recovery button, no timeout.

**Confirmed root cause:** Two independent mechanisms conspired.

1. **Workflow retry budget too long:** Step 1 (`generate-battle-questions`) retry config was `{ limit: 3, delay: "15 seconds", backoff: "exponential" }`, producing a ~105s retry window (15s + 30s + 60s) before the outer catch block could call `markPoolTopicFailed`. To a user, 105s of silent spinner is indistinguishable from a crash.

2. **No frontend timeout:** The pre-battle page polled `GET /api/battle/:id` every 2s but had zero elapsed-time tracking. If `poolStatus` stayed `'generating'` forever, the UI stayed on `LoadingPane` forever.

---

## Before / After: Retry Windows & UX

**Before (broken):**

| Layer | Behaviour |
|-------|-----------|
| Workflow step-1 | `{ limit: 3, delay: "15 seconds", backoff: "exponential" }` → 15s + 30s + 60s = **~105s** until outer catch fires |
| Frontend pre-battle | Polls every 2s. `poolStatus === 'generating'` → `LoadingPane` forever. No elapsed-time tracker. No recovery CTA. |
| Worst-case UX | 105s+ silent spinner → users assume crash → leave app |

**After (fixed):**

| Layer | Behaviour |
|-------|-----------|
| Workflow step-1 | `{ limit: 2, delay: "3 seconds", backoff: "exponential" }` → 3s + 6s = **~9s** until outer catch fires and writes `poolStatus='failed'` |
| Frontend pre-battle | After 45s in `loading` phase with `poolStatus === 'generating'`, transition to `'stuck'` phase. `StuckPane` renders with 'Cancel and try again' + 'Keep waiting' CTAs. `pollActive` drops to false so polling halts (T-04-gap-06 mitigation). |
| Worst-case UX | Normal path: ~9s to `ErrorPane` via `poolStatus='failed'`. Abnormal path (workflow hangs): 45s to `StuckPane` with actionable recovery. |

---

## New 'stuck' Phase Contract

Added to the `Phase` union in `apps/web/app/routes/_app.battle.pre.$id.tsx`:

```typescript
type Phase =
  | "loading" | "wager-propose" | "waiting-for-opponent"
  | "roadmap-reveal" | "wager-reveal" | "countdown" | "starting"
  | "stuck"  // NEW: recoverable — user may cancel or keep waiting
  | "error"; // UNCHANGED: terminal
```

**Entry conditions:** `phase === 'loading'` AND `lobby.poolStatus === 'generating'` AND `Date.now() - loadingStartedAtRef.current > 45_000` (the ref is seeded on first render meeting the first two conditions).

**Exit paths:**
- `handleCancelStuck` → `cancelBattle(battleId)` (swallowed 403 for guest, swallowed 409 for already-transitioned) → `navigate('/battle', { replace: true })`
- `handleKeepWaiting` → resets `loadingStartedAtRef.current = Date.now()` + `setPhase('loading')` (polling resumes, 45s window restarts)

**Polling gate:** `pollActive = phase === 'loading' || 'wager-propose' || 'waiting-for-opponent'` — `'stuck'` is deliberately excluded, bounding HTTP fan-out to zero once the user has been shown the stuck-pane. Only the `Keep waiting` path re-enters a polling phase.

**Distinction from `'error'`:** Error is terminal — `poolStatus === 'failed'` (workflow explicitly signaled failure) or `lobbyError.status === 403` (auth drop). Stuck is indeterminate — the workflow hasn't reported failure, it just hasn't reported success within the expected window. User agency is preserved.

---

## Test 04-33 Coverage (Automated)

File: `tests/battle/battle.workflow.failure.test.ts` (3 assertions, all green, ~9s)

| Case | Scenario | Contract Asserted |
|------|----------|-------------------|
| A | Call `markPoolTopicFailed` directly on a seeded `generating` row | `battle_pool_topics.status` flips to `'failed'`; `updated_at` is present (non-null) |
| B | `generateAndStoreBattleQuestions` with an AI mock that throws `Network connection lost` on every call | Function rejects with `/Network connection lost/`; `battle_quiz_pool` has ZERO rows for this `pool_topic_id` (no partial writes — the helper throws before the INSERT loop begins); `battle_pool_topics.status` unchanged (`'generating'`) — the step body does not self-mark failed |
| C | Full simulated outer-catch path: helper throws → catch block invokes `markPoolTopicFailed` | `battle_pool_topics.status` flips to `'failed'` — matches what polling `GET /api/battle/:id` returns as `poolStatus='failed'` to the pre-battle page (`poolStatus === 'failed'` branch at `_app.battle.pre.$id.tsx` lines 167-173 then transitions phase to `'error'`) |

**Why no wall-clock retry assertion:** `WorkflowEntrypoint` runtime cannot be driven from miniflare (documented limitation). `vi.useFakeTimers` on the retry scheduler would test the mock, not the real behavior. The ~9s retry budget is locked by source-level review (the static delay string `"3 seconds"` with `limit: 2` is present in `worker/src/workflows/BattleQuestionGenerationWorkflow.ts`) and by the existing `tests/battle/battle.workflow.populate.test.ts` suite exercising the same helpers on the success path.

---

## Test 04-34 Rationale (Manual-Only)

Pre-battle stuck-pane + 45s pool-generating timeout is declared manual-only per Nyquist 8a:

- **45s wall-clock** — simulating in unit tests requires `vi.useFakeTimers`, which tests the timer mock's behavior rather than the actual UX flow (poll tick → ref update → elapsed computation → setState).
- **Real-time poll flow** — requires coordinating TanStack Query's `refetchInterval` + a live `fetchBattleLobby` mock + a race between `lobby.poolStatus` transitions and the watchdog `useEffect`. This is integration-test surface, not unit-test surface.
- **Navigation flow** — `navigate('/battle', { replace: true })` crosses the React Router boundary; RTL `MemoryRouter` mocks can stub it but don't assert the full post-navigation state.
- **React Testing Library not wired in this repo** — RTL adoption is a non-trivial infrastructure change; deferring is aligned with Plan 05/06/07's established manual-UAT pattern for frontend-heavy UX.

Recorded in `## Manual-Only Verifications` with explicit repro instructions (two sessions, disabled AI binding, 45s wait, both CTAs exercised).

---

## Task 3 (DO Pool-Ready Watchdog) — Deferred to Phase 5

The original gap analysis proposed a third belt-and-suspenders layer: a `BattleRoom` DO alarm set at `opAttachGuest` (+60s) that would auto-transition the battle to `'expired'` and broadcast a terminal event if the workflow somehow bypassed its own outer catch. **Not shipped in this plan** because:

1. **Redundant with existing mitigations.** Tightened workflow retries (~9s) + frontend 45s timeout already give user-actionable failure within wall-clock seconds. The watchdog protects against an undocumented "Workflow engine bypasses user catch" failure mode for which we have zero in-the-wild evidence.

2. **Alarm conflict risk.** `BattleRoom.alarm()` currently multiplexes 4 purposes via implicit sequencing (disconnect-grace at :495, lobby-timeout at :511, question-timer at :514, post-end grace at :987). Adding a 5th purpose without a proper `alarmReason` discriminator field would be fragile — silent misdispatch would be hard to detect.

3. **Test infrastructure gap.** Validating the watchdog end-to-end requires driving `ctx.storage.setAlarm()` + `alarm()` invocation across the DO test harness — infrastructure not currently wired.

**Follow-up action:** File a Phase 5 ops-hardening ticket. First step: refactor `BattleRoom.alarm()` to read `storage.get('alarmReason')` and dispatch explicitly by discriminator. Then add the pool-ready watchdog as a new reason. Not urgent pre-production; current layers already bound the user-visible failure window.

---

## Deviations from Plan

**None behavioural.** Plan executed exactly as written in all 4 tasks.

**Minor scope adjustment (Task 3 test file):** The plan's behaviour section lists the 3 tests A/B/C. I briefly considered adding a 4th static-source-read assertion to lock the retry budget (`"3 seconds"` must appear in the workflow source), but reverted — importing `node:fs` into a miniflare-pooled vitest test risks environment issues (`node:fs` may not resolve cleanly in the Workers runtime even with `enable_nodejs_fs_module` flagged). The retry budget is locked instead by the commit message of Task 1 plus the explicit inline comment in the workflow source. Tracked here for completeness; not an auto-fix rule trigger.

**`.planning/` gitignore:** Required `git add -f` on the VALIDATION.md update (standard for this repo per Plan 04-09 precedent).

---

## Verification Evidence

**TypeScript compile (after each task):**
- Task 1: `cd worker && npx tsc --noEmit` → exit 0 (retry-config change is type-invisible).
- Task 2: `cd apps/web && npx tsc -b` → exit 0 (new Phase variant + useRef + StuckPane all type-clean).

**Per-task test runs:**
- Task 1: `npm test -- tests/battle/battle.workflow.populate.test.ts tests/battle/battle.pool.miss.test.ts tests/battle/battle.pool.reuse.test.ts` → 3 files / 11 tests green.
- Task 2: `cd apps/web && npx tsc -b` → exit 0.
- Task 3: `npm test -- tests/battle/battle.workflow.failure.test.ts` → 1 file / 3 tests green (~9s).
- Task 4: `grep -q "04-33" .planning/phases/04-multiplayer-battles/04-VALIDATION.md` + counter bump verified 35 → 37 + Addendum 2026-04-19c present + `nyquist_compliant: true` preserved.

**Final full battle suite:** `npm test -- tests/battle/` → **34 files passed** (1 skipped by design — stubs registry), **128 assertions + 32 todos**, duration **66.75s** (under 90s Nyquist budget). Up from pre-plan 33 files / 125 assertions.

---

## Orphaned-Row Tech-Debt Note

Same as Plan 04-09. Users who hit the workflow-failure bug BEFORE this plan shipped may have battle rows stuck at `status='pre-battle'` + `poolStatus='generating'` forever (the pre-Plan-04-10 workflow could retry for 105s before finally failing OR the retry itself silently hung). One-time cleanup SQL:

```sql
UPDATE battles
  SET status = 'expired'
  WHERE status = 'pre-battle'
    AND pool_topic_id IN (
      SELECT id FROM battle_pool_topics
      WHERE status = 'generating'
        AND updated_at < strftime('%s','now','-5 minutes')
    );

-- Also mark stuck pool topics 'failed' so the partial UNIQUE index on
-- battle_pool_topics.topic does not block a retry of the same topic string:
UPDATE battle_pool_topics
  SET status = 'failed', updated_at = strftime('%s','now')
  WHERE status = 'generating'
    AND updated_at < strftime('%s','now','-5 minutes');
```

The `-5 minutes` guard ensures no in-flight join is touched. This plan deliberately does NOT ship the SQL as a task — pre-production, tiny user base, and running data-mutation SQL from a plan commit is a footgun. Owner should run manually via `wrangler d1 execute` post-deploy if any orphaned rows exist.

---

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | `d8120dc` | fix(04-10): tighten BattleQuestionGenerationWorkflow step-1 retry so failure lands in ~9s |
| 2 | `7e2ace3` | feat(04-10): add 45s stuck-pane timeout + cancel/keep-waiting CTAs on pre-battle page |
| 3 | `b3b8200` | test(04-10): regression test for BattleQuestionGenerationWorkflow failure -> markPoolTopicFailed |
| 4 | `bd036e8` | docs(04-10): register Tests 04-33 + 04-34 for workflow failure + stuck-pane timeout in VALIDATION.md |

---

## Success Criteria

- [x] `worker/src/workflows/BattleQuestionGenerationWorkflow.ts` step-1 retry config is `{ limit: 2, delay: "3 seconds", backoff: "exponential" }` — no other lines changed
- [x] `apps/web/app/routes/_app.battle.pre.$id.tsx` `Phase` union includes `"stuck"`; `POOL_STUCK_THRESHOLD_MS = 45_000` constant exists
- [x] Elapsed-time `useEffect` transitions `phase` to `'stuck'` after 45s of `poolStatus==='generating'` in the `'loading'` phase
- [x] `StuckPane` renders with "Taking longer than expected" heading and two CTAs wired correctly (`cancelBattle(battleId)` + navigate on cancel, ref-reset on keep-waiting)
- [x] `cd apps/web && npx tsc -b` passes; `cd worker && npx tsc --noEmit` passes
- [x] `tests/battle/battle.workflow.failure.test.ts` exists with 3 green assertions (A, B, C)
- [x] `04-VALIDATION.md` Per-Task Verification Map contains rows `04-33` (✅ green) and `04-34` (✅ manual-only)
- [x] Validation Audit counters bumped from 35 → 37; Addendum 2026-04-19c section documents source + fix + Task 3 deferral
- [x] Manual-Only Verifications table contains the new stuck-pane row
- [x] `nyquist_compliant: true` frontmatter preserved
- [x] Full battle suite (`npm test -- tests/battle/`) green — 34 files, 128 assertions

## Self-Check

- `worker/src/workflows/BattleQuestionGenerationWorkflow.ts`: FOUND (contains `"3 seconds"` + `limit: 2`)
- `apps/web/app/routes/_app.battle.pre.$id.tsx`: FOUND (contains `"stuck"` + `POOL_STUCK_THRESHOLD_MS` + `StuckPane`)
- `tests/battle/battle.workflow.failure.test.ts`: FOUND (3 test cases green)
- `.planning/phases/04-multiplayer-battles/04-VALIDATION.md`: FOUND (rows 04-33 + 04-34 present, counters 37, Addendum 2026-04-19c present)
- Commit d8120dc: FOUND
- Commit 7e2ace3: FOUND
- Commit b3b8200: FOUND
- Commit bd036e8: FOUND

## Self-Check: PASSED
