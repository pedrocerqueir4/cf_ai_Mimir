---
status: resolved
trigger: "On /auth/sign-up the 'Create account' button stays permanently disabled — it never becomes clickable."
created: 2026-04-23
updated: 2026-04-23
phase: 01-foundation-auth
---

## Symptoms

expected: User fills email + password + confirm on /auth/sign-up, Turnstile widget auto-completes (or user clicks challenge), "Create account" button becomes clickable within 1-2s.

actual: Button never enables. `disabled` stays `true` indefinitely regardless of form input.

reproduction: |
  1. Start dev: `cd apps/web && npm run dev`
  2. Navigate to `http://localhost:5173/auth/sign-up`
  3. Fill in email + password + confirm — button stays disabled

## Resolution

root_cause: |
  The sign-up form at `apps/web/app/routes/_auth.sign-up.tsx:212` disables the submit button until a Turnstile CAPTCHA token arrives:
  ```ts
  disabled={isLoading || !turnstileToken}
  ```
  The `TurnstileWidget` component at `apps/web/app/components/auth/TurnstileWidget.tsx:10` reads the site key from `import.meta.env.VITE_TURNSTILE_SITE_KEY` — a client-side Vite env var.

  The repo had no `.env` file in `apps/web/`, only a `.dev.vars` with a placeholder `TURNSTILE_SECRET_KEY=your-turnstile-secret`. Vite env vars are NOT read from `.dev.vars` (that file is only for the wrangler worker runtime). So `VITE_TURNSTILE_SITE_KEY` was `undefined`, the Turnstile widget rendered with a broken site key, `onSuccess` never fired, `turnstileToken` stayed null, and the button stayed disabled forever.

  The server-side secret (`TURNSTILE_SECRET_KEY`) in `.dev.vars` was also a placeholder — so even if the widget had worked, the `verifyTurnstileToken` middleware at `worker/src/middleware/verify-turnstile.ts` would reject the submission.

fix: |
  Use Cloudflare's documented Turnstile test key pair for local dev. These always pass without showing a challenge:
  - Site key (client): `1x00000000000000000000AA`
  - Secret (server):   `1x0000000000000000000000000000000AA`

  Concretely:
  1. Create `apps/web/.env` with `VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA`
  2. Edit `apps/web/.dev.vars` — replace `TURNSTILE_SECRET_KEY=your-turnstile-secret` with `TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA`
  3. Restart `npm run dev` (Vite only reads `.env` at boot)

  Both files are gitignored. To make the setup discoverable for future devs, committed template files:
  - `apps/web/.env.example` — documents the required client-side var with the test key
  - `apps/web/.dev.vars.example` — documents all worker secrets including Turnstile and the OAuth providers

verification: |
  Manual — user loaded /auth/sign-up in a real browser after setting .env + restarting dev server. Reports "funciona bem" (works well). The Turnstile widget auto-passes in dev-test mode within ~1s, the token is set, and the Create account button becomes clickable.

files_changed:
  - apps/web/.env.example (new)
  - apps/web/.dev.vars.example (new)
  - apps/web/.env (local only — gitignored)
  - apps/web/.dev.vars (local only — gitignored)

## Notes for future contributors

- First-time setup requires copying both `.env.example` → `.env` AND `.dev.vars.example` → `.dev.vars`. The README should surface this. Clean-clone contributors will hit this bug immediately.
- Turnstile test keys are safe in the repo because they only work in local dev — Cloudflare's edge rejects them for any real domain.
- For production: register a real site at https://dash.cloudflare.com → Turnstile → replace both keys. Use `wrangler secret put TURNSTILE_SECRET_KEY` instead of `.dev.vars` for the server side.
- Cloudflare docs: https://developers.cloudflare.com/turnstile/troubleshooting/testing/
