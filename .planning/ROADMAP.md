# Roadmap: Mimir

## Overview

Mimir is built in four phases, each delivering a complete, independently verifiable capability. Phase 1 establishes identity and security contracts that every subsequent feature depends on. Phase 2 delivers the core differentiator — AI-generated learning roadmaps and lessons — along with the RAG Q&A that makes it feel like an AI platform. Phase 3 adds the gamification loop that makes learning addictive (XP, levels, streaks). Phase 4 completes the v1 product with real-time multiplayer quiz battles, the highest-complexity feature and the highest engagement ceiling.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation** - Project scaffold, auth, database schema, and security contracts
- [ ] **Phase 2: AI Content Pipeline** - Roadmap generation, lesson delivery, and RAG Q&A
- [ ] **Phase 3: Gamification** - XP system, levels, daily streaks, and leaderboard
- [ ] **Phase 4: Multiplayer Battles** - Real-time head-to-head quiz battles with server-authoritative scoring

## Phase Details

### Phase 1: Foundation
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
- [ ] 01-03-PLAN.md — Auth UI screens (sign-up, sign-in, forgot-password, verify-email), OAuth error handling
- [ ] 01-04-PLAN.md — App shell, responsive navigation, session persistence, empty state

**UI hint**: yes

### Phase 2: AI Content Pipeline
**Goal**: Users can describe any topic and receive a structured, adaptive learning roadmap with bite-sized lessons and quizzes — and ask AI questions about their own content at any time
**Depends on**: Phase 1
**Requirements**: CONT-01, CONT-02, CONT-03, CONT-04, CONT-05, CONT-06, QNA-01, QNA-02, QNA-03, QNA-04, UX-01, UX-02
**Success Criteria** (what must be TRUE):
  1. User submits a topic prompt and sees the first streaming response begin within 2 seconds, with a "Generating your roadmap..." progress state while the pipeline runs
  2. User can view their completed roadmap as a visual learning path with lesson nodes and progress indicators showing which lessons are done
  3. User can open a lesson, read bite-sized content scoped to a single concept, and complete comprehension quizzes with immediate correct/wrong feedback and explanation
  4. AI adapts roadmap format to topic complexity — linear sequence for simple topics, branching skill-tree with prerequisites for complex topics
  5. User can ask the AI a question during a lesson or from a standalone Q&A section and receive an answer that cites which lesson or section it came from, scoped to their own content
**Plans**: TBD
**UI hint**: yes

### Phase 3: Gamification
**Goal**: Users earn XP and build daily learning habits through a transparent reward loop with levels, streaks, and a leaderboard that makes progress feel real and competitive
**Depends on**: Phase 2
**Requirements**: GAME-01, GAME-02, GAME-03, GAME-04, GAME-05, GAME-06
**Success Criteria** (what must be TRUE):
  1. User earns XP after completing a lesson and after passing a quiz, with the award reflected immediately in the UI
  2. User can see their current XP total, level, and a progress bar showing how much XP remains until the next level-up
  3. User's streak counter increments on the dashboard for each consecutive day they complete at least one lesson, and resets to zero if they miss a day
  4. User can view a leaderboard showing ranked scores for the current period
**Plans**: TBD
**UI hint**: yes

### Phase 4: Multiplayer Battles
**Goal**: Users can challenge another player to a real-time head-to-head quiz battle on a topic they have studied, with server-authoritative scoring that cannot be manipulated
**Depends on**: Phase 3
**Requirements**: MULT-01, MULT-02, MULT-03, MULT-04, MULT-05, SEC-05, SEC-06
**Success Criteria** (what must be TRUE):
  1. User can initiate a quiz battle on a topic they have studied and share a join code for an opponent to enter the same room
  2. Both players see the same questions simultaneously and submit answers independently — the battle resolves correctly even if one player has a slow connection
  3. Speed-weighted scoring is calculated server-side: faster correct answers yield higher points and the client cannot alter the score
  4. User can wager XP before a battle (capped at 10-20% of their current XP) and the winner's XP balance updates after the battle ends
  5. If a WebSocket connection drops mid-battle, the client reconnects and the game state is restored from the server without corrupting scores
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 2/5 | In Progress|  |
| 2. AI Content Pipeline | 0/TBD | Not started | - |
| 3. Gamification | 0/TBD | Not started | - |
| 4. Multiplayer Battles | 0/TBD | Not started | - |
