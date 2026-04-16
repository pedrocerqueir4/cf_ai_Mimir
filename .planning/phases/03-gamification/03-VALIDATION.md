---
phase: 3
slug: gamification
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-16
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest + @cloudflare/vitest-pool-workers |
| **Config file** | `worker/vitest.config.mts` |
| **Quick run command** | `cd worker && npx vitest run --reporter=verbose` |
| **Full suite command** | `cd worker && npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd worker && npx vitest run --reporter=verbose`
- **After every plan wave:** Run `cd worker && npx vitest run --reporter=verbose`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-00-01 | 00 | 0 | GAME-01..06 | — | Test stubs created (RED state) | setup | `test -f tests/xp.test.ts && test -f tests/gamification.test.ts` | ✅ | ✅ green |
| 03-01-01 | 01 | 1 | GAME-01 | — | XP awarded server-side only | unit | `cd worker && npx vitest run tests/xp.test.ts --reporter=verbose` | ✅ | ✅ green |
| 03-01-02 | 01 | 1 | GAME-03 | — | Level thresholds computed server-side | unit | `cd worker && npx vitest run tests/xp.test.ts --reporter=verbose` | ✅ | ✅ green |
| 03-01-03 | 01 | 1 | GAME-05 | — | Streak checked server-side on lesson complete | unit | `cd worker && npx vitest run tests/xp.test.ts --reporter=verbose` | ✅ | ✅ green |
| 03-02-01 | 02 | 1 | GAME-04 | — | UI components export correctly | file-check | `ls apps/web/app/components/gamification/*.tsx` | ✅ | ✅ green |
| 03-03-01 | 03 | 2 | GAME-01,02 | T-03-06,07 | XP award + idempotency + atomic upsert | integration | `cd worker && npx vitest run tests/gamification.test.ts --reporter=verbose` | ✅ | ✅ green |
| 03-03-02 | 03 | 2 | GAME-04,06 | — | Stats endpoint returns all fields | integration | `cd worker && npx vitest run tests/gamification.test.ts --reporter=verbose` | ✅ | ✅ green |
| 03-03-03 | 03 | 2 | GAME-06 | — | Dashboard shows streak from server | e2e | manual | — | ○ manual |
| 03-04-01 | 04 | 3 | GAME-04 | — | Dashboard renders XP + streak components | file-check | `grep "XPProgressBar" apps/web/app/routes/_app._index.tsx` | ✅ | ✅ green |
| 03-04-02 | 04 | 3 | GAME-06 | — | Profile page renders stat cards | file-check | `grep "StatCard" apps/web/app/routes/_app.profile.tsx` | ✅ | ✅ green |

*Status: pending · green · red · flaky*

---

## Wave 0 Requirements

- [x] `tests/xp.test.ts` — pure unit tests for `computeLevel()`, `updateStreak()`, `toLocalDateString()`, `LEVEL_THRESHOLDS`, XP constants (created by 03-00-PLAN.md)
- [x] `tests/gamification.test.ts` — integration test stubs for XP award, streak logic, stats endpoint (created by 03-00-PLAN.md)
- [x] `tests/setup.ts` — extended with `user_stats` CREATE TABLE statement (created by 03-00-PLAN.md)

*Wave 0 plan (03-00-PLAN.md) creates all test stubs before implementation begins. Tests start RED and turn GREEN as Plans 01-03 implement the code.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Dashboard shows XP, level, streak visually | GAME-04, GAME-06 | UI rendering verification | Open dashboard, verify XP bar, level badge, streak flame display correctly |
| Level-up pulse animation triggers | GAME-03 | CSS animation timing | Complete enough activities to level up, verify subtle pulse on level badge |
| Streak resets after missed day | GAME-05 | Requires time manipulation | Change system date or mock server time, verify streak resets to 0 |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-04-16

---

## Validation Audit 2026-04-16

| Metric | Count |
|--------|-------|
| Gaps found | 2 |
| Resolved | 2 |
| Escalated | 0 |

Root cause: `createTestSession` in tests/setup.ts failed to extract auth cookie (Better Auth returned 403 for unverified email). Fixed by inserting pre-verified user + HMAC-signed session directly into D1. Also rewrote gamification.test.ts to use `app.request()` with mounted routes instead of `WORKER.fetch()`.

Result: 36/36 tests pass (29 xp.test.ts + 7 gamification.test.ts).
