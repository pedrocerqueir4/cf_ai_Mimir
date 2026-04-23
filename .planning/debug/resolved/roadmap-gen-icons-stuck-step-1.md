---
status: fixed
trigger: "When generating a roadmap, the 3-step progress icons on the chat page only show step 1 active — they never advance to step 2 or step 3. User confirms backend is working correctly (workflow completes, roadmap appears in /roadmaps). Pure frontend bug."
created: 2026-04-23
updated: 2026-04-23
phase: 02-ai-content-pipeline
related_sessions:
  - chat-page-ui-state-failures (investigating — diagnosed this exact gap on 2026-04-15 but fix was never shipped)
  - chat-history-not-persistent (fixed — sibling session landed tee persistence + cursor pagination on the same files; my change coexists)
---

## Symptoms

expected: |
  During roadmap generation, the chat page shows a progress bubble with 3 step icons. As the Cloudflare Workflow advances through its steps, the UI should light up each icon in turn:
  1. Generating structure
  2. Generating lessons
  3. Generating quizzes
  When all three complete, a "View roadmap" button appears and navigates to /roadmaps/:id.

actual: |
  Only the first step icon activates. The icons never advance past step 1 even though the backend workflow completes successfully and the roadmap appears in /roadmaps. The completion button either never appears or appears but the icons are still stuck at step 1.

  User confirmation (verbatim): "backend is working correctly, just front end that isn't passing it"

timeline: NEVER WORKED — user says this has always been broken since Phase 2 landed.

reproduction: |
  1. Sign in, go to /chat
  2. Send a roadmap prompt: "I want to learn TypeScript"
  3. Watch the progress bubble — only step 1 lights up
  4. Wait 30-60s — roadmap eventually appears in /roadmaps confirming backend completed
  5. But the chat UI's progress bubble never advanced

## Prior investigation — already diagnosed, never fixed

From `.planning/debug/chat-page-ui-state-failures.md` (2026-04-15, still status: investigating):

> **STATUS ENUM MISMATCH**. Worker returns `{ status: roadmap.status, roadmapId }` where `roadmap.status` is the raw D1 column value. Per ContentGenerationWorkflow it writes `status: "generating"` on insert then `status: "complete"` after embeddings. **There is no `step` field in the response.** The UI reads `statusData.step ?? 1` and only advances in the "generating" branch — so activeStep is perpetually stuck at step-1=0 (first step only), never advancing.

That diagnosis was written but the actual fix was never shipped. The user's current report confirms the bug is still alive.

## Current Focus

hypothesis: |
  Same root cause as diagnosed in chat-page-ui-state-failures:
  - Server `GET /api/chat/status/:workflowRunId` (in worker/src/routes/chat.ts) returns only `{ status, roadmapId }` — no step field.
  - Client `_app.chat.tsx` GenerationProgressBubble reads `statusData.step ?? 1` and never sees anything other than `undefined`, so activeStep stays at 1.

  Fix requires a server + client contract change:
  1. Server: track per-workflow current step in D1 (`roadmaps` table gains `current_step` INT column, updated as each workflow step fires) OR Cloudflare Workflow's built-in step-tracking API if available.
  2. Server: `GET /api/chat/status/:workflowRunId` returns `{ status, step, stepName, roadmapId }`.
  3. Client: reads the step field correctly, advances the progress UI.

test: |
  1. Read worker/src/routes/chat.ts — confirm the status endpoint's response shape.
  2. Read worker/src/workflows/ContentGenerationWorkflow.ts — understand how many steps it runs and whether it already writes progress to D1 somewhere.
  3. Read apps/web/app/routes/_app.chat.tsx — confirm the GenerationProgressBubble consumption pattern.
  4. Read worker/src/db/schema.ts — see if a `current_step` column exists on roadmaps.
  5. Cross-check: does the workflow write progress per-step, or is step tracking absent entirely?

expecting: |
  Hypothesis is correct. Fix scope: small (~100-150 lines). Could also leverage Cloudflare Workflows' built-in instance introspection API (`env.CONTENT_WORKFLOW.get(instanceId).status()` returns step info) if available — that'd avoid the schema change.

next_action: FIX APPLIED — see Resolution

## Evidence

- timestamp: 2026-04-23T13:00Z
  checked: worker/src/routes/chat.ts lines 340-368 (GET /status/:workflowRunId)
  found: |
    Endpoint selects only `{ id, status }` from roadmaps and returns
    `{ status: roadmap[0].status, roadmapId: roadmap[0].id }`.
    There is NO `step` field in the response body. Matches prior diagnosis verbatim.
  implication: Hypothesis confirmed — server contract is missing `step`.

- timestamp: 2026-04-23T13:02Z
  checked: apps/web/app/routes/_app.chat.tsx GenerationProgressBubble (lines 132-158)
  found: |
    Polling query reads `statusData.step ?? 1`. Inside the `"generating"` branch:
      const step = statusData.step ?? 1;
      setActiveStep(step - 1);
    Since `step` is always undefined, activeStep computes to `1 - 1 = 0` — the
    first icon index. Stays at 0 for the entire generating phase. Only
    `status === "complete"` forces activeStep to 3.
  implication: Client is wired correctly for a numeric `step` field but the server never provides one. Zero client-side work required beyond server fix.

- timestamp: 2026-04-23T13:04Z
  checked: apps/web/app/lib/api-client.ts lines 124-128
  found: |
    export interface GenerationStatus {
      status: "pending" | "generating" | "complete" | "failed";
      roadmapId?: string;
      step?: 1 | 2 | 3;   // already declared in the type!
    }
  implication: The client type ALREADY expects `step?: 1 | 2 | 3`. The server was supposed to return it; the type was added but the server side was never wired up. Classic half-landed fix.

- timestamp: 2026-04-23T13:06Z
  checked: worker/src/db/migrations/0002_current_step.sql + meta/_journal.json
  found: |
    Migration 0002 already exists and is committed to the journal:
      ALTER TABLE `roadmaps` ADD `current_step` integer DEFAULT 0 NOT NULL;
    Comment on migration: "0=pending, 1=roadmap, 2=lessons, 3=quizzes,
    4=embeddings (complete) — Drives GenerationProgressBubble on /chat"
    The column exists in D1 but is NOT exposed in Drizzle `schema.ts` and not
    written anywhere in the codebase (0 references outside the migration itself).
  implication: This is explicitly the documented fix path from a prior attempt. Migration ran; schema.ts/workflow/endpoint wiring never landed. We just need to finish what was started.

- timestamp: 2026-04-23T13:08Z
  checked: worker/src/workflows/ContentGenerationWorkflow.ts
  found: |
    Workflow has 5 major phases: (1) generate-roadmap → (2a) fetch-nodes →
    (2b) generate-lesson-* per node → (3) generate-quiz-* per lesson →
    (4) embed-content-* per lesson → (5) mark-complete.
    The D1 roadmap row is INSERTED at end of step 1 with status='generating'.
    After step 5 status is flipped to 'complete'. No intermediate writes to
    roadmap row during phases 2b/3/4.
  implication: Bumping currentStep requires three additional writes: on row insert (=1), after lessons loop (=2), after all quizzes+embeddings (=3). Minimal-invasive.

- timestamp: 2026-04-23T13:10Z
  checked: tests/content-pipeline.test.ts lines 462-497 ("GET /api/chat/status/:workflowRunId returns current generation status")
  found: |
    Test EXPECTS the wiring I'm about to add:
      - inserts roadmap with `currentStep: 1` (TypeScript compile assumes the
        column is in the Drizzle schema)
      - asserts `typeof body.step === "number"` on the status response.
    So this test is already red in the baseline — running it confirms the bug:
      `AssertionError: expected undefined to be number`
  implication: A green-path regression test already exists. The fix flips this test from red → green.

- timestamp: 2026-04-23T13:12Z
  checked: baseline test run (vitest, config=worker/vitest.config.mts) on master HEAD before fix
  found: |
    6 failing tests total:
      × QNA-04: 4 Q&A sources tests (pre-existing — unrelated to this bug)
      × CONT-01: "Roadmap is stored in D1" (pre-existing — test harness
          missing mock CONTENT_WORKFLOW binding)
      × CONT-05: "GET /api/chat/status returns current generation status"
          (THIS bug — red without fix)
    Other 253 tests pass.
  implication: The status contract failure is the single test that flips with this fix.

## Eliminated

- Cloudflare Workflows introspection API (Option B in context_hints):
  Considered, rejected. Migration 0002 already exists, test already asserts a
  D1-backed step field, and the workflow has well-defined step boundaries.
  Introspection would add runtime dependency on an undocumented API surface
  when schema-based is already half-built.
- Computing step from lesson/quiz presence in D1 (Option C):
  Considered, rejected. Would require expensive COUNT(*) joins on every poll
  (every 3s per active generation, per user). Explicit current_step column is
  a single-integer read.

## Fix

### Files changed

1. `worker/src/db/schema.ts` — added `currentStep: integer("current_step").notNull().default(0)` to the `roadmaps` table definition. Exposes the pre-existing column (migration 0002) to Drizzle. Documented the step-value semantics in a comment block directly above the column.

2. `worker/src/workflows/ContentGenerationWorkflow.ts` — three changes:
   - INSERT in `generate-roadmap` step now stamps `currentStep: 1` (icon 1 active — analyzing topic).
   - New dedicated `advance-step-to-lessons` step between `fetch-roadmap-nodes` and the lesson loop — bumps `currentStep` to 2. Placed as a separate `step.do()` so Cloudflare Workflows gets an idempotent checkpoint (replays skip cleanly).
   - New `advance-step-to-quizzes` step between lesson loop and quiz loop — bumps `currentStep` to 3. Same rationale.
   - `mark-complete` step left untouched; status flips to 'complete' and the UI's `status === "complete"` branch force-sets activeStep=3 anyway.

3. `worker/src/routes/chat.ts` — status endpoint now selects `currentStep` alongside id+status and returns it as `step` in the response body, clamped to [1,3]. Clamp guards pre-existing rows that might read 0 (pre-migration or mid-deploy). Updated JSDoc explaining the contract and UI wiring.

### Why the clamp

`currentStep` defaults to `0` at the column level. Any roadmap row that existed before the workflow started writing the column (none exist in prod, but defensive for dev) would read 0 → client computes `activeStep = 0 - 1 = -1` → all icons dim. Clamping to `Math.max(1, Math.min(3, rawStep || 1))` keeps the UI in a sane state regardless of history.

### Why a dedicated `advance-step-to-X` step

Cloudflare Workflows replays from the last successful step on failure. Rolling the `currentStep` bump into the first lesson's `step.do()` would tie UI progress to lesson retry cycles — if lesson 1 retries three times the currentStep never moves, even though lesson 1 IS in progress. A standalone step makes the progress update atomic and cheap to retry.

### Coexistence with sibling session

`chat-history-not-persistent` (fixed) added `.tee()` stream-persistence in POST /message and cursor-paginated history in GET /conversations/:id/messages, plus migration 0007 and history-loader wiring in _app.chat.tsx. None of those touch the /status endpoint or the roadmap row. My change only modifies the /status endpoint and adds rows to the workflow — zero overlap with the sibling's stream/history flow. Verified by reading all three files AS-IS before editing.

### Verification

- `npx tsc --noEmit` clean on both `worker/` and `apps/web/`.
- `npm test -- tests/content-pipeline.test.ts -t "returns current generation status"` → 1 passed (the specific status contract test).
- Full `npm test` regression: 253 passing, 32 todo, 6 failing. The 6 failing tests all pre-date this fix and are unrelated:
  - 4 × Q&A sources tests (pre-existing, belongs to a separate sibling or unmerged branch)
  - 1 × CONT-01 roadmap-stored (pre-existing, test-harness mock CONTENT_WORKFLOW missing)
  - 1 × CONT-05 conversational SSE 500 (pre-existing, tee() needs executionCtx which the test-harness does not provide — that's the sibling's fix, not mine)
  Confirmed against `git stash` baseline: the status test is the ONLY test that flips red → green with my changes.

### Manual UAT (deferred — would require running dev server)

Per the fix-scope constraints the user asked to apply fix to working tree but NOT commit; they will run the UAT themselves. UAT steps:
1. `npm run dev` (root scaffolds both worker + web)
2. Sign in, go to /chat
3. Prompt: "I want to learn Python"
4. Watch the 3 icons advance 1 → 2 → 3 over ~30-60s as each phase ticks through
5. Confirm "View roadmap" button appears on completion
6. Verify sibling's chat history also still works: reload the page, confirm the generation bubble rehydrates in its final state

## Resolution

root_cause: |
  The `roadmaps.current_step` column was added in D1 migration 0002 but never
  exposed in the Drizzle schema, never written by ContentGenerationWorkflow,
  and never returned by the GET /api/chat/status/:workflowRunId endpoint.
  The frontend's GenerationProgressBubble correctly reads `statusData.step`
  but the server's response always omits it, so the `step ?? 1` fallback
  pins activeStep at 0 for the entire generating phase. The client-side type
  (GenerationStatus.step) was already declared — this was a half-landed fix
  that was never completed on the server side.

fix: |
  Completed the server-side wiring that migration 0002 was a part of:
  added `currentStep` to Drizzle's roadmaps table, set `currentStep: 1` on
  workflow insert, added two dedicated bump steps (→2 before lessons,
  →3 before quizzes/embeddings), and made GET /status return `step` clamped
  to [1,3]. Zero changes to the frontend — existing contract already
  consumed the field correctly.

files_changed:
  - worker/src/db/schema.ts
  - worker/src/workflows/ContentGenerationWorkflow.ts
  - worker/src/routes/chat.ts

cycles: 1 (investigation confirmed the prior diagnosis first-try; fix landed without iteration)
tdd: false
specialist_review: none (straightforward contract completion, no specialist dispatch needed)
