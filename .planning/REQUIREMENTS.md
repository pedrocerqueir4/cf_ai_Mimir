# Requirements: Mimir

**Defined:** 2026-04-01
**Core Value:** Users describe a topic and instantly get an adaptive learning roadmap with bite-sized lessons and quizzes that make learning addictive

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Authentication

- [x] **AUTH-01**: User can sign up with email and password
- [x] **AUTH-02**: User receives email verification after signup
- [x] **AUTH-03**: User can reset password via email link
- [x] **AUTH-04**: User can sign in via Google OAuth
- [x] **AUTH-05**: User can sign in via GitHub OAuth
- [x] **AUTH-06**: User session persists across browser refresh

### AI Content Generation

- [x] **CONT-01**: User describes a topic via chat prompt and AI generates a structured learning roadmap
- [x] **CONT-02**: AI adapts roadmap format based on topic complexity — linear for simple topics, branching skill-tree for complex topics
- [x] **CONT-03**: AI generates bite-sized lessons (2-10 min) scoped to a single concept
- [x] **CONT-04**: Each lesson includes mixed content: reading material and comprehension quizzes
- [x] **CONT-05**: Content generation begins streaming response within 2 seconds of prompt submission
- [x] **CONT-06**: Content generation pipeline handles failures gracefully with step-level retries via Cloudflare Workflows

### Gamification

- [ ] **GAME-01**: User earns XP for completing lessons
- [ ] **GAME-02**: User earns XP for passing quizzes
- [ ] **GAME-03**: User has a level that increases at defined XP thresholds
- [ ] **GAME-04**: User can see their current XP, level, and progress to next level
- [ ] **GAME-05**: User maintains a daily study streak for consecutive days with at least one lesson completed
- [ ] **GAME-06**: Streak counter is visible on the main dashboard

### Multiplayer

- [ ] **MULT-01**: User can initiate a real-time quiz battle on a topic they've studied
- [ ] **MULT-02**: Two players compete head-to-head answering the same questions simultaneously
- [ ] **MULT-03**: Battle scoring is speed-weighted — faster correct answers earn more points
- [ ] **MULT-04**: User can wager XP before a battle, winner takes the pot (capped at 10-20% of current XP)
- [ ] **MULT-05**: Battle state is server-authoritative — no client-side score manipulation

### AI Q&A

- [x] **QNA-01**: User can ask questions about lesson content during a lesson and receive RAG-backed answers
- [x] **QNA-02**: User can access a standalone Q&A section to query any of their learning content
- [x] **QNA-03**: AI answers are scoped to the user's own generated content via Vectorize embeddings
- [x] **QNA-04**: AI Q&A responses cite which lesson/section the answer came from

### Learning UX

- [x] **UX-01**: User can see a visual roadmap of their learning path with progress indicators
- [x] **UX-02**: User receives immediate feedback on quiz answers (correct/wrong with explanation)
- [x] **UX-03**: UI is mobile-first with thumb-zone navigation and minimum 48px tap targets
- [x] **UX-04**: User can resume learning exactly where they left off across sessions

### Security

- [x] **SEC-01**: All user input is sanitized against XSS, SQLi, and prompt injection
- [x] **SEC-02**: Authentication is hardened with rate limiting and brute-force protection
- [x] **SEC-03**: Strict data isolation — users can never access another user's content or progress (no IDOR)
- [x] **SEC-04**: SSRF prevention on all server-side requests
- [ ] **SEC-05**: Race condition protection on multiplayer scoring and XP updates (atomic operations)
- [ ] **SEC-06**: All scoring and XP awards are server-authoritative

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Gamification v2

- **GAME-07**: Streak recovery mechanic (streak-save token earned weekly)
- **GAME-08**: Global leaderboard with weekly resets
- **GAME-09**: Friend-based leaderboards with invite system
- **GAME-10**: Badges and achievements for milestones

### Content Input v2

- **CONT-07**: User can paste text and AI generates lessons from it
- **CONT-08**: User can provide a URL and AI generates lessons from the page content
- **CONT-09**: User can upload PDF files for lesson generation (with security hardening)
- **CONT-10**: User can upload PowerPoint files for lesson generation

### Learning v2

- **UX-05**: Onboarding flow (3-step: topic demo, sample roadmap, signup incentive)
- **UX-06**: Flashcard mode auto-generated from lesson content with spaced repetition
- **UX-07**: AI tutor persona customization per domain

### Social v2

- **SOCL-01**: Friend system with invite by username/email
- **SOCL-02**: Friend leaderboard leagues

## Out of Scope

| Feature | Reason |
|---------|--------|
| Native mobile apps (iOS/Android) | Mobile-first web is faster to iterate; revisit after PMF |
| Lives/hearts system | Punishes mistakes — opposite of learning; anti-feature |
| User-generated content marketplace | Content quality variance, moderation overhead, legal liability |
| Real-time collaboration / group study rooms | Scope bloat for solo-learner MVP; multiplayer is competitive only |
| Offline mode | Sync complexity with streaks/XP; WebSocket battles require connectivity |
| Certification and credentials | Different product vertical requiring assessment proctoring |
| Social feed / community forum | Moderation burden, toxic competition risk |
| Adaptive difficulty mid-lesson | Per-session complexity; defer to roadmap-level calibration |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01 | Phase 1 | Complete |
| AUTH-02 | Phase 1 | Complete |
| AUTH-03 | Phase 1 | Complete |
| AUTH-04 | Phase 1 | Complete |
| AUTH-05 | Phase 1 | Complete |
| AUTH-06 | Phase 1 | Complete |
| SEC-01 | Phase 1 | Complete |
| SEC-02 | Phase 1 | Complete |
| SEC-03 | Phase 1 | Complete |
| SEC-04 | Phase 1 | Complete |
| UX-03 | Phase 1 | Complete |
| UX-04 | Phase 1 | Complete |
| CONT-01 | Phase 2 | Complete |
| CONT-02 | Phase 2 | Complete |
| CONT-03 | Phase 2 | Complete |
| CONT-04 | Phase 2 | Complete |
| CONT-05 | Phase 2 | Complete |
| CONT-06 | Phase 2 | Complete |
| QNA-01 | Phase 2 | Complete |
| QNA-02 | Phase 2 | Complete |
| QNA-03 | Phase 2 | Complete |
| QNA-04 | Phase 2 | Complete |
| UX-01 | Phase 2 | Complete |
| UX-02 | Phase 2 | Complete |
| GAME-01 | Phase 3 | Pending |
| GAME-02 | Phase 3 | Pending |
| GAME-03 | Phase 3 | Pending |
| GAME-04 | Phase 3 | Pending |
| GAME-05 | Phase 3 | Pending |
| GAME-06 | Phase 3 | Pending |
| MULT-01 | Phase 4 | Pending |
| MULT-02 | Phase 4 | Pending |
| MULT-03 | Phase 4 | Pending |
| MULT-04 | Phase 4 | Pending |
| MULT-05 | Phase 4 | Pending |
| SEC-05 | Phase 4 | Pending |
| SEC-06 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 37 total
- Mapped to phases: 37
- Unmapped: 0

---
*Requirements defined: 2026-04-01*
*Last updated: 2026-04-01 after roadmap creation*
