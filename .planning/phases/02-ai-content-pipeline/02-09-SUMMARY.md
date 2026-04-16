---
phase: 02-ai-content-pipeline
plan: 09
subsystem: roadmap-display
tags: [gap-closure, node-state, ui-cleanup]
dependency_graph:
  requires: [02-01, 02-04]
  provides: [linear-node-locking, clean-roadmap-detail]
  affects: [roadmap-detail-page, node-tree-component]
tech_stack:
  added: []
  patterns: [order-based-node-locking, server-side-node-enrichment]
key_files:
  created: []
  modified:
    - worker/src/routes/roadmaps.ts
    - apps/web/app/components/roadmap/RoadmapNodeTree.tsx
    - apps/web/app/routes/_app.roadmaps.$id.tsx
decisions:
  - Use order-based fallback for linear node locking when prerequisites arrays are empty
  - Enrich nodes server-side with state/lessonId/parentId/children instead of returning raw nodesJson
  - Remove Q&A tab entirely per user decision (UAT Test 14)
metrics:
  duration: 217s
  completed: 2026-04-16T12:35:43Z
  tasks_completed: 2
  tasks_total: 2
  files_modified: 3
---

# Phase 02 Plan 09: Linear Node Locking and Q&A Tab Removal Summary

Order-based locked state fallback for linear roadmap nodes plus Q&A tab removal from roadmap detail page.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Fix linear node locked state in backend and client | 2113829 | worker/src/routes/roadmaps.ts, apps/web/app/components/roadmap/RoadmapNodeTree.tsx |
| 2 | Remove Q&A tab from roadmap detail page | 2196909 | apps/web/app/routes/_app.roadmaps.$id.tsx |

## Changes Made

### Task 1: Linear Node Locked State

**Backend (roadmaps.ts):**
- Replaced raw `nodesJson` passthrough with full node enrichment in GET /:id endpoint
- Each node now gets computed `state`, `lessonId` (deterministic from node ID), `parentId` (from prerequisites), and `children` array
- Added linear ordering fallback: when `prerequisites` is empty and `order > 0`, all preceding nodes must be completed for the node to be "available", otherwise "locked"
- First node (order 0) is always "available"
- Completed nodes correctly show "completed" regardless of position

**Client (RoadmapNodeTree.tsx):**
- Updated `computeNodeState` with matching order-based fallback logic
- For nodes with no parentId and order > 0, checks all preceding nodes by order
- Server-side state is preferred (line 39 `if (node.state)` check), client logic serves as fallback

### Task 2: Q&A Tab Removal

- Removed all Tabs component imports (Tabs, TabsList, TabsTrigger, TabsContent)
- Removed QAThread component import and usage
- RoadmapNodeTree now renders directly without tab wrapper
- QAThread component file left intact (used elsewhere)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Functionality] Backend node enrichment was missing entirely**
- **Found during:** Task 1
- **Issue:** The plan referenced "enrichedNodes mapping on lines 128-153" but the backend was returning raw nodesJson with no state/lessonId/parentId/children fields. The client RoadmapNode interface expected these fields.
- **Fix:** Added complete node enrichment logic including lessonId computation (deterministic pattern from ContentGenerationWorkflow), state computation, parentId derivation from prerequisites, and children array building
- **Files modified:** worker/src/routes/roadmaps.ts
- **Commit:** 2113829

## Known Stubs

None - all data flows are wired with real computation logic.

## Self-Check: PASSED
