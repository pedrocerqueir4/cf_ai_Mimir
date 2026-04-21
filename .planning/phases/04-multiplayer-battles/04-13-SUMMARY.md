---
phase: 04-multiplayer-battles
plan: 13
subsystem: multiplayer
tags: [multiplayer, wave-9, gap-closure, frontend, stuckpane, retry-ux, nyquist]

# Dependency graph
requires:
  - phase: 04-multiplayer-battles
    provides: "Plan 04-12 POST /api/battle/:id/pool/retry endpoint + PoolRetryResponse discriminated union exported from worker/src/validation/battle-schemas.ts; Plan 04-10 StuckPane + 45s elapsed-time watchdog; Plan 04-11 applyWagerResponseToCache + waiting-for-opponent watchdog extension"
provides:
  - "BattleApiError.body — optional `public readonly body: unknown` field (4th constructor arg, default null) — backward-compatible extension enabling callers to discriminate 4xx/5xx response variants by parsed JSON body"
  - "apps/web/app/lib/api-client.ts: retryBattlePool(battleId) → Promise<PoolRetryResponse> — POST with no body, credentials: 'include', throws BattleApiError(status, serverMessage, message, body) on non-OK"
  - "apps/web/app/lib/api-client.ts: PoolRetryResponse — discriminated union mirroring the backend contract (ready / generating+inFlight / generating+restarted)"
  - "apps/web/app/routes/_app.battle.pre.$id.tsx: StuckPane accepts canRetry + retrying + onRetry props; host-only third CTA rendered between Cancel and Keep-waiting; all three CTAs share disabled={cancelling || retrying}"
  - "apps/web/app/routes/_app.battle.pre.$id.tsx: handleRetryPool useCallback with 200/202/409/4xx-5xx response discriminator + Sonner toast feedback + ref reset on 202"
  - "VALIDATION.md Test ID 04-42 (manual-only) + Addendum 2026-04-21b"
affects: [04-multiplayer-battles plan 04-14 (regression tests 04-39/40/41 + optional future automated host-retry UAT if RTL lands)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Backward-compatible error-class extension: add optional constructor arg with default (body?: unknown = null) + `public readonly body` field, so call-sites that need richer error context narrow `err.body` at the catch without forcing every throw-site to pass it"
    - "Frontend discriminated-union consumer: type annotation on the awaited response (`const response: PoolRetryResponse = await retryBattlePool(...)`) + early-return for the terminal arm (`status === 'ready'`) + fall-through for the re-armed arm gives the TS narrowing engine a flat 3-branch decision tree without nested switches"
    - "Host-only UI affordance with backend-authoritative trust: frontend conditionally renders the retry CTA via `lobby.hostId === currentUserId` (defense-in-depth + UX polish); the authoritative 403 still lives on the backend from Plan 04-12 T-04-gap-10 mitigation"
    - "WARN-7 defensive remount guard: `if (!lobby || lobby.hostId !== currentUserId) return;` at top of the async handler, mirroring the `if (retrying) return;` debounce — belt-and-suspenders against fast-remount races where the render-time guard (canRetry) and click-time guard diverge"

key-files:
  created: []
  modified:
    - apps/web/app/lib/api-client.ts
    - apps/web/app/routes/_app.battle.pre.$id.tsx
    - .planning/phases/04-multiplayer-battles/04-VALIDATION.md

key-decisions:
  - "BattleApiError extended with optional `body` field (4th constructor arg, `= null` default) rather than creating a BattleApiErrorWithBody subclass — keeps one error type across the file, backward-compatible for all 6 existing 3-arg call-sites, and narrows `err.body` at the call-site via `typeof err.body === 'object' && 'inFlight' in (err.body as Record<string, unknown>)`"
  - "Three CTAs stacked top-to-bottom in StuckPane: Cancel (destructive) → Retry (secondary, host-only) → Keep waiting (outline). Progressive-disclosure convention: most-disruptive at top, active-recovery in the middle for emphasis, passive at bottom"
  - "All three CTAs share `disabled={cancelling || retrying}` so any in-flight action disables the whole button stack — prevents concurrent retry+cancel races that would produce confusing toast sequences"
  - "202 restarted branch resets the matching stuck-ref via `stuckReason` (waiting → waitingStartedAtRef; otherwise loading → loadingStartedAtRef) and flips phase back to the matching `waiting-for-opponent` | `loading` — reusing exactly the handleKeepWaiting pattern so the 45s watchdog re-arms cleanly without duplicating logic"
  - "200 ready branch does NOT manually setPhase — invalidateQueries lets the existing phase-transition useEffect promote to roadmap-reveal on the next poll tick. Avoids duplicating the phase logic, prevents races between the manual setPhase and the poll-driven useEffect"
  - "409 inFlight discrimination uses `typeof err.body === 'object' && 'inFlight' in err.body && err.body.inFlight === true` rather than pattern-matching on err.serverMessage — type-safe, survives server-side message-copy refactors, and doesn't rely on string equality"
  - "Test 04-42 declared manual-only upfront per Nyquist 8a — RTL is not wired in this repo (see VALIDATION.md frontmatter `frontend_manual_only: true`); asserting the visual conditional render + Sonner toast sequence is better done via two-browser UAT than by mocking every RTL primitive for a single interaction"

patterns-established:
  - "Error-class body carrier pattern: when a non-OK HTTP response returns a parsed JSON body the caller needs to discriminate on (beyond status + serverMessage), add an optional `body: unknown` field to the existing error class rather than subclassing — keeps the instanceof check flat and the 4th arg's `= null` default keeps every 3-arg callsite untouched. Reusable for any future endpoint whose error shape is load-bearing."
  - "Stuck-pane CTA stack triage: (destructive) + (active-recovery, role-gated) + (passive-waiting). The middle slot reserves room for role-specific recovery affordances without rearranging the outer two. Future plans adding per-role recovery can extend the middle slot without touching Cancel/Keep-waiting wiring."

requirements-completed:
  - MULT-01
  - MULT-02

# Metrics
duration: ~10min
completed: 2026-04-21
---

# Phase 04 Plan 13: Host Retry UX for Pre-Battle Stuck Pane Summary

**Host-only 'Retry pool generation' CTA wired into the existing StuckPane on `/battle/pre/:id`, consuming the Plan 04-12 backend endpoint via a new `retryBattlePool` helper; BattleApiError extended with an optional `body: unknown` carrier so the 409 inFlight branch can be discriminated from other 409s at the call-site.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-04-21T11:40:17Z
- **Completed:** 2026-04-21T11:49:55Z
- **Tasks:** 3/3
- **Files modified:** 3 (2 source + 1 VALIDATION doc)

## Accomplishments

- Extended `BattleApiError` class with a `public readonly body: unknown` field + 4th optional constructor arg (default `null`) — backward-compatible, all existing 3-arg callsites keep compiling, enables any future error-discrimination-by-body pattern
- Added `retryBattlePool(battleId): Promise<PoolRetryResponse>` helper and `PoolRetryResponse` discriminated-union type to `api-client.ts`, mirroring the backend contract from Plan 04-12 byte-for-byte
- Wired host-only 'Retry pool generation' CTA into StuckPane: third button between Cancel and Keep-waiting, visible only when `lobby.hostId === currentUserId`; Sonner toasts surface all three response branches (200 ready, 202 restarted, 409 inFlight) plus the 4xx/5xx error fallback
- All three StuckPane CTAs now share `disabled={cancelling || retrying}` so any in-flight action disables the whole stack — prevents confusing concurrent retry+cancel races
- Registered Test 04-42 as manual-only in VALIDATION.md with Addendum 2026-04-21b; manual-only counter bumps 2 → 3 (04-34, 04-38, 04-42); automated counter unchanged per Nyquist 8a
- Full `tests/battle/` suite remains green post-change (36 files / 137 tests / 32 todo / 1 skipped — identical to the Plan 04-12 baseline); no backend regression introduced by this frontend plan

## Task Commits

Each task was committed atomically with `--no-verify` per parallel worktree protocol:

1. **Task 1: Extend BattleApiError + add retryBattlePool + PoolRetryResponse** — `8ed3f95` (feat)
2. **Task 2: Host-only Retry pool generation CTA in StuckPane** — `139825f` (feat)
3. **Task 3: Register Test 04-42 + Addendum 2026-04-21b in VALIDATION.md** — `cd5013e` (docs)

_All 3 commits are in the current worktree branch; orchestrator will merge after wave-9 completion._

## Files Created/Modified

### Modified
- `apps/web/app/lib/api-client.ts` — (Step A0) extended `BattleApiError` class with `public readonly body: unknown` field + 4th constructor arg (default `null`); (Step A) new `PoolRetryResponse` discriminated-union type exported near the existing battle-types neighborhood; (Step B) new `retryBattlePool` helper immediately after `cancelBattle`, mirroring its shape (POST / no body / `credentials: "include"`) and throwing 4-arg `BattleApiError(status, serverMessage, message, body)` on non-OK
- `apps/web/app/routes/_app.battle.pre.$id.tsx` — (Step A) import block extended with `retryBattlePool` + `type PoolRetryResponse`; (Step B) `const [retrying, setRetrying] = useState(false)` sibling to `cancelling`; (Step C) new `handleRetryPool` useCallback with WARN-7 defensive guard, 200 ready / 202 restarted / 409 inFlight / 4xx-5xx error branches, and the exact `[battleId, currentUserId, lobby, queryClient, retrying, stuckReason]` deps array; (Step D) StuckPane signature extended with `canRetry` + `retrying` + `onRetry` props; (Step E) third Button (`variant="secondary"`) rendered conditionally on `canRetry` between Cancel and Keep-waiting with label `{retrying ? "Retrying…" : "Retry pool generation"}`; (Step F) StuckPane consumer computes `canRetry = lobby != null && currentUserId != null && lobby.hostId === currentUserId` inline and passes the new props; (Step G) all three Button `disabled` expressions extended to `cancelling || retrying`
- `.planning/phases/04-multiplayer-battles/04-VALIDATION.md` — (Step A) new Test 04-42 row appended after the 04-41 row, declared manual-only, references T-04-gap-13; (Step B) new Addendum 2026-04-21b appended after Addendum 2026-04-21a with fix shape, commit hashes (`8ed3f95`, `139825f`, this commit), and counter update (manual-only 2 → 3; automated unchanged)

## Key Decisions

See frontmatter `key-decisions` above — 7 decisions logged. Primary:
- **BattleApiError `body` field is backward-compatible** — 4th arg with `= null` default means all 6 existing 3-arg callsites in the file (`createBattle`, `joinBattle`, `fetchBattleLobby`, `submitWager`, `startBattle`, `cancelBattle`, `fetchLeaderboard`) compile unchanged
- **CTA stack ordering** — Cancel / Retry / Keep-waiting, progressive disclosure, most-disruptive at top
- **200 ready branch has no manual setPhase** — the existing phase-transition useEffect handles promotion on the next poll tick; avoids duplicating phase logic and prevents races
- **409 inFlight discrimination via typed body narrow** — type-safe, survives server-side error-message refactors

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Dependency install into fresh worktree to enable `npx tsc -b` gate**
- **Found during:** Task 1 preflight (`cd apps/web && npx tsc -b` required working `typescript` binary; fresh worktree had no `node_modules`)
- **Issue:** Fresh worktree checkout has no installed dependencies; tsc, vitest, and all bundled tooling unavailable. Mirrors Plan 04-12 deviation #2.
- **Fix:** Ran `npm install --prefer-offline --no-audit --no-fund` at repo root + `apps/web/` + `worker/` (latter needed for cross-project tsc to resolve `../../worker` imports). Reverted lockfile + `worker-configuration.d.ts` drift via `git checkout -- package-lock.json apps/web/worker-configuration.d.ts` to keep commit scope tight. `node_modules` is gitignored, so installed deps don't leak into commits.
- **Files modified:** None in commit scope (install artifacts reverted).
- **Commit:** None — out-of-scope infrastructure.
- **In-scope:** NO — this is an infrastructure prerequisite, not a plan deliverable.

### Plan-criterion nitpicks (informational, not rule violations)

**2. [Plan acceptance nitpick] `grep -c "import.*retryBattlePool"` returns 0 instead of 1**
- **Found during:** Task 2 verification
- **Issue:** The plan's acceptance criterion `grep -c "import.*retryBattlePool"` requires the substring `import` on the SAME line as `retryBattlePool`. The actual import statement in `_app.battle.pre.$id.tsx` is a multi-line `import { ... } from "~/lib/api-client";` block — `retryBattlePool` lives on line 17, but the `import` keyword is on line 13. The symbol IS imported (line 17 confirms it, and tsc is happy), but the regex as written can't see across lines.
- **Fix:** None needed — the import is structurally correct. Verification via `grep -n "retryBattlePool\|PoolRetryResponse" apps/web/app/routes/_app.battle.pre.\$id.tsx` confirms both symbols present at lines 17 and 21 inside the multi-line block.
- **Same issue for `grep -c "import.*PoolRetryResponse"`** — identical multi-line block artifact.
- **Same issue for `grep -B1 "onClick={onRetry}" … | grep -c "canRetry &&"`** — the plan expected `{canRetry && (` to be on the line immediately above `<Button`, but the formatter I used puts `{canRetry && (` two lines above (`<Button` / `onClick={onRetry}`). Structural correctness unchanged — the conditional render is intact, confirmed via `grep -B3 "onClick={onRetry}"` which shows `{canRetry && (` as the second line of context.
- **Impact:** Zero functional impact. All TypeScript type-checks pass. All behavior is correct. Plan-criterion grep patterns are too strict for multi-line formatting; the structural gates (tsc, end-to-end grep) all pass.

### Authentication Gates

None encountered. Pure frontend wiring; no external auth.

## Verification Evidence

1. **Task 1 grep gates:**
   - `grep -c "public readonly body: unknown" apps/web/app/lib/api-client.ts` → 1
   - `grep -c "this.body = body" apps/web/app/lib/api-client.ts` → 1
   - `grep -c "export type PoolRetryResponse" apps/web/app/lib/api-client.ts` → 1
   - `grep -c "export async function retryBattlePool" apps/web/app/lib/api-client.ts` → 1

2. **Task 2 grep gates:**
   - `grep -c "const \[retrying, setRetrying\] = useState" apps/web/app/routes/_app.battle.pre.\$id.tsx` → 1
   - `grep -c "const handleRetryPool = useCallback" apps/web/app/routes/_app.battle.pre.\$id.tsx` → 1
   - `grep -c "canRetry" apps/web/app/routes/_app.battle.pre.\$id.tsx` → 6 (≥3 required)
   - `grep -c "lobby\.hostId === currentUserId" apps/web/app/routes/_app.battle.pre.\$id.tsx` → 5 (≥1 required)
   - `grep -c "onRetry: () => void" apps/web/app/routes/_app.battle.pre.\$id.tsx` → 1
   - `grep -c "retrying: boolean" apps/web/app/routes/_app.battle.pre.\$id.tsx` → 1
   - `grep -c "disabled={cancelling || retrying}" apps/web/app/routes/_app.battle.pre.\$id.tsx` → 3 (all three CTAs disable together)
   - WARN-7 guard: `grep -c 'if (!lobby || lobby.hostId !== currentUserId) return' apps/web/app/routes/_app.battle.pre.\$id.tsx` → 1
   - Deps array: `grep -c '\[battleId, currentUserId, lobby, queryClient, retrying, stuckReason\]' apps/web/app/routes/_app.battle.pre.\$id.tsx` → 1

3. **Task 3 grep gates:**
   - `grep -c "04-42" .planning/phases/04-multiplayer-battles/04-VALIDATION.md` → 5 (≥2 required; row + addendum multiple references)
   - `grep -c "Addendum 2026-04-21b" .planning/phases/04-multiplayer-battles/04-VALIDATION.md` → 1
   - `grep -c "T-04-gap-13" .planning/phases/04-multiplayer-battles/04-VALIDATION.md` → 2 (≥2 required; row + addendum)
   - Manual-only marker on 04-42 row present
   - Counter transition `2 → 3` present in addendum

4. **TypeScript gate (plan-prescribed):** `cd apps/web && npx tsc -b` exits 0 (pre-existing `app/root.tsx` and `workers/app.ts` TS2307 codegen-artifact diagnostics unchanged; not introduced by this plan).

5. **Battle suite regression gate:** `npm test -- tests/battle/` → 36 test files pass, 137 tests pass, 32 todo, 1 skipped, ~62s. Matches Plan 04-12 baseline exactly — zero backend regression.

6. **End-to-end symbol wiring:** `grep -n "retryBattlePool\|canRetry\|handleRetryPool" apps/web/app/routes/_app.battle.pre.\$id.tsx` shows all three symbols threaded through imports (L17), handler definition (L402), handler call (L411), consumer derivation (L520), props forwarding (L529–531), and StuckPane signature + conditional render (L744, L751, L776).

## Threat Flags

Plan threat model (T-04-gap-13 UX leakage + T-04-gap-13-spam DoS accepted + T-04-gap-13-stale race accepted) covers all security-relevant surface. Backend 403 from Plan 04-12 is the authoritative defense; this plan's conditional render is defense-in-depth + UX polish. No new flags introduced.

## Deferred Issues

None. Plan scope closed in full. 04-42 is manual-only by design (Nyquist 8a; declared upfront in VALIDATION.md). Plan 04-14 will land automated regression tests for 04-39/04-40/04-41 (backend Plan 04-12 gates).

## Self-Check: PASSED

All claimed files exist on disk:
- `apps/web/app/lib/api-client.ts` — contains `public readonly body: unknown`, `export type PoolRetryResponse`, `export async function retryBattlePool`
- `apps/web/app/routes/_app.battle.pre.$id.tsx` — contains `retryBattlePool` (import + handler call), `handleRetryPool` (useCallback), `canRetry` (6 occurrences — props, consumer derivation, conditional render), `Retry pool generation` (button label + JSDoc), `disabled={cancelling || retrying}` (three CTAs)
- `.planning/phases/04-multiplayer-battles/04-VALIDATION.md` — contains `04-42` (5 occurrences), `Addendum 2026-04-21b` (1), `T-04-gap-13` (2), `2 → 3` counter note

All claimed commits exist in git history:
- `8ed3f95` Task 1 (api-client) — present
- `139825f` Task 2 (StuckPane) — present
- `cd5013e` Task 3 (VALIDATION) — present
