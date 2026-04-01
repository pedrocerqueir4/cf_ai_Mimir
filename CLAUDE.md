<!-- GSD:project-start source:PROJECT.md -->
## Project

**Mimir**

Mimir is an AI-powered, gamified micro-learning platform that converts topic descriptions into interactive, structured learning roadmaps. Users describe what they want to learn via chat prompts, and the AI generates bite-sized lessons with quizzes, progress tracking, XP/streaks, and real-time multiplayer quiz battles. Mobile-first web app built entirely on Cloudflare's stack.

**Core Value:** Users describe a topic and instantly get an adaptive learning roadmap with bite-sized lessons and quizzes that make learning addictive — this must work flawlessly and feel fast.

### Constraints

- **Security**: Comprehensive security at every layer — input sanitization (XSS, SQLi, prompt injection), hardened auth (rate limiting, secure sessions, brute-force protection), strict data isolation (no IDOR), SSRF prevention, race condition protection in multiplayer, full OWASP top 10 coverage
- **Platform**: All infrastructure on Cloudflare — no external cloud providers
- **AI Model**: Workers AI with Llama 3.3 — bound by model capabilities and Cloudflare AI gateway limits
- **Mobile-first**: UI must be designed for mobile viewports first, desktop second
- **No file upload in MVP**: All content input via chat prompts only — eliminates RCE vector
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommended Stack
### Core Technologies
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Cloudflare Workers | Runtime (via Wrangler 4.79) | API backend, server-side logic | Native edge runtime, zero cold starts, direct bindings to D1/R2/DO/AI without network hops |
| Cloudflare Pages (→ Workers) | — | Frontend hosting + SSR | Cloudflare now directs all new projects to Workers (not Pages); Workers serves static assets and handles SSR in one unit |
| React | 19.2.4 | Frontend UI framework | Team-specified; v19 concurrent features improve perceived speed for real-time quiz battles |
| Hono | 4.12.9 | HTTP framework for Workers | Purpose-built for edge runtimes; full TypeScript, sub-millisecond routing, middleware chain, ~15kb; the de-facto standard for Workers APIs in 2025 |
| TypeScript | 6.0.2 | Type safety across full stack | Hono's generics propagate types from env bindings through request handlers; catches binding misconfiguration at compile time |
| Wrangler | 4.79.0 | Local dev + deployments | Only official tool for Workers; provides local D1/DO/R2 simulation |
### Infrastructure (Cloudflare Primitives)
| Service | Purpose | Why / Key Constraints |
|---------|---------|----------------------|
| Workers AI — `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Roadmap + lesson + quiz generation | 24,576 token context window; $0.29/M input, $2.25/M output; fp8 quantization makes it significantly faster than full-precision Llama 3.3; supports function calling and streaming. Use for structured JSON output of learning content. |
| Workers AI — `@cf/baai/bge-large-en-v1.5` | Generating embeddings for Q&A (RAG) | 1024-dimensional output; higher semantic quality than bge-small (384d) or bge-base (768d); stay within Vectorize's 1536-dimension limit with headroom |
| Cloudflare Vectorize | Vector store for lesson/roadmap content Q&A | Max 10M vectors/index, 1536 dimensions, 50 results per query; pairs natively with Workers AI embeddings without leaving Cloudflare |
| Cloudflare D1 (SQLite) | User accounts, progress, XP, streaks, leaderboards | Drizzle ORM is the idiomatic D1 client; strongly consistent within a Worker invocation; free for dev, paid tier scales |
| Cloudflare Durable Objects | Real-time multiplayer quiz battle rooms | Single-threaded per room guarantees no race conditions; WebSocket Hibernation API prevents billing during idle; one DO instance per active battle room |
| Cloudflare Workflows | AI content generation pipelines (multi-step, durable) | GA as of 2024; automatically retries failed steps; prevents partial generation (e.g., roadmap generated but lessons failed); triggered by HTTP or Queue messages |
| Cloudflare R2 | Static assets (avatars, generated images, audio) | Not needed in MVP (no file upload); add when post-MVP media features land. S3-compatible; Workers binding avoids egress fees |
| Cloudflare WAF + AI Security for Apps | Prompt injection detection, OWASP Top 10 | Native; 96.3% prompt injection detection rate, <0.1% false positives; requires no code changes — configured at DNS/edge level |
| Workers Rate Limiting | Per-user/per-IP rate limits on AI endpoints | GA as of Sept 2025; bind via `wrangler.toml`, enforce in Hono middleware; critical for AI endpoints (generation is expensive per-call) |
### Database Layer
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Drizzle ORM | 0.45.2 | D1 query builder + migrations | Only type-safe ORM with first-class D1 support; Drizzle Kit handles schema migrations via Wrangler; avoids raw SQL while keeping D1 performance |
| Drizzle Kit | (bundled with drizzle-orm) | Schema migrations | `drizzle-kit push` for dev; `drizzle-kit generate` + `wrangler d1 migrations apply` for prod |
### Authentication
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Better Auth | 1.5.6 | Email/password + Google + GitHub OAuth | Purpose-built for edge runtimes; official D1 adapter; Cloudflare Workers support documented; handles email verification, session management, PKCE OAuth flows. Does NOT require a separate auth server — runs inside your Worker. |
### Frontend Libraries
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| React Router | 7.13.2 | Client-side routing + loader pattern | Use framework mode (`react-router.config.ts`); loaders co-locate data fetching with routes; reduces waterfall requests |
| TanStack Query | 5.96.1 | Server state, caching, background sync | Owns all async data (API calls, optimistic updates for XP/streaks); pairs with React Router loaders — loaders prefetch, TanStack Query manages cache invalidation |
| Zustand | 5.0.12 | Client-side UI state | Manages transient state: active battle room, quiz answer selection, countdown timers; keeps React Router loaders clean |
| Tailwind CSS | 4.2.2 | Utility-first styling, mobile-first | v4 uses `@import "tailwindcss"` — no `tailwind.config.js` required; built-in mobile-first responsive utilities; Vite plugin replaces PostCSS pipeline |
| Zod | 4.3.6 | Runtime schema validation | Validate all API request bodies and AI-generated JSON before persistence; use `z.parse()` on Llama 3.3 outputs to catch hallucinated schema deviations |
### Development Tools
| Tool | Purpose | Notes |
|------|---------|-------|
| `create-cloudflare` (C3) | Project scaffolding | Run `npm create cloudflare@latest` — scaffolds React Router + Cloudflare Vite plugin in one step |
| Cloudflare Vite Plugin | Runs Worker runtime locally | Ensures local dev matches production Workers runtime exactly; required for Workers-mode (not Pages-mode) projects |
| Vitest | Unit + integration testing | Workers-compatible; use `@cloudflare/vitest-pool-workers` to test with real D1/DO bindings in miniflare |
| `@cloudflare/workers-types` | 4.20260401.1 | TypeScript types for CF primitives | Pin to dated version matching your compatibility date; auto-generated from live Cloudflare runtime |
## Installation
# Scaffold project (React Router + Cloudflare Vite Plugin)
# Database ORM
# Auth
# Backend framework (if using separate Worker for API)
# Frontend state
# Validation
# Styling (Tailwind v4 — Vite plugin only)
# No postcss or autoprefixer needed with v4 Vite plugin
# Types
## Alternatives Considered
| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Workers (serving static + SSR) | Cloudflare Pages | Only if your team already has a Pages project; Cloudflare officially directs all new investment to Workers |
| Hono | itty-router / native Workers fetch | itty-router is fine for very simple Workers; Hono wins when you need middleware chains, typed env, and auth integration |
| Better Auth | Clerk, Auth0, WorkOS | External auth providers work but introduce a non-Cloudflare dependency; Better Auth runs inside the Worker with D1, matching the stack constraint |
| Drizzle ORM | Kysely + D1 dialect | Kysely is also valid (Better Auth uses it internally); Drizzle has broader ecosystem momentum and better migration tooling in 2025 |
| TanStack Query + Zustand | Redux Toolkit | Redux is an anti-pattern for this stack; adds 50kb+ bundle, unnecessary boilerplate; TQ + Zustand cover both server and client state cleanly |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | `@cf/meta/llama-3.1-8b-instruct-fast` | Use 8B for low-latency tasks (quiz question suggestions, short feedback); use 70B for long-form roadmap + lesson generation where quality matters |
| `@cf/baai/bge-large-en-v1.5` (1024d) | `@cf/baai/bge-small-en-v1.5` (384d) | Use small only if you hit Vectorize index dimension limits or latency is critical; large produces measurably better RAG retrieval |
| React Router v7 (framework mode) | Next.js | Next.js has no official first-class Cloudflare Workers support (Pages adapter exists but is community-maintained); React Router v7 has official Cloudflare Vite plugin support |
## What NOT to Use
| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Cloudflare Pages (for new projects) | Cloudflare has officially paused all new features for Pages; all investment is now on Workers with static asset support | Cloudflare Workers (`create-cloudflare` with `--framework=react-router`) |
| Prisma ORM | Prisma requires a persistent connection pool and a TCP database connection; D1 is HTTP-based; Prisma's D1 adapter is perpetually experimental and breaks on migrations | Drizzle ORM — built for serverless, native D1 adapter |
| External LLM APIs (OpenAI, Anthropic) | Violates the Cloudflare-only constraint; introduces external API key secrets, egress costs, and latency; Workers AI Llama 3.3 stays within Cloudflare network | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` via `env.AI.run()` |
| Socket.io | Requires Node.js-specific features and stateful server; incompatible with Workers runtime | Cloudflare Durable Objects + native WebSocket API (DO Hibernation API) |
| Redis / Upstash | External dependency; Durable Objects KV storage and D1 cover all session/state needs within Cloudflare | Durable Objects (transient room state) + D1 (persistent user data) |
| PostgreSQL (Neon, Supabase) | External cloud provider; violates platform constraint; introduces network latency from Workers to external DB | D1 (SQLite) via Drizzle — co-located at Cloudflare edge |
| JWT stored in localStorage | XSS-vulnerable; if JS is compromised, attacker reads the token | Better Auth's session cookies with `HttpOnly; Secure; SameSite=Strict` |
| Redux Toolkit | 50kb+ bundle, significant boilerplate, no benefit over TanStack Query + Zustand for this architecture | TanStack Query (server state) + Zustand (client state) |
| PostCSS + autoprefixer (with Tailwind v4) | Tailwind v4's Vite plugin fully replaces the PostCSS pipeline; adding PostCSS creates version conflicts | `@tailwindcss/vite` plugin only |
## Stack Patterns by Variant
- One Durable Object instance per active room
- DO holds WebSocket connections + in-memory battle state (question index, scores, timers)
- Use Hibernation API (`this.ctx.acceptWebSocket(ws)`) so the DO sleeps between moves
- Persist final scores to D1 only at battle end (not on every message)
- Batch outbound state updates: broadcast every 100ms max, not per-keystroke
- Trigger a Cloudflare Workflow on roadmap creation request
- Step 1: Generate roadmap structure with Llama 3.3 (structured JSON output via function calling)
- Step 2: Generate lesson content per node (parallel fan-out within Workflow)
- Step 3: Generate quiz questions per lesson
- Step 4: Create embeddings with bge-large-en-v1.5, upsert to Vectorize
- Steps are independently retriable — if embedding step fails, only Step 4 retries
- Do NOT do this inline in a Worker request (24,576 token context + multi-step = timeout risk)
- User query → bge-large-en-v1.5 embedding → Vectorize search (top 10 results)
- Inject retrieved context into Llama 3.3 system prompt
- Stream response via Workers AI streaming API
- Zod-validate the structured parts; stream free-text parts directly to client
- Better Auth handles session rotation, PKCE for OAuth
- Add Cloudflare WAF rules + Workers Rate Limiting on `/auth/*` endpoints (10 req/min per IP for login, 5 for registration)
- Set `trustedOrigins` in Better Auth config; set `PUBLIC_URL` env var to prevent host header injection
- All auth cookies: `HttpOnly; Secure; SameSite=Strict`
## Version Compatibility
| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `drizzle-orm@0.45.x` | `wrangler@4.x`, D1 GA | Drizzle Kit `push` works against local Wrangler D1 simulation |
| `better-auth@1.5.x` | `drizzle-orm@0.45.x`, `hono@4.x` | Better Auth uses Drizzle internally for D1; confirm D1 adapter compatibility before upgrading either |
| `react-router@7.x` (framework mode) | Cloudflare Vite Plugin, `wrangler@4.x` | Set `future.v8_viteEnvironmentApi: true` in `react-router.config.ts`; required for Cloudflare Vite plugin compat |
| `tailwindcss@4.x` | Vite (any current version) | No `tailwind.config.js`; configure via CSS `@theme` blocks; v4 and v3 configs are incompatible |
| `@cloudflare/workers-types@4.2026xxxx` | Compatibility date in `wrangler.toml` | Must match or trail your `compatibility_date`; dated package name format — use `@latest` or pin to current year's release |
| `hono@4.x` | `@cloudflare/workers-types@4.x` | Hono's `Bindings` generic is typed against CF workers-types; mismatched versions cause `env.AI` type errors |
## Sources
- [Cloudflare Workers AI — llama-3.3-70b-instruct-fp8-fast model page](https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/) — context window (24,576 tokens), pricing, streaming support — HIGH confidence
- [Cloudflare Vectorize limits](https://developers.cloudflare.com/vectorize/platform/limits/) — max 1536 dimensions, 10M vectors, 50 query results — HIGH confidence
- [Cloudflare Durable Objects WebSocket best practices](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) — Hibernation API, serialization, batching — HIGH confidence
- [Cloudflare Workflows GA announcement](https://blog.cloudflare.com/workflows-ga-production-ready-durable-execution/) — GA status, step retries, pipeline use cases — HIGH confidence
- [Cloudflare full-stack Workers blog post](https://blog.cloudflare.com/full-stack-development-on-cloudflare-workers/) — Pages deprecation signal, Workers-first recommendation — HIGH confidence
- [Hono — Cloudflare Workers getting started](https://hono.dev/docs/getting-started/cloudflare-workers) — Bindings access pattern, middleware — HIGH confidence
- [Better Auth on Cloudflare + Hono](https://hono.dev/examples/better-auth-on-cloudflare) — D1 integration, OAuth setup — MEDIUM confidence (community example, not Cloudflare official)
- [Drizzle ORM — Cloudflare D1 docs](https://orm.drizzle.team/docs/connect-cloudflare-d1) — D1 adapter, migration workflow — HIGH confidence
- [React Router v7 on Cloudflare Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/react-router/) — official setup via C3, Vite plugin — HIGH confidence
- [Tailwind CSS v4.0 release notes](https://tailwindcss.com/blog/tailwindcss-v4) — no config file, Vite plugin, `@import "tailwindcss"` — HIGH confidence
- [Cloudflare AI Security for Apps](https://developers.cloudflare.com/waf/detections/ai-security-for-apps/) — prompt injection detection GA, 96.3% detection rate — HIGH confidence
- [Workers Rate Limiting GA changelog](https://developers.cloudflare.com/changelog/post/2025-09-19-ratelimit-workers-ga/) — GA status Sept 2025, Hono middleware — HIGH confidence
- npm registry (direct version queries 2026-04-01) — hono 4.12.9, drizzle-orm 0.45.2, better-auth 1.5.6, tailwindcss 4.2.2, react 19.2.4, zod 4.3.6, react-router 7.13.2, zustand 5.0.12, @tanstack/react-query 5.96.1, wrangler 4.79.0, typescript 6.0.2 — HIGH confidence
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
