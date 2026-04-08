---
phase: 02-ai-content-pipeline
plan: "07"
subsystem: ui
tags: [react, shadcn, tanstack-query, vectorize, rag, qa, citations, lucide, tailwind]

# Dependency graph
requires:
  - phase: 02-ai-content-pipeline
    provides: "api-client.ts with askQuestion, QAResponse (citations array)"
  - phase: 02-ai-content-pipeline
    provides: "shadcn components: Sheet, ScrollArea, Input, Button"
  - phase: 02-ai-content-pipeline
    provides: "roadmap detail page with Lessons/Q&A tabs placeholder"
  - phase: 02-ai-content-pipeline
    provides: "lesson page with Ask AI stub button"
provides:
  - QAThread: reusable scrollable Q&A conversation with citation links, typing indicator, error state
  - InLessonQASheet: bottom sheet (60vh) wrapping QAThread for in-lesson Q&A
  - Roadmap Q&A tab content: full-roadmap RAG Q&A replacing placeholder
  - Lesson Ask AI wiring: opens InLessonQASheet replacing Coming soon toast
affects: [03-gamification, 04-multiplayer]

# Tech tracking
added:
  - apps/web/app/components/qa/QAThread.tsx — reusable Q&A thread component
  - apps/web/app/components/qa/InLessonQASheet.tsx — bottom sheet wrapper

patterns:
  - Citation rendering: regex split on [Lesson N: Title] pattern against citations array; inline <a> with onCitationClick callback
  - Sheet close-then-navigate: onCitationClick closes sheet first, navigation executes after 160ms sheet animation
  - QAThread height: flex-col h-full with ScrollArea flex-1 min-h-0 and fixed input bar
  - InLessonQASheet height: h-[60vh] via SheetContent className override

# Key files
created:
  - apps/web/app/components/qa/QAThread.tsx
  - apps/web/app/components/qa/InLessonQASheet.tsx

modified:
  - apps/web/app/routes/_app.roadmaps.$id.tsx
  - apps/web/app/routes/_app.roadmaps.$id.lessons.$lessonId.tsx

# Key decisions
decisions:
  - QAResponse uses citations (not sources) array with lessonId/lessonTitle/lessonOrder — matched actual api-client.ts interface
  - Citation navigation: onCitationClick callback closes sheet first then navigate after 160ms — prevents sheet flash during route change
  - QAThread uses RadixUI ScrollArea with data-radix-scroll-area-viewport selector for auto-scroll-to-bottom
  - InLessonQASheet suppresses Radix SheetContent built-in close button via p-0 override; custom header added
  - Roadmap Q&A tab height: h-[calc(100vh-12rem)] so QAThread fills remaining viewport below tab bar

# Metrics
duration: "3min"
completed: "2026-04-08"
tasks_completed: 2
files_created: 2
files_modified: 2
---

# Phase 02 Plan 07: RAG Q&A Experience Summary

**One-liner:** Vectorize-backed Q&A with citation links via reusable QAThread component wired into lesson bottom sheet and roadmap detail tab.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Build QAThread component and InLessonQASheet | fd0e682 | QAThread.tsx, InLessonQASheet.tsx |
| 2 | Wire Q&A into roadmap detail tab and lesson page | fba432e | _app.roadmaps.$id.tsx, _app.roadmaps.$id.lessons.$lessonId.tsx |

## What Was Built

### QAThread (`apps/web/app/components/qa/QAThread.tsx`)

Reusable Q&A conversation component that:
- Accepts `roadmapId`, optional `lessonId`, `placeholder`, `emptyText`, and `onCitationClick` props
- Calls `askQuestion()` from api-client on send (Enter or button click)
- Renders user messages right-aligned (`bg-foreground/8`) and AI messages left-aligned (`bg-card`), matching buddy chat bubble style
- Shows 3-dot bouncing typing indicator while waiting
- Parses `[Lesson N: Title]` patterns from answer text and renders them as `text-primary` inline links
- Also renders a citation tag list below each answer using the `citations` array from `QAResponse`
- Error state: AI bubble with `border-destructive` and "Couldn't retrieve an answer. Try rephrasing your question."
- Empty state: centered `emptyText` prop with muted foreground
- Auto-scrolls to bottom on new message using `data-radix-scroll-area-viewport` selector

### InLessonQASheet (`apps/web/app/components/qa/InLessonQASheet.tsx`)

Bottom sheet wrapper for in-lesson Q&A:
- `side="bottom"`, `h-[60vh]` — 60% viewport height per UI-SPEC
- `role="dialog"`, `aria-label="Lesson Q&A"`, `aria-modal="true"` for accessibility
- Focus management: auto-focuses the question input on open via `[aria-label="Question input"]` selector
- `onCitationClick` handler closes the sheet then navigates to cited lesson after 160ms animation delay

### Roadmap Detail Q&A Tab (`_app.roadmaps.$id.tsx`)

- Replaced `Q&A coming soon` placeholder with `<QAThread roadmapId={roadmap.id} placeholder="Ask about this roadmap..." emptyText="Ask anything about your {title} content." />`
- No `lessonId` — scopes to entire roadmap per QNA-02 / D-14
- Tab height: `h-[calc(100vh-12rem)]` so QAThread fills remaining viewport

### Lesson Page Sheet Wiring (`_app.roadmaps.$id.lessons.$lessonId.tsx`)

- Added `const [qaOpen, setQaOpen] = useState(false)`
- `handleAskAI` now calls `setQaOpen(true)` instead of `toast.info("Coming soon")`
- Added stable `id="ask-ai-btn"` on Ask AI button for focus return
- `<InLessonQASheet open={qaOpen} onOpenChange={setQaOpen} roadmapId={roadmapId} lessonId={lessonId} />` rendered conditionally when IDs are defined

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Used actual QAResponse interface (citations not sources)**

- **Found during:** Task 1
- **Issue:** The plan interface spec showed `sources` with `{ lessonId, title, displayText }`, but the actual `api-client.ts` interface uses `citations` with `{ lessonId, lessonTitle, lessonOrder }`.
- **Fix:** Implemented against the actual `QAResponse` interface. Citation display text is built as `[Lesson N: Title]` using `lessonOrder` and `lessonTitle`. The `onCitationClick` callback is added to handle close-then-navigate.
- **Files modified:** `QAThread.tsx`, `InLessonQASheet.tsx`
- **Commit:** fd0e682

## Known Stubs

None — all Q&A wiring is complete. The `/api/qa/ask` endpoint returns real data from Vectorize (implemented in Plan 04).

## Self-Check: PASSED

- [x] `apps/web/app/components/qa/QAThread.tsx` exists
- [x] `apps/web/app/components/qa/InLessonQASheet.tsx` exists
- [x] Commits fd0e682 and fba432e exist in git log
- [x] TypeScript check passes (`tsc --noEmit` clean)
- [x] All 9 verification assertions pass
