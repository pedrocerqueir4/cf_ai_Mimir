---
phase: 4
slug: multiplayer-battles
status: complete
nyquist_compliant: true
frontend_manual_only: true  # Plans 05, 06, 07 declared manual-only per B5 revision — see Manual-Only Verifications table below. Nyquist 8a permits this when declared upfront.
wave_0_complete: true
created: 2026-04-17
audited: 2026-04-19
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Generated from RESEARCH.md §Validation Architecture (31 automated specs + manual UAT).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x with `@cloudflare/vitest-pool-workers` 0.14 |
| **Config file** | `worker/vitest.config.mts` (serial `fileParallelism: false` — DO namespace sharing avoids cold-start races) |
| **Test directory** | `tests/battle/` (repo-root — 33 battle test files) |
| **Quick run command** | `npm test -- tests/battle/` |
| **Full suite command** | `npm test` |
| **Measured runtime** | ~46 seconds (battle suite, 32 files, 121 assertions — under 90s budget) |

---

## Sampling Rate

- **After every task commit:** Run quick command (battle tests only)
- **After every plan wave:** Run full suite command
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

> Populated by gsd-planner during plan generation. Each task in PLAN.md must reference a Test ID below or declare itself manual-only with justification.

| Test ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-W0-01 | 00 | 0 | infra | — | Battle test harness boots with DO + WS mocks | unit | `npm test -- tests/battle/battle.setup.test.ts` | ✅ | ✅ green |
| 04-W0-02 | 01 | 0 | infra | — | D1 migration applies battle tables locally | unit | `npm test -- tests/battle/battle.schema.test.ts` | ✅ | ✅ green |
| 04-W0-03 | 00 | 0 | MULT-01..05 | — | Test stubs exist for all MULT/SEC reqs | unit | `npm test -- tests/battle/battle.stubs.test.ts` | ✅ | ✅ green (32 `it.todo` registry — by design per Plan 04-00) |
| 04-01 | 01 | 1 | MULT-01 | — | POST /api/battle/create returns 6-char join code | integration | `npm test -- tests/battle/battle.create.test.ts` | ✅ | ✅ green |
| 04-02 | 01 | 1 | MULT-01 | — | POST /api/battle/join with valid code routes to DO | integration | `npm test -- tests/battle/battle.join.test.ts` | ✅ | ✅ green |
| 04-03 | 01 | 1 | MULT-01 | T-04-01 | Join code generation excludes 5 ambiguous chars (I, O, l, 0, 1) | unit | `npm test -- tests/battle/battle.code.test.ts` | ✅ | ✅ green |
| 04-04 | 01 | 1 | MULT-01 | — | 5-min lobby auto-destroy via DO alarm | unit | `npm test -- tests/battle/battle.lobby.timeout.test.ts` | ✅ | ✅ green |
| 04-05 | 02 | 2 | MULT-02 | — | DO broadcasts same question to both sockets | integration | `npm test -- tests/battle/battle.broadcast.test.ts` | ✅ | ✅ green |
| 04-06 | 02 | 2 | MULT-02 | — | Question advances when both submit OR 15s timer fires | integration | `npm test -- tests/battle/battle.advance.test.ts` | ✅ | ✅ green |
| 04-07 | 02 | 2 | MULT-02 | — | Slow connection: late-arriving answer beats timer = scored 0 | unit | `npm test -- tests/battle/battle.timer.test.ts` | ✅ | ✅ green |
| 04-08 | 02 | 2 | MULT-03, SEC-06 | T-04-02 | Score formula: round(1000 × (1 - (rt/15000)/2)) for correct, 0 for wrong | unit | `npm test -- tests/battle/battle.score.test.ts` | ✅ | ✅ green |
| 04-09 | 02 | 2 | SEC-06 | T-04-02 | Client-supplied timestamp in answer payload is IGNORED | unit | `npm test -- tests/battle/battle.score.client-ts.test.ts` | ✅ | ✅ green |
| 04-10 | 02 | 2 | SEC-06 | T-04-02 | Client-supplied score field in answer payload is IGNORED | unit | `npm test -- tests/battle/battle.score.client-score.test.ts` | ✅ | ✅ green |
| 04-11 | 02 | 2 | MULT-03 | — | Tie at end → sudden-death tiebreaker pulls extra question | integration | `npm test -- tests/battle/battle.tiebreaker.test.ts` | ✅ | ✅ green |
| 04-12 | 04 | 3 | MULT-04 | T-04-03 | Wager tier validation: only 10/15/20% accepted server-side | unit | `npm test -- tests/battle/battle.wager.test.ts` | ✅ | ✅ green (consolidated w/ 04-13 — both behaviors in one file) |
| 04-13 | 04 | 3 | MULT-04 | T-04-03 | Wager amount = max(10 XP, tier × xp) — floor enforced | unit | `npm test -- tests/battle/battle.wager.test.ts` | ✅ | ✅ green |
| 04-14 | 04 | 3 | MULT-04 | — | Server picks random tier of two proposals (50/50) | unit | `npm test -- tests/battle/battle.wager.random.test.ts` | ✅ | ✅ green |
| 04-15 | 04 | 3 | MULT-04, SEC-05 | T-04-04 | Atomic XP transfer via env.DB.batch — no partial state | integration | `npm test -- tests/battle/battle.xp.atomic.test.ts` | ✅ | ✅ green |
| 04-16 | 04 | 3 | SEC-05 | T-04-04 | Concurrent transfers preserve sum invariant (no money created/destroyed) | property | `npm test -- tests/battle/battle.xp.invariant.test.ts` | ✅ | ✅ green |
| 04-17 | 04 | 3 | MULT-04 | — | Battle ledger row inserted on every XP transfer | integration | `npm test -- tests/battle/battle.ledger.test.ts` | ✅ | ✅ green |
| 04-18 | 04 | 3 | MULT-04 | T-04-03 | Wager re-validates against current XP at battle-start (not just proposal-time) | integration | `npm test -- tests/battle/battle.wager.recheck.test.ts` | ✅ | ✅ green |
| 04-19 | 02 | 4 | MULT-05 | — | Reconnect with lastSeenQuestionIdx restores full state snapshot | integration | `npm test -- tests/battle/battle.reconnect.test.ts` | ✅ | ✅ green |
| 04-20 | 04 | 4 | MULT-05 | T-04-05 | 30s reconnect grace: alarm fires if no rejoin → forfeit | integration | `npm test -- tests/battle/battle.disconnect.forfeit.test.ts` | ✅ | ✅ green |
| 04-21 | 02 | 4 | MULT-05 | — | Question timer pauses during disconnect, resumes on rejoin | unit | `npm test -- tests/battle/battle.timer.pause.test.ts` | ✅ | ✅ green |
| 04-22 | 08 | 4 | SEC-06 | T-04-06 | 3 consecutive no-answers triggers auto-forfeit | integration | `npm test -- tests/battle/battle.idle.forfeit.test.ts` | ✅ | ✅ green |
| 04-23 | 08 | 4 | SEC-06 | T-04-07 | Newer WS connection kicks older for same (battleId, userId) | integration | `npm test -- tests/battle/battle.multitab.test.ts` | ✅ | ✅ green |
| 04-24 | 08 | 4 | SEC-06 | T-04-08 | WebSocket upgrade rejects unauthenticated request | integration | `npm test -- tests/battle/battle.auth.ws.test.ts` | ✅ | ✅ green |
| 04-25 | 08 | 4 | SEC-06 | T-04-08 | DO does not accept fetch from unauthorized userId for given battleId | integration | `npm test -- tests/battle/battle.auth.do.test.ts` | ✅ | ✅ green |
| 04-26 | 03 | 5 | MULT-01 | — | battleQuizPool reuse: existing topic returns cached questions | integration | `npm test -- tests/battle/battle.pool.reuse.test.ts` | ✅ | ✅ green |
| 04-27 | 03 | 5 | MULT-01 | — | battleQuizPool miss: triggers BattleQuestionGenerationWorkflow | integration | `npm test -- tests/battle/battle.pool.miss.test.ts` | ✅ | ✅ green |
| 04-28 | 03 | 5 | MULT-01 | T-04-09 | Vectorize similarity > 0.85 threshold for topic match | integration | `npm test -- tests/battle/battle.pool.similarity.test.ts` | ✅ | ✅ green |
| 04-29 | 03 | 5 | MULT-01 | T-04-09 | Concurrent pool population for same fresh topic: deduplicated | integration | `npm test -- tests/battle/battle.pool.race.test.ts` | ✅ | ✅ green |
| 04-30 | 03 | 5 | MULT-01 | — | Workflow stores 20 questions in pool per topic | integration | `npm test -- tests/battle/battle.workflow.populate.test.ts` | ✅ | ✅ green |
| 04-31 | 04 | 6 | MULT-04 | — | Leaderboard query: weekly + all-time tabs sort by net XP won | integration | `npm test -- tests/battle/battle.leaderboard.test.ts` | ✅ | ✅ green |
| 04-32 | 09 | 7 | MULT-01 | T-04-gap-01 | Join path: battle state remains in 'lobby' when findOrQueueTopic fails on transient AI upstream error (1031); retry-with-jitter absorbs transient failures; joinCode remains valid | integration | `npm test -- tests/battle/battle.join.pool-failure.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

> Actual location during execution was `tests/battle/` (repo-root), not `apps/web/test/battle/`. Vitest config lives at `worker/vitest.config.mts` and `include`s `../tests/**/*.test.ts`.

- [x] `tests/setup.ts` — extended with battle tables in `CREATE_STATEMENTS` (Plan 04-01)
- [x] `tests/battle/battle.setup.test.ts` — harness sanity check (4/4 passed, commit f17022f)
- [x] `tests/battle/battle.schema.test.ts` — schema migration applies
- [x] `tests/battle/battle.stubs.test.ts` — 32 `it.todo` entries for tests 04-01..31 + 04-W0-02
- [x] `worker/src/db/migrations/0003_battle_tables.sql` — generated by drizzle-kit (Plan 04-01)
- [x] `worker/vitest.config.mts` — pool config reused; serial `fileParallelism: false` added to avoid DO namespace races

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Slot-machine reveal animation timing & feel (D-02, D-18) | MULT-04 | Visual/perceptual quality of confetti reveal cannot be asserted in headless tests | Open two browsers, create battle, join, propose tiers, observe both reveals visually for ~2s each, confirm feel matches "gamified" intent |
| Mobile-first lobby + battle UX on real device | MULT-01..05 | 48px tap targets, thumb-zone navigation, viewport behavior under iOS Safari/Chrome Android | Run dev server, open in real iPhone/Android browser, run a full battle end-to-end |
| Real network reconnect (WiFi drop, train tunnel) | MULT-05 | Real network conditions can't be reliably simulated in test runner; need to validate timer-pause UX feels right | Start battle on phone, toggle airplane mode for 15s, restore, confirm state restoration |
| Battle landing tabs + create/join navigation flow (Plan 05) | MULT-01 | E2E browser interaction across 3 routes; React Testing Library not wired in project; deferred to UAT | Open /battle; confirm 3 tabs render; click Create → confirm navigation to /battle/new; click Join → confirm navigation to /battle/join; share intent with ?tab=join&code=XXXXXX prefills |
| Pre-battle roadmap + wager slot-machine reveals with confetti (Plan 06) | MULT-04 | Animation timing/feel is subjective; visual/perceptual; manual UAT | Complete a battle join; confirm two reveals (roadmap then wager) each play for ~2s with confetti + scale pulse; verify reduced-motion emulation renders final state immediately |
| Battle room WebSocket client + reconnect overlay + results screen (Plan 07) | MULT-02, MULT-05 | Requires two concurrent browser sessions + network-failure simulation; manual UAT | Run full battle on two browsers; mid-battle close one tab; confirm opponent sees ReconnectOverlay + Sonner toast; reconnect within 30s restores state; 4001 close eviction works on multi-tab |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags (`npm test` uses `vitest run`)
- [x] Feedback latency < 90s (measured 46s for battle suite)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ✅ validated 2026-04-19 — 32/32 battle test files green, 121 assertions passing

---

## Validation Audit 2026-04-19

| Metric | Count |
|--------|-------|
| Test IDs audited | 35 (04-W0-01..03 + 04-01..31 + 04-32) |
| COVERED (green) | 35 |
| PARTIAL | 0 |
| MISSING | 0 |
| Gaps found | 0 |
| Gaps resolved | 0 |
| Escalated to manual-only | 0 (frontend-only UAT items already declared upfront per B5 revision) |

**Notes:**
- Tests 04-12 and 04-13 consolidated into `tests/battle/battle.wager.test.ts` (9 assertions covering tier-set validation AND 10-XP floor enforcement). Single-file vs two-file split was an execution-time implementation choice — both behaviors fully verified.
- `battle.stubs.test.ts` intentionally keeps 32 `it.todo` entries as a test-ID registry (Plan 04-00 contract). Real assertions live in the per-ID files listed above.
- Test Infrastructure table corrected: actual path is `tests/battle/` at repo-root (not `apps/web/test/battle/`); commands rewritten to use the repo `npm test` entry point backed by `worker/vitest.config.mts`.
- Test 04-32 added post-audit as gap closure for UAT Phase 04 Test 5 blocker (see Addendum 2026-04-19b below).

## Validation Audit Addendum 2026-04-19b (gap 04-09)

| Metric | Delta |
|--------|-------|
| Test IDs added | 1 (04-32) |
| New test file | `tests/battle/battle.join.pool-failure.test.ts` (4 assertions: A/B/C/D) |
| Requirement | MULT-01 |
| Threat ref | T-04-gap-01 (D — transient upstream DoS), T-04-gap-02 (T — state leak on partial failure), T-04-gap-03 (I — raw upstream error disclosure) |
| Source gap | `.planning/phases/04-multiplayer-battles/04-UAT.md` Test 5 — guest join threw `InferenceUpstreamError: error code: 1031`, host stranded, joinCode unusable |
| Fix applied | (1) retry-with-jitter wrapper around `env.AI.run` and `env.VECTORIZE.query` in `worker/src/services/battle-pool.ts`; (2) re-ordered `POST /api/battle/join` in `worker/src/routes/battle.ts` so `findOrQueueTopic` runs BEFORE any D1 UPDATE or DO attachGuest, collapsed two-step UPDATE into one atomic write, structured 503 body `{ error, code: 'AI_UPSTREAM_TEMPORARY' }` on terminal failure |
| Fix commits | `b464c48` (retry wrapper), `940083e` (reorder + structured 503), `1b948b9` (regression test) |
| Verified | `tests/battle/battle.join.pool-failure.test.ts` 4/4 green; full battle suite 33 files / 125 assertions green post-fix |

**Nyquist compliance preserved:** the new Test 04-32 is registered with an automated command on the same sampling cadence as the rest of Phase 04 — feedback latency for this gap closure is ≈12s (single file) or ≈57s (full battle suite), well under the 90s budget.
