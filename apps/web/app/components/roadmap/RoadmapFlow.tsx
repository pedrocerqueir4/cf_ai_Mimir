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
  if (node.state) return node.state as LessonNodeState;

  if (node.lessonId && completedLessonIds.includes(node.lessonId)) {
    return "completed";
  }

  if (!node.parentId && node.order === 0) return "available";

  if (node.parentId) {
    const parent = allNodes.find((n) => n.id === node.parentId);
    if (!parent) return "available";
    const parentState = computeNodeState(parent, allNodes, completedLessonIds);
    if (parentState !== "completed") return "locked";
    return "available";
  }

  if (node.order > 0) {
    const allPrecedingComplete = allNodes
      .filter((n) => n.order < node.order && !n.parentId)
      .every((n) => n.lessonId && completedLessonIds.includes(n.lessonId));
    return allPrecedingComplete ? "available" : "locked";
  }

  return "available";
}

// ─── Edge derivation ──────────────────────────────────────────────────────────
//
// Edges mirror `computeNodeState`'s unlock semantics so every drawn line
// answers the question "what must be completed to unlock this node?":
//   - Node with parentId → unlocked when parent completes → edge from parent
//   - Non-parented node at order > 0 → unlocked when ALL preceding non-parented
//     nodes complete → fan-in edges from each one
// The `complexity` parameter is kept for API stability but no longer changes
// edge derivation — the prior linear/branching split was the bug that caused
// missing edges between top-level nodes in branching roadmaps.

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
    if (node.parentId) {
      // Explicit parent → child unlock.
      edges.push({
        id: `e-${node.parentId}-${node.id}`,
        source: node.parentId,
        target: node.id,
        type: "smoothstep",
        style: edgeStyle(computedStates.get(node.parentId)),
      });
    } else if (node.order > 0) {
      // Non-parented node: every preceding non-parented node is a prerequisite
      // (mirrors `computeNodeState` line 54-58 — "all preceding non-parented
      // complete"). Draw an inbound edge from each.
      const preceding = nodes.filter(
        (n) => n.order < node.order && !n.parentId,
      );
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
