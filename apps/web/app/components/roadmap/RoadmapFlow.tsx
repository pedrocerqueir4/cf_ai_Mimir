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
// on each node — one inbound edge per prereq. This mirrors the backend's unlock
// semantics exactly (a node unlocks when ALL its prerequisites are completed,
// see `worker/src/routes/roadmaps.ts` line 130-145). Prior versions used only
// `parentId` (which was the FIRST prereq, dropped the rest) so nodes with
// multiple prerequisites showed only one edge — and stayed locked after the
// user completed that visible prereq because the OTHER (invisible) ones were
// still incomplete.
//
// For roadmaps where prerequisites is empty but order > 0, fall back to the
// backend's "all preceding nodes" rule (see worker line 137-145).
//
// `complexity` is kept for API stability but no longer changes edge derivation.

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

  const edges: Edge[] = [];

  for (const node of nodes) {
    const prereqs = node.prerequisites ?? [];

    if (prereqs.length > 0) {
      // Explicit prerequisites — one edge per prereq.
      for (const prereqId of prereqs) {
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
      // preceding nodes complete. Mirror the same edges client-side.
      const preceding = nodes.filter((n) => n.order < node.order);
      for (const pre of preceding) {
        edges.push({
          id: `e-${pre.id}-${node.id}`,
          source: pre.id,
          target: node.id,
          type: "smoothstep",
          style: edgeStyle(computedStates.get(pre.id)),
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
    nodesep: 32, // horizontal spacing between siblings
    ranksep: 56, // vertical spacing between ranks
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
        // Pan with right-mouse only on desktop (panOnDrag={[2]}); single-finger
        // touch never pans so taps reach the LessonNode buttons cleanly. Pinch
        // still zooms the canvas on touch via zoomOnPinch.
        panOnDrag={[2]}
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
