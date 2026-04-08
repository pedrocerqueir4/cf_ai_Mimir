---
phase: 02-ai-content-pipeline
plan: 02
subsystem: backend, ai-pipeline
tags: [cloudflare-workflows, workers-ai, llama-3.3, bge-large, vectorize, drizzle, zod]

# Dependency graph
requires:
  - phase: 02-ai-content-pipeline
    plan: 01
    provides: "D1 schema (roadmaps, lessons, quizzes, quiz_questions), Zod validators, prompt builders, chunkText utility, Env bindings (AI, VECTORIZE, CONTENT_WORKFLOW)"
provides:
  - "ContentGenerationWorkflow: 4-step durable AI content generation pipeline"
  - "content-generation.service: detectRoadmapIntent, buildChatMessages, extractTopicFromMessage helpers"
affects: [02-03-PLAN, 02-04-PLAN, 02-05-PLAN, 02-06-PLAN, 02-07-PLAN, 02-08-PLAN]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Workflows store-in-step: write full content to D1 inside step.do(), return only record IDs (1MiB limit compliance)"
    - "Deterministic IDs for idempotency: lessonId = roadmapId-lesson-nodeId, quizId = lessonId-quiz"
    - "AI response extraction: handle both string and {response: string} shapes from Workers AI"
    - "Markdown stripping before embedding: regex strip of ##, **, *, `, [], bullets before chunkText()"
    - "Exponential backoff retry config on every step.do()"

key-files:
  created:
    - "worker/src/workflows/ContentGenerationWorkflow.ts — 4-step Cloudflare Workflow for AI content generation"
    - "worker/src/services/content-generation.service.ts — detectRoadmapIntent, buildChatMessages, extractTopicFromMessage"
  modified: []

key-decisions:
  - "Store-in-step pattern confirmed: all AI generation writes content to D1 within step.do(), returns only IDs — validates 1MiB limit mitigation"
  - "Markdown stripped before chunking in embed-content step — cleaner text improves embedding quality; regex approach avoids adding a markdown parser dependency"
  - "Void step.do() for generate-quizzes and embed-content — these steps only write to D1/Vectorize, returning nothing to avoid any size limit risk"
  - "detectRoadmapIntent uses keyword heuristic (not AI classifier) per Research Pitfall 4 — confirmation step added at API layer before Workflow trigger"
  - "BUDDY_SYSTEM_PROMPT is private constant in service module — not exported, not configurable at runtime"

# Metrics
duration: 2min
completed: 2026-04-08
---

# Phase 2 Plan 02: AI Content Generation Pipeline Summary

**4-step ContentGenerationWorkflow (generate-roadmap, generate-lessons, generate-quizzes, embed-content) with Zod-validated AI outputs stored in D1 within each step, plus intent detection and chat helper service for the chat API route**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-08T14:07:02Z
- **Completed:** 2026-04-08T14:09:00Z
- **Tasks:** 2
- **Files created:** 2

## Accomplishments

- Implemented `ContentGenerationWorkflow` as a `WorkflowEntrypoint` subclass with 4 named durable steps
- Each step uses `step.do()` with exponential backoff retry config (3 retries for roadmap/embed, 2 for lessons/quizzes)
- Step outputs are strictly IDs only: `string` (roadmapId) from step 1, `string[]` (lessonIds) from step 2, void from steps 3 and 4 — full 1MiB compliance
- All AI outputs Zod-validated before D1 writes: `RoadmapOutputSchema.parse()`, `LessonOutputSchema.parse()`, `QuizOutputSchema.parse()`
- Deterministic IDs for idempotency: `${roadmapId}-lesson-${node.id}` for lessons, `${lessonId}-quiz` for quizzes, `${quizId}-q${i}` for questions
- `onConflictDoNothing()` on all inserts enables safe step retries without duplicate data
- Markdown stripped before chunking (`##`, `**`, `` ` ``, `[]()`) for cleaner bge-large embeddings
- `chunkText(plainText, 300, 50)` — 300-word chunks, 50-word overlap, safely below 512-token limit
- Vectorize upsert with full metadata: `{ lessonId, roadmapId, userId, chunkIndex, text, lessonTitle }`
- Roadmap status transitions: `generating` → `complete` on success, `generating` → `failed` on unhandled error
- `detectRoadmapIntent()`: 9 case-insensitive regex patterns for roadmap creation intent
- `buildChatMessages()`: prepends BUDDY_SYSTEM_PROMPT, limits history to last 20 messages (Llama 3.3 24k context)
- `extractTopicFromMessage()`: strips 9 intent prefixes to extract clean topic string for Workflow payload

## Task Commits

Each task was committed atomically:

1. **Task 1: ContentGenerationWorkflow with 4 durable steps** - `9023530` (feat)
2. **Task 2: content-generation service with roadmap intent detection** - `222e970` (feat)

**Plan metadata:** (docs commit follows)

## Files Created

- `worker/src/workflows/ContentGenerationWorkflow.ts` — 4-step Cloudflare Workflow (376 lines)
- `worker/src/services/content-generation.service.ts` — Intent detection and chat helpers (119 lines)

## Decisions Made

- Store-in-step pattern validated: each step.do() writes to D1 and returns only IDs — critical for 1MiB limit
- Markdown stripped before embedding: regex approach (no dep) gives cleaner text for bge-large-en-v1.5
- `onConflictDoNothing()` on all inserts: makes every step safely idempotent on Workflow retry
- `detectRoadmapIntent` is keyword-only (not AI): fast, free, no extra AI call — confirmation step at API layer

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — this plan is pure backend logic (Workflow class + service helpers). No UI rendering, no data stubs.

## Self-Check: PASSED

Files verified:
- `worker/src/workflows/ContentGenerationWorkflow.ts` — FOUND
- `worker/src/services/content-generation.service.ts` — FOUND

Commits verified:
- `9023530` — FOUND (feat(02-02): implement ContentGenerationWorkflow)
- `222e970` — FOUND (feat(02-02): add content-generation service)
