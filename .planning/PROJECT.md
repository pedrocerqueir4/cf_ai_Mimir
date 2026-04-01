# Mimir

## What This Is

Mimir is an AI-powered, gamified micro-learning platform that converts topic descriptions into interactive, structured learning roadmaps. Users describe what they want to learn via chat prompts, and the AI generates bite-sized lessons with quizzes, progress tracking, XP/streaks, and real-time multiplayer quiz battles. Mobile-first web app built entirely on Cloudflare's stack.

## Core Value

Users describe a topic and instantly get an adaptive learning roadmap with bite-sized lessons and quizzes that make learning addictive — this must work flawlessly and feel fast.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] User describes a topic via chat prompt and AI generates a structured learning roadmap
- [ ] Roadmap adapts format to complexity: linear (text → quiz → next) for simple topics, branching skill-tree with prerequisites for complex topics
- [ ] Lessons are bite-sized with mixed formats: reading, quizzes, flashcards, practice exercises
- [ ] XP system with points per lesson/quiz completion and level-up thresholds
- [ ] Daily study streaks (Duolingo-style)
- [ ] Global and friend-based leaderboards
- [ ] Real-time multiplayer quiz battles (Kahoot-style head-to-head)
- [ ] AI-powered Q&A available during lessons and as standalone feature (Vectorize-backed)
- [ ] Email/password authentication with email verification
- [ ] OAuth sign-in (Google, GitHub)
- [ ] User progress persistence across sessions (D1)
- [ ] Mobile-first responsive web design

### Out of Scope

- File upload (PDF, PowerPoint) — deferred post-MVP due to RCE attack surface; will be added after security hardening
- Text paste input — post-MVP feature
- URL scraping input — post-MVP feature
- Native mobile app — web-first, mobile-optimized
- Badges/achievements — v2 gamification expansion

## Context

- **Platform**: Entirely Cloudflare — Workers AI (Llama 3.3), Cloudflare Workflows, D1, Vectorize, Durable Objects, WebSockets, R2, Pages
- **AI Model**: Workers AI with Llama 3.3 for content generation (roadmaps, lessons, quizzes)
- **Vector Search**: Vectorize for AI Q&A about learning content
- **Real-time**: Durable Objects + WebSockets for live multiplayer quiz battles
- **Storage**: D1 for user progress/streaks/XP, R2 for any file storage needs
- **Processing**: Cloudflare Workflows for content generation pipelines
- **Frontend**: React with mobile-first CSS (Tailwind), deployed to Cloudflare Pages
- **Target users**: Solo learners (students, self-learners) studying technical subjects
- **Security posture**: Bulletproof — this is a core design principle, not an afterthought

## Constraints

- **Security**: Comprehensive security at every layer — input sanitization (XSS, SQLi, prompt injection), hardened auth (rate limiting, secure sessions, brute-force protection), strict data isolation (no IDOR), SSRF prevention, race condition protection in multiplayer, full OWASP top 10 coverage
- **Platform**: All infrastructure on Cloudflare — no external cloud providers
- **AI Model**: Workers AI with Llama 3.3 — bound by model capabilities and Cloudflare AI gateway limits
- **Mobile-first**: UI must be designed for mobile viewports first, desktop second
- **No file upload in MVP**: All content input via chat prompts only — eliminates RCE vector

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Chat-prompt-only input for MVP | Eliminates RCE risk from file upload; simplest secure input vector | — Pending |
| Cloudflare-only stack | Unified platform reduces operational complexity, edge-native performance | — Pending |
| Workers AI (Llama 3.3) over external LLM APIs | Stays within Cloudflare ecosystem, lower latency, no external API keys | — Pending |
| React for frontend | Wide ecosystem, team familiarity, good Cloudflare Pages support | — Pending |
| Mobile-first web over native app | Broader reach, single codebase, faster iteration | — Pending |
| Adaptive roadmap format (linear vs branching) | Simple topics don't need complex navigation; complex topics need structure | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-01 after initialization*
