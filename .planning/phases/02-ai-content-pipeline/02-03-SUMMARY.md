---
phase: 02-ai-content-pipeline
plan: 03
subsystem: api-routes
tags: [hono, d1, workers-ai, vectorize, sse, idor, quiz-security]
dependency_graph:
  requires: [02-01, 02-02]
  provides: [chat-api, roadmaps-api, qa-api]
  affects: [apps/web/workers/app.ts]
tech_stack:
  added: []
  patterns:
    - Hono route groups mounted in unified worker entry
    - SSE streaming with text/event-stream for conversational AI replies
    - Workflow trigger returning 202 + workflowRunId for async generation
    - Quiz answer security — correctOptionId never returned before answer submission
    - RAG flow: bge-large-en-v1.5 embed → Vectorize scoped query → Llama 3.3 answer with citations
    - IDOR prevention on every user-scoped query via verifyOwnership + userId filter
key_files:
  created:
    - worker/src/routes/chat.ts
    - worker/src/routes/roadmaps.ts
    - worker/src/routes/qa.ts
  modified:
    - apps/web/workers/app.ts
decisions:
  - "SSE streaming used directly for conversational chat; 202 + workflowRunId for roadmap generation — two distinct interaction models never conflated"
  - "correctOptionId and explanation stripped from GET /lessons/:id endpoint at query-select level; only revealed via POST /quiz/:questionId/answer"
  - "Vectorize RAG query uses roadmapId + userId metadata filter (not just userId) — tighter scoping prevents cross-roadmap content bleed"
  - "IDOR prevention via double-check pattern: verifyOwnership on roadmap + join verification on nested resources (lessons, questions)"
metrics:
  duration: 3min
  completed: "2026-04-08T14:21:19Z"
  tasks_completed: 2
  files_modified: 4
---

# Phase 2 Plan 3: API Routes (Chat, Roadmaps, Q&A) Summary

**One-liner:** Three Hono route groups providing chat SSE streaming with Workflow trigger, roadmap CRUD with quiz answer key security, and Vectorize RAG Q&A with citation sources.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create chat, roadmaps, and Q&A API route modules | 8e3eaa9 | worker/src/routes/chat.ts, roadmaps.ts, qa.ts |
| 2 | Mount route modules in unified worker entry | 5bb9097 | apps/web/workers/app.ts |

## What Was Built

### Chat API (`worker/src/routes/chat.ts`)

- **POST /api/chat/message** — Dual-mode: detects roadmap intent via `detectRoadmapIntent()`, triggers `CONTENT_WORKFLOW.create()` returning 202 + workflowRunId; otherwise fetches last 20 history messages and streams SSE from Llama 3.3 with `text/event-stream` content-type. No `response_format` on streaming path (incompatible per Research Pitfall 2).
- **GET /api/chat/conversations** — Groups messages by conversationId, returns latest timestamp + 100-char preview per conversation.
- **GET /api/chat/conversations/:conversationId/messages** — IDOR-safe: verifies conversation ownership via userId match before returning messages.
- **GET /api/chat/status/:workflowRunId** — Polls roadmap generation status scoped to userId (prevents cross-user status polling).

### Roadmaps API (`worker/src/routes/roadmaps.ts`)

- **GET /api/roadmaps** — Lists user's roadmaps with `totalLessons` and `completedLessons` counts via Drizzle aggregate queries.
- **GET /api/roadmaps/:id** — Returns roadmap with parsed `nodesJson` and `completedLessonIds` array for frontend node tree rendering.
- **GET /api/roadmaps/:id/lessons/:lessonId** — Returns lesson content + quiz questions. `correctOptionId` and `explanation` are **never selected** from the database at this endpoint — stripped at the Drizzle select level, not filtered post-fetch.
- **POST /api/roadmaps/:id/lessons/:lessonId/complete** — Idempotent completion marking; checks for existing record before insert.
- **POST /api/roadmaps/quiz/:questionId/answer** — The sole endpoint that reveals `correctOptionId` and `explanation`. Verifies question ownership via full join chain: quiz_questions → quizzes → lessons → roadmaps WHERE userId = current user.
- **GET /api/roadmaps/:id/quiz/practice** — Fetches questions from completed lessons only via JOIN on lessonCompletions; randomizes and caps at 10. Same answer-key exclusion as lesson endpoint.

### Q&A API (`worker/src/routes/qa.ts`)

- **POST /api/qa/ask** — Full RAG flow: embed question with `@cf/baai/bge-large-en-v1.5`, query Vectorize with `{ roadmapId, userId }` metadata filter (plus optional `lessonId`), fetch lesson titles from D1 for citation building, generate grounded answer via Llama 3.3. Returns `{ answer, sources: [{ lessonId, title, displayText }] }` per QNA-04.
- System prompt explicitly restricts model to provided context and instructs citation by lesson title.

### Worker Entry (`apps/web/workers/app.ts`)

- Mounted `/api/chat`, `/api/roadmaps`, `/api/qa` routes.
- Added `AI`, `VECTORIZE`, `CONTENT_WORKFLOW` bindings to `AppEnv` interface.
- All existing auth routes and health endpoint preserved.

## Security Contracts Met

- Every route applies `authGuard` (userId from session only, never from params/body)
- Every user-scoped query includes `userId` in WHERE clause (IDOR prevention)
- `sanitize` middleware on all POST/PUT/PATCH routes (XSS, SQLi, prompt injection filter)
- `correctOptionId` and `explanation` excluded at select level in GET endpoints — cannot leak via response shaping bug
- Quiz ownership verified via 4-table join chain before revealing correct answer

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all endpoints are fully wired. Actual AI responses depend on Workers AI binding availability at runtime; no mock/placeholder data returned.

## Self-Check: PASSED

Files created:
- worker/src/routes/chat.ts — FOUND
- worker/src/routes/roadmaps.ts — FOUND
- worker/src/routes/qa.ts — FOUND
- apps/web/workers/app.ts — MODIFIED (FOUND)

Commits verified:
- 8e3eaa9 — feat(02-03): add chat, roadmaps, and Q&A API route modules — FOUND
- 5bb9097 — feat(02-03): mount chat, roadmaps, and Q&A routes in unified worker entry — FOUND
