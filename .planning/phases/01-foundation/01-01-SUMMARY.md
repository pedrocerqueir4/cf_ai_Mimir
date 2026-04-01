---
phase: 01-foundation
plan: 01
subsystem: scaffold
tags: [react-router, hono, d1, drizzle, tailwind-v4, shadcn, security]
dependency_graph:
  requires: []
  provides:
    - React Router v7 app scaffold at apps/web
    - Hono worker entrypoint with /api/health
    - D1 database with 4 auth tables (users, sessions, accounts, verifications)
    - Tailwind v4 zinc/blue theme tokens with dark mode
    - shadcn/ui 10 components installed
    - Input sanitization middleware (XSS, SQLi, prompt injection)
    - IDOR enforcement utility (verifyOwnership)
    - Shared Zod validation schemas
  affects:
    - All future plans — security middleware must be active before any data endpoints
tech_stack:
  added:
    - React Router 7.x on Cloudflare Workers
    - Hono 4.x HTTP framework
    - Drizzle ORM 0.45.x with D1 adapter
    - Tailwind CSS v4 with @tailwindcss/vite plugin
    - shadcn/ui components (button, input, label, form, card, separator, alert, avatar, skeleton, sonner)
    - class-variance-authority, clsx, tailwind-merge
    - @tanstack/react-query, zustand, zod (frontend state/validation)
    - drizzle-kit for migration generation
  patterns:
    - Tailwind v4 @theme CSS blocks — no tailwind.config.js
    - shadcn CSS variables in @layer base with light/dark tokens
    - Hono middleware chaining (cors → sanitize → routes)
    - Drizzle schema → wrangler d1 migrations apply (local)
key_files:
  created:
    - apps/web/app/app.css (Tailwind v4 theme tokens, dark mode variables)
    - apps/web/app/lib/utils.ts (shadcn cn() utility)
    - apps/web/app/components/ui/* (10 shadcn components)
    - worker/src/index.ts (Hono entrypoint with cors + sanitize middleware)
    - worker/src/db/schema.ts (Drizzle schema: users, sessions, accounts, verifications)
    - worker/src/db/migrations/0000_faulty_maggott.sql (generated migration)
    - worker/src/middleware/sanitize.ts (XSS/SQLi/prompt injection blocker)
    - worker/src/middleware/idor-check.ts (dual-condition ownership enforcer)
    - worker/src/types/env.d.ts (Cloudflare bindings type definitions)
    - packages/shared/src/schemas/auth.ts (signUp, signIn, forgotPassword Zod schemas)
    - drizzle.config.ts (sqlite dialect, schema → migrations path)
  modified:
    - worker/wrangler.toml (mimir-api name, D1 binding, rate limit bindings, migrations_dir)
    - package.json (added drizzle-kit, drizzle-orm at root)
decisions:
  - "D1 migrations_dir set to src/db/migrations — wrangler defaults to worker/migrations which is outside the src directory tree"
  - "shadcn components.json aliases use ~/components → apps/web/app/components via tsconfig.cloudflare.json ~ → ./app/* path mapping"
  - "app/lib/utils.ts created manually — shadcn init in non-interactive mode did not generate it"
  - "clsx + tailwind-merge installed as explicit deps since shadcn init skipped them in non-interactive mode"
metrics:
  duration: 7 minutes
  completed: 2026-04-01
  tasks_completed: 2
  files_created: 22
  files_modified: 3
---

# Phase 01 Plan 01: Project Scaffold Summary

**One-liner:** React Router v7 + Hono worker scaffold on Cloudflare with D1 auth schema, Tailwind v4 zinc/blue tokens, shadcn/ui, and XSS/SQLi/IDOR security middleware.

---

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Scaffold project, install deps, configure Tailwind v4 + shadcn, D1 schema | 7a92cb7 | 24 files |
| 2 | Create input sanitization middleware and IDOR enforcement utility | c1f7ca8 | 3 files |

---

## Outcomes

### Project Scaffold (Task 1)

- React Router v7 scaffolded at `apps/web/` via `npm create cloudflare@latest` with `@cloudflare/vite-plugin` and `@tailwindcss/vite`
- Frontend dependencies installed: `@tanstack/react-query`, `zustand`, `zod`, `clsx`, `tailwind-merge`, all Radix UI primitives
- Hono worker entrypoint at `worker/src/index.ts` with `/api/health` endpoint and env bindings type
- Drizzle schema created with 4 Better Auth-compatible tables; migration `0000_faulty_maggott.sql` generated and applied locally
- D1 confirmed: accounts, sessions, users, verifications tables present
- Tailwind v4 theme tokens in `app.css` with full zinc/blue palette, dark mode `.dark {}` block, Inter font
- 10 shadcn components installed at `apps/web/app/components/ui/`
- Shared Zod schemas: `signUpSchema`, `signInSchema`, `forgotPasswordSchema` in `packages/shared`
- No `tailwind.config.js` or `postcss.config.js` present

### Security Middleware (Task 2)

- `sanitize` middleware blocks XSS (`<script>`, `onerror`), SQL injection (`UNION SELECT`, `OR 1=1`, `'; DROP`), and prompt injection (`[INST]`, `<<SYS>>`, `ignore previous`, `system:`) on all POST/PUT/PATCH bodies — returns `{ error: "Invalid input" }` 400
- `verifyOwnership` enforces `AND(eq(idCol, recordId), eq(ownerCol, userId))` — both conditions always required, preventing IDOR by design
- Both middleware wired into Hono: `app.use("/api/*", sanitize)` — active before all route handlers

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing functionality] shadcn non-interactive init didn't generate utils.ts or install clsx/tailwind-merge**
- **Found during:** Task 1 (shadcn component installation)
- **Issue:** `npx shadcn@latest init` in non-TTY mode did not create `app/lib/utils.ts` or install the `clsx` and `tailwind-merge` dependencies that all components depend on via the `cn()` utility
- **Fix:** Created `app/lib/utils.ts` manually with `cn()` function; installed `clsx` and `tailwind-merge` explicitly; installed all Radix UI peer dependencies
- **Files modified:** `apps/web/app/lib/utils.ts`, `apps/web/package.json`

**2. [Rule 1 - Bug] wrangler.toml missing migrations_dir — D1 apply failed**
- **Found during:** Task 1 (D1 migration application)
- **Issue:** Wrangler defaults to looking for migrations in `worker/migrations/` relative to `wrangler.toml` location, but drizzle-kit generates them to `worker/src/db/migrations/`
- **Fix:** Added `migrations_dir = "src/db/migrations"` to the `[[d1_databases]]` section in `wrangler.toml`
- **Files modified:** `worker/wrangler.toml`

**3. [Rule 3 - Blocking] shadcn components.json used literal `~/components` path**
- **Found during:** Task 1 (shadcn add command)
- **Issue:** `components.json` with `~/components` alias was taken literally by the CLI (files placed in `apps/web/~/components/ui/`). The `~` alias is defined only in `tsconfig.cloudflare.json` as `./app/*`, not resolved at CLI level.
- **Fix:** Moved all generated files from literal `~/components/ui/` to `apps/web/app/components/ui/`; cleaned up the `~/` directory
- **Files modified:** All 10 shadcn component files moved to correct location

---

## Known Stubs

None. All files are fully implemented. The `wrangler.toml` has `database_id = "local"` which is a placeholder for production deployment (expected — local dev uses miniflare's D1 simulation and does not need a real ID).

---

## Self-Check: PASSED

All 11 key files found on disk. Both task commits verified in git history (7a92cb7, c1f7ca8).
