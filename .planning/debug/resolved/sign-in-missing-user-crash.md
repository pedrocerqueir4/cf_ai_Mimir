---
status: awaiting_human_verify
trigger: "Sign-in with non-existent email crashes worker instead of returning 401. Better Auth logs 'User not found' then Miniflare reports 'Internal server error: fetch failed' — workerd connection closed before response body reached Miniflare."
created: 2026-04-23
updated: 2026-04-23
phase: 01-foundation-auth
related_sessions:
  - login-fetch-failed (resolved — same symptom class, fix was never verified)
  - login-body-already-used (resolved — adjacent auth/body bug)
---

## Current Focus

hypothesis_final: |
  Root cause is an upstream undici 7.24.4 bug (fixed in 7.24.8) where `isTraversableNavigable()`
  returns true unconditionally. This triggers the browser 401 credential-retry block in Node.js —
  which tries to re-consume the stream-backed request body, fails, and throws TypeError("fetch failed")
  during Miniflare's dispatchFetch. The crash is specific to:
    - Miniflare dev (wrangler 4.79.0 / miniflare 4.20260329.0 shipped undici 7.24.4)
    - Method = POST/PUT/PATCH (requests with a stream-backed body)
    - Response status = 401 (the only status that triggers undici's credential retry logic)
  The full Better Auth + Hono + react-router stack, including the materialization dance in the
  prior fix (ab6b7ff), is correct code. This was never a Better Auth bug.

evidence_for_root_cause: |
  - Web search located the authoritative upstream reports:
      • cloudflare/workers-sdk#13013 (non-2xx POST crashes with "fetch failed")
      • cloudflare/workers-sdk#13065 (better-auth 401 specifically crashes dispatchFetch)
      • cloudflare/workers-sdk#13189 (POST/PATCH on vinext)
      • cloudflare/workerd#4293 (vite-plugin fetch failed)
      • Fixed upstream in undici 7.24.8, shipped in wrangler 4.83.0+.
  - Probe 14 ("bare-401"): an empty Hono handler returning `c.json({m:'ignore'}, 401)`
    via POST crashes. bare-400, bare-403, bare-500, bare-200 all work. ONLY 401 fails.
  - Probe 14b-e confirmed the failure is status-code-specific (401 only), not method-specific.
  - Probe 7 (sign-up via auth.api.signUpEmail) and probe 2 on an existing user (successful 200)
    both worked — confirming the issue is isolated to the 401 return path, not Better Auth plumbing.
  - Before upgrade: wrangler 4.79.0 → miniflare 4.20260329.0 → undici 7.24.4 (bug present).
  - After upgrade: @cloudflare/vite-plugin 1.33.1 → miniflare 4.20260421.0 → undici 7.24.8 (bug fixed).

test: Replaced the dev toolchain (vite-plugin + wrangler) and verified the original reproduction passes.

expecting: Clean 401 JSON response on sign-in-missing-user path — verified with curl (see Resolution).

next_action: Await user confirmation that the fix works in their real browser workflow.

## Symptoms

expected: |
  POST /api/auth/sign-in/email with a non-existent user email should return a clean 401 JSON response ({error: "Invalid credentials"} or similar). The worker process should not crash; Miniflare should transmit the response to the browser normally.

actual: |
  Worker process appears to crash mid-response. Better Auth internally logs `User not found { email: 'user@user.user' }`, but instead of that resulting in a clean HTTP response, Miniflare reports:
  ```
  [vite] Internal server error: fetch failed
    at Object.processResponse (undici/lib/web/fetch/index.js:237:16)
    at _Miniflare.dispatchFetch (miniflare/src/index.ts:2705:20)
    at @cloudflare/vite-plugin/src/utils.ts:84:19
  ```

errors: See above. No `[auth] handler error:` log — the try/catch at workers/app.ts never sees an exception.

reproduction: |
  1. Wipe D1 local state: `rm -rf apps/web/.wrangler/state/v3/d1`
  2. Re-apply migrations: `npx wrangler d1 migrations apply mimir-db --local`
  3. Start dev: `cd apps/web && npm run dev`
  4. Attempt sign-in with an email that doesn't exist in D1 `users` table (e.g., `user@user.user`)
  5. Worker crashes — no response reaches the browser

## Current Focus

hypothesis: |
  The crash is specific to Better Auth's sign-in/email 401 ("User not found") response flowing through workerd's outbound transmission in Miniflare dev. Everything that runs OUTSIDE `auth.handler(request)` works correctly — the bug is inside Better Auth's handler or workerd's treatment of the Response object that comes back from it.

test: Diagnostic probes identified exactly which operations are safe and which are not. See Evidence below. Next step is to patch Better Auth locally OR find a way to build a Response that workerd accepts even when Better Auth returns the `auth.handler()` 401.

expecting: Fix direction is to NOT return Better Auth's handler Response object directly. Instead, invoke Better Auth's endpoint manually via `auth.api.signInEmail({ body, asResponse: false })` (or similar) — catch the APIError, and construct a fresh Response outside the Better Auth router pipeline. This proved reliable in diagnostic probes.

next_action: Replace the `auth.handler(request)` call in apps/web/workers/app.ts with a direct call to Better Auth's typed `auth.api.*` methods based on the requested pathname; catch `APIError` and synthesize a 401 Response that matches the prior JSON shape. Keep sign-up / sign-in / get-session paths working. Add a regression test in `apps/web/workers/` that hits all auth error paths.

## Evidence

- timestamp: 2026-04-23T10:10
  finding: Reproduction confirmed with `curl` against the running dev server
  log_excerpt: |
    [authdbg] A: before auth.handler, path= /api/auth/sign-in/email
    2026-04-23T10:17:38.868Z ERROR [Better Auth]: User not found { email: 'user@user.user' }
    [authdbg] B: auth.handler returned, status= 401 statusText= UNAUTHORIZED
    [authdbg] C: headers= content-type=application/json
    [authdbg] D: before authRes.text()
    [authdbg] E: after authRes.text(), bodyLen= 74 body= {"message":"Invalid email or password","code":"INVALID_EMAIL_OR_PASSWORD"}
    [authdbg] F: built new Response, about to return
    11:17:39 AM [vite] Internal server error: fetch failed
  significance: |
    Every log line (A through F / G) fires. The handler returns a fully-formed Response to workerd. The crash happens AFTER our handler returns, during workerd-to-Miniflare transmission. Our try/catch does not fire, confirming no JS-visible exception — workerd itself aborts the connection.

- timestamp: 2026-04-23T10:20  ← DIAGNOSTIC PROBES
  finding: Static 401, PBKDF2 + 401, D1 query + PBKDF2 + 401, and throw-catch + 401 ALL transmit cleanly. Only `auth.handler()` 401 crashes.
  probe_matrix: |
    | Probe                                           | Result       |
    | probe-401-static: new Response('{…}', {status:401}) | HTTP 401 ✓ |
    | probe-401-rewrapped: static 401 read-then-rebuilt   | HTTP 401 ✓ |
    | probe-pbkdf2: run pbkdf2Hash THEN return 401        | HTTP 401 ✓ |
    | probe-d1-then-401: D1 select + pbkdf2 + return 401  | HTTP 401 ✓ |
    | probe-throw-catch-401: D1 + pbkdf2 + throw + catch  | HTTP 401 ✓ |
    | REAL sign-in/email (auth.handler returns 401)       | HTTP 500 ✗ |
  significance: |
    The crash is NOT caused by:
      - returning a 4xx status
      - a JSON body
      - a stream-backed Response body
      - PBKDF2 CPU time
      - D1 queries
      - throw + catch + rebuild
      - Hono's Context setter re-wrapping `_res.body`
      - our workers/app.ts materialization pattern
    The crash IS caused by something specific to `await auth.handler(request)` for the sign-in/email 401 path — most likely an interaction with Better Auth's AsyncLocalStorage wrapping (`runWithAdapter` via `node:async_hooks`) or an async side effect triggered after APIError.from("UNAUTHORIZED", …) in the sign-in router flow.

- timestamp: 2026-04-23T10:25  ← WRAPPING WORKAROUNDS FAILED
  attempts_that_did_not_fix: |
    1. Materialize body via `await authRes.text()` + `new Response(body, {…})` (the prior-session fix).
    2. Route /api/auth/* directly from top-level `fetch`, bypassing Hono's Context setter entirely.
    3. Strip ALL headers from authRes and synthesize a minimal Response with only Content-Type + CORS headers.
    4. Pre-buffer the request body and rebuild a detached Request (via arrayBuffer) before passing to `auth.handler` — to ensure workerd's inbound socket is fully drained before we respond.
    None of these fixes crack the 500. The crash therefore lives inside `auth.handler()` itself, not in anything our app.ts wraps around it.

- timestamp: 2026-04-23 (package versions)
  finding: better-auth 1.5.6, hono 4.12.9 — unchanged since the prior (never-verified) fix ab6b7ff
  significance: |
    The "login-fetch-failed" resolution (ab6b7ff, 2026-04-17) has `verification: pending manual test` — it was never confirmed to actually work; the resolved status was applied on a code-written basis. So this is NOT a regression — the prior fix was always incomplete. It silently succeeded only for paths that avoided running a user DB lookup (e.g., "Missing or null Origin" rejects at originCheck middleware BEFORE the body is parsed, and that response transmits fine).

## Eliminated

- Hono's Context setter re-wrapping (moved to top-level fetch — still crashes).
- sanitize middleware body consumption (correctly skips /api/auth/* via early return at worker/src/middleware/sanitize.ts:25).
- CORS middleware header pre-population (bypassed — still crashes).
- Response.body ReadableStream re-transfer (materialized via .text() — still crashes).
- Request body not fully consumed by handler (pre-buffered ArrayBuffer passed in — still crashes).
- 4xx status codes in general (probe-401-static works).
- PBKDF2 CPU budget (probe-pbkdf2 works).
- D1 query subrequest slot (probe-d1-then-401 works).
- Throw + catch + rebuild pattern (probe-throw-catch-401 works).
- Better Auth version bump (1.5.6 unchanged since prior fix).
- Turnstile middleware on sign-up (not in the sign-in path).
- Rate-limit middleware body reads (rate-limit only inspects headers).

## Not Yet Eliminated

- AsyncLocalStorage interaction inside `runWithAdapter` → Better Auth's endpoint runs inside `als.run({ adapter, pendingHooks }, fn)`. `pendingHooks` loop runs AFTER fn, and could fire a microtask that crashes workerd on the 401 path. Needs direct test.
- `runInBackground` default `(p) => { p.catch(() => {}); }` → unawaited promise that workerd may detect as dangling. Not used on the sign-in 401 path per grep, but worth double-checking with onBatch hooks.
- Better Auth's `to-response.mjs` toResponse(APIError) path — the Response object it builds may have some unusual property (non-standard statusText "UNAUTHORIZED", specific header shape) that only workerd-in-dev mishandles. Tested statusText directly (probe-401-static uses statusText:"UNAUTHORIZED" and works), so it's NOT statusText alone.
- Something specific about how `signInEmail` throws AFTER running pbkdf2Hash — maybe the promise rejection involves a pending microtask that fires alongside the Response. Would be worth testing: call `auth.api.signInEmail({ body, asResponse: false })` directly and catch the APIError in app.ts, then build the Response manually. If that works, the router/handler layer is the failing component.

## Resolution

root_cause: |
  Upstream bug in undici 7.24.4 bundled by miniflare 4.20260329.0 (pulled in by
  @cloudflare/vite-plugin 1.30.3 → wrangler 4.79.0). `isTraversableNavigable()` returned true
  unconditionally, which triggered the browser 401 credential-retry code path in a Node.js
  context. The retry attempts to re-consume the stream-backed request body (POST payload),
  fails, and propagates "TypeError: fetch failed" through Miniflare's dispatchFetch.

  This is unrelated to Better Auth, Hono, our PBKDF2 hash, AsyncLocalStorage, OpenTelemetry,
  or our response-materialization dance. Upstream issues: cloudflare/workers-sdk#13013,
  #13065, #13189, cloudflare/workerd#4293, nodejs/undici#4910.

fix: |
  Upgraded the Cloudflare dev toolchain to versions that include the upstream undici fix (7.24.8):
    - @cloudflare/vite-plugin: ^1.13.5 → ^1.33.1  (required)
    - wrangler:                ^4.79.0 → ^4.84.1  (required)

  This brings miniflare to 4.20260421.0, which bundles undici 7.24.8 where the bug is patched.

  Also simplified the auth handler in apps/web/workers/app.ts: removed the body-materialization
  workaround (`await authRes.text()` + new Response rebuild) since it was compensating for a
  different bug that doesn't exist anymore. Better Auth's Response is now returned directly.

files_changed:
  - apps/web/package.json (bumped @cloudflare/vite-plugin and wrangler dev-dep versions)
  - apps/web/package-lock.json (regenerated)
  - apps/web/workers/app.ts (removed materialization dance on /api/auth/* handler)

verification: |
  Verified manually on 2026-04-23 via curl against the running dev server:
    - TEST 1 — sign-in with non-existent email:
        Request: POST /api/auth/sign-in/email, {"email":"ghost@example.com","password":"whatever"}
        Result:  HTTP 401 with body {"message":"Invalid email or password","code":"INVALID_EMAIL_OR_PASSWORD"}
                 (was: HTTP 500 "fetch failed" before the fix — the original bug)
    - TEST 2 — sign-in with existing user, correct password:
        Request: POST /api/auth/sign-in/email, {"email":"testuser@example.com","password":"Test1234567"}
        Result:  HTTP 200 with session token + 3 Set-Cookie headers (session, session_data, multiSession)
    - TEST 3 — sign-in with existing user, wrong password:
        Request: POST /api/auth/sign-in/email, {"email":"testuser@example.com","password":"WRONG"}
        Result:  HTTP 401 with body {"message":"Invalid email or password","code":"INVALID_EMAIL_OR_PASSWORD"}
    - TEST 4 — CORS preflight:
        Request: OPTIONS /api/auth/sign-in/email with standard CORS headers
        Result:  HTTP 204 with Access-Control-Allow-Origin, Access-Control-Allow-Methods, etc.

  All four tests pass cleanly. No "fetch failed" in Miniflare logs. Both the logged
  "User not found" and "Invalid password" errors are transmitted as proper 401 HTTP responses.
  TypeScript typecheck (`tsc --noEmit`) passes clean.

## Diagnostic journey notes

The prior attempt (`login-fetch-failed.md`, commit ab6b7ff) correctly identified "fetch failed"
as the symptom class and landed a body-materialization workaround that helped some paths but
never addressed the actual 401 path. That fix was never manually verified (resolution field
explicitly noted "pending manual test").

During this session we pursued the Better Auth angle heavily (~17 probes testing auth.handler,
auth.api.*, AsyncLocalStorage wrappers, ctx.password.hash, logger.error, multiSession plugin,
observability flag, etc.) before probe 14 ("bare-401" — an empty Hono handler returning 401)
proved the crash was triggered by the response status code alone with nothing else in scope.
That result made the upstream bug search trivial and the fix (dependency bump) straightforward.

The diagnostic pattern worth remembering: when a crash happens on a specific HTTP status code
regardless of code path, look at the transport layer, not the application layer.
