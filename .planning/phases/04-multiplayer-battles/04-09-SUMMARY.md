---
phase: 04-multiplayer-battles
plan: 09
subsystem: multiplayer-battles
status: complete
started: 2026-04-19
completed: 2026-04-19
gap_closure: true
gap_source: .planning/phases/04-multiplayer-battles/04-UAT.md#Test-5
tags: [multiplayer, wave-7, gap-closure, join-path, ai-resilience, pool-lookup, nyquist]
requirements_addressed:
  - MULT-01
threat_refs:
  - T-04-gap-01
  - T-04-gap-02
  - T-04-gap-03
dependency_graph:
  requires:
    - 04-03 (battle-pool service)
    - 04-04 (battle HTTP routes — POST /api/battle/join)
  provides:
    - join-path resilience against transient Workers AI / Vectorize upstream errors
    - structured 503 error contract for guest clients on AI upstream failure
    - retryWithJitter helper (internal to battle-pool.ts)
  affects:
    - POST /api/battle/join response contract (new 503 body shape)
    - battle row mutation ordering (atomic single-UPDATE guest attach + pool)
tech_stack:
  added: []
  patterns:
    - retry-with-jitter absorbs transient upstream flakes (1 retry, 200-400ms backoff)
    - pool-first ordering (resolve upstream dependency before any D1/DO mutation)
    - structured error codes (AI_UPSTREAM_TEMPORARY) instead of raw upstream text
key_files:
  created:
    - tests/battle/battle.join.pool-failure.test.ts
  modified:
    - worker/src/services/battle-pool.ts
    - worker/src/routes/battle.ts
    - .planning/phases/04-multiplayer-battles/04-VALIDATION.md
decisions:
  - "Single atomic UPDATE in POST /join (guest + status + pool_topic_id in one write) instead of the prior two-step pattern — the earlier split was correct only because the original order had a mutation BEFORE pool resolution; with the reorder, a single UPDATE is both atomic and simpler"
  - "Local retryWithJitter helper (not exported) — the retry contract is specific to battle-pool's upstream calls and should not proliferate as a general utility without a broader retry policy discussion"
  - "Model this repo's battle-pool as D1+JSON-embedding + in-memory cosine similarity (no Vectorize binding wired in at runtime); the plan's Vectorize retry + Vectorize-failure regression case applies to the `env.VECTORIZE.query` call that battle-pool.ts DOES make — the retry wrapper is still present and the test asserts the same contract against that path"
metrics:
  duration_minutes: 15
  tasks: 4
  files_modified: 3
  files_created: 1
  commits: 5
---

# Phase 04 Plan 09: Join-Path Pool-Failure Resilience Gap Closure Summary

**One-liner:** Re-ordered `POST /api/battle/join` so `findOrQueueTopic` runs before any D1 UPDATE or DO dispatch, wrapped the Workers AI + Vectorize calls in a 1-retry-with-jitter helper, and introduced a structured 503 (`AI_UPSTREAM_TEMPORARY`) on terminal failure — closes the UAT Phase 04 Test 5 blocker where a transient `InferenceUpstreamError 1031` stranded the host.

---

## Gap Closed

**Source:** `.planning/phases/04-multiplayer-battles/04-UAT.md` Test 5

**User-reported symptom:** Guest clicked "Join," saw error toast `[battle join] findOrQueueTopic failed: InferenceUpstreamError: error code: 1031`, got bounced back to `/battle`. Host remained on "Waiting for opponent..." forever. The joinCode from Test 4 was no longer valid for retry — no path to recovery.

**Confirmed root cause (gsd-debugger 2026-04-19):** `POST /api/battle/join` mutated D1 (`UPDATE battles SET status='pre-battle', guest_id=?, ...`) and then the BattleRoom DO (`opAttachGuest` which deletes the 5-min lobby alarm) BEFORE calling `findOrQueueTopic`. When the AI embedding call inside `findOrQueueTopic` threw error 1031, the catch block returned 500 with no compensating rollback — battle row stuck in `status='pre-battle'`, DO's lobby alarm deleted, joinCode no longer resolvable via the partial `UNIQUE(join_code) WHERE status='lobby'` index.

---

## Before / After: POST /api/battle/join Order of Operations

**Before (broken):**

1. Lookup battle by joinCode + `status='lobby'` (read-only)
2. IDOR + validation checks (read-only)
3. Coin-flip + pick winning roadmap (read-only)
4. **UPDATE battles SET guest_id, status='pre-battle', winning_*** ← FIRST IRREVERSIBLE MUTATION
5. DO `attachGuest` (deletes lobby alarm) ← SECOND IRREVERSIBLE MUTATION
6. `findOrQueueTopic(...)` ← THROWS HERE on AI 1031 → bare 500, NO rollback
7. UPDATE battles SET pool_topic_id
8. Branch: hit → 200 ready / miss → 202 generating

**After (fixed):**

1. Lookup battle by joinCode + `status='lobby'` (read-only)
2. IDOR + validation checks (read-only)
3. Coin-flip + pick winning roadmap (read-only)
4. **`findOrQueueTopic(...)`** — now runs FIRST, with retryWithJitter absorbing single-shot flakes; on terminal failure → structured 503 `{ error, code: 'AI_UPSTREAM_TEMPORARY' }` and RETURN (zero mutations occurred)
5. SINGLE atomic UPDATE battles SET guest_id, guest_roadmap_id, winning_*, status='pre-battle', pool_topic_id (all in one write)
6. DO `attachGuest`
7. Branch: hit → 200 ready / miss → 202 generating

**Invariant:** On any `findOrQueueTopic` failure (AI or Vectorize), zero D1 writes and zero DO writes have occurred. Battle row stays `status='lobby'`, `guest_id IS NULL`, lobby alarm still armed → joinCode remains valid for a client retry.

---

## Retry-with-Jitter Contract

Helper: `retryWithJitter<T>(fn: () => Promise<T>, opts?: { retries?: number; minMs?: number; maxMs?: number }): Promise<T>`

- Defaults: `retries=1` (2 attempts total), `minMs=200`, `maxMs=400` (uniform jitter between attempts)
- On success of any attempt: returns value immediately
- On failure of all attempts: re-throws the **last** error unchanged so existing error-handling paths stay correct
- Applied to: `env.AI.run('@cf/baai/bge-large-en-v1.5', ...)` in `embedTopic` and `env.VECTORIZE.query(topicEmbedding, ...)` in `findOrQueueTopic`
- Not exported — local concern of `worker/src/services/battle-pool.ts`

Rationale: most 1031s are single-shot. Two attempts with a 200-400ms backoff absorbs the vast majority of transient flakes while keeping the overall join latency well under client timeouts even on a second failure.

---

## Test 04-32 Coverage

File: `tests/battle/battle.join.pool-failure.test.ts` (4 assertions, all green)

| Case | Scenario | Contract Asserted |
|------|----------|-------------------|
| A | Persistent AI failure (always throws 1031) | Response 503 + `code: 'AI_UPSTREAM_TEMPORARY'`; battle row stays `status='lobby'`, `guest_id IS NULL`, `pool_topic_id IS NULL`; `ai.callCount() >= 2` proves retry wrapper ran |
| B | Flake-once AI (throws once, then succeeds) | Response 200/202; `ai.callCount() >= 2` proves retry absorbed the flake; battle row reaches `status='pre-battle'` with guest attached |
| C | Terminal-fail then retry-success on same joinCode | First attempt 503, row stays `status='lobby'`; second attempt (healthy AI) returns 200/202 and lands in `pre-battle` — proves joinCode remained usable |
| D | Vectorize upstream failure (AI healthy) | Same invariants as case A — battle stays `status='lobby'`, 503 with `code: 'AI_UPSTREAM_TEMPORARY'` |

---

## Deviations from Plan

**Plan text said** to wrap `env.VECTORIZE.query` call at "lines 226-236" of `battle-pool.ts`. Verified against actual code — the Vectorize query is there at that location, wrapped as specified. No deviation.

**Plan text said** the `AI_UPSTREAM_TEMPORARY` message would return `503`. Earlier plan stub recorded `500`; the PLAN body clearly specified `503` + structured JSON. Implemented as `503` per the plan body.

**Auto-fix (Rule 3 — blocking issue):** `.planning/` is gitignored in this repo, so the Task 4 commit required `git add -f` to stage the VALIDATION.md update. This is standard for the planning docs in this repo (earlier `docs(planning): …` commits also required the forced add). No behavioral change — just logging the deviation.

**No other deviations.** Plan executed exactly as written. Existing pool/join/create tests remained green throughout; no existing test needed adjustment.

---

## Verification Evidence

**TypeScript:** `cd worker && npx tsc --noEmit` → exit 0 after every task.

**Per-task test runs:**

- Task 1: `npm test -- tests/battle/battle.pool.{reuse,miss,similarity,race}.test.ts tests/battle/battle.workflow.populate.test.ts` → 5 files, 18 tests green.
- Task 2: `npm test -- tests/battle/battle.join.test.ts tests/battle/battle.create.test.ts` → 2 files, 8 tests green. Full battle suite spot-check: 32 files / 121 tests green.
- Task 3: `npm test -- tests/battle/battle.join.pool-failure.test.ts` → 1 file, 4 tests green (A, B, C, D). Full battle suite: 33 files / 125 tests green.
- Task 4: `grep -q "04-32" .planning/phases/04-multiplayer-battles/04-VALIDATION.md` → match; counters bumped 34 → 35; frontmatter `nyquist_compliant: true` preserved.

**Final full battle suite run:** 33 files passed, 1 skipped (stubs file), 125 assertions passed, 32 todos (stubs registry by design). Duration: 56.66s (under the 90s Nyquist budget).

---

## Orphaned-Row Tech-Debt Note

Users who hit the bug before this fix shipped may have battle rows stuck with `status='pre-battle'` + `guest_id IS NULL` + `pool_topic_id IS NULL`. These rows cannot progress and will never match the `status='lobby'` joinCode lookup. Options:

1. **Recommended (zero risk):** After deploy, run manually via `wrangler d1 execute`:
   ```sql
   UPDATE battles
     SET status = 'expired'
     WHERE status = 'pre-battle'
       AND guest_id IS NULL
       AND pool_topic_id IS NULL
       AND created_at < strftime('%s','now','-5 minutes');
   ```
   The `-5 minutes` guard ensures no in-flight join is touched.

2. **Accept the debt:** rows cost disk only, partial UNIQUE index is unaffected, zombie-lobby sweeper ignores `pre-battle`. Flag for Phase 5 ops hardening.

This plan deliberately does NOT ship the SQL cleanup as a task — pre-production, tiny user base, and running data-mutation SQL from a plan commit is a footgun. Owner should run the one-liner post-deploy.

---

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | `b464c48` | fix(04-09): add retry-with-jitter wrapper for transient Workers AI + Vectorize upstream errors |
| 2 | `940083e` | fix(04-09): reorder /api/battle/join to resolve pool before mutating D1/DO state |
| 3 | `1b948b9` | test(04-09): regression test for join-path AI failure isolation |
| 4 | `d2e662a` | docs(04-09): register Test 04-32 for join-path AI failure regression in VALIDATION.md |

---

## Success Criteria

- [x] `retryWithJitter` helper exists in `worker/src/services/battle-pool.ts` and wraps BOTH `env.AI.run` (in `embedTopic`) AND `env.VECTORIZE.query` (in `findOrQueueTopic`)
- [x] `POST /api/battle/join` calls `findOrQueueTopic` BEFORE any D1 UPDATE and BEFORE any DO dispatch
- [x] Two-step UPDATE collapsed into one atomic UPDATE
- [x] On terminal AI failure, handler returns `503` with `{ error, code: "AI_UPSTREAM_TEMPORARY" }` and zero D1/DO mutation has occurred
- [x] `tests/battle/battle.join.pool-failure.test.ts` exists with 4 assertions (A, B, C, D), all pass green
- [x] `04-VALIDATION.md` Per-Task Verification Map contains new `04-32` row with `Status: ✅ green`
- [x] Validation Audit counters bumped 34 → 35; Addendum 2026-04-19b section documents source + fix
- [x] `nyquist_compliant: true` frontmatter preserved
- [x] Full battle suite green post-fix

## Self-Check: PASSED

- worker/src/services/battle-pool.ts: FOUND (388 lines, contains `retryWithJitter`)
- worker/src/routes/battle.ts: FOUND (836 lines, contains `AI_UPSTREAM_TEMPORARY`)
- tests/battle/battle.join.pool-failure.test.ts: FOUND (4 test cases green)
- .planning/phases/04-multiplayer-battles/04-VALIDATION.md: FOUND (row 04-32 present, counters bumped, Addendum present)
- Commit b464c48: FOUND
- Commit 940083e: FOUND
- Commit 1b948b9: FOUND
- Commit d2e662a: FOUND
