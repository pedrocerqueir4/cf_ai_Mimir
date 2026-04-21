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
| 04-33 | 10 | 7 | MULT-01, MULT-02 | T-04-gap-04 | BattleQuestionGenerationWorkflow step-1 failure propagates to battle_pool_topics.status='failed' via markPoolTopicFailed within tightened retry window; no partial writes to battle_quiz_pool on failure; simulated outer-catch path flips status for polling GET /api/battle/:id clients | integration | `npm test -- tests/battle/battle.workflow.failure.test.ts` | ✅ | ✅ green |
| 04-34 | 10 | 7 | MULT-01, MULT-02 | T-04-gap-05 | Pre-battle stuck-pane UX: after 45s of poolStatus='generating' in the 'loading' phase, UI shows 'Taking longer than expected' pane with 'Cancel and try again' CTA (wires /api/battle/:id/cancel + navigate to /battle) and 'Keep waiting' CTA (resets 45s timer) | manual | Open /battle on two sessions; host creates + guest joins; force workflow failure (disable env.AI binding or induce network drop). Wait ≥45s on pre-battle page. Confirm StuckPane renders; click 'Cancel and try again' → verify return to /battle. Re-run and click 'Keep waiting' → confirm spinner returns and 45s window restarts. | ✅ | ✅ manual-only |
| 04-35 | 11 | 7 | MULT-04 | T-04-gap-07 | Wager submit advance: applyWagerResponseToCache merges the server-canonical wager fields into the TanStack cache UNCONDITIONALLY on 2xx — first-submitter's tier is set, opponent's tier preserved, bothProposed forwards appliedTier. Locks phase-regression contract: (currentUserId===hostId ? hostWagerTier : guestWagerTier) is non-null post-submit so the pre-battle useEffect does NOT bounce back to wager-propose. | unit | `npm test -- tests/battle/battle.wager.advance.test.ts` | ✅ | ✅ green |
| 04-36 | 11 | 7 | MULT-01 | T-04-gap-09 | GET /api/battle/:id response includes per-participant name/image/xp/level so the lobby ParticipantCard can render rich identity tiles. LEFT JOIN user_stats + computeLevel(xp) derivation server-side; defaults xp:0 / level:1 when user_stats row absent. | integration | `npm test -- tests/battle/battle.lobby.participants.test.ts` | ✅ | ✅ green |
| 04-37 | 11 | 7 | MULT-04 | T-04-gap-08 | Static-source gate: /battle/new route no longer references WagerTierPicker / wagerTier / fetchUserStats / getLocalTimezone — the illustrative wager picker that produced the Test 7 "double-wager" UX complaint is removed. Asserted by a `?raw` Vite import of the route source + regex absence check. | automated | `npm test -- tests/battle/battle.wager.advance.test.ts` (static-source block) | ✅ | ✅ green |
| 04-38 | 11 | 7 | MULT-01 | — | Lobby ParticipantCard renders opponent name/image/level/XP on connect: when the guest joins, the host's lobby view updates with a second ParticipantCard tile showing the guest's avatar (or initials), name, level badge, and total XP. Before-join the slot renders a 'Waiting for opponent to join…' placeholder. | manual | Open two browser sessions. Host creates a battle; guest pastes the code. On the host's lobby screen confirm the guest's ParticipantCard appears with their name, level badge, and XP. Reverse: on the guest's side confirm the host's tile renders identically. Trigger with both avatars-set and avatar-null users to confirm the initials fallback. | ✅ | ✅ manual-only |
| 04-39 | 12 | 8 | MULT-01, MULT-02 | T-04-gap-11 | BattleRoom DO pool-timeout alarm: when runtime.phase='pre-battle' and the 60s alarm fires, battle_pool_topics.status flips from 'generating' to 'failed' via markPoolTopicFailed; when status is already 'ready' or 'failed', alarm is a no-op. Single-alarm-per-DO invariant preserved — opStartBattle deleteAlarm clears it. | integration | `npm test -- tests/battle/battle.room.pool-timeout.test.ts` | ⬜ | ⬜ pending (file ships in Plan 04-14) |
| 04-40 | 12 | 8 | MULT-01 | T-04-gap-10, T-04-gap-11, T-04-gap-12 | POST /api/battle/:id/pool/retry endpoint contract: (a) non-host returns generic 403; (b) battle without poolTopicId returns 404; (c) battle not in pre-battle returns 409; (d) poolStatus='ready' returns 200 {status:'ready'} (idempotent); (e) poolStatus='generating' AND workflow_started_at < 60s ago returns 409 {status:'generating', inFlight:true}; (f) poolStatus='failed' OR (generating AND stale) returns 202 {status:'generating', restarted:true} and fires BATTLE_QUESTION_WORKFLOW.create with the SAME poolTopicId; topic is NEVER read from request body. | integration | `npm test -- tests/battle/battle.pool.retry.test.ts` | ⬜ | ⬜ pending (file ships in Plan 04-14) |
| 04-41 | 12 | 8 | MULT-01, MULT-02 | T-04-gap-11 | BattleQuestionGenerationWorkflow step 0 `record-workflow-started` stamps battle_pool_topics.workflow_started_at = Date.now() via markWorkflowStarted; nullWorkflowStartedAt sets it back to NULL (used by the retry endpoint). Both helpers are exported and compose correctly with the existing markPoolTopicFailed outer-catch path. | integration | `npm test -- tests/battle/battle.workflow.started-at.test.ts` | ⬜ | ⬜ pending (file ships in Plan 04-14) |

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
| Pre-battle stuck-pane + 45s pool-generating timeout (Plan 10) | MULT-01, MULT-02 | Requires real-time poll + 45s wall-clock timer + navigation flow; React Testing Library not wired in this repo; simulating the 45s window in unit tests would be flaky and test the timer mock rather than the real UX | Open /battle on two concurrent sessions. Force workflow failure (e.g., `wrangler dev` with AI binding disabled or induce network drop in devtools). Host creates → guest joins → pre-battle page enters `loading`. Wait ≥45s. Confirm StuckPane renders with 'Taking longer than expected' heading and two CTAs. Click 'Cancel and try again' → verify navigation to /battle. Re-run the flow and click 'Keep waiting' → confirm spinner returns and the 45s timer resets. |
| Lobby ParticipantCard renders opponent name/image/level/XP on connect (Plan 11) | MULT-01 | Visual/presentational — avatar-vs-initials fallback, LevelBadge visual integration, and two-session real-time refresh on guest join. RTL not wired in this repo; simulating the lobby-poll-to-render pipeline would test the mocks rather than the UX. | Open /battle on two concurrent browser sessions. Host creates a battle. Host's lobby shows a single ParticipantCard (host) plus a dashed-border "Waiting for opponent to join…" placeholder. Guest pastes the code. Within one poll tick the host's lobby replaces the placeholder with a ParticipantCard for the guest showing name, avatar (or initials fallback), LevelBadge, and `X XP`. Swap roles and verify the guest sees the host's tile identically. Set one user's avatar to null in the DB to confirm the initials fallback renders. |

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
| Test IDs audited | 40 (04-W0-01..03 + 04-01..31 + 04-32 + 04-33 + 04-34 + 04-35 + 04-36 + 04-37 + 04-38) |
| COVERED (green) | 40 (37 automated green + 1 manual-only 04-34 + 1 automated green 04-37 static-source + 1 manual-only 04-38) |
| PARTIAL | 0 |
| MISSING | 0 |
| Gaps found | 0 |
| Gaps resolved | 0 |
| Escalated to manual-only | 2 (04-34 — 45s wall-clock stuck-pane; 04-38 — lobby ParticipantCard visual/presentational; both declared upfront per Nyquist 8a) |

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

## Validation Audit Addendum 2026-04-19c (gap 04-10)

| Metric | Delta |
|--------|-------|
| Test IDs added | 2 (04-33 automated, 04-34 manual-only) |
| New test file | `tests/battle/battle.workflow.failure.test.ts` (3 assertions: A/B/C) |
| Requirements | MULT-01, MULT-02 |
| Threat refs | T-04-gap-04 (D — async workflow failure silently strands clients), T-04-gap-05 (UX brittleness — silent indefinite spinner), T-04-gap-06 (resource leak — unbounded polling on stuck pool) |
| Source gap | `.planning/phases/04-multiplayer-battles/04-UAT.md` Test 5 (SECOND gap — workflow-failure-gap): `BattleQuestionGenerationWorkflow` logs `[workflow] START … Network connection lost`, step-1 retry config `{limit:3, delay:"15 seconds"}` stretched the user's silent-spinner window to ~105s before the outer catch wrote `poolStatus='failed'` |
| Fix applied | (1) Tightened step-1 retry config in `worker/src/workflows/BattleQuestionGenerationWorkflow.ts` from `{limit:3, delay:"15 seconds"}` (~105s) to `{limit:2, delay:"3 seconds"}` (~9s) so outer-catch `markPoolTopicFailed` fires within wall-clock seconds. (2) Added `'stuck'` phase + 45s elapsed-time watchdog + `StuckPane` with `Cancel and try again` / `Keep waiting` CTAs in `apps/web/app/routes/_app.battle.pre.$id.tsx`. (3) Regression test covers step-body atomic-failure surface (no partial writes), markPoolTopicFailed contract, and the full simulated outer-catch path (~9s deterministic). |
| Fix commits | `d8120dc` (workflow retry tightening), `7e2ace3` (stuck-pane + 45s timeout + CTAs), `b3b8200` (regression test) |
| Deferred | Task 3 of the original gap proposal (DO pool-ready watchdog): defense-in-depth against an undocumented "workflow engine bypasses user catch" failure mode. Frontend 45s timeout + tightened workflow ~9s retry already give user-actionable failures within wall-clock seconds; adding alarm semantics to `BattleRoom.alarm()` without a full integration harness risks introducing bugs worse than the gap being closed. Filed for Phase 5 ops hardening with a proper `alarmReason` discriminator to multiplex alarm purposes safely. |
| Verified | `tests/battle/battle.workflow.failure.test.ts` 3/3 green (~9s); full battle suite 34 files / 128 assertions green post-fix (~67s, under 90s Nyquist budget) |

**Nyquist compliance preserved:** Test 04-33 runs on the same per-task cadence with ~9s latency; Test 04-34 is declared manual-only upfront (Nyquist 8a — real-time poll + 45s wall-clock timer + navigation flow, RTL not wired in this repo; simulating the window in unit tests would test the mock rather than the UX). Both counters bumped 35 → 37; frontmatter `nyquist_compliant: true` preserved.

## Validation Audit Addendum 2026-04-19d (gap 04-11)

| Metric | Delta |
|--------|-------|
| Test IDs added | 4 (04-35 automated unit, 04-36 automated integration, 04-37 automated static-source, 04-38 manual-only) |
| New test files | `tests/battle/battle.wager.advance.test.ts` (6 assertions: 5 pure-function + 1 static-source block), `tests/battle/battle.lobby.participants.test.ts` (3 integration assertions A/B/C) |
| Requirements | MULT-01 (lobby participant identity surface), MULT-04 (wager state-machine correctness) |
| Threat refs | T-04-gap-07 (D — wager-submit cache miss leaves UI bounced, blocking battle progression), T-04-gap-08 (UX brittleness — duplicate wager prompt across Create and pre-battle flows), T-04-gap-09 (information opacity — lobby cannot surface opponent identity needed for informed wager decision) |
| Source gap | `.planning/phases/04-multiplayer-battles/04-UAT.md` Test 7 — three issues bundled: (1) both players stuck after picking wager tier, UI doesn't advance to `/battle/pre/:id`; (2) host prompted for wager twice (Create form + pre-battle); (3) enhancement — show opponent name/level/XP in lobby |
| Fix applied | (1) Extract `applyWagerResponseToCache` into `apps/web/app/lib/battle-wager-cache.ts`; rewrite pre-battle `handleSubmitWager` to apply cache merge UNCONDITIONALLY on 2xx (not only `bothProposed`) — fixes first-submitter bounce-back. Also extend the stuck-pane watchdog to cover `waiting-for-opponent` + both-wagers-submitted + pool-not-ready > 45s with separate `waitingStartedAtRef` + `stuckReason` state. (2) Remove the illustrative `WagerTierPicker` + `useQuery(userStats)` + `fetchUserStats`/`getLocalTimezone`/`WagerTier` imports from `apps/web/app/routes/_app.battle.new.tsx` — Create form now only collects roadmap + question count. (3) Extend GET `/api/battle/:id` to surface `hostImage/hostXp/hostLevel/guestImage/guestXp/guestLevel` via LEFT JOIN `user_stats` + `computeLevel(xp)` (import added from `../lib/xp`). Wire two `ParticipantCard` tiles into the lobby (new component at `apps/web/app/components/battle/ParticipantCard.tsx`, imports existing `LevelBadge`). |
| Fix commits | `ca60a68` (Task 1 wager cache + watchdog), `b6adf9f` (Task 2 Create cleanup), `e8d8484` (Task 3 backend participant fields), `da63695` (Task 4 frontend ParticipantCard), `3389fef` (Task 5 regression tests) |
| Deferred follow-ups | None. The UAT Test 7 bundle is closed. `.planning/STATE.md` remains the orchestrator's responsibility; Plan 04-11 does not mutate it. |
| Verified | `tests/battle/battle.wager.advance.test.ts` 6/6 green (~8s), `tests/battle/battle.lobby.participants.test.ts` 3/3 green (~7s); full battle suite 36 files / 144 assertions green (one pre-existing DO cold-start race flake in `battle.score.test.ts` passes on isolated re-run — not introduced by this plan). Backend `cd worker && npx tsc --noEmit` exit 0; frontend `cd apps/web && npx tsc -b` exit 0. |

**Nyquist compliance preserved:** Tests 04-35 / 04-36 / 04-37 run on the same per-task cadence. Counters bumped 37 → 40. Escalated-to-manual count bumped 1 → 2 (04-34 + 04-38 — both declared upfront per Nyquist 8a: 04-38 is visual/presentational — avatar-vs-initials fallback + LevelBadge visual integration + two-session real-time refresh — which RTL is not wired to assert in this repo). Frontmatter `nyquist_compliant: true` preserved.

## Validation Audit Addendum 2026-04-21a (gap 04-12 backend)

| Metric | Delta |
|--------|-------|
| Test IDs added | 3 (04-39 / 04-40 / 04-41 — all automated, registered as ⬜ pending pending Plan 04-14 implementation) |
| New source files | `worker/src/db/migrations/0006_battle_pool_workflow_started_at.sql` (1 ALTER TABLE); schema + workflow + DO + route extensions (see Fix applied below) |
| Requirements | MULT-01 (deterministic pool recovery), MULT-02 (silent-drop detection via observability stamp) |
| Threat refs | T-04-gap-10 (I — host-only IDOR on the retry endpoint), T-04-gap-11 (D — thundering herd on flaky pools), T-04-gap-12 (T/I — prompt-injection via retry topic param) |
| Source gap | `.planning/debug/pre-battle-hang-after-wager.md` (status: root_cause_found) — user report "pre-battle hang after wager." Plan 04-10 closed the frontend stuck-pane; this plan closes the backend 60s force-fail + host retry path. Also closes the residual `.planning/phases/04-multiplayer-battles/04-UAT.md` BattleQuestionGenerationWorkflow silent-drop case (proposal C from the original gap summary that Plan 04-10 deferred). |
| Fix applied | (1) Schema: `battle_pool_topics.workflow_started_at INTEGER` (nullable) + migration `0006_battle_pool_workflow_started_at.sql`. (2) Workflow: new exported helpers `markWorkflowStarted` + `nullWorkflowStartedAt`; new `step.do("record-workflow-started", …)` as the first step of `BattleQuestionGenerationWorkflow.run`. (3) DO: `POOL_TIMEOUT_MS = 60s` scheduled at end of `opAttachGuest`; `alarm()` `case "pre-battle":` branch reads battle_pool_topics.status via battle.poolTopicId and calls `markPoolTopicFailed` if still 'generating'; `opStartBattle`'s existing `deleteAlarm()` covers the new alarm (comment amended). (4) HTTP: new `POST /api/battle/:id/pool/retry` with host-only (403), pre-battle-only (409), idempotent ready (200), in-flight (409), stale/failed (202) branches; `PoolRetryResponse` discriminated-union type exported from `worker/src/validation/battle-schemas.ts`; `embedTopic` re-exported from `worker/src/services/battle-pool.ts`. |
| Fix commits | `8e83b25` (Task 1 schema), `c801095` (Task 2 migration + setup.ts DDL), `310e3af` (Task 3 workflow stamp), `c90ee56` (Task 4 DO alarm + lobby test update), `b7e3277` (Task 5 HTTP endpoint + types), plus this VALIDATION commit. |
| Verified (this plan) | `cd worker && npx tsc --noEmit` exits 0; existing tests stay green: `battle.schema.test.ts`, `battle.workflow.failure.test.ts`, `battle.workflow.populate.test.ts`, `battle.lobby.timeout.test.ts` (updated to assert new pool-timeout alarm invariant), `battle.disconnect.forfeit.test.ts`, `battle.idle.forfeit.test.ts`; full battle suite 36 files / 137 tests green. Plan 04-14 adds 04-39 / 04-40 / 04-41 and flips pending rows to green. |
| Deferred | None. Plan 04-13 wires the host-retry CTA into the frontend StuckPane. Plan 04-14 lands the three regression tests. |

**Nyquist compliance:** Counters bumped 40 → 43. All three new tests declared automated (no new manual-only). Frontmatter `nyquist_compliant: true` preserved. Plan 04-12 does NOT change the backend test cadence — execution of 04-39/04-40/04-41 is budgeted under the existing 90s Nyquist window as part of the Plan 04-14 suite.
