import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  ReactFlow,
  ReactFlowProvider,
  type Node,
  type Edge,
  type NodeTypes,
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import "@xyflow/react/dist/style.css";

import type { RoadmapNode } from "~/lib/api-client";
import { LessonNode, type LessonNodeData, type LessonNodeState } from "./LessonNode";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RoadmapFlowProps {
  nodes: RoadmapNode[];
  completedLessonIds: string[];
  roadmapId: string;
  complexity: "linear" | "branching";
}

// Dimensions used by both dagre layout and the visual node card.
// Keep these in sync with `LessonNode` width/height — dagre needs accurate
// box sizes to space siblings correctly without overlap.
const NODE_WIDTH = 180;
const NODE_HEIGHT = 84;

// ─── State computation (mirrors RoadmapNodeTree.computeNodeState) ─────────────

function computeNodeState(
  node: RoadmapNode,
  allNodes: RoadmapNode[],
  completedLessonIds: string[],
): LessonNodeState {
  // Backend computes state correctly using ALL prerequisites — trust it.
  if (node.state) return node.state as LessonNodeState;

  // Defensive fallback (should not normally fire — backend always sets state).
  // Mirrors `worker/src/routes/roadmaps.ts` line 121-146 exactly: completed if
  // this lesson done; otherwise "all prereqs complete" → available, else locked;
  // bare order>0 nodes use "all preceding complete" backend fallback.
  if (node.lessonId && completedLessonIds.includes(node.lessonId)) {
    return "completed";
  }

  const prereqs = node.prerequisites ?? [];
  if (prereqs.length > 0) {
    const allPrereqsComplete = prereqs.every((prereqId) => {
      const prereq = allNodes.find((n) => n.id === prereqId);
      return Boolean(
        prereq?.lessonId && completedLessonIds.includes(prereq.lessonId),
      );
    });
    return allPrereqsComplete ? "available" : "locked";
  }

  if (node.order === 0) return "available";

  const allPrecedingComplete = allNodes
    .filter((n) => n.order < node.order)
    .every((n) => n.lessonId && completedLessonIds.includes(n.lessonId));
  return allPrecedingComplete ? "available" : "locked";
}

// ─── Edge derivation ──────────────────────────────────────────────────────────
//
// Edges are sourced directly from the backend-provided `prerequisites: string[]`
// on each node — one inbound edge per prereq. Then we apply transitive
// reduction: drop edges that are redundant because a longer path through
// another prereq already conveys the same reachability. Example:
//   X requires [Y, Z]; Y requires [Z]
// The Z → X edge is dropped because Z → Y → X already implies it. The unlock
// LOGIC is unchanged (backend still requires all of [Y, Z] complete to unlock
// X) — only the VISUAL edge set is minimized for readability.
//
// For roadmaps where prerequisites is empty but order > 0, fall back to the
// backend's "all preceding nodes" rule (see worker line 137-145).
//
// `complexity` is kept for API stability but no longer changes edge derivation.

/**
 * Build a per-node set of ALL transitive ancestors (direct + indirect prereqs).
 * Memoized + cycle-guarded.
 */
function buildAncestorsMap(
  nodes: RoadmapNode[],
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const byId = new Map(nodes.map((n) => [n.id, n] as const));

  function computeAncestors(
    nodeId: string,
    visited: Set<string>,
  ): Set<string> {
    const cached = map.get(nodeId);
    if (cached) return cached;
    if (visited.has(nodeId)) return new Set(); // cycle guard

    const node = byId.get(nodeId);
    if (!node) return new Set();

    const nextVisited = new Set(visited);
    nextVisited.add(nodeId);

    const ancestors = new Set<string>();
    for (const p of node.prerequisites ?? []) {
      ancestors.add(p);
      const sub = computeAncestors(p, nextVisited);
      for (const s of sub) ancestors.add(s);
    }

    map.set(nodeId, ancestors);
    return ancestors;
  }

  for (const n of nodes) computeAncestors(n.id, new Set());
  return map;
}

/**
 * Filter `node.prerequisites` to its transitive reduction: drop any direct
 * prereq `p` if some OTHER direct prereq `q` already has `p` in its ancestor
 * closure. Result is the minimal set of edges that preserves reachability.
 */
function reducedPrereqs(
  node: RoadmapNode,
  ancestorsMap: Map<string, Set<string>>,
): string[] {
  const prereqs = node.prerequisites ?? [];
  if (prereqs.length <= 1) return [...prereqs];

  return prereqs.filter((p) => {
    return !prereqs.some((q) => {
      if (q === p) return false;
      return ancestorsMap.get(q)?.has(p) ?? false;
    });
  });
}

function deriveEdges(
  nodes: RoadmapNode[],
  _complexity: "linear" | "branching",
  computedStates: Map<string, LessonNodeState>,
): Edge[] {
  const edgeStyle = (sourceState: LessonNodeState | undefined) => {
    const active = sourceState === "completed";
    return {
      stroke: active ? "hsl(var(--dominant))" : "hsl(var(--border))",
      strokeWidth: active ? 2 : 1.5,
    };
  };

  const ancestorsMap = buildAncestorsMap(nodes);
  const edges: Edge[] = [];

  for (const node of nodes) {
    const directPrereqs = node.prerequisites ?? [];

    if (directPrereqs.length > 0) {
      // Explicit prerequisites — apply transitive reduction, then one edge
      // per remaining (non-redundant) prereq.
      const reduced = reducedPrereqs(node, ancestorsMap);
      for (const prereqId of reduced) {
        // Skip dangling refs in case the API returns a stale prereq id.
        if (!nodes.some((n) => n.id === prereqId)) continue;
        edges.push({
          id: `e-${prereqId}-${node.id}`,
          source: prereqId,
          target: node.id,
          type: "smoothstep",
          style: edgeStyle(computedStates.get(prereqId)),
        });
      }
    } else if (node.order > 0) {
      // Backend fallback: nodes with no prereqs but order>0 require all
      // preceding nodes complete. Mirror the same edges client-side, but
      // only draw the IMMEDIATE preceding node's edge — the rest are
      // transitively reachable via the chain (same reduction principle).
      const sortedPreceding = nodes
        .filter((n) => n.order < node.order)
        .sort((a, b) => b.order - a.order); // descending — closest first
      const immediate = sortedPreceding[0];
      if (immediate) {
        edges.push({
          id: `e-${immediate.id}-${node.id}`,
          source: immediate.id,
          target: node.id,
          type: "smoothstep",
          style: edgeStyle(computedStates.get(immediate.id)),
        });
      }
    }
  }

  return edges;
}

// ─── Dagre auto-layout ────────────────────────────────────────────────────────
//
// Computes top-down (TB) positions. Both linear and branching roadmaps render
// vertically — dagre handles spacing for sibling children automatically.

function layoutWithDagre(
  rfNodes: Node[],
  rfEdges: Edge[],
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "TB",
    nodesep: 48, // horizontal spacing between siblings (raised from 32 — UAT)
    ranksep: 96, // vertical spacing between ranks (raised from 56 — UAT)
    marginx: 16,
    marginy: 16,
  });

  for (const n of rfNodes) {
    g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const e of rfEdges) {
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  const positionedNodes = rfNodes.map((n) => {
    const { x, y } = g.node(n.id);
    // dagre returns center positions; React Flow expects top-left.
    return {
      ...n,
      position: {
        x: x - NODE_WIDTH / 2,
        y: y - NODE_HEIGHT / 2,
      },
    };
  });

  return { nodes: positionedNodes, edges: rfEdges };
}

// ─── Inner viz (client-only) ──────────────────────────────────────────────────

const nodeTypes: NodeTypes = {
  lesson: LessonNode,
};

function RoadmapFlowInner({
  nodes,
  completedLessonIds,
  roadmapId,
  complexity,
}: RoadmapFlowProps) {
  const navigate = useNavigate();

  // Pre-compute all node states once so edges can reflect "active path" colour
  // without re-deriving per edge.
  const computedStates = useMemo(() => {
    const map = new Map<string, LessonNodeState>();
    for (const n of nodes) {
      map.set(n.id, computeNodeState(n, nodes, completedLessonIds));
    }
    return map;
  }, [nodes, completedLessonIds]);

  // Build React Flow nodes (with click handler bound per node).
  const initialRfNodes: Node[] = useMemo(() => {
    return nodes.map((node) => {
      const state = computedStates.get(node.id) ?? "available";
      const isLocked = state === "locked";
      const data: LessonNodeData = {
        title: node.title,
        state,
        onClick: () => {
          if (isLocked) return;
          if (node.lessonId) {
            navigate(`/roadmaps/${roadmapId}/lessons/${node.lessonId}`);
          }
        },
      };
      return {
        id: node.id,
        type: "lesson",
        position: { x: 0, y: 0 }, // overwritten by dagre
        data: data as unknown as Record<string, unknown>,
        // Disable React Flow's default node drag — these are nav buttons,
        // not draggable cards.
        draggable: false,
        selectable: false,
        connectable: false,
      };
    });
  }, [nodes, computedStates, navigate, roadmapId]);

  const initialRfEdges = useMemo(
    () => deriveEdges(nodes, complexity, computedStates),
    [nodes, complexity, computedStates],
  );

  const { nodes: laidOutNodes, edges: laidOutEdges } = useMemo(
    () => layoutWithDagre(initialRfNodes, initialRfEdges),
    [initialRfNodes, initialRfEdges],
  );

  // ─── Canvas height — derived from layout extent ─────────────────────────────
  // We want the canvas to be tall enough to show all nodes without
  // viewport-fitting (which can over-zoom small graphs). Compute max y + node
  // height + margin so the canvas grows with the roadmap.
  const canvasHeight = useMemo(() => {
    if (laidOutNodes.length === 0) return 320;
    const maxY = Math.max(...laidOutNodes.map((n) => n.position.y));
    return Math.max(320, maxY + NODE_HEIGHT + 80);
  }, [laidOutNodes]);

  return (
    <div
      // No border, page-background blend — the canvas should feel like part
      // of the page, not an overlay panel.
      className="w-full bg-background"
      style={{ height: `${canvasHeight}px` }}
      aria-label="Roadmap lesson flow"
    >
      <ReactFlow
        nodes={laidOutNodes}
        edges={laidOutEdges}
        nodeTypes={nodeTypes}
        // React Flow's node wrapper consumes pointer events on touch before
        // they reach the LessonNode button — wire the navigation through
        // React Flow's blessed onNodeClick callback so taps fire reliably on
        // touch devices. The button's onClick stays for keyboard / a11y but
        // also routes through this same handler via the data.onClick closure.
        onNodeClick={(_evt, node) => {
          const data = node.data as unknown as { onClick?: () => void };
          data.onClick?.();
        }}
        // No grid/dot backdrop — omit `<Background>` entirely so the page bg
        // shows through. Disable controls + minimap for a clean mobile UX.
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1, minZoom: 0.3 }}
        proOptions={{ hideAttribution: true }}
        // Pan enabled on touch + left-mouse. The LessonNode button carries the
        // `nopan nodrag` utility classes (per React Flow docs) so single-finger
        // touch on a NODE doesn't accidentally pan the canvas — only touches
        // on the .react-flow__pane background initiate pan. Tap-to-open on
        // node still works (verified by app.css touch-action: manipulation
        // override on .react-flow__node, which beats React Flow's inline
        // touch-action: none — see xyflow/xyflow#5087).
        panOnDrag={true}
        zoomOnScroll={false}
        zoomOnPinch
        zoomOnDoubleClick={false}
        minZoom={0.3}
        maxZoom={1.5}
        // Edge defaults — soft tone, no markers; states applied per edge.
        defaultEdgeOptions={{
          type: "smoothstep",
        }}
        nodesDraggable={false}
        nodesConnectable={false}
        // elementsSelectable MUST be true for onNodeClick to fire — React Flow
        // wires node click detection through the selection layer.
        elementsSelectable={true}
        // Hide React Flow's default panel borders + handles via no extra UI.
      />
    </div>
  );
}

// ─── SSR-safe outer wrapper ───────────────────────────────────────────────────
//
// React Flow uses `ResizeObserver` and DOM measurement during init — those
// don't exist in the Workers SSR runtime. We mount on the client only, with a
// minimal placeholder for the SSR pass + first paint so layout reserves space.

export function RoadmapFlow(props: RoadmapFlowProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    // Reserve a sensible height on the SSR/initial render so there's no
    // layout thrash when React Flow hydrates.
    return (
      <div
        className="w-full bg-background"
        style={{ height: "480px" }}
        aria-hidden="true"
      />
    );
  }

  return (
    <ReactFlowProvider>
      <RoadmapFlowInner {...props} />
    </ReactFlowProvider>
  );
}
