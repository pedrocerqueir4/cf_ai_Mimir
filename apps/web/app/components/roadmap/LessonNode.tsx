import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { CheckCircle, Lock } from "lucide-react";
import { cn } from "~/lib/utils";

// ─── LessonNode (custom React Flow node) ──────────────────────────────────────
//
// Each node is rendered as a button-styled card. It carries lesson title,
// progression state (locked/in-progress/completed/available), and a click
// handler injected via node `data`. Visual states use Phase 06 tokens —
// emerald (`--success`) for completed, amethyst (`--dominant`) for in-progress,
// muted/border for locked.
//
// Handles are kept invisible — edges still attach but the dots are hidden so
// the canvas stays visually clean and matches the page background.

export type LessonNodeState =
  | "locked"
  | "available"
  | "in_progress"
  | "completed";

export interface LessonNodeData {
  title: string;
  state: LessonNodeState;
  onClick: () => void;
  // For aria-label fallback when state is locked
  lockedHint?: string;
  [key: string]: unknown;
}

function LessonNodeComponent({ data }: NodeProps) {
  const { title, state, onClick } = data as unknown as LessonNodeData;

  const isLocked = state === "locked";
  const isCompleted = state === "completed";
  const isInProgress = state === "in_progress";

  // Subtle status caption mirroring RoadmapNodeTree contract.
  const ctaCopy = isCompleted
    ? "Review"
    : isInProgress
      ? "Resume lesson"
      : isLocked
        ? "Locked"
        : "Start lesson";

  // Border + background per state, matching the page surface so the canvas
  // feels integrated rather than overlaid.
  const cardStateClass = isInProgress
    ? "border-[hsl(var(--dominant))] ring-2 ring-[hsl(var(--dominant))]/30 bg-[hsl(var(--bg-elevated))]"
    : isCompleted
      ? "border-[hsl(var(--success))]/40 bg-[hsl(var(--success-soft))]/30"
      : isLocked
        ? "border-border bg-[hsl(var(--bg-subtle))]"
        : "border-border bg-[hsl(var(--bg-elevated))]";

  const titleColorClass = isLocked
    ? "text-[hsl(var(--fg-subtle))]"
    : "text-foreground";

  const captionColorClass = isCompleted
    ? "text-[hsl(var(--success))]"
    : isInProgress
      ? "text-[hsl(var(--dominant))]"
      : isLocked
        ? "text-[hsl(var(--fg-subtle))]"
        : "text-[hsl(var(--fg-muted))]";

  return (
    <>
      {/* Hidden inbound handle — edges still terminate here, dot is invisible. */}
      <Handle
        type="target"
        position={Position.Top}
        style={{ opacity: 0, pointerEvents: "none" }}
      />

      <button
        type="button"
        aria-label={`${title} — ${state.replace("_", " ")}`}
        aria-disabled={isLocked ? "true" : undefined}
        tabIndex={isLocked ? -1 : 0}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className={cn(
          "block w-[180px] min-h-12 rounded-[var(--radius-lg)] border p-3 text-left",
          "shadow-sm transition-shadow duration-[var(--dur-base)] motion-reduce:transition-none",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          cardStateClass,
          isLocked ? "cursor-not-allowed" : "lg:hover:shadow-[var(--shadow-md)]",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0 flex flex-col">
            <span
              className={cn(
                "text-[14px] font-medium leading-[1.3] line-clamp-2",
                titleColorClass,
              )}
            >
              {title}
            </span>
            <span
              className={cn(
                "text-[11px] leading-[1.4] tracking-[0.005em] mt-1",
                captionColorClass,
              )}
            >
              {ctaCopy}
            </span>
          </div>
          {isCompleted && (
            <CheckCircle
              className="h-4 w-4 text-[hsl(var(--success))] shrink-0 mt-0.5"
              aria-hidden="true"
            />
          )}
          {isInProgress && (
            <span
              className="h-2 w-2 rounded-full bg-[hsl(var(--dominant))] shrink-0 mt-2"
              aria-hidden="true"
            />
          )}
          {isLocked && (
            <Lock
              className="h-4 w-4 text-[hsl(var(--fg-subtle))] shrink-0 mt-0.5"
              aria-hidden="true"
            />
          )}
        </div>
      </button>

      <Handle
        type="source"
        position={Position.Bottom}
        style={{ opacity: 0, pointerEvents: "none" }}
      />
    </>
  );
}

export const LessonNode = memo(LessonNodeComponent);
