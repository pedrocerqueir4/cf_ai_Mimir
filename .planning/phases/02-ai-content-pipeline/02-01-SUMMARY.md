---
phase: 02-ai-content-pipeline
plan: 01
subsystem: database, infra
tags: [drizzle, d1, sqlite, workers-ai, vectorize, workflows, zod, shadcn, react-markdown]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "D1 schema (users/sessions/accounts/verifications), worker wrangler.toml, env.d.ts, shadcn initialized"
provides:
  - "6 new D1 tables: chat_messages, roadmaps, lessons, lesson_completions, quizzes, quiz_questions"
  - "Drizzle migration 0001_flashy_white_tiger.sql applied locally"
  - "Zod validation schemas: RoadmapOutputSchema, LessonOutputSchema, QuizOutputSchema"
  - "AI prompt builders: buildRoadmapSystemPrompt, buildLessonSystemPrompt, buildQuizSystemPrompt"
  - "JSON schemas for structured Workers AI output: ROADMAP_JSON_SCHEMA, LESSON_JSON_SCHEMA, QUIZ_JSON_SCHEMA"
  - "Text chunking utility for bge-large-en-v1.5 embedding pipeline"
  - "Workers AI, Vectorize, Workflows bindings in both wrangler configs"
  - "Env types updated with Ai, VectorizeIndex, Workflow"
  - "6 shadcn components: Sheet, Progress, Tabs, Tooltip, Badge, ScrollArea"
  - "react-markdown installed for lesson content rendering"
affects: [02-02-PLAN, 02-03-PLAN, 02-04-PLAN, 02-05-PLAN, 02-06-PLAN, 02-07-PLAN, 02-08-PLAN]

# Tech tracking
tech-stack:
  added:
    - "react-markdown (lesson Markdown rendering)"
    - "@radix-ui/react-dialog, @radix-ui/react-progress, @radix-ui/react-scroll-area, @radix-ui/react-tabs, @radix-ui/react-tooltip (shadcn deps)"
  patterns:
    - "AI output validation: always parse Llama 3.3 JSON through Zod before D1 write"
    - "Text chunking: 300-word chunks, 50-word overlap for bge-large-en-v1.5 (512 token limit)"
    - "Quiz security: correctOptionId stored server-side only, never exposed to client before answer submission"

key-files:
  created:
    - "worker/src/validation/content-schemas.ts — RoadmapOutputSchema, LessonOutputSchema, QuizOutputSchema Zod validators"
    - "worker/src/validation/roadmap-prompts.ts — AI system prompt builders + JSON schemas for structured output"
    - "worker/src/services/chunk-text.ts — word-based text chunker for Vectorize embedding pipeline"
    - "worker/src/db/migrations/0001_flashy_white_tiger.sql — 6 new table migration (applied locally)"
    - "apps/web/app/components/ui/sheet.tsx — Sheet component (for in-lesson Q&A bottom sheet)"
    - "apps/web/app/components/ui/progress.tsx — Progress bar (for roadmap/lesson progress)"
    - "apps/web/app/components/ui/tabs.tsx — Tabs (for roadmap detail view)"
    - "apps/web/app/components/ui/tooltip.tsx — Tooltip (for node tree labels)"
    - "apps/web/app/components/ui/badge.tsx — Badge (for XP/status chips)"
    - "apps/web/app/components/ui/scroll-area.tsx — ScrollArea (for chat message list)"
  modified:
    - "worker/src/db/schema.ts — 6 new Drizzle table definitions appended"
    - "apps/web/wrangler.jsonc — AI, Vectorize, Workflows bindings + migrations_dir added"
    - "worker/wrangler.toml — AI, Vectorize, Workflows bindings added"
    - "worker/src/types/env.d.ts — Ai, VectorizeIndex, Workflow types added to Env interface"
    - "apps/web/worker-configuration.d.ts — regenerated via wrangler types with new bindings"

key-decisions:
  - "correctOptionId is stored in quiz_questions but never returned to client before answer submission (security contract established in schema comment)"
  - "Chunk size set to 300 words (not 350) for bge-large-en-v1.5 — 390 avg tokens vs 512 limit leaves safe headroom"
  - "Vectorize index creation deferred to deployment (requires CLOUDFLARE_API_TOKEN) — bindings are configured but remote index not provisioned in this plan"
  - "shadcn CLI installed components to wrong path (~/components/ui) due to literal alias interpretation — moved to app/components/ui manually (Rule 3 auto-fix)"

patterns-established:
  - "AI validation pattern: all Llama 3.3 outputs must pass through Zod schemas before any D1 write"
  - "Prompt builder pattern: buildXxxSystemPrompt() function + ROADMAP_JSON_SCHEMA constant per generation type"
  - "Embedding chunking: chunkText(text, 300, 50) → embed each chunk → upsert to Vectorize with metadata"

requirements-completed: [CONT-06]

# Metrics
duration: 8min
completed: 2026-04-08
---

# Phase 2 Plan 01: Infrastructure Setup Summary

**D1 schema extended with 6 content pipeline tables, Zod AI output validators and prompt builders created, AI/Vectorize/Workflows bindings configured in both wrangler configs, and 6 shadcn UI components installed**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-04-08T14:00:00Z
- **Completed:** 2026-04-08T14:08:00Z
- **Tasks:** 2
- **Files modified:** 14

## Accomplishments

- Extended D1 schema with 6 new tables (chat_messages, roadmaps, lessons, lesson_completions, quizzes, quiz_questions) using consistent FK/timestamp patterns from Phase 1
- Generated and applied Drizzle migration locally (7 SQL commands, all successful)
- Created three Zod validators (RoadmapOutputSchema, LessonOutputSchema, QuizOutputSchema) and matching AI prompt builders with JSON schemas for Workers AI structured output
- Configured all three Cloudflare bindings (AI, Vectorize, Workflows) in both wrangler files, updated Env interface, regenerated worker-configuration.d.ts
- Installed 6 shadcn components and react-markdown for the Phase 2 UI surfaces

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend D1 schema, generate migration, add Zod validation schemas and AI prompt templates** - `7c9413e` (feat)
2. **Task 2: Configure Cloudflare bindings (AI, Vectorize, Workflows) and install shadcn components** - `561e26d` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `worker/src/db/schema.ts` — 6 new Drizzle table definitions for content pipeline
- `worker/src/db/migrations/0001_flashy_white_tiger.sql` — Migration with 7 CREATE TABLE statements
- `worker/src/validation/content-schemas.ts` — RoadmapOutputSchema, LessonOutputSchema, QuizOutputSchema
- `worker/src/validation/roadmap-prompts.ts` — buildRoadmapSystemPrompt, buildLessonSystemPrompt, buildQuizSystemPrompt, ROADMAP_JSON_SCHEMA, LESSON_JSON_SCHEMA, QUIZ_JSON_SCHEMA
- `worker/src/services/chunk-text.ts` — chunkText(text, chunkWords=300, overlapWords=50)
- `apps/web/wrangler.jsonc` — AI, Vectorize, Workflows bindings + migrations_dir
- `worker/wrangler.toml` — AI, Vectorize, Workflows bindings
- `worker/src/types/env.d.ts` — Ai, VectorizeIndex, Workflow added to Env
- `apps/web/worker-configuration.d.ts` — Regenerated with new bindings
- `apps/web/app/components/ui/sheet.tsx` — Sheet component
- `apps/web/app/components/ui/progress.tsx` — Progress bar
- `apps/web/app/components/ui/tabs.tsx` — Tabs
- `apps/web/app/components/ui/tooltip.tsx` — Tooltip
- `apps/web/app/components/ui/badge.tsx` — Badge
- `apps/web/app/components/ui/scroll-area.tsx` — ScrollArea

## Decisions Made

- correctOptionId is stored in quiz_questions but NEVER returned to client before answer submission — enforced by schema comment and to be enforced at API layer in Plan 02-05
- 300-word chunks chosen for bge-large-en-v1.5 embedding (not 350) — safer margin below 512-token limit (300 words ≈ 390 tokens avg)
- Vectorize remote index provisioning deferred to deployment — requires Cloudflare API token, bindings are wired for when token is available

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] shadcn CLI installed components to wrong path**
- **Found during:** Task 2 (Install shadcn components)
- **Issue:** shadcn CLI interpreted the `~/components` alias literally and created `apps/web/~/components/ui/` instead of `apps/web/app/components/ui/`
- **Fix:** Moved all 6 component files from `apps/web/~/components/ui/` to `apps/web/app/components/ui/` and removed the erroneous `~/` directory
- **Files modified:** All 6 shadcn component files
- **Verification:** `test -f apps/web/app/components/ui/sheet.tsx` and 5 others all PASS
- **Committed in:** `561e26d` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking path issue)
**Impact on plan:** Auto-fix was necessary to place components where the TypeScript `~` alias resolves correctly. No scope creep.

## Issues Encountered

- Vectorize index creation (`wrangler vectorize create`) requires `CLOUDFLARE_API_TOKEN` — skipped for now, noted in plan as required before production deployment. Local development does not require the remote index to exist.
- `npm test` requires Cloudflare auth (wrangler remote mode) — pre-existing issue from Phase 1, not caused by these changes.

## Known Stubs

None — this plan creates infrastructure (schema, validators, bindings) with no UI rendering or data flow. No stub values exist.

## Next Phase Readiness

- All schema tables ready for Workflow implementation (Plan 02-02)
- Zod schemas and prompt builders ready for ContentGenerationWorkflow steps
- Bindings configured for direct use in subsequent plans
- Vectorize remote index must be provisioned (with API token) before Plans 02-06/07 (Q&A RAG) can work remotely
- All 6 shadcn components available for Plans 02-03 through 02-08 UI work

## User Setup Required

**Vectorize remote index provisioning required before production deployment:**
```bash
# Requires CLOUDFLARE_API_TOKEN to be set
npx wrangler vectorize create mimir-lessons --dimensions=1024 --metric=cosine
npx wrangler vectorize create-metadata-index mimir-lessons --property-name=roadmapId --type=string
npx wrangler vectorize create-metadata-index mimir-lessons --property-name=userId --type=string
npx wrangler vectorize create-metadata-index mimir-lessons --property-name=lessonId --type=string
```
Local development proceeds without the remote index.

---
*Phase: 02-ai-content-pipeline*
*Completed: 2026-04-08*
