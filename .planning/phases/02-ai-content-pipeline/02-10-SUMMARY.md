---
phase: 02-ai-content-pipeline
plan: 10
subsystem: quiz-data-pipeline
tags: [gap-closure, api-alignment, quiz, data-transform]
dependency_graph:
  requires: [02-09]
  provides: [quiz-frontend-backend-alignment]
  affects: [lesson-view, practice-quiz, quiz-answer-submission]
tech_stack:
  patterns: [response-transformation, field-mapping, json-parse]
key_files:
  modified:
    - worker/src/routes/roadmaps.ts
    - apps/web/app/lib/api-client.ts
decisions:
  - Return bare array from practice quiz endpoint instead of {questions:[...]} wrapper
  - Parse optionsJson server-side so frontend receives ready-to-render arrays
  - Move questionId from request body to URL path param for submitQuizAnswer
metrics:
  duration: 97s
  completed: 2026-04-16T12:40:41Z
  tasks_completed: 2
  tasks_total: 2
  files_modified: 2
---

# Phase 02 Plan 10: Quiz Data Pipeline Gap Closure Summary

Fix backend-frontend data shape mismatches in quiz endpoints so lesson quizzes render and practice quiz loads correctly.

## One-liner

Backend quiz responses transformed to match frontend types: flat questions array with mapped field names and parsed options; frontend URLs and types aligned to actual backend routes.

## Completed Tasks

| Task | Name | Commit | Key Changes |
|------|------|--------|-------------|
| 1 | Transform backend quiz responses to match frontend types | f132481 | Lesson endpoint: flatten quiz.questions to top-level questions array, map questionText->question, questionType->type, parse optionsJson. Practice quiz: same mapping + return bare array |
| 2 | Fix frontend API client URLs and types | 3ecc30e | fetchPracticeQuiz: /quiz -> /quiz/practice. submitQuizAnswer: body questionId -> URL path param. LessonDetail: state -> isCompleted+nodeId+createdAt. QuizQuestion: remove lessonId, add order |

## Deviations from Plan

None - plan executed exactly as written.

## Key Changes Detail

### Backend (worker/src/routes/roadmaps.ts)

**Lesson endpoint (GET /:id/lessons/:lessonId):**
- Added `mappedQuestions` transform that maps DB column names to frontend-expected names
- `questionText` -> `question`, `questionType` -> `type`, `optionsJson` (string) -> `options` (parsed array)
- Response changed from `{ quiz: { id, questions } }` to `{ questions: mappedQuestions }` (flat)

**Practice quiz endpoint (GET /:id/quiz/practice):**
- Same field mapping applied to shuffled questions
- Response changed from `{ questions: shuffled }` (object) to bare array `mappedShuffled`
- Fixes the bug where `questions.length === 0` check on an object always evaluated as truthy

### Frontend (apps/web/app/lib/api-client.ts)

- `fetchPracticeQuiz` URL: `/api/roadmaps/:id/quiz` -> `/api/roadmaps/:id/quiz/practice`
- `submitQuizAnswer` URL: `/api/quiz/answer` -> `/api/roadmaps/quiz/:questionId/answer`
- `submitQuizAnswer` body: removed `questionId` (now in URL path)
- `LessonDetail` type: removed `state`, added `isCompleted`, `nodeId`, `createdAt`
- `QuizQuestion` type: removed `lessonId`, added `order`

## Verification

TypeScript compilation not run (worker tsconfig may not be available in worktree), but changes are mechanical field renames and JSON.parse additions that match existing patterns in the codebase.

## Self-Check: PASSED
