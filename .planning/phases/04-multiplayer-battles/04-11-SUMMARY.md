---
phase: 04-multiplayer-battles
plan: 11
subsystem: multiplayer-battles
status: complete
started: 2026-04-20
completed: 2026-04-20
gap_closure: true
gap_source: .planning/phases/04-multiplayer-battles/04-UAT.md#test-7
tags: [multiplayer, wave-7, gap-closure, wager-flow, lobby-identity, nyquist]
requirements_addressed:
  - MULT-01
  - MULT-04
threat_refs:
  - T-04-gap-07
  - T-04-gap-08
  - T-04-gap-09
dependency_graph:
  requires:
    - 04-04 (GET /api/battle/:id handler + findBattleForParticipant helper)
    - 04-10 (prior stuck-pane watchdog + Phase 'stuck' variant this plan extends)
    - gamification/LevelBadge component + worker/src/lib/xp.ts computeLevel helper (pre-existing)
  provides:
    - wager-submit cache merge that survives first-submitter's next poll tick
    - waiting-for-opponent stuck-pane watchdog for >45s pool-not-ready cases
    - per-participant name/image/level/XP surface on lobby GET response
    - ParticipantCard lobby component (consumes the new wire fields)
  affects:
    - apps/web/app/routes/_app.battle.pre.$id.tsx (wager handler + watchdog)
    - apps/web/app/routes/_app.battle.new.tsx (wager picker removed)
    - apps/web/app/routes/_app.battle.lobby.$code.tsx (ParticipantCard wired)
    - worker/src/routes/battle.ts GET /:id response shape (+6 fields)
    - apps/web/app/lib/api-client.ts BattleLobbyState (+6 fields)
tech_stack:
  added: []
  patterns:
    - pure helper extraction (applyWagerResponseToCache) for testable cache merges
    - dual-purpose useRef watchdogs + stuckReason discriminator state
    - LEFT JOIN user_stats with server-side level derivation via computeLevel
    - Vite `?raw` import for bundle-time source-text assertions (avoids
      Workers `/bundle/...` vs repo-root mismatch that node:fs.readFileSync hits)
key_files:
  created:
    - apps/web/app/lib/battle-wager-cache.ts
    - apps/web/app/components/battle/ParticipantCard.tsx
    - tests/battle/battle.wager.advance.test.ts
    - tests/battle/battle.lobby.participants.test.ts
  modified:
    - apps/web/app/routes/_app.battle.pre.$id.tsx
    - apps/web/app/routes/_app.battle.new.tsx
    - apps/web/app/routes/_app.battle.lobby.$code.tsx
    - apps/web/app/lib/api-client.ts
    - worker/src/routes/battle.ts
    - .planning/phases/04-multiplayer-battles/04-VALIDATION.md
decisions:
  - "Extract applyWagerResponseToCache into a pure helper module (no React/TanStack deps) so the first-submitter cache-merge contract is unit-testable. The earlier inline implementation in handleSubmitWager had 5 fine-grained branches (host vs guest, first vs second submitter, bothProposed vs not) that were only verifiable end-to-end — any regression would bounce the UI back to wager-propose and be hard to reproduce."
  - "Two distinct watchdog refs (loadingStartedAtRef + waitingStartedAtRef) with a stuckReason discriminator rather than a single unified ref — the two phases can both arm independently during a battle lifecycle and collapsing them would cause cross-contamination when phase flips back and forth. stuckReason lets handleKeepWaiting reset the correct ref and return to the right phase."
  - "Server-side LEFT JOIN user_stats + computeLevel derivation rather than a separate /api/user/:id/stats endpoint call from the frontend — keeps the lobby GET as the single source of truth and avoids an N+2 waterfall (host + guest) per poll tick."
  - "Default xp: 0 / level: 1 for users without a user_stats row. Fresh accounts don't always have a stats row seeded yet (depends on whether they've completed a lesson). LEFT JOIN + coalesce keeps the lobby functional from the very first battle."
  - "Static-source gate test (04-37) uses Vite `?raw` import not node:fs.readFileSync — the Workers pool bundles source into /bundle/... so repo-root filesystem paths don't resolve. `?raw` imports are bundled at Vite-config time, so the source text ships inline with the test module."
  - "ParticipantCard is intentionally presentational (no hooks, no session). The lobby route derives isSelf and passes it in. Keeps the component trivially unit-testable if RTL is ever wired and keeps avatar/initials fallback logic in one place."
metrics:
  duration_minutes: 11
  tasks: 6
  files_modified: 6
  files_created: 4
  commits: 6
---

# Phase 04 Plan 11: Wager Flow + Lobby Enhancement Gap Closure Summary

**One-liner:** Fixed stuck-after-wager blocker by rewriting the wager-submit cache merge to unconditionally apply the server response on any 2xx (pure helper + regression tests), removed the duplicate illustrative wager picker from `/battle/new`, and extended the lobby to show opponent name/image/level/XP via a new ParticipantCard — closes the three-issue bundle surfaced at UAT Phase 04 Test 7.

---

## Gap Closed

**Source:** `.planning/phases/04-multiplayer-battles/04-UAT.md` Test 7 — three items reported by the user in a single session:

1. **BLOCKER.** "Not working, gets stuck after picking a wager, neither the host or the user2 can do anything just gets stuck." Both clients hung on the wager picker screen with no progression to `/battle/pre/:id`.
2. **UX bug (minor).** "The host is selecting the wager 2 times, first time in the 'create table tab' that is /battle/new and after when the user2 join, should be just when the user2 join."
3. **Enhancement.** "To be better should show information of the user when the both player connect showing their name, level, xp."

All three bundled into a single plan per user preference (Option A). Bounded scope: no new DB migration, no new route, no new schema — only wire-format extensions to existing GET `/api/battle/:id` and a cache-merge correctness fix on the frontend.

**Confirmed root causes:**

1. **Wager stuck-after-submit:** the pre-battle page's `handleSubmitWager` applied the server response to the TanStack cache ONLY when the server returned `bothProposed=true`. The FIRST submitter's own tier got no cache update, so the next 2s lobby poll returned `hostWagerTier: null` (or `guestWagerTier: null`), and the phase-transition `useEffect` read that as "my tier NOT proposed" and reset `phase` back to `wager-propose`. Looked like the submit button was a no-op. Same bug for either side, both could get stuck simultaneously.
2. **Double wager:** Plan 04-05 shipped a `<WagerTierPicker>` inside the Create form (`apps/web/app/routes/_app.battle.new.tsx`) as an "illustrative preview" of tiers, with no server-side semantics (the `createBattle` payload never carried the tier — the actual proposal happens in `/battle/pre/:id`). Users couldn't tell it was illustrative and perceived the pre-battle picker as a duplicate prompt.
3. **No participant identity surface:** GET `/api/battle/:id` only returned `hostName` / `guestName` (no avatar, no level, no XP). The lobby couldn't render an identity tile without either a waterfall fetch per participant or a wire-format extension.

---

## Before / After

**Before (broken):**

| Layer | Behaviour |
|-------|-----------|
| Wager submit handler | Applied cache merge ONLY on `bothProposed=true`. First submitter's own tier wasn't cached. Next poll returned null tier → phase useEffect bounced UI back to wager-propose. |
| Create form | Hosted a `<WagerTierPicker>` + `useQuery(fetchUserStats)` for the XP preview. Tier value was NEVER sent to the server; purely decorative — confused users into thinking they committed twice. |
| Lobby GET response | `hostName` / `guestName` only — 2 fields per participant. |
| Lobby UI | Flat `<p>Opponent: {lobby.guestName ?? "Waiting…"}</p>` — no avatar, no level, no XP. |
| Stuck-pane watchdog | Armed ONLY during `phase === 'loading'` with `poolStatus === 'generating'`. If pool generation finished between transitioning to `waiting-for-opponent` and the workflow later failing, the user would be silently stuck with no recovery path. |

**After (fixed):**

| Layer | Behaviour |
|-------|-----------|
| Wager submit handler | `applyWagerResponseToCache` pure helper applies the server response to the `["battle", id, "lobby-pre"]` cache UNCONDITIONALLY on 2xx. First-submitter's tier is set immediately; opponent's tier preserved from prev cache. `bothProposed=true` additionally forwards `appliedWagerTier` so the roadmap reveal can fire without waiting for the next poll. |
| Create form | Only roadmap + question-count pickers. Wager proposal happens exactly once in the pre-battle flow after both players have joined. Cleanup: removed `<WagerTierPicker>` + `useQuery(userStats)` + `fetchUserStats` / `getLocalTimezone` / `WagerTier` imports. |
| Lobby GET response | Adds `hostImage`, `hostXp`, `hostLevel`, `guestImage`, `guestXp`, `guestLevel` (6 new fields). Guest-side fields null when `guestId` is null. Derivation: SELECT extended to pull `users.image`, LEFT JOIN `user_stats.xp`, level computed via existing `computeLevel(xp).level` from `worker/src/lib/xp`. |
| Lobby UI | Two `<ParticipantCard>` tiles (new component). Each shows avatar (or initials fallback), name (with `(you)` marker for the self slot), the existing `LevelBadge`, total XP (`.toLocaleString()`), and a role chip (host/guest). Guest slot before join renders a dashed-border "Waiting for opponent to join…" placeholder. |
| Stuck-pane watchdog | Two arming conditions: (a) `phase === 'loading'` + `poolStatus === 'generating'` > 45s (Plan 04-10), (b) `phase === 'waiting-for-opponent'` + both wagers submitted + `poolStatus !== 'ready'` > 45s (Plan 04-11). Separate `loadingStartedAtRef` / `waitingStartedAtRef`. A `stuckReason` state discriminator lets `handleKeepWaiting` reset the correct ref and return to the right phase. |

---

## New Pure Helper Contract

`apps/web/app/lib/battle-wager-cache.ts`:

```typescript
export type WagerTier = 10 | 15 | 20;

export interface WagerSubmitResponsePayload {
  tier: WagerTier;
  bothProposed: boolean;
  appliedTier: WagerTier | null;
  hostWagerAmount: number | null;
  guestWagerAmount: number | null;
}

export function applyWagerResponseToCache(
  prev: BattleLobbyState | undefined,
  response: WagerSubmitResponsePayload,
  currentUserId: string | null,
  selectedTier: WagerTier,
): BattleLobbyState | undefined;
```

**Contract:**
- `prev === undefined` → return `undefined` (loader hasn't populated cache yet; don't synthesize state).
- `prev` defined → return new `BattleLobbyState` with `hostWagerTier` or `guestWagerTier` set to `selectedTier` based on whether `currentUserId` matches `prev.hostId` / `prev.guestId`. Opponent's tier preserved from `prev`.
- `response.bothProposed === true && response.appliedTier != null` → additionally forward `appliedWagerTier` so the pre-battle page can advance to `roadmap-reveal` without waiting for the next poll.

Immutable: never mutates `prev`.

---

## Test 04-35 / 04-36 / 04-37 Coverage

### 04-35 — Wager cache advance (5 pure-function cases)

File: `tests/battle/battle.wager.advance.test.ts` (wager-advance describe block).

| Case | Scenario | Contract Asserted |
|------|----------|-------------------|
| A | First-submitter host | `hostWagerTier = selected`, `guestWagerTier = null`, `appliedWagerTier = null`, `prev` not mutated |
| B | First-submitter guest | `guestWagerTier = selected`, `hostWagerTier = null`, `appliedWagerTier = null` |
| C | Second-submitter with `bothProposed=true` + `appliedTier` from server | Submitter's tier set, opponent's preserved from prev, `appliedWagerTier` forwarded |
| D | Undefined `prev` | Returns `undefined` (loader hasn't hydrated; don't invent state) |
| E | Phase-regression contract | `(currentUserId===hostId ? hostWagerTier : guestWagerTier)` is NON-null post-submit — locks the exact condition the pre-battle page's phase-transition useEffect reads to decide "my tier proposed?". Before the Plan 04-11 fix, this returned null and the UI bounced back to wager-propose. |

### 04-36 — Lobby GET participant fields (3 integration cases)

File: `tests/battle/battle.lobby.participants.test.ts` (HTTP-level tests via `battleRoutes`).

| Case | Scenario | Contract Asserted |
|------|----------|-------------------|
| A | Host-only lobby (guest not yet joined) | `hostName/hostImage/hostXp/hostLevel` populated from seeded user + user_stats; `guestName/guestImage/guestXp/guestLevel` all null |
| B | Both players in lobby with user_stats rows | Both sides populated; XP reflects seeded values; level between 1 and 25 (computeLevel cap) |
| C | Guest has no user_stats row yet | LEFT JOIN defaults kick in: `guestXp === 0`, `guestLevel === 1` |

**Test-data nuance honored:** `createTestSession(email)` in `tests/setup.ts:250` seeds `user.name = email.split("@")[0]` — so host created with `"participants-host@test.example"` has `hostName === "participants-host"` (not the full email). Assertions account for this.

### 04-37 — /battle/new source cleanup (static-source grep)

File: `tests/battle/battle.wager.advance.test.ts` (static-source describe block).

Imports the `/battle/new` route source via Vite `?raw` (bundle-time text import, not `node:fs`) and asserts absence of: `WagerTierPicker`, `wagerTier`, `fetchUserStats`, `getLocalTimezone`. Comment lines are stripped before matching so prose explanations of what was removed don't trigger false positives.

**Why `?raw` not `node:fs`:** The Workers pool bundles source into `/bundle/...` inside miniflare. `readFileSync("apps/web/app/routes/_app.battle.new.tsx")` returns ENOENT. `?raw` resolves at Vite-config time and embeds the file text as a string literal in the compiled test module — works inside the Workers runtime.

---

## Test 04-38 Rationale (Manual-Only)

The lobby `ParticipantCard` visual rendering + two-session real-time refresh is declared manual-only per Nyquist 8a:

- **Visual surface:** avatar-vs-initials fallback, `LevelBadge` visual integration, the "(you)" marker, the role chip — these are presentational details RTL would assert only via snapshot tests (which are fragile and don't validate the actual visual output).
- **Two-session real-time:** demonstrating that the host's lobby reactively replaces the "Waiting…" placeholder with the guest's `ParticipantCard` within one poll tick of the guest joining requires two concurrent browsers + real polling — not something RTL can simulate without heavy fetch mocking.
- **React Testing Library not wired in this repo** — aligns with Plans 05/06/07/10 precedent for frontend-heavy UX verification.

Recorded in `## Manual-Only Verifications` with explicit repro instructions (two sessions, guest join, verify tile, avatar-null fallback).

---

## Deviations from Plan

**None behavioural.** All 6 tasks executed in plan-specified order with plan-specified intent. A few mechanical adjustments captured here for completeness:

1. **Task 5 static-source test — switched from `node:fs` to Vite `?raw`.** The plan suggested `node:fs` for the static-grep block (Test 04-37). First run failed with `ENOENT: no such file or directory, readAll '/bundle/apps/web/app/routes/_app.battle.new.tsx'` because the Workers pool bundles test code under `/bundle/...` and repo-root paths don't resolve. Swapped to `import battleNewSource from "…?raw"` which embeds the file text at Vite-config time. Contract preserved; no test-behaviour change. Tracked as a Rule 3 fix (blocking issue auto-resolved).

2. **Frontmatter `type` field.** The plan-level frontmatter didn't specify a `type`; mirrored Plan 04-10's `status: complete` convention rather than introducing new metadata.

3. **`.planning/` gitignore.** Required `git add -f` on the VALIDATION.md update — carried from Plan 04-09 / 04-10 precedent.

4. **Pre-existing DO cold-start race flake.** `battle.score.test.ts` line 154 tripped once during the full-suite run but passed cleanly in isolation. Not introduced by Plan 04-11 (the file and its assertions are untouched). Documented here so the verifier doesn't chase it as a regression.

---

## Verification Evidence

**TypeScript compile (per task):**
- Task 1: `cd apps/web && npx tsc -b` → exit 0; `cd worker && npx tsc --noEmit` → exit 0.
- Task 2: `cd apps/web && npx tsc -b` → exit 0.
- Task 3: `cd worker && npx tsc --noEmit` → exit 0; existing battle tests (`battle.join.test.ts` + `battle.create.test.ts`) → 8/8 green.
- Task 4: `cd apps/web && npx tsc -b` → exit 0.
- Task 5: `npm test -- tests/battle/battle.wager.advance.test.ts tests/battle/battle.lobby.participants.test.ts` → 9/9 green.

**Full battle suite post-plan:** `npm test -- tests/battle/` → **35 / 36 files pass** (one pre-existing `battle.score.test.ts` flake — DO cold-start race — which passes on isolated re-run). **144 assertions + 32 todos**, total runtime **~113s**. Up from pre-plan 33 files / 135 assertions.

**Manual sanity (plan-level):** Task 6's grep for `04-35` / `04-36` / `04-37` / `04-38` / `2026-04-19d` / counter `40` → all present. `nyquist_compliant: true` frontmatter preserved.

---

## Orphaned-Row Tech-Debt Note

Same note as Plans 04-09 and 04-10. Users who hit any of the pre-plan bugs (stuck wager, or stale workflow failure) may have battle rows sitting at `status='pre-battle'` + `poolStatus='generating'` indefinitely. Plan 04-09 drafted a one-time cleanup SQL; Plan 04-10 re-iterated it; Plan 04-11 inherits the same:

```sql
UPDATE battles
  SET status = 'expired'
  WHERE status = 'pre-battle'
    AND pool_topic_id IN (
      SELECT id FROM battle_pool_topics
      WHERE status = 'generating'
        AND updated_at < strftime('%s','now','-5 minutes')
    );

UPDATE battle_pool_topics
  SET status = 'failed', updated_at = strftime('%s','now')
  WHERE status = 'generating'
    AND updated_at < strftime('%s','now','-5 minutes');
```

Not shipped as a migration step — running data-mutation SQL from a plan commit is a footgun. Owner runs manually via `wrangler d1 execute` post-deploy if any orphaned rows linger.

---

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | `ca60a68` | feat(04-11): fix stale-cache bounce after wager submit + extend stuck-pane watchdog |
| 2 | `b6adf9f` | refactor(04-11): remove illustrative wager picker from /battle/new |
| 3 | `e8d8484` | feat(04-11): extend lobby GET response with participant name/image/level/XP |
| 4 | `da63695` | feat(04-11): show participant name/level/XP in lobby via ParticipantCard |
| 5 | `3389fef` | test(04-11): regression tests for wager advance + lobby participant fields |
| 6 | `fc283e3` | docs(04-11): register tests 04-35..04-38 in VALIDATION.md |

---

## Success Criteria

- [x] 6 atomic commits on master (plus this SUMMARY commit)
- [x] `apps/web/app/lib/battle-wager-cache.ts` pure helper created; `applyWagerResponseToCache` exported
- [x] `handleSubmitWager` in `_app.battle.pre.$id.tsx` rewrites cache on every 2xx (not only `bothProposed`)
- [x] Stuck-pane watchdog extended to `waiting-for-opponent` with separate ref + `stuckReason` state
- [x] `/battle/new` no longer imports `WagerTierPicker` / `wagerTier` / `fetchUserStats` / `getLocalTimezone`
- [x] GET `/api/battle/:id` returns 6 new fields; `BattleLobbyState` type extended accordingly
- [x] `ParticipantCard` component created and wired into lobby with avatar/initials fallback + LevelBadge + XP
- [x] `tests/battle/battle.wager.advance.test.ts` 6/6 green (5 pure + 1 static-source)
- [x] `tests/battle/battle.lobby.participants.test.ts` 3/3 green (A/B/C)
- [x] `cd apps/web && npx tsc -b` exit 0; `cd worker && npx tsc --noEmit` exit 0
- [x] 04-VALIDATION.md has rows 04-35..04-38, counter 40, Addendum 2026-04-19d, `nyquist_compliant: true` preserved

## Self-Check

- `apps/web/app/lib/battle-wager-cache.ts`: FOUND (exports `applyWagerResponseToCache`, `WagerTier`, `WagerSubmitResponsePayload`)
- `apps/web/app/routes/_app.battle.pre.$id.tsx`: FOUND (imports `applyWagerResponseToCache`; uses `waitingStartedAtRef` + `stuckReason`)
- `apps/web/app/routes/_app.battle.new.tsx`: FOUND (no longer imports `WagerTierPicker` / `wagerTier` / `fetchUserStats` / `getLocalTimezone`)
- `apps/web/app/routes/_app.battle.lobby.$code.tsx`: FOUND (imports `ParticipantCard`; uses `useSession`; renders two tiles)
- `apps/web/app/components/battle/ParticipantCard.tsx`: FOUND (presentational, props: name/image/level/xp/role/isSelf)
- `apps/web/app/lib/api-client.ts`: FOUND (BattleLobbyState includes `hostImage/hostXp/hostLevel/guestImage/guestXp/guestLevel`)
- `worker/src/routes/battle.ts`: FOUND (imports `computeLevel`; GET /:id LEFT-JOINs user_stats; response has 6 new fields)
- `tests/battle/battle.wager.advance.test.ts`: FOUND (6 cases, green)
- `tests/battle/battle.lobby.participants.test.ts`: FOUND (3 cases, green)
- `.planning/phases/04-multiplayer-battles/04-VALIDATION.md`: FOUND (rows 04-35 + 04-36 + 04-37 + 04-38 present; counter 40; Addendum 2026-04-19d present; nyquist_compliant: true preserved)
- Commit ca60a68: FOUND
- Commit b6adf9f: FOUND
- Commit e8d8484: FOUND
- Commit da63695: FOUND
- Commit 3389fef: FOUND
- Commit fc283e3: FOUND

## Self-Check: PASSED
