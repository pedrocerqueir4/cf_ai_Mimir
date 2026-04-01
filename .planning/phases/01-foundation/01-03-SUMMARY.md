---
phase: 01-foundation
plan: 03
subsystem: ui
tags: [react, react-router, shadcn, react-hook-form, zod, better-auth, turnstile, tailwind, lucide]

# Dependency graph
requires:
  - phase: 01-foundation/01-01
    provides: shadcn components (Button, Input, Label, Form, Card, Separator, Alert, Sonner)
  - phase: 01-foundation/01-02
    provides: auth-client.ts exports (signIn, signUp, signOut, forgetPassword, authClient)
provides:
  - Four auth screens: sign-up, sign-in, forgot-password, verify-email
  - Auth layout wrapper (_auth.tsx) with ThemeToggle and centered 480px card
  - ThemeToggle component persisting to localStorage mimir-theme key
  - OAuthButtons component (Google + GitHub) using signIn.social()
  - TurnstileWidget component using @marsidev/react-turnstile
  - session.ts with getRestorePath/saveRestorePath (UX-04)
  - auth-schemas.ts with signUpSchema/signInSchema/forgotPasswordSchema
affects: [auth-backend, session-management, protected-routes, app-shell]

# Tech tracking
tech-stack:
  added: ["@marsidev/react-turnstile@^1.5.0"]
  patterns:
    - "shadcn Form + react-hook-form + zodResolver for all auth forms"
    - "mode: onBlur / reValidateMode: onChange for validation timing"
    - "signIn.social() for OAuth provider buttons"
    - "authClient.sendVerificationEmail() for verification resend"
    - "sessionStorage for restore-path (not localStorage — cleared on tab close)"

key-files:
  created:
    - apps/web/app/routes/_auth.tsx
    - apps/web/app/routes/_auth.sign-up.tsx
    - apps/web/app/routes/_auth.sign-in.tsx
    - apps/web/app/routes/_auth.forgot-password.tsx
    - apps/web/app/routes/_auth.verify-email.tsx
    - apps/web/app/components/auth/OAuthButtons.tsx
    - apps/web/app/components/auth/TurnstileWidget.tsx
    - apps/web/app/components/layout/ThemeToggle.tsx
    - apps/web/app/lib/theme.ts
    - apps/web/app/lib/session.ts
    - apps/web/app/lib/auth-schemas.ts
  modified:
    - apps/web/package.json

key-decisions:
  - "Import auth schemas via local apps/web/app/lib/auth-schemas.ts — packages/shared has no package.json and is not configured as a workspace package, so relative deep-imports from route files would be fragile"
  - "sessionStorage (not localStorage) for restore-path — cleared when tab closes, preventing stale path restoration across sessions"
  - "Forgot-password always shows success state regardless of email existence — prevents email enumeration attacks"
  - "D-06 OAuth error: read ?error= query param from useSearchParams() and show destructive Alert; Better Auth redirects to callbackURL with error param on OAuth failure"

patterns-established:
  - "Auth form pattern: shadcn Card wrapper + shadcn Form + zodResolver + mode:onBlur + reValidateMode:onChange"
  - "Loading state pattern: isLoading state + disabled button + Loader2 animate-spin + aria-busy on form"
  - "Server error pattern: serverError state string + Alert variant=destructive above form fields"
  - "OAuth buttons always above separator, always above email form (UI-SPEC order)"

requirements-completed: [AUTH-01, AUTH-02, AUTH-03, UX-03]

# Metrics
duration: 3min
completed: 2026-04-01
---

# Phase 01 Plan 03: Auth UI Screens Summary

**Four auth screens (sign-up, sign-in, forgot-password, verify-email) with shadcn Form + Zod validation, OAuth buttons, dark mode toggle, Turnstile CAPTCHA widget, D-06 OAuth error handling, and UX-04 restore-path wiring**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-01T15:57:05Z
- **Completed:** 2026-04-01T16:00:14Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments

- Auth layout wrapper centers content at max-width 480px with ThemeToggle in top-right; theme persists to localStorage key `mimir-theme` defaulting to system preference
- All four auth screens match UI-SPEC copywriting exactly with shadcn Card containers, 48px tap targets, Zod validation fires on blur and clears on change
- Sign-in handles D-06 OAuth error query param (`?error=`), `?reason=session_expired` banner, D-05 Turnstile CAPTCHA gate, and UX-04 restore-path navigation on success

## Task Commits

Each task was committed atomically:

1. **Task 1: Auth layout wrapper, theme toggle, OAuth buttons** - `326b7f0` (feat)
2. **Task 2: All four auth screens, Turnstile widget, session utilities** - `51ec82f` (feat)

**Plan metadata:** (pending — final docs commit)

## Files Created/Modified

- `apps/web/app/routes/_auth.tsx` — Auth layout: min-h-screen flex col, ThemeToggle justify-end, Outlet in max-w-[480px] centered
- `apps/web/app/routes/_auth.sign-up.tsx` — Create your account form: name/email/password/confirm, OAuthButtons, Zod signUpSchema, 48px CTA
- `apps/web/app/routes/_auth.sign-in.tsx` — Welcome back form: email/password, OAuthButtons, session_expired banner, D-06 OAuth error alert, D-05 Turnstile gate, UX-04 getRestorePath
- `apps/web/app/routes/_auth.forgot-password.tsx` — Reset your password form + Check your email success state; anti-enumeration (always succeeds)
- `apps/web/app/routes/_auth.verify-email.tsx` — Verify your email with Resend verification email button, Sonner toast on success
- `apps/web/app/components/auth/OAuthButtons.tsx` — Google + GitHub outline buttons, inline SVG icons, signIn.social(), min-h-12
- `apps/web/app/components/auth/TurnstileWidget.tsx` — @marsidev/react-turnstile wrapper, VITE_TURNSTILE_SITE_KEY, theme:auto
- `apps/web/app/components/layout/ThemeToggle.tsx` — Sun/Moon icon toggle, aria-label, min-h-12 min-w-12, mimir-theme localStorage
- `apps/web/app/lib/theme.ts` — getStoredTheme/setStoredTheme/applyTheme, STORAGE_KEY=mimir-theme, .dark class on documentElement
- `apps/web/app/lib/session.ts` — getRestorePath/saveRestorePath using sessionStorage mimir-restore-path key
- `apps/web/app/lib/auth-schemas.ts` — Local copy of signUpSchema/signInSchema/forgotPasswordSchema (Zod v4)
- `apps/web/package.json` — Added @marsidev/react-turnstile@^1.5.0

## Decisions Made

- **Local auth-schemas.ts**: The shared package at `packages/shared/src/schemas/auth.ts` has no `package.json` and isn't configured as a workspace package. Deep relative imports from route files (../../../../packages/shared/...) would be fragile. Created `apps/web/app/lib/auth-schemas.ts` as a local copy — schemas are identical to the shared version.
- **sessionStorage for restore-path**: Used `sessionStorage` rather than `localStorage` so the restore path is cleared when the browser tab closes. This prevents stale path restoration across separate browsing sessions.
- **Anti-enumeration on forgot-password**: Always transitions to success state regardless of whether the email exists in the system. Prevents an attacker from discovering registered email addresses.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Created session.ts which didn't exist yet**
- **Found during:** Task 2 (sign-in screen)
- **Issue:** Sign-in screen imports `getRestorePath` from `~/lib/session` per UX-04, but `session.ts` is listed as a Plan 04 deliverable. It didn't exist.
- **Fix:** Created `apps/web/app/lib/session.ts` with `getRestorePath` and `saveRestorePath` using sessionStorage. The API matches the interface specified in the plan (`export function getRestorePath(): string | null`).
- **Files modified:** `apps/web/app/lib/session.ts`
- **Committed in:** `51ec82f` (Task 2 commit)

**2. [Rule 3 - Blocking] Created auth-schemas.ts to resolve shared package import**
- **Found during:** Task 2 (sign-up, sign-in, forgot-password screens)
- **Issue:** Schemas in `packages/shared/src/schemas/auth.ts` cannot be imported via package name (no workspace setup). Deep relative paths from route files would be fragile.
- **Fix:** Created `apps/web/app/lib/auth-schemas.ts` with identical schema definitions. All routes use `~/lib/auth-schemas`.
- **Files modified:** `apps/web/app/lib/auth-schemas.ts`
- **Committed in:** `51ec82f` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both blocking issues resolved inline. No scope creep. Plan 04 can still create session.ts — the web app's copy uses the same API contract.

## Issues Encountered

- `authClient.sendVerificationEmail()` used for verification email resend instead of re-calling `signUp.email()` — Better Auth exposes this method on the client instance for resending verification without re-registering.

## Known Stubs

None. All screens have real data wiring:
- Sign-up calls `signUp.email()` and navigates to `/auth/verify-email` on success
- Sign-in calls `signIn.email()` and calls `getRestorePath()` on success
- Forgot-password calls `forgetPassword()` (Better Auth `forgetPassword` export)
- Verify-email calls `authClient.sendVerificationEmail()` for resend

The verify-email `email` display relies on `?email=` query param being set by the sign-up success navigation — this is intentional and correct behavior (sign-up should navigate to `/auth/verify-email?email=...`).

## Next Phase Readiness

- Auth UI screens are complete and ready for integration testing
- Route file for `_auth.tsx` is registered — React Router will auto-discover it
- Plan 04 (session utilities, root loader) can safely proceed; `session.ts` is already created with the expected API
- `VITE_TURNSTILE_SITE_KEY` env var needed in `.env.local` for Turnstile to work in development

---
*Phase: 01-foundation*
*Completed: 2026-04-01*
