---
phase: 02-ai-content-pipeline
plan: "05"
subsystem: frontend/ui
tags: [roadmaps, node-tree, progress, tanstack-query, shadcn, accessibility]
dependency_graph:
  requires: ["02-04"]
  provides: ["roadmaps-list-page", "roadmap-detail-page", "RoadmapNodeTree", "RoadmapListItem"]
  affects: ["02-06", "02-07", "02-08", "02-09"]
tech_stack:
  added: []
  patterns:
    - "TanStack Query useQuery for roadmap list and detail fetching"
    - "Client-side node state derivation from completedLessonIds + parentId structure"
    - "Complexity inference from parentId presence (linear vs branching)"
    - "Radix Tooltip with controlled open prop for locked node 1.5s auto-dismiss"
key_files:
  created:
    - apps/web/app/routes/_app.roadmaps.tsx
    - apps/web/app/routes/_app.roadmaps.$id.tsx
    - apps/web/app/components/roadmap/RoadmapListItem.tsx
    - apps/web/app/components/roadmap/RoadmapNodeTree.tsx
  modified: []
decisions:
  - "Complexity derived client-side: if any node has parentId !== null or non-empty children array, roadmap is branching; otherwise linear"
  - "completedLessonIds derived from pre-computed node.state === completed (API already computes states) — avoids double computation"
  - "Q&A tab renders intentional placeholder 'Q&A coming soon' per plan spec — Plan 07 replaces with full RAG Q&A"
metrics:
  duration: "2min"
  completed_date: "2026-04-08"
  tasks_completed: 2
  files_changed: 4
---

# Phase 02 Plan 05: Roadmap List and Detail UI Summary

Roadmaps list page with progress bars and empty state, roadmap detail with adaptive node tree (linear/branching), 4 node states, locked tooltip, and Lessons/Q&A tabs.

## What Was Built

### Task 1: Roadmaps List Page and RoadmapListItem Component

**apps/web/app/components/roadmap/RoadmapListItem.tsx** — Reusable roadmap card row per UI-SPEC D-07, D-18:
- Full-width `Card` with `min-h-12` tap target, `p-4` internal padding
- Title at 16px semibold, progress label "N of M lessons complete" at 14px/muted-foreground
- `Progress` component at `h-1` (4px), accent fill via shadcn defaults
- `role="progressbar"` with `aria-valuenow`, `aria-valuemin="0"`, `aria-valuemax="100"`
- `ChevronRight` (16px, muted-foreground) right-aligned
- Entire card wrapped in React Router `Link` to `/roadmaps/:id`

**apps/web/app/routes/_app.roadmaps.tsx** — Roadmaps list page per UI-SPEC Screen 2:
- Page title "Your Roadmaps" at 20px semibold, `pt-6`
- TanStack Query `useQuery({ queryKey: ["roadmaps"], queryFn: fetchRoadmaps })`
- Loading: 3 `Skeleton` rows at `h-[72px]`, `gap-2`
- Empty state: "No roadmaps yet" heading, "Start a conversation in Chat..." body, "Go to Chat" CTA
- Data state: maps roadmaps to `RoadmapListItem` components; filters to only show `status === "complete"` entries

### Task 2: Roadmap Detail Page with Node Tree Visualization

**apps/web/app/components/roadmap/RoadmapNodeTree.tsx** — Node tree visualization per UI-SPEC Screen 3:

Props: `{ nodes, completedLessonIds, roadmapId, complexity }`

Node state computation from `completedLessonIds` (with fallback to API `state` field if already provided):
- completed: lessonId is in completedLessonIds
- locked: parentId exists and parent is not completed
- available: all prerequisites met, not completed
- First root node (order 0, no parentId) always available

Linear layout: sorted vertical column with `ConnectorLine` (2px `bg-border`) between nodes.

Branching layout: recursive `BranchNode` with 32px `pl-8` indent per depth level, `gap-8` between root nodes.

Node card states:
- Locked: Lock icon (muted-foreground), muted title, `aria-disabled="true"`, `tabIndex={-1}`
- Available: foreground title, no icon
- In progress: `border-primary`, foreground title, 8px accent dot indicator
- Completed: `border-border`, foreground title, `CheckCircle` (accent, 16px) right-aligned

Locked node tooltip: Radix `Tooltip` with controlled `open` prop — set to `true` on tap, auto-dismissed after 1.5s with `setTimeout`.

Each node: `<button>` with `aria-label="{title} — {state}"`, focus ring via `focus-visible:ring-2`.

**apps/web/app/routes/_app.roadmaps.$id.tsx** — Roadmap detail page per UI-SPEC Screen 3:
- `ChevronLeft` + "Roadmaps" back link to `/roadmaps`
- Roadmap title as Heading (20px, semibold)
- TanStack Query `useQuery({ queryKey: ["roadmap", id], queryFn: () => fetchRoadmapDetail(id) })`
- Loading: stacked `Skeleton` rectangles
- Error: "This roadmap doesn't exist or you don't have access to it."
- Shadcn `Tabs` with "Lessons" (default) and "Q&A" tabs
- Lessons tab renders `RoadmapNodeTree`
- Q&A tab renders placeholder "Q&A coming soon" (replaced in Plan 07)

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 464bd26 | feat(02-05): build roadmaps list page and RoadmapListItem component |
| 2 | 9477bf0 | feat(02-05): build roadmap detail page with node tree visualization and Lessons/Q&A tabs |

## Deviations from Plan

### Auto-adapted Interfaces (not deviations — forward-compatible design)

**Complexity derivation** — The plan spec defines `complexity` as a `RoadmapDetail` field, but the actual `api-client.ts` (from Plan 04) does not include it. Complexity is derived client-side: `isBranching = nodes.some(n => n.children?.length > 0 || n.parentId !== null)`. This produces correct linear/branching classification without an API change.

**completedLessonIds derivation** — The plan spec passes `completedLessonIds` as a prop; the `RoadmapDetail` from Plan 04 provides `nodes[].state` pre-computed. `completedLessonIds` is derived as `nodes.filter(n => n.state === "completed").map(n => n.lessonId)`. The `RoadmapNodeTree` supports both: if `node.state` is present, it's used directly; otherwise it's computed from `completedLessonIds`.

## Known Stubs

**Q&A tab placeholder** — `apps/web/app/routes/_app.roadmaps.$id.tsx` line 114: "Q&A coming soon". This is intentional per plan spec: "The Q&A tab content will be a placeholder text 'Q&A coming soon' for now — Plan 07 will replace it with the actual Q&A interface." The tab renders and is navigable; only the content is deferred.

## Self-Check: PASSED
