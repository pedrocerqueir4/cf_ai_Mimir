# Mimir

> An AI-powered, gamified micro-learning platform that turns any topic into an adaptive roadmap of bite-sized lessons, quizzes, and real-time multiplayer battles — built end-to-end on Cloudflare.

<!-- TODO: add screenshot -->

Users describe what they want to learn via chat. Mimir generates a structured learning roadmap, bite-sized lessons with inline quizzes, a RAG-backed Q&A layer scoped to the user's own content, XP/streak gamification, and head-to-head quiz battles with server-authoritative, speed-weighted scoring.

The entire stack — runtime, database, vector store, LLM, real-time coordination, durable pipelines, WAF — runs on Cloudflare. No external cloud providers.

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Development](#development)
- [Testing](#testing)
- [Deployment](#deployment)
- [Project Status](#project-status)
- [Security](#security)
- [Contributing / Workflow](#contributing--workflow)
- [License](#license)

---

## Features

### AI Content Generation
- Prompt-to-roadmap pipeline powered by `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
- Adaptive roadmap shape — linear sequence for simple topics, branching skill-tree for complex ones
- Bite-sized lessons (2-10 minutes) scoped to a single concept, with mixed reading + comprehension quizzes
- Streaming response begins within ~2 seconds of prompt submission
- Durable, multi-step generation via Cloudflare Workflows — independently retriable steps for roadmap, lessons, quizzes, and embeddings
- RAG Q&A layer that answers user questions against their own generated content using `bge-large-en-v1.5` embeddings and Vectorize, with citations back to the source lesson

### Gamification
- XP awards on lesson completion and quiz pass with immediate UI feedback (toasts)
- Level progression with thresholds and a progress bar to next level
- Daily study streaks that reset on missed days
- Stats dashboard and profile page surfacing XP, level, streak, and activity
- Leaderboard surfaced in the multiplayer lobby

### Real-Time Multiplayer Quiz Battles
- One Durable Object instance per battle room, using the WebSocket Hibernation API
- Server-authoritative, speed-weighted scoring — clients cannot alter the score
- XP wagering capped at 10-20% of current XP with an atomic, idempotent ledger transfer on battle end
- Join-code flow, lobby, pre-battle reveals (slot-machine roadmap + wager reveals), sudden-death tiebreakers
- Disconnect/reconnect recovery with server-driven state restoration and timer pause
- Idle and multi-tab forfeit handling

### Security-First Stack
- Input sanitization middleware on all `/api/*` routes (XSS, SQLi, prompt injection)
- Auth rate limiting (10 req/min sign-in, 5 req/min registration) via Workers Rate Limiting
- Battle rate limiting (5/min create, 10/min join)
- Cloudflare Turnstile challenge enforced after repeated sign-in failures
- Strict data isolation (IDOR guard middleware) — users can never touch another user's content or progress
- SSRF prevention via fetch allowlist middleware
- Better Auth session cookies (`HttpOnly; Secure; SameSite=Strict`), PKCE OAuth flows, email verification
- WebSocket auth guard on battle room upgrades
- Server-authoritative XP and scoring with atomic D1 batch writes

### Mobile-First UI
- Designed for mobile viewports first; desktop second
- 48px minimum tap targets, thumb-zone navigation, bottom nav on small screens
- React 19 + React Router 7 framework mode with SSR on Workers
- Tailwind CSS v4 + shadcn/ui primitives + Framer Motion for pre-battle reveals

---

## Tech Stack

| Area        | Technology                                                    | Purpose                                                                  |
| ----------- | ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Runtime     | Cloudflare Workers (Wrangler 4.79)                            | Edge runtime for API and SSR — zero cold starts, native CF bindings      |
| HTTP        | Hono 4.12                                                     | Typed routing, middleware chain, CF Bindings generics                    |
| Frontend    | React 19 + React Router 7 (framework mode)                    | SSR + loader-colocated data fetching on Workers                          |
| State       | TanStack Query 5 + Zustand 5                                  | Server-state caching + transient client state (battle rooms, timers)     |
| Styling     | Tailwind CSS 4 (`@tailwindcss/vite`) + shadcn/ui + Framer Motion | Mobile-first utilities, accessible primitives, reveal animations       |
| Database    | Cloudflare D1 (SQLite) + Drizzle ORM 0.45 + Drizzle Kit       | Type-safe queries, schema migrations, strong consistency per invocation  |
| Auth        | Better Auth 1.5 + Cloudflare Turnstile                        | Email/password + Google + GitHub OAuth, bot challenge on repeated fails  |
| AI (LLM)    | Workers AI — `@cf/meta/llama-3.3-70b-instruct-fp8-fast`       | Roadmap, lesson, quiz, and battle question generation                    |
| AI (Embed)  | Workers AI — `@cf/baai/bge-large-en-v1.5` (1024d) + Vectorize | User-scoped RAG Q&A with citations                                       |
| Real-time   | Cloudflare Durable Objects (Hibernation API)                  | Single-threaded per-room battle state and WebSocket coordination         |
| Pipelines   | Cloudflare Workflows                                          | Durable, step-retriable content + battle-question generation             |
| Rate Limit  | Workers Rate Limiting                                         | Auth + battle endpoint throttling                                        |
| Validation  | Zod 4                                                         | Runtime schema validation of request bodies and AI-generated JSON        |
| Testing     | Vitest 4 + `@cloudflare/vitest-pool-workers`                  | Integration tests against real D1/DO bindings via miniflare              |
| Tooling     | TypeScript 6, Wrangler 4.79, Cloudflare Vite Plugin           | Full-stack types, local dev parity, production deploys                   |

---

## Architecture

```
                              +---------------------------+
                              |          Browser          |
                              |  (React 19 + RR7 + TQ5)   |
                              +-------------+-------------+
                                            |
                                 HTTPS / WebSocket (WSS)
                                            |
                              +-------------v-------------+
                              |   mimir-web (Worker)      |
                              |   React Router SSR        |
                              |   workers/app.ts          |
                              +-------------+-------------+
                                            |
                                 Hono API (/api/*)
                                            |
     +--------------+--------------+--------+--------+----------------+---------------+
     |              |              |                 |                |               |
     v              v              v                 v                v               v
 +---------+   +---------+   +----------+    +-------------+   +-----------+   +-----------+
 |   D1    |   | Workers |   |Vectorize |    | Durable Obj |   | Workflows |   |Rate Limit |
 | (SQLite)|   |   AI    |   | (embeds) |    | BattleRoom  |   |  Content+ |   | (auth+    |
 | Drizzle |   | Llama3.3|   |  RAG     |    | Hibernation |   |  Battle   |   |  battle)  |
 +---------+   | + BGE   |   |  Q&A     |    +-------------+   +-----------+   +-----------+
               +---------+   +----------+
```

### How the pieces fit

- **React Router 7 framework mode** serves SSR and client routes from a Cloudflare Worker (`apps/web/workers/app.ts`). Loaders fetch from the same Worker's Hono API via direct bindings where possible.
- **Hono API** (`/api/*`) handles auth (Better Auth), chat/roadmap/lesson/Q&A/gamification/battle endpoints, and is wrapped by middleware for sanitization, rate limiting, IDOR, SSRF allowlist, auth guards, and Turnstile.
- **D1** is the source of truth for users, roadmaps, lessons, quizzes, user stats (XP/level/streak), and battle tables. Managed via Drizzle ORM.
- **Workers AI** powers both content generation (Llama 3.3 70B fp8-fast with streaming) and embedding generation (BGE-large 1024d).
- **Vectorize** stores per-user lesson embeddings for RAG Q&A, retrieved top-K and injected into the Llama 3.3 prompt.
- **Durable Objects** (`BattleRoom`) own the real-time battle state — one instance per room, WebSocket Hibernation API, server-authoritative scoring, timer pause on disconnect, atomic XP transfer on end.
- **Workflows** (`ContentGenerationWorkflow`, `BattleQuestionGenerationWorkflow`) handle multi-step durable pipelines with independent step retries — avoiding Worker invocation timeouts for long generation jobs.

---

## Project Structure

```
cf_ai_Mimir/
├── apps/web/              # React Router 7 frontend + SSR Worker (runtime entry)
│   ├── app/               # Routes, components, hooks, stores, lib
│   │   ├── routes/        # _auth.* and _app.* file-based routes
│   │   └── components/    # auth, battle, gamification, layout, lesson, qa, roadmap, ui
│   ├── workers/app.ts     # Worker entry: serves SSR assets + mounts Hono API
│   └── wrangler.jsonc     # Web Worker bindings (D1, AI, Vectorize, DO, Workflows, rate limits)
├── worker/                # Standalone API Worker (used for local API dev + vitest harness)
│   ├── src/
│   │   ├── index.ts       # Hono app entry
│   │   ├── auth.ts        # Better Auth factory
│   │   ├── routes/        # battle, chat, gamification, qa, roadmaps
│   │   ├── middleware/    # sanitize, rate-limit, auth-guard, idor-check, fetch-allowlist, turnstile, ws-auth
│   │   ├── durable-objects/BattleRoom.ts
│   │   ├── workflows/     # ContentGenerationWorkflow, BattleQuestionGenerationWorkflow
│   │   ├── services/      # battle pool, XP ledger, etc.
│   │   ├── db/            # Drizzle schema + migrations (0000..0005)
│   │   ├── lib/           # Pure utilities (scoring, join-code, etc.)
│   │   └── validation/    # Zod schemas
│   └── wrangler.jsonc     # API Worker bindings
├── packages/shared/       # Cross-worker/web shared schemas (Zod)
├── tests/                 # Vitest integration tests (auth, content, gamification, qa, security, xp, battle/*)
├── .planning/             # GSD workflow artifacts (ROADMAP, REQUIREMENTS, STATE, phases/)
├── drizzle.config.ts      # Drizzle Kit config (SQLite dialect, worker schema)
└── package.json           # Workspace root (test script only)
```

---

## Getting Started

### Prerequisites

- **Node.js 20+** and **npm**
- **Cloudflare account** with Workers, D1, Vectorize, Durable Objects, Workflows, and Workers AI enabled
- **Wrangler** logged in: `npx wrangler login`

### 1. Install dependencies

```bash
npm install
npm --prefix apps/web install
npm --prefix worker install
```

> The `postinstall` script in `apps/web` runs `wrangler types` to generate CF binding types from `wrangler.jsonc`. If that fails, you may need to `wrangler login` first.

### 2. Configure environment variables

Copy your local secrets into `apps/web/.dev.vars` (git-ignored):

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
TURNSTILE_SECRET_KEY=...
```

These power Better Auth's OAuth providers and Cloudflare Turnstile bot-challenge enforcement.

Non-secret runtime vars (e.g. `PUBLIC_URL`, `ENVIRONMENT`) are declared in `wrangler.jsonc` under `vars`.

### 3. Create Cloudflare bindings

Run each command once for your Cloudflare account. Update the resulting IDs in `apps/web/wrangler.jsonc` and `worker/wrangler.jsonc`.

```bash
# D1 database
npx wrangler d1 create mimir-db

# Vectorize index — 1024 dimensions matches bge-large-en-v1.5
npx wrangler vectorize create mimir-lessons --dimensions=1024 --metric=cosine

# Durable Objects (BattleRoom) and Workflows are declared inline in wrangler.jsonc
# and created on first deploy/dev run.
```

### 4. Apply database migrations

Drizzle migrations live at `worker/src/db/migrations/`. Apply them to your local D1 simulation:

```bash
npx wrangler d1 migrations apply mimir-db --local --config apps/web/wrangler.jsonc
```

Or push the schema directly during development:

```bash
npx drizzle-kit push
```

---

## Development

Start the full stack (React Router SSR + Hono API) via the web app Worker:

```bash
cd apps/web
npm run dev
```

This runs `react-router dev` through the Cloudflare Vite plugin, which boots a local Workers runtime with your D1/AI/Vectorize/DO/Workflows/rate-limit bindings in miniflare.

### Useful commands

| Command                           | Where         | What it does                                              |
| --------------------------------- | ------------- | --------------------------------------------------------- |
| `npm run dev`                     | `apps/web`    | Local dev server — SSR + API + bindings                   |
| `npm run build`                   | `apps/web`    | Production React Router build                             |
| `npm run typecheck`               | `apps/web`    | `wrangler types` + `react-router typegen` + `tsc -b`      |
| `npm run cf-typegen`              | `apps/web`    | Regenerate `worker-configuration.d.ts` from wrangler.jsonc |
| `npx drizzle-kit push`            | repo root     | Push Drizzle schema to local D1                           |
| `npx drizzle-kit generate`        | repo root     | Generate a new SQL migration from schema changes          |
| `npx wrangler d1 execute mimir-db --local --command="..."` | repo root | Ad-hoc D1 SQL for debugging                  |
| `npm test`                        | repo root     | Run Vitest suite via `@cloudflare/vitest-pool-workers`    |

---

## Testing

The project uses **Vitest** with `@cloudflare/vitest-pool-workers` so tests run inside a real miniflare Workers runtime with live D1, Durable Object, and Workflow bindings.

```bash
npm test
```

Test coverage lives in `tests/`:

- `auth.test.ts` — sign-up, sign-in, OAuth, session persistence
- `content-pipeline.test.ts` — ContentGenerationWorkflow steps, streaming
- `gamification.test.ts`, `xp.test.ts` — XP awards, level thresholds, streaks
- `qna.test.ts` — RAG retrieval and citation scoping
- `security.test.ts` — sanitization, IDOR, SSRF, rate limits
- `battle/*.test.ts` — 32+ tests covering scoring, reconnect, wager, ledger, timer pause, idle forfeit, multi-tab eviction, tiebreakers, pool dedup

The root-level Vitest config lives at `worker/vitest.config.mts`.

---

## Deployment

### Worker + frontend

The production deploy target is the web Worker at `apps/web`, which serves React Router SSR, static assets, and the Hono API in a single unit:

```bash
cd apps/web
npm run deploy   # runs: react-router build && wrangler deploy
```

### Secrets

Upload production secrets via wrangler (never commit them):

```bash
cd apps/web
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put TURNSTILE_SECRET_KEY
```

### Migrations in production

```bash
npx wrangler d1 migrations apply mimir-db --remote --config apps/web/wrangler.jsonc
```

---

## Project Status

Milestone v1 is executing through four phases (plus one inserted integration-fix phase). Status pulled from `.planning/REQUIREMENTS.md` and `.planning/ROADMAP.md`.

| Phase                                    | Plans Complete | Status       |
| ---------------------------------------- | -------------- | ------------ |
| 01. Foundation (auth + security)         | 4 / 5          | In progress  |
| 02. AI Content Pipeline (roadmaps + RAG) | 10 / 11        | In progress  |
| 02.1 Cross-Phase Integration Fixes       | 2 / 2          | Complete     |
| 03. Gamification                         | 5 / 5 (plans)  | Implemented  |
| 04. Multiplayer Battles                  | 8 / 9          | In progress  |

### v1 requirement coverage

| Area                     | Done | Total |
| ------------------------ | ---- | ----- |
| Authentication           | 6    | 6     |
| AI Content Generation    | 6    | 6     |
| AI Q&A (RAG + citations) | 4    | 4     |
| Learning UX              | 4    | 4     |
| Security                 | 6    | 6     |
| Gamification             | 0    | 6     |
| Multiplayer              | 2    | 5     |

Gamification and several multiplayer requirements are implemented in code (per phase 03 and 04 plans) but still pending final verification checkpoints in `REQUIREMENTS.md`.

---

## Security

Mimir treats security as a stack-wide contract, not a feature. Summary of what the middleware and bindings enforce today:

- **Input sanitization** (`/api/*`) against XSS, SQLi, and prompt injection
- **Auth rate limits** — 10/min sign-in, 5/min registration (Workers Rate Limiting)
- **Battle rate limits** — 5/min create, 10/min join
- **Turnstile challenge** after repeated sign-in failures
- **IDOR guard** middleware on resource routes — strict data isolation per user
- **SSRF prevention** via fetch allowlist on outbound server requests
- **WebSocket auth guard** on battle room upgrades
- **Better Auth** sessions in `HttpOnly; Secure; SameSite=Strict` cookies with PKCE OAuth flows
- **Server-authoritative scoring and XP** — atomic D1 batches, idempotent ledger, client cannot alter results
- **Zod validation** on all request bodies and AI-generated JSON before persistence

See `CLAUDE.md` for the full security constraint list and threat surface.

---

## Contributing / Workflow

This repository uses the **GSD (Get Stuff Done)** workflow. Planning artifacts live under `.planning/` (ROADMAP, REQUIREMENTS, STATE, per-phase plans and validations) and must stay in sync with code changes.

Entry points:

- `/gsd:quick` — small fixes, doc updates, ad-hoc tasks
- `/gsd:debug` — investigation and bug fixing
- `/gsd:execute-phase` — planned phase work

Direct repo edits outside a GSD workflow are discouraged unless explicitly requested. Additional per-phase context lives under `.planning/phases/NN-*/`.

---

## License

<!-- Add LICENSE file and update this section -->

No license file is present in the repository yet. Add a `LICENSE` file at the project root and update this section before publishing.
