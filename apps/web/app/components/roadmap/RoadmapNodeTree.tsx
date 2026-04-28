import { useState } from "react";
import { useNavigate } from "react-router";
import { CheckCircle, Lock } from "lucide-react";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { Card, CardContent } from "~/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import type { RoadmapNode } from "~/lib/api-client";
import { cn } from "~/lib/utils";

// ─── Stagger variants (UI-SPEC § Roadmap Detail Motion: lessons stagger in) ──

const listContainerVariants: Variants = {
  hidden: { opacity: 1 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04 } },
};

function buildItemVariants(reduced: boolean | null): Variants {
  return reduced
    ? {
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: { duration: 0.12 } },
      }
    : {
        hidden: { opacity: 0, y: 12 },
        visible: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.32, ease: [0.4, 0, 0.2, 1] as const },
        },
      };
}

// ─── Types ────────────────────────────────────────────────────────────────────

type NodeState = "locked" | "available" | "in_progress" | "completed";

interface NodeTreeProps {
  nodes: RoadmapNode[];
  completedLessonIds: string[];
  roadmapId: string;
  complexity: "linear" | "branching";
}

// ─── Node State Computation ───────────────────────────────────────────────────

function computeNodeState(
  node: RoadmapNode,
  allNodes: RoadmapNode[],
  completedLessonIds: string[],
  depth: number,
): NodeState {
  if (node.state) return node.state as NodeState;

  if (node.lessonId && completedLessonIds.includes(node.lessonId)) {
    return "completed";
  }

  if (!node.parentId && node.order === 0) return "available";
  if (depth === 0 && node.order === 0) return "available";

  if (node.parentId) {
    const parent = allNodes.find((n) => n.id === node.parentId);
    if (!parent) return "available";
    const parentState = computeNodeState(
      parent,
      allNodes,
      completedLessonIds,
      depth - 1,
    );
    if (parentState !== "completed") return "locked";
    return "available";
  }

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

  // UI-SPEC § Roadmap Detail — Start lesson / Review caption per state
  const ctaCopy = isCompleted ? "Review" : isInProgress ? "Resume lesson" : "Start lesson";

  // Status caption color — amethyst for active/in-progress, emerald for done,
  // subtle for locked (per RoadmapNodeTree action item).
  const cardBorderClass = isInProgress
    ? "border-[hsl(var(--dominant))]"
    : isCompleted
      ? "border-[hsl(var(--success))]/40"
      : "border-border";

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
            className={cn(
              "block w-full text-left rounded-[var(--radius-lg)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              isLocked && "cursor-not-allowed",
            )}
          >
            <Card
              className={cn(
                "mx-4 min-h-12 transition-shadow duration-[var(--dur-base)] motion-reduce:transition-none",
                cardBorderClass,
                !isLocked && "lg:hover:shadow-[var(--shadow-md)]",
              )}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-3">
                  {/* Lock icon for locked nodes */}
                  {isLocked && (
                    <Lock
                      className="h-4 w-4 text-[hsl(var(--fg-subtle))] shrink-0"
                      aria-hidden="true"
                    />
                  )}

                  {/* Node title + CTA caption */}
                  <div className="flex-1 min-w-0 flex flex-col">
                    <span
                      className={cn(
                        "text-[18px] font-medium leading-[1.3] truncate",
                        isLocked
                          ? "text-[hsl(var(--fg-subtle))]"
                          : "text-foreground",
                      )}
                    >
                      {node.title}
                    </span>
                    <span
                      className={cn(
                        "text-[12px] leading-[1.4] tracking-[0.005em] mt-0.5",
                        isCompleted
                          ? "text-[hsl(var(--success))]"
                          : isInProgress
                            ? "text-[hsl(var(--dominant))]"
                            : isLocked
                              ? "text-[hsl(var(--fg-subtle))]"
                              : "text-[hsl(var(--fg-muted))]",
                      )}
                    >
                      {isLocked ? "Locked" : ctaCopy}
                    </span>
                  </div>

                  {/* Status icon — emerald checkmark for done, amethyst dot for in-progress */}
                  {isCompleted && (
                    <CheckCircle
                      className="h-5 w-5 text-[hsl(var(--success))] shrink-0"
                      aria-hidden="true"
                    />
                  )}
                  {isInProgress && (
                    <span
                      className="h-2 w-2 rounded-full bg-[hsl(var(--dominant))] shrink-0"
                      aria-hidden="true"
                    />
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

function ConnectorLine({ active = false }: { active?: boolean }) {
  return (
    <div className="flex justify-center" aria-hidden="true">
      <div
        className={cn(
          "w-0.5 h-8",
          active ? "bg-[hsl(var(--dominant))]" : "bg-border",
        )}
      />
    </div>
  );
}

// ─── Linear Layout ────────────────────────────────────────────────────────────

interface LinearLayoutProps {
  nodes: RoadmapNode[];
  completedLessonIds: string[];
  roadmapId: string;
  itemVariants: Variants;
}

function LinearLayout({
  nodes,
  completedLessonIds,
  roadmapId,
  itemVariants,
}: LinearLayoutProps) {
  const sorted = [...nodes].sort((a, b) => a.order - b.order);

  return (
    <motion.div
      variants={listContainerVariants}
      initial="hidden"
      animate="visible"
      className="flex flex-col"
    >
      {sorted.map((node, index) => {
        const state = computeNodeState(node, nodes, completedLessonIds, 0);
        // Active path: connector before a completed/in-progress node receives
        // the amethyst tint to surface the user's progress through the timeline.
        const prev = index > 0 ? sorted[index - 1]! : null;
        const prevState = prev
          ? computeNodeState(prev, nodes, completedLessonIds, 0)
          : null;
        const connectorActive =
          prevState === "completed" &&
          (state === "completed" ||
            state === "in_progress" ||
            state === "available");
        return (
          <motion.div key={node.id} variants={itemVariants}>
            {index > 0 && <ConnectorLine active={connectorActive} />}
            <NodeCard node={node} state={state} roadmapId={roadmapId} />
          </motion.div>
        );
      })}
    </motion.div>
  );
}

// ─── Branching Layout ─────────────────────────────────────────────────────────

interface BranchNodeProps {
  node: RoadmapNode;
  allNodes: RoadmapNode[];
  completedLessonIds: string[];
  roadmapId: string;
  depth: number;
  itemVariants: Variants;
}

function BranchNode({
  node,
  allNodes,
  completedLessonIds,
  roadmapId,
  depth,
  itemVariants,
}: BranchNodeProps) {
  const state = computeNodeState(node, allNodes, completedLessonIds, depth);
  const children =
    node.children && node.children.length > 0
      ? [...node.children].sort((a, b) => a.order - b.order)
      : allNodes
          .filter((n) => n.parentId === node.id)
          .sort((a, b) => a.order - b.order);

  return (
    <motion.div
      variants={itemVariants}
      className={cn("flex flex-col", depth > 0 && "pl-8")}
    >
      <NodeCard node={node} state={state} roadmapId={roadmapId} />
      {children.length > 0 && (
        <div className="mt-0">
          {children.map((child) => {
            const childState = computeNodeState(
              child,
              allNodes,
              completedLessonIds,
              depth + 1,
            );
            const connectorActive =
              state === "completed" &&
              (childState === "completed" ||
                childState === "in_progress" ||
                childState === "available");
            return (
              <div key={child.id}>
                <ConnectorLine active={connectorActive} />
                <BranchNode
                  node={child}
                  allNodes={allNodes}
                  completedLessonIds={completedLessonIds}
                  roadmapId={roadmapId}
                  depth={depth + 1}
                  itemVariants={itemVariants}
                />
              </div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}

interface BranchingLayoutProps {
  nodes: RoadmapNode[];
  completedLessonIds: string[];
  roadmapId: string;
  itemVariants: Variants;
}

function BranchingLayout({
  nodes,
  completedLessonIds,
  roadmapId,
  itemVariants,
}: BranchingLayoutProps) {
  const rootNodes = nodes
    .filter((n) => !n.parentId)
    .sort((a, b) => a.order - b.order);

  return (
    <motion.div
      variants={listContainerVariants}
      initial="hidden"
      animate="visible"
      className="flex flex-col gap-8"
    >
      {rootNodes.map((node, index) => (
        <motion.div key={node.id} variants={itemVariants}>
          {index > 0 && <ConnectorLine />}
          <BranchNode
            node={node}
            allNodes={nodes}
            completedLessonIds={completedLessonIds}
            roadmapId={roadmapId}
            depth={0}
            itemVariants={itemVariants}
          />
        </motion.div>
      ))}
    </motion.div>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function RoadmapNodeTree({
  nodes,
  completedLessonIds,
  roadmapId,
  complexity,
}: NodeTreeProps) {
  const reducedMotion = useReducedMotion();
  const itemVariants = buildItemVariants(reducedMotion);

  if (!nodes || nodes.length === 0) return null;

  if (complexity === "linear") {
    return (
      <LinearLayout
        nodes={nodes}
        completedLessonIds={completedLessonIds}
        roadmapId={roadmapId}
        itemVariants={itemVariants}
      />
    );
  }

  return (
    <BranchingLayout
      nodes={nodes}
      completedLessonIds={completedLessonIds}
      roadmapId={roadmapId}
      itemVariants={itemVariants}
    />
  );
}
