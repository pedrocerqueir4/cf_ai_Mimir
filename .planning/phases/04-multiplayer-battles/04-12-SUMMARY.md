---
phase: 04-multiplayer-battles
plan: 12
subsystem: multiplayer
tags: [multiplayer, battle, pool-recovery, do-alarm, workflow-observability, gap-closure, wave-8, nyquist]

# Dependency graph
requires:
  - phase: 04-multiplayer-battles
    provides: "Plan 04-09 findOrQueueTopic + retryWithJitter embedTopic helper; Plan 04-10 frontend stuck-pane 45s watchdog + tightened step-1 retry budget; Plan 04-11 wager-advance cache + lobby ParticipantCard — backend half of pre-battle-hang remediation deferred to this plan"
provides:
  - "battle_pool_topics.workflow_started_at INTEGER column (nullable unix ms) — observability stamp distinguishing silent-drop from slow-run workflows"
  - "markWorkflowStarted + nullWorkflowStartedAt helpers exported from BattleQuestionGenerationWorkflow"
  - "record-workflow-started step — the first step of BattleQuestionGenerationWorkflow.run"
  - "POOL_TIMEOUT_MS (60s) alarm scheduled at end of opAttachGuest; alarm() pre-battle branch flips pool status to failed"
  - "POST /api/battle/:id/pool/retry endpoint — host-only, rate-limited, zero-body retry path with 403/404/409/200/202 contract"
  - "PoolRetryResponse discriminated-union type — exported for frontend consumption in Plan 04-13"
  - "embedTopic re-exported from battle-pool.ts so the retry path reuses the shared retryWithJitter wrapper"
affects: [04-multiplayer-battles plan 04-13 (frontend StuckPane retry CTA wiring), plan 04-14 (regression tests 04-39/40/41)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Workflow observability: step 0 stamps start-time in D1 so silent-drop vs slow-run can be distinguished externally"
    - "DO single-alarm-per-instance invariant preserved across phase transitions: lobby-alarm → pool-timeout alarm (replace-on-attach) → cleared by opStartBattle deleteAlarm"
    - "Zero-body retry endpoint: topic re-read from D1 column written under assertTopicSafe — eliminates prompt-injection vector by construction"
    - "60s frontend-backend watchdog handshake: frontend StuckPane surfaces retry/cancel CTAs at 45s (15s before backend force-fails at 60s) so 'keep waiting' is still recoverable"

key-files:
  created:
    - worker/src/db/migrations/0006_battle_pool_workflow_started_at.sql
    - worker/src/db/migrations/meta/0006_snapshot.json
  modified:
    - worker/src/db/schema.ts
    - worker/src/workflows/BattleQuestionGenerationWorkflow.ts
    - worker/src/durable-objects/BattleRoom.ts
    - worker/src/routes/battle.ts
    - worker/src/services/battle-pool.ts
    - worker/src/validation/battle-schemas.ts
    - tests/setup.ts
    - tests/battle/battle.lobby.timeout.test.ts
    - .planning/phases/04-multiplayer-battles/04-VALIDATION.md
    - worker/src/db/migrations/meta/_journal.json

key-decisions:
  - "workflow_started_at stored as unix MILLISECONDS (raw Date.now()), not unix seconds via mode: timestamp — required for the 60s in-flight window check in the retry endpoint. Documented as WARN-5 footgun in both schema.ts and the workflow helper JSDocs."
  - "Pre-battle alarm branch early-returns on missing poolTopicId (not an error, not a throw) — matches 'race-after-fact' semantics consistent with the existing lobby/disconnect branches"
  - "POOL_RETRY_INFLIGHT_WINDOW_MS (60s) deliberately equals BattleRoom POOL_TIMEOUT_MS — a retry becomes eligible EXACTLY when the DO alarm would force-fail the pool, eliminating the 'double-jeopardy' window"
  - "Workflow .create called with the SAME poolTopicId on retry — accepts residual T-04-gap-14 risk of workflow-id-collision. If the runtime rejects, the DO alarm still converges to status=failed within 60s; regression test will surface this if it becomes a hard-fail in production."
  - "Retry endpoint re-reads topic from D1 (never request body) — T-04-gap-12 prompt-injection mitigation by construction, not by validation"
  - "PoolRetryResponse appended to battle-schemas.ts end-of-file. Plan instructed 'after PoolStatus export' but no PoolStatus export exists; added under a new HTTP response contracts section."
  - "battle.lobby.timeout.test.ts updated to assert the new single-alarm invariant — after attachGuest, the alarm is now the 60s pool-timeout alarm (not null as before). Firing it with poolTopicId=null is a no-op on battles.status (pre-battle branch early-returns)."

patterns-established:
  - "Observability-first workflow steps: the CHEAPEST possible step (single D1 write, {retries: {limit:2, delay:'1s'}} → ~3s max) runs FIRST so downstream consumers can distinguish 'scheduling succeeded, runtime never ran' from 'slow runtime'. This is a scale-able pattern for ANY multi-step Workflow whose silent-drop behavior is externally observable."
  - "Frontend-backend handshake windows: the retry endpoint's in-flight window (60s) and the DO force-fail alarm (60s) are EQUAL and deliberately aligned. The frontend's stuck-pane watchdog (45s) fires 15s earlier to give the user recoverable CTAs before the backend makes an irrecoverable decision. Three clocks, two trust boundaries, one deterministic convergence time."

requirements-completed:
  - MULT-01
  - MULT-02

# Metrics
duration: ~14min
completed: 2026-04-21
---

# Phase 04 Plan 12: Pre-Battle Hang Recovery (Backend) Summary

**Backend-only gap-closure for the pre-battle-hang blocker: 60s DO alarm force-fails silently-dropped workflows, new host-only POST /pool/retry endpoint re-fires the same workflow, observability stamp distinguishes silent-drop from slow-run.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-04-21T11:18:21Z
- **Completed:** 2026-04-21T11:32:00Z
- **Tasks:** 6/6
- **Files modified:** 10 (2 new migration artifacts + 6 source edits + 1 test update + 1 VALIDATION doc)

## Accomplishments

- Added backend 60s force-fail alarm for silently-dropped BattleQuestionGenerationWorkflow runs — no more forever-`generating` pool topics
- Landed host-only POST `/api/battle/:id/pool/retry` with a complete 403/404/409/200/202 contract backed by authGuard + sanitize + battleJoinRateLimit, threat-modeled against IDOR, thundering herd, and prompt injection
- Shipped workflow observability stamp (`workflow_started_at`) via a new pre-step-1 Workflows step, enabling external callers to distinguish scheduling-succeeded-but-runtime-never-ran from slow-running
- Preserved full existing battle test suite (36 files / 137 tests) green; updated the single test (`battle.lobby.timeout.test.ts`) whose assertion contradicted the new pool-timeout alarm semantics
- Registered 3 placeholder validation rows (04-39 / 04-40 / 04-41) + Addendum 2026-04-21a — Plan 04-14 will flip them to green with the actual regression suite

## Task Commits

Each task was committed atomically with `--no-verify` per parallel worktree protocol:

1. **Task 1: Add workflowStartedAt column to schema.ts** — `8e83b25` (feat)
2. **Task 2: Generate + apply Drizzle migration + setup.ts DDL** — `c801095` (feat)
3. **Task 3: Add workflow observability helpers + record-workflow-started step** — `310e3af` (feat)
4. **Task 4: Add pool-timeout alarm branch to BattleRoom DO + update lobby.timeout test** — `c90ee56` (feat)
5. **Task 5: POST /api/battle/:id/pool/retry endpoint + PoolRetryResponse + embedTopic export** — `b7e3277` (feat)
6. **Task 6: VALIDATION.md addendum** — `3a86d60` (docs)

_All 6 commits are in the current worktree branch; orchestrator will merge after wave-8 completion._

## Files Created/Modified

### Created
- `worker/src/db/migrations/0006_battle_pool_workflow_started_at.sql` — Drizzle-generated ALTER TABLE adding the nullable `workflow_started_at` INTEGER column
- `worker/src/db/migrations/meta/0006_snapshot.json` — drizzle-kit snapshot for migration history

### Modified
- `worker/src/db/schema.ts` — new nullable `workflowStartedAt: integer("workflow_started_at")` column on `battlePoolTopics` with extensive JSDoc explaining the unix-milliseconds vs unix-seconds storage choice
- `worker/src/workflows/BattleQuestionGenerationWorkflow.ts` — new exported helpers `markWorkflowStarted` and `nullWorkflowStartedAt`; new step 0 `record-workflow-started` wrapping `markWorkflowStarted`
- `worker/src/durable-objects/BattleRoom.ts` — `POOL_TIMEOUT_MS = 60_000` constant; `markPoolTopicFailed` import; `setAlarm` call at end of `opAttachGuest`; `alarm()` `case "pre-battle":` branch reads `battles.poolTopicId` → `battle_pool_topics.status` and flips to `failed` via `markPoolTopicFailed` if still `generating`; `opStartBattle` deleteAlarm comment amended
- `worker/src/routes/battle.ts` — `POOL_RETRY_INFLIGHT_WINDOW_MS = 60_000` constant; `embedTopic` import (multi-line block); `nullWorkflowStartedAt` + `PoolRetryResponse` imports; new `POST /:id/pool/retry` handler with `sanitize + battleJoinRateLimit` chain and the full 403/404/409/200/202 response contract
- `worker/src/services/battle-pool.ts` — single-keyword flip: `async function embedTopic` → `export async function embedTopic` (body unchanged; retryWithJitter wrapper preserved)
- `worker/src/validation/battle-schemas.ts` — `PoolRetryResponse` discriminated-union type appended to end of file under a new HTTP response contracts section
- `tests/setup.ts` — hardcoded `CREATE TABLE IF NOT EXISTS battle_pool_topics` DDL extended with nullable `workflow_started_at INTEGER` column between `workflow_run_id` and `created_at` (matches schema.ts column order)
- `tests/battle/battle.lobby.timeout.test.ts` — `attachGuest cancels the lobby alarm` test updated to assert the new pool-timeout alarm invariant: alarm is present (~60s out, strictly earlier than the 5-minute lobby alarm), firing it with `poolTopicId=null` is a no-op on `battles.status`
- `.planning/phases/04-multiplayer-battles/04-VALIDATION.md` — three new rows (04-39 / 04-40 / 04-41) registered as `pending`; new Addendum 2026-04-21a with fix-applied summary, commit hashes, and Nyquist compliance note (40 → 43)
- `worker/src/db/migrations/meta/_journal.json` — drizzle-kit auto-updated journal entry for migration 0006

## Key Decisions

See frontmatter `key-decisions` above — 7 decisions logged, chief among them:
- **Unix ms storage unit** (WARN-5 footgun) — documented in schema.ts + workflow helper JSDoc
- **60s-60s-45s handshake** — retry eligibility (60s), DO alarm (60s), frontend stuck-pane (45s)
- **Zero-body retry** — topic never crosses the trust boundary from client on retry, eliminating T-04-gap-12 by construction
- **Workflow id collision accepted risk** — T-04-gap-14 residual; DO alarm still converges within 60s if `.create` rejects

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated battle.lobby.timeout.test.ts to assert new single-alarm invariant**
- **Found during:** Task 4 verification (running existing alarm-path tests)
- **Issue:** The test `attachGuest cancels the lobby alarm — no premature expire` asserted `expect(await state.storage.getAlarm()).toBeNull()` after attachGuest. This assertion held BEFORE the plan because attachGuest simply deleted the lobby alarm; the plan legitimately changes this behavior by scheduling a NEW 60s pool-timeout alarm in the same handler. Leaving the test unchanged would falsely report a regression.
- **Fix:** Renamed the test to `attachGuest cancels the lobby alarm and schedules the 60s pool-timeout alarm — no premature expire`; updated assertions to (a) capture the lobby-alarm timestamp BEFORE attachGuest, (b) assert the pool-timeout timestamp AFTER attachGuest is non-null AND strictly less than the lobby-alarm timestamp (proves the 5-minute lobby alarm was replaced by the 60-second pool-timeout alarm), (c) fire the alarm and assert `battles.status` stays `lobby` because the test's seed does NOT set `pool_topic_id` and the new pre-battle branch early-returns on missing poolTopicId.
- **Files modified:** `tests/battle/battle.lobby.timeout.test.ts`
- **Commit:** `c90ee56`
- **In-scope:** YES — the test verifies behavior this plan explicitly modifies (single-alarm invariant across lobby→pre-battle transition).

**2. [Rule 3 - Blocking] Dependency install into worktree to enable type-check and tests**
- **Found during:** Task 1 verification (`npx tsc --noEmit` failed with "This is not the tsc command you are looking for")
- **Issue:** Fresh worktree had no `node_modules` — tsc, vitest, drizzle-kit all unavailable.
- **Fix:** Ran `npm install --prefer-offline --no-audit --no-fund` at root + `worker/`. Restored `package-lock.json` to its committed state afterward via `git checkout -- package-lock.json` to keep the commit scope tight (lockfile drift was an install artifact, not a plan deliverable). Installed deps persist in `node_modules` only, which is gitignored.
- **Files modified:** None in commit scope (lockfile drift reverted).
- **Commit:** None — out-of-scope infrastructure.

### Plan-instructed path adjustments

**3. [Plan clarification - Anchor] PoolRetryResponse appended to end of battle-schemas.ts**
- **Found during:** Task 5 Step B
- **Issue:** Plan instructed "add PoolRetryResponse IMMEDIATELY AFTER the existing `PoolStatus` export." Grep confirmed no `PoolStatus` export exists in `worker/src/validation/battle-schemas.ts`.
- **Fix:** Appended `PoolRetryResponse` at end of file under a new `// ─── HTTP response contracts ─────` section header. Same semantic result; preserves the discriminated-union shape exactly as specified.
- **Files modified:** `worker/src/validation/battle-schemas.ts`
- **Commit:** `b7e3277`

**4. [Plan clarification - Infrastructure] drizzle-kit push not executed (no persistent local D1 in worktree)**
- **Found during:** Task 2 Step C
- **Issue:** Plan's Step C ran `cd worker && npx drizzle-kit push`. In the worktree, no persistent local D1 file exists (the project uses miniflare in-memory D1 via `tests/setup.ts` hardcoded DDL). `drizzle-kit push` requires a database URL; attempting it errored with "Please provide required params: url: undefined."
- **Fix:** The migration file (`0006_*.sql`) IS the production apply path (orchestrator runs `wrangler d1 migrations apply` at deploy time). Test D1 is re-created from `tests/setup.ts` DDL on every test run — step D of the plan extended that DDL unconditionally, which IS the test-path apply. No code change needed; documented in the Task 2 commit body.
- **Files modified:** None beyond plan-specified files.
- **Commit:** `c801095`

### Authentication Gates

None encountered. All work was code-path-only; no external auth needed.

## Verification Evidence

1. **Type-check (all 6 commits):** `cd worker && npx tsc --noEmit` exit 0.
2. **Schema migration shape:** `grep "ADD \`workflow_started_at\`" worker/src/db/migrations/0006_battle_pool_workflow_started_at.sql` → 1 match. `grep "DROP TABLE" …` → 0 matches (plain ALTER TABLE ADD COLUMN, no table rewrite — preserves FKs from `battle_quiz_pool` and `battles` to `battle_pool_topics`).
3. **Schema test:** `npm test -- tests/battle/battle.schema.test.ts` → 7/7 green.
4. **Workflow tests:** `npm test -- tests/battle/battle.workflow.failure.test.ts tests/battle/battle.workflow.populate.test.ts` → 8/8 green.
5. **Alarm-path tests (Task 4):** `npm test -- tests/battle/battle.lobby.timeout.test.ts tests/battle/battle.disconnect.forfeit.test.ts tests/battle/battle.idle.forfeit.test.ts` → 7/7 green (after test update in Task 4).
6. **Full battle test suite:** `npm test -- tests/battle/` → 36 test files, 137 passed, 32 todo, 1 skipped. Matches the Plan 04-11 baseline — no regressions.
7. **Route ordering:** `grep 'battleRoutes\.\(post\|get\)' worker/src/routes/battle.ts` shows `/:id/cancel` (L719) → `/:id/pool/retry` (L763) → `/:id` GET (L877). Hono registration order preserved.
8. **VALIDATION.md acceptance:** `grep -c 04-39` → 4; `grep -c 04-40` → 4; `grep -c 04-41` → 4; `grep -c "Addendum 2026-04-21a"` → 1; `grep -c "T-04-gap-10\|T-04-gap-11\|T-04-gap-12"` → 4.

## Threat Flags

Plan threat model (T-04-gap-10 / 11 / 12 / 11-alarm / 14) covers all security-relevant surface introduced. No new flags.

## Deferred Issues

None. Plan scope closed in full.

## Self-Check: PASSED

All claimed files exist on disk:
- `worker/src/db/migrations/0006_battle_pool_workflow_started_at.sql` — exists
- `worker/src/db/migrations/meta/0006_snapshot.json` — exists
- `worker/src/db/schema.ts` — contains `workflowStartedAt` + `workflow_started_at`
- `worker/src/workflows/BattleQuestionGenerationWorkflow.ts` — contains `markWorkflowStarted`, `nullWorkflowStartedAt`, `record-workflow-started`
- `worker/src/durable-objects/BattleRoom.ts` — contains `POOL_TIMEOUT_MS`, `setAlarm(Date.now() + POOL_TIMEOUT_MS)`, `pool-timeout fired`
- `worker/src/routes/battle.ts` — contains `/:id/pool/retry`, `POOL_RETRY_INFLIGHT_WINDOW_MS`, `restarted: true`, `inFlight: true`
- `worker/src/services/battle-pool.ts` — contains `export async function embedTopic`
- `worker/src/validation/battle-schemas.ts` — contains `export type PoolRetryResponse`
- `tests/setup.ts` — contains `workflow_started_at INTEGER` in hardcoded DDL
- `tests/battle/battle.lobby.timeout.test.ts` — updated; 2/2 green
- `.planning/phases/04-multiplayer-battles/04-VALIDATION.md` — contains `Addendum 2026-04-21a` and rows for 04-39/40/41

All claimed commits exist in git history:
- `8e83b25` Task 1 (schema) — present
- `c801095` Task 2 (migration + setup.ts) — present
- `310e3af` Task 3 (workflow stamp) — present
- `c90ee56` Task 4 (DO alarm + lobby test) — present
- `b7e3277` Task 5 (HTTP endpoint) — present
- `3a86d60` Task 6 (VALIDATION) — present
