---
phase: 02-ai-content-pipeline
plan: "06"
subsystem: ui
tags: [react, react-markdown, tanstack-query, lucide, shadcn, tailwind, quiz, lesson, markdown]

# Dependency graph
requires:
  - phase: 02-ai-content-pipeline
    provides: "api-client.ts with fetchLesson, submitQuizAnswer, completeLesson, fetchPracticeQuiz"
  - phase: 02-ai-content-pipeline
    provides: "shadcn components: Card, Button, Separator, Skeleton, Sonner"
provides:
  - LessonContent component renders AI-generated Markdown safely via react-markdown
  - QuizQuestion component with instant feedback, accent/destructive borders, a11y attributes
  - Lesson view page with reading content + inline Knowledge Check quiz + completion flow
  - Practice quiz page with randomized questions, score summary, retry capability
affects: [02-07, 03-gamification, 04-multiplayer]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - QuizQuestion uses local state machine (idle → submitting → answered) for instant feedback without optimistic update complexity
    - Lesson completion calls completeLesson() then invalidates roadmap query to refresh node tree states
    - Practice quiz shuffles question indices on mount and on retry rather than shuffling the questions array
    - "Finish lesson" CTA transitions to quizFinished state which reveals "Complete lesson" — avoids conflating quiz navigation with lesson completion

key-files:
  created:
    - apps/web/app/components/lesson/LessonContent.tsx
    - apps/web/app/components/lesson/QuizQuestion.tsx
    - apps/web/app/routes/_app.roadmaps.$id.lessons.$lessonId.tsx
    - apps/web/app/routes/_app.roadmaps.$id.quiz.tsx
  modified: []

key-decisions:
  - "QuizQuestion uses a 3-phase state machine (idle/submitting/answered) to batch option locking + feedback rendering atomically — avoids race between API response and UI state"
  - "Finish lesson CTA sets quizFinished boolean rather than directly completing — separates quiz navigation from lesson completion semantics"
  - "Ask AI button shows toast('Coming soon') — Plan 07 replaces with bottom sheet; button presence required by plan spec"

patterns-established:
  - "Pattern: quiz feedback state machine — idle→submitting→answered prevents double-submit and ensures pointer-events-none before API resolves"

requirements-completed:
  - CONT-03
  - CONT-04
  - UX-02

# Metrics
duration: 3min
completed: 2026-04-08
---

# Phase 02 Plan 06: Lesson View and Practice Quiz Summary

**Lesson view with react-markdown rendering, instant quiz feedback using accent/destructive border states, and standalone practice quiz with score summary and retry**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-08T14:28:59Z
- **Completed:** 2026-04-08T14:32:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- LessonContent safely renders AI-generated Markdown (h2/h3/p/ul/ol/code/pre) via react-markdown with no dangerouslySetInnerHTML
- QuizQuestion delivers instant per-question feedback: correct=accent border+CheckCircle, wrong=destructive border+XCircle; correct option also gets accent border when wrong; role="alert" announces outcome to screen readers
- Lesson view page chains reading content into Knowledge Check quiz with Next question/Finish lesson/Complete lesson flow; invalidates roadmap query on completion
- Practice quiz provides standalone reinforcement mode with randomized questions, progress indicator, and score summary ("{X} of {M} correct") with Try again and Back to roadmap CTAs

## Task Commits

Each task was committed atomically:

1. **Task 1: Build quiz question component and lesson content renderer** - `4078dde` (feat)
2. **Task 2: Build lesson view page and practice quiz page** - `5f08e3c` (feat)

## Files Created/Modified

- `apps/web/app/components/lesson/LessonContent.tsx` - Markdown renderer via react-markdown; 680px max-width, px-6 mobile padding, prose-like className overrides
- `apps/web/app/components/lesson/QuizQuestion.tsx` - Reusable quiz question with idle/submitting/answered state machine, instant feedback, accessibility attributes
- `apps/web/app/routes/_app.roadmaps.$id.lessons.$lessonId.tsx` - Lesson view page (Screen 4): header, LessonContent, Knowledge Check quiz section, fixed Ask AI footer
- `apps/web/app/routes/_app.roadmaps.$id.quiz.tsx` - Practice quiz page (Screen 5): randomized questions, progress indicator, score summary, empty state

## Decisions Made

- QuizQuestion uses a 3-phase state machine (idle → submitting → answered) to atomically lock options and render feedback; prevents double-submit race conditions
- "Finish lesson" CTA sets `quizFinished` boolean (not directly completeLesson) to cleanly separate quiz navigation from the completion side-effect
- Ask AI button shows `toast.info("Coming soon")` as a stub — Plan 07 replaces this with the in-lesson Q&A bottom sheet; button presence required by plan spec

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

- `apps/web/app/routes/_app.roadmaps.$id.lessons.$lessonId.tsx` line 129: `toast.info("Coming soon")` for the "Ask AI" button — intentional per plan spec ("the button must be present... show a toast 'Coming soon' on click"). Plan 07 will wire the bottom sheet.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Lesson view and practice quiz UI complete; ready for Plan 07 (in-lesson Q&A bottom sheet)
- `QuizQuestion` component is reusable and exported — multiplayer quiz battles (Phase 4) can import it directly
- `LessonContent` is decoupled from data fetching — can be reused in any context that supplies a Markdown string

---
*Phase: 02-ai-content-pipeline*
*Completed: 2026-04-08*
