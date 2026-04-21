---
phase: 04-multiplayer-battles
plan: 14
subsystem: multiplayer
tags: [multiplayer, wave-10, gap-closure, regression-tests, nyquist]

# Dependency graph
requires:
  - phase: 04-multiplayer-battles
    provides: "Plan 04-12 (backend gap closure — POST /:id/pool/retry endpoint + PoolRetryResponse discriminated union + markWorkflowStarted/nullWorkflowStartedAt helpers + DO pool-timeout alarm) and Plan 04-13 (frontend retry CTA + BattleApiError.body carrier). This plan adds NO production source — it lands the automated defense that proves those plans work and prevents regression."
provides:
  - "tests/battle/battle.room.pool-timeout.test.ts — BattleRoom DO pool-timeout alarm regression (4 assertions: A alarm scheduled at ~60s / B fire-in-generating flips status to failed / C fire-after-ready is no-op / D opStartBattle clears alarm)"
  - "tests/battle/battle.pool.retry.test.ts — POST /:id/pool/retry endpoint contract regression (6 assertions: A 403 non-host / B 404 no poolTopicId / C 409 wrong status / D 200 idempotent ready / E 409 inFlight / F 202 restarted + workflow.create fired once with server-canonical topic, workflow_started_at nulled)"
  - "tests/battle/battle.workflow.started-at.test.ts — markWorkflowStarted + nullWorkflowStartedAt helper unit test (4 assertions: A stamp = Date.now() ±2s / B set to NULL / C idempotent / D [BLOCKER-3] static-source: record-workflow-started step.do precedes generate-battle-questions AND invokes markWorkflowStarted)"
  - "VALIDATION.md — 04-39 / 04-40 / 04-41 flipped from ⬜ pending → ✅ green; Addendum 2026-04-21c records the landing with commit refs and T-04-gap-10/11/12 mitigations marked green; Measured runtime row updated (~46s → ~130s after Plans 04-12/04-13/04-14)"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DO alarm regression pattern: seed D1 rows + init DO via fetch('https://do/op', X-Battle-Op) → runInDurableObject(stub, async (_inst, state) => state.storage.getAlarm()) for timestamp checks + runDurableObjectAlarm(stub) to force-fire. Mirrors battle.lobby.timeout.test.ts exactly."
    - "HTTP-handler regression pattern with mock workflow binding: `buildApp().request(path, init, { ...env, BATTLE_QUESTION_WORKFLOW: mock.binding } as unknown as Env)` — the Hono `request(path, init, env)` third-arg injects overrides per-test, letting case F assert 1 workflow.create call while A/B/C/D/E each assert 0. Same pattern as battle.join.pool-failure.test.ts."
    - "Mock workflow binding: `{ create: async ({id, params}) => { calls.push({id, params}); return {id} } }` — matches the production `.create({id, params})` shape exactly; `getCalls()` closure captures call list for assertions."
    - "Unit-level helper test via direct import: `import { markWorkflowStarted } from '../../worker/src/workflows/BattleQuestionGenerationWorkflow'` + `await markWorkflowStarted(env as unknown as Env, poolTopicId)` — exercises Drizzle → D1 write path without the workflow runtime (miniflare can't drive Workflows). Same pattern as battle.workflow.failure.test.ts."
    - "BLOCKER-3 static-source via Vite ?raw: `import workflowSource from '../../worker/src/workflows/BattleQuestionGenerationWorkflow.ts?raw'` — ships the file contents as a string at bundle time, sidesteps `node:fs` path mismatches in the Workers test pool. Strip comments → regex assert step.do name exists + indexOf source-order check + window-slice + markWorkflowStarted( regex inside the window. Mirrors Test 04-37 precedent in battle.wager.advance.test.ts:32."
    - "Updated-at ordering across second-precision columns: `setTimeout(r => 1100)` between the write and the read forces a strict > comparison despite the unix-seconds Drizzle `mode: 'timestamp'` — the 1.1s wait is enough to guarantee the next clock tick."

key-files:
  created:
    - tests/battle/battle.room.pool-timeout.test.ts
    - tests/battle/battle.pool.retry.test.ts
    - tests/battle/battle.workflow.started-at.test.ts
  modified:
    - .planning/phases/04-multiplayer-battles/04-VALIDATION.md

key-decisions:
  - "Kept the mock workflow binding self-contained per test rather than lifting it into a shared tests/battle/helpers/ module — each test's calls array needs its own closure for assertions, and the 15-line helper mirrors the same inline pattern used elsewhere in the suite (battle.join.pool-failure.test.ts envWith())."
  - "Case F asserts the EXACT topic string `retry-F-topic-${poolTopicId}` was passed to workflow.create — not just that some topic was passed. This locks T-04-gap-12 (pool-topic poisoning) tighter: not only does the endpoint not read from the request body (zero body is sent), it re-reads the canonical topic from battle_pool_topics.topic. If a future refactor accidentally wired the topic through the request, the assertion would break immediately."
  - "Case E seeds `workflow_started_at = Date.now()` (not `Date.now() - 30_000` or similar) to unambiguously exercise the 60s in-flight window — even if the machine is slow and a few seconds elapse between seed and request, we're still well within the window. The alternate 'just outside 60s' case is covered implicitly by Case F's 'failed' branch path that the endpoint also hits for stale-generating."
  - "Each test seeds a different userId via `createTestSession` (unique email per case — host-retry-A / host-retry-B / ...) so the battleJoinRateLimit keyed on userId doesn't cross-pollinate. No global RL reset needed; the per-test userId rotation is sufficient."
  - "Case D of battle.workflow.started-at.test.ts (BLOCKER-3 static-source) uses the same comment-strip regex as Test 04-37 so future maintainers recognize the pattern instantly. The window-slice approach (slice(firstRecord, firstGen) then match /markWorkflowStarted\\s*\\(/) is stricter than a flat file-wide match — it proves the invocation is INSIDE the record-workflow-started step.do(), not just somewhere else in the file."
  - "No production source changed in this plan. Per the plan contract: if a bug had surfaced while writing the tests (e.g., BATTLE_QUESTION_WORKFLOW.create rejects on same-id re-schedule), it would have been filed as a follow-up gap-closure request rather than patched inline. None surfaced — all three runtime tests passed on first green run against the landed Plans 04-12/04-13 source."

patterns-established:
  - "Test-only gap-closure waves are legitimate Nyquist milestones. Plan 04-12 + 04-13 landed the fix; Plan 04-14 lands the defense. The two-step cadence (implementation then regression coverage) keeps each plan's scope focused and keeps the VALIDATION.md pending markers visible between the two."
  - "DO alarm lifecycle regression triangulates on (scheduled / fires-correctly / no-op-on-racy-state / cleared-on-transition) — 4 cases is the minimum coverage to catch all four failure modes (missing setAlarm / wrong threshold / false-positive flip / leaked alarm post-transition). Template-reusable for any future DO-alarm-backed invariant."
  - "Endpoint-contract regression triangulates on auth-gate-branches (403/404) + pre-condition-branches (409-wrong-status) + status-gate-branches (200/409/202 for ready/inFlight/failed). Mock-workflow-calls-captured = 0 on every branch except the one that should fire."

requirements-completed:
  - MULT-01
  - MULT-02

# Metrics
duration: ~12min
completed: 2026-04-21
---

# Phase 04 Plan 14: Wave 10 Regression Suite for Gap 04-12 Backend + 04-13 Frontend Summary

**Three new regression test files (14 assertions total) landed as the automated defense for Plans 04-12 / 04-13: DO pool-timeout alarm lifecycle, POST /:id/pool/retry endpoint six-branch contract, and markWorkflowStarted/nullWorkflowStartedAt observability helpers — including a BLOCKER-3 static-source case proving the record-workflow-started step precedes generate-battle-questions in BattleQuestionGenerationWorkflow.ts source order. VALIDATION.md 04-39/04-40/04-41 flipped from ⬜ pending → ✅ green; Addendum 2026-04-21c records the landing.**

## What Landed

### Task 1 — tests/battle/battle.room.pool-timeout.test.ts (Test 04-39, commit `eaff2ac`)

4 assertions covering the BattleRoom DO pool-timeout alarm:

- **A: opAttachGuest schedules a ~60s alarm** — `runInDurableObject` → `state.storage.getAlarm()` returns a timestamp in [Date.now() + 55s, Date.now() + 65s].
- **B: alarm fires in pre-battle with status='generating' → flips to 'failed'** — `runDurableObjectAlarm(stub)` force-fires; post-fire D1 query asserts `battle_pool_topics.status = 'failed'`.
- **C: alarm fires with status already 'ready' → no-op** — race-winner scenario: flip status to 'ready' before firing → alarm leaves it untouched.
- **D: opStartBattle clears the pool-timeout alarm** — after setQuestions + startBattle, any pending alarm is the 15s question timer, NOT the 60s pool-timeout.

Mirrors the `battle.lobby.timeout.test.ts` fixture pattern exactly. Single-alarm-per-DO invariant locked.

### Task 2 — tests/battle/battle.pool.retry.test.ts (Test 04-40, commit `fde37af`)

6 assertions covering every branch of POST /api/battle/:id/pool/retry:

- **A (T-04-gap-10)**: guest → 403 Forbidden, 0 workflow.create calls.
- **B**: battle with `pool_topic_id IS NULL` → 404 with `{error}` body, 0 workflow.create calls.
- **C**: battle with `status='active'` → 409, 0 workflow.create calls.
- **D**: poolStatus='ready' → 200 `{status:'ready'}` (idempotent no-op), 0 workflow.create calls.
- **E (T-04-gap-11)**: poolStatus='generating' AND `workflow_started_at = Date.now()` → 409 `{status:'generating', inFlight:true, workflowRunId}`, 0 workflow.create calls.
- **F (T-04-gap-12)**: poolStatus='failed' → 202 `{status:'generating', restarted:true, workflowRunId}`, workflow.create fired EXACTLY ONCE with the same poolTopicId AND the server-canonical topic re-read from `battle_pool_topics.topic` (NOT from request body); D1 `workflow_started_at` nulled post-retry.

Uses `buildApp().request(path, init, overriddenEnv)` with a per-test mocked `BATTLE_QUESTION_WORKFLOW.create` that captures calls without running anything. Matches the envWith() pattern from `battle.join.pool-failure.test.ts`.

### Task 3 — tests/battle/battle.workflow.started-at.test.ts (Test 04-41, commit `b851286`)

4 assertions covering the observability helpers:

- **A**: `markWorkflowStarted(env, id)` stamps `workflow_started_at = Date.now()` (±2s wall-clock tolerance) AND refreshes `updated_at`.
- **B**: `nullWorkflowStartedAt(env, id)` sets `workflow_started_at` back to NULL.
- **C**: `markWorkflowStarted` is idempotent — second call overwrites with a strictly newer timestamp (1.1s wait between calls guarantees the next second tick).
- **D (BLOCKER-3)**: Vite `?raw` import of BattleQuestionGenerationWorkflow.ts source, strip comments, then:
  - `/step\.do\(\s*["']record-workflow-started["']/` matches (step exists).
  - `firstRecord < firstGen` in source order (observability stamp runs before question generation).
  - `markWorkflowStarted\s*\(` matches inside the sliced window [firstRecord, firstGen] (the helper is invoked inside the step body, not merely imported at top-of-file).

Mirrors Test 04-37's static-source pattern from `battle.wager.advance.test.ts:32` — the only practical way to prove workflow-step ordering since miniflare cannot drive Cloudflare Workflows.

### Task 4 — VALIDATION.md update (commit `4b58897`)

- **Rows flipped**: 04-39, 04-40, 04-41 all advanced from `⬜ / ⬜ pending (file ships in Plan 04-14)` → `✅ / ✅ green`.
- **Runtime row updated**: `~46 seconds (Plan 04-11 baseline, 36 files/144 assertions)` → annotated with `After Plans 04-12/04-13/04-14: ~130 seconds (39 files / ~158 assertions — includes BLOCKER-3 static-source case)`.
- **Addendum 2026-04-21c appended** — records the flip, the commit refs (Tasks 1-4 + this VALIDATION commit), threat-refs (T-04-gap-10/11/12) all marked green with the per-case assertion that proves each.

## Deviations from Plan

**None — plan executed exactly as written.** Zero production source modified. Zero Rules 1-3 deviations triggered. Zero follow-up gap-closure requests filed.

The only minor footnote is that the worktree-level environment required installing `node_modules` at both the repo root (`npm install`) AND the `worker/` subpackage (`cd worker && npm install`) before vitest could resolve Hono/Drizzle imports — this is a pre-existing worktree setup step, not a deviation from the plan's task list.

## Verification

### Per-test (all green)

| Test file | Assertions | Duration |
|-----------|------------|----------|
| `battle.room.pool-timeout.test.ts` | 4/4 | ~12s |
| `battle.pool.retry.test.ts` | 6/6 | ~10s |
| `battle.workflow.started-at.test.ts` | 4/4 | ~12s |

### Combined run of new tests

```
npm test -- tests/battle/battle.room.pool-timeout.test.ts tests/battle/battle.pool.retry.test.ts tests/battle/battle.workflow.started-at.test.ts
→ Test Files  3 passed (3)
  Tests  14 passed (14)
  Duration  17.76s
```

### Full battle suite

```
npm test -- tests/battle/
→ Test Files  1 failed | 38 passed | 1 skipped (40)
  Tests  1 failed | 150 passed | 32 todo (183)
  Duration  73.63s
```

The single failure is in `battle.advance.test.ts` — a pre-existing DO cold-start race flake that passes on isolated re-run (confirmed: `npm test -- tests/battle/battle.advance.test.ts → 3 passed`). Same flake-class noted in Addendum 2026-04-21a. **NOT introduced by this plan** — my three new tests are all green in every run, both isolated and in the full suite.

### VALIDATION.md invariants

- `grep -c "Addendum 2026-04-21c"` → 2 (one reference in the Test Infrastructure runtime row, one heading).
- `grep -c "pending (file ships in Plan 04-14)"` → 0 (all three flipped).
- Each new test file referenced in VALIDATION.md ≥ 2 times (original row + addendum).

## Issues Surfaced

None. All three runtime tests passed on first green run against the Plans 04-12/04-13 production source. No new Cloudflare-constraint violations, no auth-gate deviations, no schema drift.

## TDD Gate Compliance

Plan frontmatter `type: execute`, not `type: tdd` — plan-level TDD gates (RED/GREEN/REFACTOR commit sequence) do NOT apply to this plan.

Individual tasks were declared `tdd="true"` by the plan author, but since each task's deliverable IS the test file (there is no production code to test-first), the conventional RED→GREEN cycle is collapsed into a single commit per task. Each test was run immediately after creation and passed on first green run.

## Threat Surface

No new threat surface introduced — this plan adds test files only. The threat register is confirmed GREEN for the three gaps it asserts:

| Threat ID | Mitigation proof | Test case |
|-----------|------------------|-----------|
| T-04-gap-10 | Host-only IDOR on /pool/retry — guest gets 403 | 04-40 Case A |
| T-04-gap-11 | Thundering herd — fresh in-flight returns 409, stale gets reset; DO alarm flips status once | 04-40 Case E + 04-39 Case B + 04-41 Case D (static-source proof the observability stamp runs) |
| T-04-gap-12 | Topic poisoning prevention — workflow.create receives server-canonical topic from DB, never request body | 04-40 Case F |
| T-04-gap-11-alarm | One-shot alarm, clean-clear on transition | 04-39 Cases B + D |

## Commits

| Commit | Task | Message |
|--------|------|---------|
| `eaff2ac` | Task 1 | test(04-14): add BattleRoom DO pool-timeout alarm regression (04-39) |
| `fde37af` | Task 2 | test(04-14): add POST /:id/pool/retry endpoint regression (04-40) |
| `b851286` | Task 3 | test(04-14): add workflow_started_at observability helpers regression (04-41 + BLOCKER-3) |
| `4b58897` | Task 4 | docs(04-14): flip 04-39/04-40/04-41 rows to green + Addendum 2026-04-21c |

## Self-Check: PASSED

- `tests/battle/battle.room.pool-timeout.test.ts` exists ✓
- `tests/battle/battle.pool.retry.test.ts` exists ✓
- `tests/battle/battle.workflow.started-at.test.ts` exists ✓
- `.planning/phases/04-multiplayer-battles/04-VALIDATION.md` modified ✓
- Commit `eaff2ac` exists in git log ✓
- Commit `fde37af` exists in git log ✓
- Commit `b851286` exists in git log ✓
- Commit `4b58897` exists in git log ✓
- VALIDATION.md: 04-39/04-40/04-41 rows flipped to ✅ green ✓
- VALIDATION.md: Addendum 2026-04-21c present ✓
- All 14 new assertions pass ✓
- Full battle suite: 38/40 files green + 1 pre-existing cold-start flake (battle.advance.test.ts, NOT introduced by this plan) + 1 skipped ✓
