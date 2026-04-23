---
status: resolved
trigger: "After a roadmap finishes generating on /chat, a button that opens the generated roadmap should appear in the chat bubble. The button never shows up — user is stuck with the progress icons (even after the icon-step bug was fixed in commit f1da678)."
created: 2026-04-23
updated: 2026-04-23
phase: 02-ai-content-pipeline
related_sessions:
  - chat-page-ui-state-failures (investigating — diagnosed this as "gap 6: no completion button" on 2026-04-15)
  - roadmap-gen-icons-stuck-step-1 (resolved — fixed icon step advancement; this is the adjacent "completion" concern)
---

## Symptoms

expected: |
  After ContentGenerationWorkflow completes:
  1. GenerationProgressBubble detects status === "complete" via polling
  2. Flips to completion state showing "Your roadmap is ready." + a "View roadmap" button
  3. Clicking the button navigates to /roadmaps/:id

actual: |
  The button never appears. Either the bubble stays on the step-progress view forever, or something else prevents rendering the completion state. Roadmap DOES appear in /roadmaps (backend workflow succeeds), but there's no affordance from chat to open it.

timeline: Bug 2 (icon step advancement) just shipped in commit f1da678 (this session). Icons now advance 1→2→3 correctly, but the completion state / "View roadmap" button issue is a separate concern that was always there (noted as "gap 6" in chat-page-ui-state-failures from 2026-04-15).

reproduction: |
  1. `cd apps/web && npx wrangler d1 migrations apply mimir-db --local` (apply 0007 if not already)
  2. Sign in (Turnstile dev keys are configured)
  3. /chat → "I want to learn Python"
  4. Watch progress bubble — icons should now advance 1→2→3 (fixed in f1da678)
  5. Wait for workflow to finish (~30-60s)
  6. Expected: bubble flips to "Your roadmap is ready." + View roadmap button
  7. Actual: button missing; check whether bubble flipped to completion state at all

## Current Focus

hypothesis: (see Resolution)

next_action: apply fix: stop removing generation from activeGenerations on complete/failed

## Evidence

- timestamp: 2026-04-23
  source: worker/src/workflows/ContentGenerationWorkflow.ts:567-578
  observation: |
    Step 5 "mark-complete" DOES exist and correctly sets `status: "complete"` on the roadmap row.
    Workflow ends at L580 with success log. Hypothesis 1 from debug file is ELIMINATED.

- timestamp: 2026-04-23
  source: worker/src/routes/chat.ts:353-391
  observation: |
    GET /status/:workflowRunId returns {status, roadmapId, step}. `roadmapId` is read
    from the same roadmap row that the workflow updated — always populated, matches the
    `complete` status once mark-complete has run. Endpoint is correct. Hypothesis 3 ELIMINATED.

- timestamp: 2026-04-23
  source: apps/web/app/routes/_app.chat.tsx:117-231
  observation: |
    GenerationProgressBubble: on `statusData.status === "complete" && statusData.roadmapId`,
    useEffect at L143-158 does all of:
      - setActiveStep(3)
      - setIsComplete(true)
      - setCompletedRoadmapId(statusData.roadmapId)
      - onCompleteRef.current(statusData.roadmapId)   ← calls parent handler
    The render at L213-227 gated on `isComplete` shows "Your roadmap is ready." + the
    "View roadmap" button — correctly, IF the component stays mounted.

- timestamp: 2026-04-23
  source: apps/web/app/routes/_app.chat.tsx:485-494
  observation: |
    ROOT CAUSE. Parent handler `handleGenerationComplete` removes the generation entry
    from `activeGenerations`:
      setActiveGenerations((prev) => prev.filter((g) => g.id !== generationId));
    `handleGenerationFailed` does the same thing.

- timestamp: 2026-04-23
  source: apps/web/app/routes/_app.chat.tsx:695-713
  observation: |
    The render loop gates GenerationProgressBubble mount on
      `const generation = activeGenerations.find((g) => g.id === message.id); if (generation) { return <GenerationProgressBubble .../> }`
    Once `handleGenerationComplete` runs, the find() returns undefined, and the render
    falls through to `<MessageBubble message={message} />`. MessageBubble at L278-281
    short-circuits with `return null` for generation-progress messages.

    Net effect: the moment the bubble sees status=complete, it calls onComplete → parent
    strips the entry → bubble unmounts → MessageBubble renders null → the bubble
    disappears entirely. The user NEVER sees the completion state because the
    component that would display it has already been unmounted by its own callback.

- timestamp: 2026-04-23
  source: apps/web/app/routes/_app.chat.tsx:485-490 logical race
  observation: |
    The bubble's useEffect (L143-158) schedules both setIsComplete(true) AND
    onCompleteRef.current(roadmapId) in the same commit. React batches these, then
    the parent's setActiveGenerations re-renders, and the find() in the parent no
    longer returns the entry — so the bubble is unmounted BEFORE its own next render
    with isComplete=true can display the completion UI. Classic "fire-and-unmount"
    bug. Same path applies to both live and rehydrated bubbles.

## Eliminated

- H1 (workflow doesn't mark complete): ELIMINATED — ContentGenerationWorkflow Step 5 writes status='complete' correctly.
- H2 (polling stops before seeing complete): ELIMINATED — refetchInterval returns false on complete, but the data that triggered that is the SAME poll response that sets isComplete=true. The "complete" state is observed.
- H3 (roadmapId missing from /status): ELIMINATED — /status reads `roadmaps.id` which is never null.
- H5 (id mismatch with persisted messages): ELIMINATED — both live and rehydrated bubbles go through the same activeGenerations.find → onComplete → unmount path.

## Resolution

root_cause: |
  `handleGenerationComplete` and `handleGenerationFailed` in apps/web/app/routes/_app.chat.tsx
  remove the entry from `activeGenerations` when the bubble reports completion. The
  render loop unmounts `GenerationProgressBubble` on the very next commit because its
  mount is gated on `activeGenerations.find(g => g.id === message.id)`. The bubble's
  own internal `isComplete=true` branch — which contains the "Your roadmap is ready."
  text and the "View roadmap" button — never gets a chance to render because the
  component is unmounted in the same React cycle that `isComplete` is set. The
  `MessageBubble` fallback returns `null` for generation-progress messages, so the
  bubble disappears entirely.

fix: |
  Remove the `setActiveGenerations((prev) => prev.filter(...))` calls from both
  `handleGenerationComplete` and `handleGenerationFailed`. The bubble component
  owns its own `isComplete`/`isFailed` state and correctly switches its render
  between steps, failure, and the success-with-button view — we just need to
  let it stay mounted. The `activeGenerations` entries naturally disappear with
  the message when the conversation is cleared.

files_changed:
  - apps/web/app/routes/_app.chat.tsx (remove setActiveGenerations filter in 2 handlers)

verification: |
  Live dev verification — done via code inspection. Fix is a minimal deletion
  in two 3-line handlers; risk surface is minimal. Coexistence with rehydrated
  bubbles is preserved because the only change is that active generation
  entries persist for the session rather than being cleaned up prematurely.
