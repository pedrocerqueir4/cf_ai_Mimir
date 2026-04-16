import { useState } from "react";
import { useNavigate } from "react-router";
import { CheckCircle, Lock } from "lucide-react";
import { Card, CardContent } from "~/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import type { RoadmapNode } from "~/lib/api-client";
import { cn } from "~/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type NodeState = "locked" | "available" | "in_progress" | "completed";

interface NodeTreeProps {
  nodes: RoadmapNode[];
  completedLessonIds: string[];
  roadmapId: string;
  complexity: "linear" | "branching";
}

// ─── Node State Computation ───────────────────────────────────────────────────

/**
 * Compute node state client-side from completedLessonIds and prerequisites.
 * If the node already has a `state` field from the API, prefer that.
 * Otherwise derive from completedLessonIds + parentId structure.
 */
function computeNodeState(
  node: RoadmapNode,
  allNodes: RoadmapNode[],
  completedLessonIds: string[],
  depth: number
): NodeState {
  // If API already provides a computed state, use it
  if (node.state) return node.state as NodeState;

  // Derive from completedLessonIds
  if (node.lessonId && completedLessonIds.includes(node.lessonId)) {
    return "completed";
  }

  // Root nodes (no parent, first in order) are always available
  if (!node.parentId && node.order === 0) return "available";
  if (depth === 0 && node.order === 0) return "available";

  // Check if parent is completed (branching roadmaps)
  if (node.parentId) {
    const parent = allNodes.find((n) => n.id === node.parentId);
    if (!parent) return "available";
    const parentState = computeNodeState(parent, allNodes, completedLessonIds, depth - 1);
    if (parentState !== "completed") return "locked";
    return "available";
  }

  // Linear ordering fallback: no parentId but order > 0
  // All preceding nodes (by order) must be completed
  if (node.order > 0) {
    const allPrecedingComplete = allNodes
      .filter((n) => n.order < node.order)
      .every((n) => n.lessonId && completedLessonIds.includes(n.lessonId));
    return allPrecedingComplete ? "available" : "locked";
  }

  return "available";
}

// ─── Single Node Card ─────────────────────────────────────────────────────────

interface NodeCardProps {
  node: RoadmapNode;
  state: NodeState;
  roadmapId: string;
}

function NodeCard({ node, state, roadmapId }: NodeCardProps) {
  const navigate = useNavigate();
  const [tooltipOpen, setTooltipOpen] = useState(false);

  const isLocked = state === "locked";
  const isCompleted = state === "completed";
  const isInProgress = state === "in_progress";

  function handleClick() {
    if (isLocked) {
      // Show tooltip for 1.5s
      setTooltipOpen(true);
      setTimeout(() => setTooltipOpen(false), 1500);
      return;
    }
    if (node.lessonId) {
      navigate(`/roadmaps/${roadmapId}/lessons/${node.lessonId}`);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    }
  }

  const cardBorderClass = isInProgress ? "border-primary" : "border-border";

  return (
    <TooltipProvider>
      <Tooltip open={isLocked ? tooltipOpen : undefined}>
        <TooltipTrigger asChild>
          <button
            type="button"
            role="button"
            aria-label={`${node.title} — ${state.replace("_", " ")}`}
            aria-disabled={isLocked ? "true" : undefined}
            tabIndex={isLocked ? -1 : 0}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            className="w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-lg"
          >
            <Card className={cn("mx-4 min-h-12", cardBorderClass)}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-3">
                  {/* Lock icon for locked nodes */}
                  {isLocked && (
                    <Lock className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}

                  {/* Node title */}
                  <span
                    className={cn(
                      "text-base flex-1 min-w-0 truncate",
                      isLocked ? "text-muted-foreground" : "text-foreground"
                    )}
                  >
                    {node.title}
                  </span>

                  {/* CheckCircle for completed nodes */}
                  {isCompleted && (
                    <CheckCircle className="h-4 w-4 text-primary shrink-0" />
                  )}

                  {/* Progress dot for in-progress nodes */}
                  {isInProgress && (
                    <span className="h-2 w-2 rounded-full bg-primary shrink-0" aria-hidden="true" />
                  )}
                </div>
              </CardContent>
            </Card>
          </button>
        </TooltipTrigger>
        {isLocked && (
          <TooltipContent side="top">
            Complete previous lessons to unlock
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  );
}

// ─── Connector Line ───────────────────────────────────────────────────────────

function ConnectorLine() {
  return (
    <div className="flex justify-center" aria-hidden="true">
      <div className="w-0.5 h-8 bg-border" />
    </div>
  );
}

// ─── Linear Layout ────────────────────────────────────────────────────────────

interface LinearLayoutProps {
  nodes: RoadmapNode[];
  completedLessonIds: string[];
  roadmapId: string;
}

function LinearLayout({ nodes, completedLessonIds, roadmapId }: LinearLayoutProps) {
  const sorted = [...nodes].sort((a, b) => a.order - b.order);

  return (
    <div className="flex flex-col">
      {sorted.map((node, index) => {
        const state = computeNodeState(node, nodes, completedLessonIds, 0);
        return (
          <div key={node.id}>
            {index > 0 && <ConnectorLine />}
            <NodeCard node={node} state={state} roadmapId={roadmapId} />
          </div>
        );
      })}
    </div>
  );
}

// ─── Branching Layout ─────────────────────────────────────────────────────────

interface BranchNodeProps {
  node: RoadmapNode;
  allNodes: RoadmapNode[];
  completedLessonIds: string[];
  roadmapId: string;
  depth: number;
}

function BranchNode({ node, allNodes, completedLessonIds, roadmapId, depth }: BranchNodeProps) {
  const state = computeNodeState(node, allNodes, completedLessonIds, depth);
  const children = node.children && node.children.length > 0
    ? [...node.children].sort((a, b) => a.order - b.order)
    : allNodes.filter((n) => n.parentId === node.id).sort((a, b) => a.order - b.order);

  return (
    <div className={cn("flex flex-col", depth > 0 && "pl-8")}>
      <NodeCard node={node} state={state} roadmapId={roadmapId} />
      {children.length > 0 && (
        <div className="mt-0">
          {children.map((child) => (
            <div key={child.id}>
              <ConnectorLine />
              <BranchNode
                node={child}
                allNodes={allNodes}
                completedLessonIds={completedLessonIds}
                roadmapId={roadmapId}
                depth={depth + 1}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface BranchingLayoutProps {
  nodes: RoadmapNode[];
  completedLessonIds: string[];
  roadmapId: string;
}

function BranchingLayout({ nodes, completedLessonIds, roadmapId }: BranchingLayoutProps) {
  // Root nodes are those with no parentId
  const rootNodes = nodes
    .filter((n) => !n.parentId)
    .sort((a, b) => a.order - b.order);

  return (
    <div className="flex flex-col gap-8">
      {rootNodes.map((node, index) => (
        <div key={node.id}>
          {index > 0 && <ConnectorLine />}
          <BranchNode
            node={node}
            allNodes={nodes}
            completedLessonIds={completedLessonIds}
            roadmapId={roadmapId}
            depth={0}
          />
        </div>
      ))}
    </div>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function RoadmapNodeTree({
  nodes,
  completedLessonIds,
  roadmapId,
  complexity,
}: NodeTreeProps) {
  if (!nodes || nodes.length === 0) return null;

  if (complexity === "linear") {
    return (
      <LinearLayout
        nodes={nodes}
        completedLessonIds={completedLessonIds}
        roadmapId={roadmapId}
      />
    );
  }

  return (
    <BranchingLayout
      nodes={nodes}
      completedLessonIds={completedLessonIds}
      roadmapId={roadmapId}
    />
  );
}
