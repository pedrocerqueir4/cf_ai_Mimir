# Roadmap: Mimir

## Overview

Mimir is built in four phases, each delivering a complete, independently verifiable capability. Phase 1 establishes identity and security contracts that every subsequent feature depends on. Phase 2 delivers the core differentiator — AI-generated learning roadmaps and lessons — along with the RAG Q&A that makes it feel like an AI platform. Phase 3 adds the gamification loop that makes learning addictive (XP, levels, streaks). Phase 4 completes the v1 product with real-time multiplayer quiz battles, the highest-complexity feature and the highest engagement ceiling.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 01: Foundation** - Project scaffold, auth, database schema, and security contracts
- [ ] **Phase 02: AI Content Pipeline** - Roadmap generation, lesson delivery, and RAG Q&A
- [ ] **Phase 02.1: Cross-Phase Integration Fixes** - Rate limiting, Q&A citations, sanitize middleware, type alignment (INSERTED)
- [ ] **Phase 03: Gamification** - XP system, levels, daily streaks, and stats dashboard
- [ ] **Phase 04: Multiplayer Battles** - Real-time head-to-head quiz battles with server-authoritative scoring

## Phase Details

### Phase 01: Foundation
**Goal**: Users can securely create accounts, sign in, and have their identity and progress anchored in the system — with all security contracts established for every phase that follows
**Depends on**: Nothing (first phase)
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06, SEC-01, SEC-02, SEC-03, SEC-04, UX-03, UX-04
**Success Criteria** (what must be TRUE):
  1. User can sign up with email and password and receive an email verification link
  2. User can sign in with Google OAuth and GitHub OAuth without any external auth server
  3. User can reset a forgotten password via an emailed link
  4. User session persists across browser refresh and tab close/reopen
  5. The UI is mobile-first with all interactive elements meeting 48px minimum tap targets and thumb-zone navigation
**Plans**: 5 plans

Plans:
- [x] 01-00-PLAN.md — Wave 0: vitest + test infrastructure, test stubs for all requirements
- [x] 01-01-PLAN.md — Project scaffold, D1 schema, Tailwind/shadcn setup, security middleware
- [x] 01-02-PLAN.md — Better Auth configuration, auth API, rate limiting, Turnstile enforcement, SSRF boundary
- [x] 01-03-PLAN.md — Auth UI screens (sign-up, sign-in, forgot-password, verify-email), OAuth error handling
- [x] 01-04-PLAN.md — App shell, responsive navigation, session persistence, empty state

**UI hint**: yes

### Phase 02: AI Content Pipeline
**Goal**: Users can describe any topic and receive a structured, adaptive learning roadmap with bite-sized lessons and quizzes — and ask AI questions about their own content at any time
**Depends on**: Phase 1
**Requirements**: CONT-01, CONT-02, CONT-03, CONT-04, CONT-05, CONT-06, QNA-01, QNA-02, QNA-03, QNA-04, UX-01, UX-02
**Success Criteria** (what must be TRUE):
  1. User submits a topic prompt and sees the first streaming response begin within 2 seconds, with a "Generating your roadmap..." progress state while the pipeline runs
  2. User can view their completed roadmap as a visual learning path with lesson nodes and progress indicators showing which lessons are done
  3. User can open a lesson, read bite-sized content scoped to a single concept, and complete comprehension quizzes with immediate correct/wrong feedback and explanation
  4. AI adapts roadmap format to topic complexity — linear sequence for simple topics, branching skill-tree with prerequisites for complex topics
  5. User can ask the AI a question during a lesson or from a standalone Q&A section and receive an answer that cites which lesson or section it came from, scoped to their own content
**Plans**: 11 plans

Plans:
- [x] 02-00-PLAN.md — Wave 0: test stubs for all requirements, AI/Vectorize mock bindings in test setup
- [x] 02-01-PLAN.md — D1 schema extension (6 tables), Cloudflare bindings (AI/Vectorize/Workflows), Zod validation schemas, shadcn components
- [x] 02-02-PLAN.md — ContentGenerationWorkflow (4-step durable pipeline: roadmap, lessons, quizzes, embeddings)
- [x] 02-03-PLAN.md — API routes: chat (streaming + workflow trigger), roadmaps (CRUD + quiz answer), Q&A (RAG with citations)
- [x] 02-04-PLAN.md — Navigation update (5 tabs) + buddy chat screen (streaming, generation progress, message bubbles)
- [x] 02-05-PLAN.md — Roadmaps list page + roadmap detail with node tree visualization (linear/branching)
- [x] 02-06-PLAN.md — Lesson view (Markdown content + inline quiz with instant feedback) + practice quiz mode
- [x] 02-07-PLAN.md — RAG Q&A: in-lesson bottom sheet + roadmap-level Q&A tab with citation links
- [ ] 02-08-PLAN.md — Integration verification checkpoint (human end-to-end verification)
- [x] 02-09-PLAN.md — Gap closure: fix node locked state for linear roadmaps + remove Q&A tab
- [x] 02-10-PLAN.md — Gap closure: fix quiz data pipeline (lesson quiz rendering + practice quiz URL/shape)

**UI hint**: yes

### Phase 02.1: Cross-Phase Integration Fixes (INSERTED)
**Goal**: Fix security and data wiring gaps discovered during milestone audit — restore rate limiting on auth endpoints, fix Q&A citation rendering, apply global input sanitization, and align TypeScript types with actual API responses
**Depends on**: Phase 2
**Requirements**: QNA-04, SEC-01, SEC-02
**Gap Closure**: Closes gaps from v1.0-MILESTONE-AUDIT.md
**Success Criteria** (what must be TRUE):
  1. Auth endpoints have rate limiting applied (10 req/min sign-in, 5 req/min registration)
  2. Q&A answers display citation links that navigate to referenced lessons
  3. Input sanitization middleware runs globally on all API routes
  4. No TypeScript `as string` casts on userId in roadmap routes
**Plans**: 2 plans

Plans:
- [x] 02.1-01-PLAN.md — Security middleware wiring: rate limiting + global sanitize in app.ts
- [x] 02.1-02-PLAN.md — Data alignment: Q/A citation fix, AuthVariables generic, api-client.ts types

### Phase 03: Gamification
**Goal**: Users earn XP and build daily learning habits through a transparent reward loop with levels, streaks, and a stats dashboard that makes progress feel real and competitive
**Depends on**: Phase 2
**Requirements**: GAME-01, GAME-02, GAME-03, GAME-04, GAME-05, GAME-06
**Success Criteria** (what must be TRUE):
  1. User earns XP after completing a lesson and after passing a quiz, with the award reflected immediately in the UI
  2. User can see their current XP total, level, and a progress bar showing how much XP remains until the next level-up
  3. User's streak counter increments on the dashboard for each consecutive day they complete at least one lesson, and resets to zero if they miss a day
  4. User can view a leaderboard showing ranked scores for the current period
**Plans**: 6 plans

Plans:
- [x] 03-00-PLAN.md — Wave 0: test stubs for xp.test.ts and gamification.test.ts, setup.ts user_stats table
- [x] 03-01-PLAN.md — Backend foundation: userStats schema, XP/level/streak utility library, stats API endpoint
- [x] 03-02-PLAN.md — Gamification UI components (XPProgressBar, StreakCounter, StatCard, LevelBadge) + api-client types
- [x] 03-03-PLAN.md — XP award logic in lesson/quiz endpoints, frontend toasts, schema push
- [x] 03-04-PLAN.md — Dashboard (home page replacement) + Profile page with stats grid
- [x] 03-05-PLAN.md — Gap closure: mount sonner Toaster in root.tsx so XP toasts render (UAT Test 2 fix)

**UI hint**: yes

### Phase 04: Multiplayer Battles
**Goal**: Users can challenge another player to a real-time head-to-head quiz battle on a topic they have studied, with server-authoritative scoring that cannot be manipulated
**Depends on**: Phase 3
**Requirements**: MULT-01, MULT-02, MULT-03, MULT-04, MULT-05, SEC-05, SEC-06
**Success Criteria** (what must be TRUE):
  1. User can initiate a quiz battle on a topic they have studied and share a join code for an opponent to enter the same room
  2. Both players see the same questions simultaneously and submit answers independently — the battle resolves correctly even if one player has a slow connection
  3. Speed-weighted scoring is calculated server-side: faster correct answers yield higher points and the client cannot alter the score
  4. User can wager XP before a battle (capped at 10-20% of their current XP) and the winner's XP balance updates after the battle ends
  5. If a WebSocket connection drops mid-battle, the client reconnects and the game state is restored from the server without corrupting scores
**Plans**: 15 plans

Plans:
- [x] 04-00-PLAN.md — Wave 0: wrangler bindings (DO + Workflow + battle rate limits), BattleRoom + BattleQuestionGenerationWorkflow skeletons, 31 it.todo stub map
- [x] 04-01-PLAN.md — D1 schema (6 battle tables + partial UNIQUE index), pure utilities (join-code, battle-scoring, Zod strict inbound schemas), drizzle-kit push
- [x] 04-02-PLAN.md — BattleRoom DO core: Hibernation accept, alarms, scoring critical section, multi-tab eviction, sudden-death, idle forfeit
- [x] 04-03-PLAN.md — BattleQuestionGenerationWorkflow + battle-pool service (Vectorize topic similarity + race-deduped pool population)
- [x] 04-04-PLAN.md — HTTP routes: /api/battle create/join/wager/start/cancel/:id/leaderboard + websocketAuthGuard + battle rate-limit extensions
- [x] 04-05-PLAN.md — Frontend landing: /battle tabs (Create/Join/Leaderboard), Create flow, Join flow, Lobby, shared pickers, shadcn dialog/alert-dialog
- [x] 04-06-PLAN.md — Pre-battle reveals: SlotMachineReel (framer-motion), RoadmapRevealScreen, WagerRevealScreen, canvas-confetti, reduced-motion path
- [x] 04-07-PLAN.md — Battle room + Results: Zustand store, useBattleSocket hook, BattleTimer/ScoreCard/ConnectionDot/BattleQuestion/ReconnectOverlay, results screen
- [x] 04-08-PLAN.md — Atomic XP transfer (env.DB.batch) + idempotent ledger + disconnect/reconnect/timer-pause/forfeit DO logic
- [x] 04-09-PLAN.md — Gap closure: join-path AI 1031 isolation (retry-with-jitter + re-ordered findOrQueueTopic + structured 503)
- [x] 04-10-PLAN.md — Gap closure: workflow-failure fast-fail + frontend 45s stuck-pane (StuckPane + tightened step-1 retry)
- [x] 04-11-PLAN.md — Gap closure: wager-submit cache bounce fix + /battle/new Create-wager cleanup + lobby ParticipantCard (name/level/XP)
- [ ] 04-12-PLAN.md — Gap closure: backend pool-stuck recovery (schema + DO alarm + observability stamp + host retry endpoint)
- [ ] 04-13-PLAN.md — Gap closure: frontend host retry UX (StuckPane 'Retry pool generation' CTA + api-client wiring)
- [ ] 04-14-PLAN.md — Gap closure: regression tests (DO alarm, retry endpoint, workflow_started_at helpers)

## Progress

**Execution Order:**
Phases execute in numeric order: 01 -> 02 -> 02.1 -> 03 -> 04

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 01. Foundation | 4/5 | In Progress|  |
| 02. AI Content Pipeline | 10/11 | In Progress|  |
| 02.1 Integration Fixes | 0/2 | Not started | - |
| 03. Gamification | 0/5 | Not started | - |
| 04. Multiplayer Battles | 12/15 | In Progress|  |
