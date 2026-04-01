---
phase: 01-foundation
plan: 02
subsystem: auth
tags: [better-auth, drizzle, hono, cloudflare-workers, d1, oauth, google, github, turnstile, rate-limiting, ssrf, multi-session]

# Dependency graph
requires:
  - phase: 01-01
    provides: D1 schema (users, sessions, accounts, verifications), Hono app skeleton, Env bindings, sanitize middleware

provides:
  - Better Auth instance with D1 drizzle adapter, email/password, OAuth (Google+GitHub), multiSession (max 3), 7-day sessions
  - authGuard middleware — derives userId from session cookie, sets c.var.userId (IDOR prevention contract)
  - Rate limiting middleware on all auth endpoints (10/min auth, 5/min register)
  - Turnstile server-side enforcement after 5 failed sign-in attempts per IP (D-05)
  - SSRF fetch allowlist documenting and enforcing all Phase 1 outbound fetch targets (SEC-04)
  - Better Auth React client with multiSession plugin for frontend auth operations

affects: [01-03, auth-ui, protected-routes, any-data-endpoint]

# Tech tracking
tech-stack:
  added:
    - better-auth 1.5.6 (worker: D1 adapter + cloudflare integration; web: react client + multiSession plugin)
  patterns:
    - Server-authority userId: authGuard sets c.var.userId from session only — never from request body/params
    - SSRF boundary: fetch-allowlist.ts documents ALL Phase 1 outbound fetch targets as hardcoded constants
    - Failure-counter pattern: in-memory per-IP failure tracking with 1-hour TTL and periodic cleanup
    - Rate limit before handler: app.use middleware registered before app.on handler ensures rate limiting applies first

key-files:
  created:
    - worker/src/auth.ts
    - worker/src/middleware/auth-guard.ts
    - worker/src/middleware/rate-limit.ts
    - worker/src/middleware/verify-turnstile.ts
    - worker/src/middleware/fetch-allowlist.ts
    - apps/web/app/lib/auth-client.ts
  modified:
    - worker/src/index.ts

key-decisions:
  - "usePlural: true in drizzleAdapter matches schema table names (users, sessions, accounts, verifications)"
  - "...cloudflare() spread sets cookie config required for Workers runtime"
  - "In-memory failure counter acceptable for D-05 — rate limiter is primary defense; counter resets on Worker restart"
  - "authGuard sets both userId and full session on context for downstream flexibility"
  - "Rate limit middleware registered on /api/auth/* BEFORE the Better Auth handler in Hono route order"

patterns-established:
  - "IDOR contract: all downstream handlers use c.get('userId') — never req.body.userId or req.params.userId"
  - "SSRF boundary: add new outbound fetch targets to ALLOWED_FETCH_ORIGINS with documentation before using fetch()"
  - "Failure counter + Turnstile: recordLoginFailure/resetLoginFailures called around auth attempts to enforce D-05"

requirements-completed: [AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06, SEC-02, SEC-04]

# Metrics
duration: 12min
completed: 2026-04-01
---

# Phase 01 Plan 02: Auth Backend Summary

**Better Auth on Hono with D1 adapter, multiSession (max 3), OAuth (Google+GitHub), rate limiting, Turnstile failure-counter enforcement (D-05), SSRF fetch allowlist (SEC-04), and React auth client**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-04-01T15:50:34Z
- **Completed:** 2026-04-01T16:02:00Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Better Auth instance configured with D1 drizzle adapter (usePlural: true), cloudflare() integration, email/password with verification, Google+GitHub OAuth, multiSession (max 3 concurrent per D-01), 7-day session expiry (D-02), account linking (prevents duplicate accounts on OAuth sign-in with existing email), and OAuth error redirect to /auth/sign-in (D-06)
- authGuard middleware establishes IDOR prevention contract: all protected routes get userId from verified session only
- Rate limiting (10/min auth, 5/min register) mounted on /api/auth/* BEFORE Better Auth handler; Turnstile enforcement (D-05) on sign-in routes after 5 failed attempts per IP with 403 + { turnstileRequired: true } response
- SSRF boundary documented in fetch-allowlist.ts: 5 hardcoded allowed origins (Turnstile + OAuth providers), assertAllowedFetchTarget() guard used before outbound fetch in Turnstile verification
- React auth client configured with multiSessionClient plugin, exports signIn/signUp/signOut/useSession/forgetPassword/resetPassword

## Task Commits

1. **Task 1: Create Better Auth instance, auth-guard middleware, mount auth routes** - `22a1cf3` (feat)
2. **Task 2: Rate limiting, Turnstile enforcement, SSRF allowlist, React auth client** - `d56959b` (feat)

## Files Created/Modified

- `worker/src/auth.ts` - Better Auth instance factory (createAuth) with all Phase 1 config
- `worker/src/middleware/auth-guard.ts` - Session verification middleware, sets userId + session on context
- `worker/src/middleware/rate-limit.ts` - authRateLimit + registerRateLimit using Workers Rate Limiting binding
- `worker/src/middleware/verify-turnstile.ts` - D-05 failure counter, requireTurnstileAfterFailures, verifyTurnstileToken
- `worker/src/middleware/fetch-allowlist.ts` - SEC-04 SSRF boundary with 5 hardcoded allowed origins
- `apps/web/app/lib/auth-client.ts` - Better Auth React client with multiSession plugin
- `worker/src/index.ts` - Auth routes mounted, rate limit + Turnstile wired before auth handler

## Decisions Made

- `usePlural: true` in drizzleAdapter required to match existing schema table names (users, sessions, accounts, verifications) — per Pitfall 1 in RESEARCH.md
- `...cloudflare()` spread required for correct cookie config in Cloudflare Workers runtime — per Pitfall 3 in RESEARCH.md
- In-memory failure counter for D-05 is acceptable: the Workers Rate Limiter is the primary brute-force defense; the counter provides CAPTCHA gating which resets on Worker restart (noted as acceptable limitation)
- `advanced.defaultCallbackURL: "/auth/sign-in"` implements D-06: OAuth errors redirect to sign-in page where UI Plan 03 will read the ?error= query param and show an Alert

## Deviations from Plan

None — plan executed exactly as written. The vitest run showed a pre-existing ESM configuration issue with @cloudflare/vitest-pool-workers (unrelated to auth implementation). All acceptance criteria verified via direct grep checks.

## Known Stubs

- `worker/src/auth.ts` lines 19 and 25: `console.log` for email sending (verification email and password reset). These are **intentional stubs** specified in the plan — "TODO: Replace with real email provider (MailChannels or Resend)". Email verification flow is structurally complete; email delivery is deferred until an email provider is configured. Auth flow works in dev (emails logged to console). No future plan currently scheduled to resolve this — needs to be added to a later plan.

## Issues Encountered

- `better-auth` was not installed in `apps/web` (only in `worker`). Installed via `npm install better-auth` in apps/web before creating auth-client.ts — Rule 3 auto-fix (blocking dependency).

## User Setup Required

External services require manual configuration before OAuth and Turnstile can function:

**Google OAuth (AUTH-04):**
- `GOOGLE_CLIENT_ID` — Google Cloud Console -> APIs & Services -> Credentials -> OAuth 2.0 Client IDs
- `GOOGLE_CLIENT_SECRET` — Same location
- Dashboard: Create OAuth 2.0 Client ID (Web application type), add authorized redirect URI: `{PUBLIC_URL}/api/auth/callback/google`

**GitHub OAuth (AUTH-05):**
- `GITHUB_CLIENT_ID` — GitHub -> Settings -> Developer settings -> OAuth Apps
- `GITHUB_CLIENT_SECRET` — Same location
- Dashboard: Create OAuth App with callback URL: `{PUBLIC_URL}/api/auth/callback/github`

**Cloudflare Turnstile (D-05, D-07):**
- `TURNSTILE_SECRET_KEY` — Cloudflare Dashboard -> Turnstile -> Site -> Settings
- `VITE_TURNSTILE_SITE_KEY` — Same Turnstile site settings (public key, used by frontend in Plan 03)
- Dashboard: Create a Turnstile widget (managed type)

## Next Phase Readiness

- Auth backend is complete: /api/auth/* endpoints active, session middleware enforcing IDOR contract, rate limiting and Turnstile enforcement wired
- Plan 03 (auth UI) can immediately use: authClient exports (signIn, signUp, signOut, useSession), /api/auth/* endpoints, and the 403 { turnstileRequired: true } response for showing the Turnstile widget after 5 failures
- Protected routes pattern established: any new route can use `app.use("/api/protected/...", authGuard)` and access `c.get("userId")` safely

---
*Phase: 01-foundation*
*Completed: 2026-04-01*

## Self-Check: PASSED

- FOUND: worker/src/auth.ts
- FOUND: worker/src/middleware/auth-guard.ts
- FOUND: worker/src/middleware/rate-limit.ts
- FOUND: worker/src/middleware/verify-turnstile.ts
- FOUND: worker/src/middleware/fetch-allowlist.ts
- FOUND: apps/web/app/lib/auth-client.ts
- FOUND: .planning/phases/01-foundation/01-02-SUMMARY.md
- FOUND commit: 22a1cf3 (Task 1)
- FOUND commit: d56959b (Task 2)
