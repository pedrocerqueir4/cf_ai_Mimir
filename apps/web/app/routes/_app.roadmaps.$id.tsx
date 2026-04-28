import { useParams } from "react-router";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { Skeleton } from "~/components/ui/skeleton";
import { Progress } from "~/components/ui/progress";
import { RoadmapNodeTree } from "~/components/roadmap/RoadmapNodeTree";
import { fetchRoadmapDetail } from "~/lib/api-client";

export default function RoadmapDetailPage() {
  const { id } = useParams<{ id: string }>();

  const {
    data: roadmap,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["roadmap", id],
    queryFn: () => fetchRoadmapDetail(id!),
    enabled: !!id,
  });

  // ─── Loading State ───────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="px-4 pb-24">
        <div className="flex items-center gap-2 pt-6 mb-4">
          <Skeleton className="h-8 w-24 rounded" />
        </div>
        <Skeleton className="h-9 w-3/4 rounded mb-4" />
        <Skeleton className="h-2 w-full rounded mb-2" />
        <Skeleton className="h-3 w-32 rounded mb-6" />
        <div className="flex flex-col gap-3">
          <Skeleton className="w-full h-14 rounded-[var(--radius-lg)]" />
          <Skeleton className="w-full h-14 rounded-[var(--radius-lg)]" />
          <Skeleton className="w-full h-14 rounded-[var(--radius-lg)]" />
          <Skeleton className="w-full h-14 rounded-[var(--radius-lg)]" />
        </div>
      </div>
    );
  }

  // ─── Error State ─────────────────────────────────────────────────────────────
  if (isError || !roadmap) {
    return (
      <div className="px-4 pb-24">
        <div className="flex items-center gap-1 pt-6 mb-4">
          <Link
            to="/roadmaps"
            className="flex items-center gap-1 text-[14px] text-[hsl(var(--fg-muted))] hover:text-foreground transition-colors min-h-12"
          >
            <ChevronLeft className="h-4 w-4" />
            Roadmaps
          </Link>
        </div>
        <p className="text-[16px] leading-[1.5] text-[hsl(var(--fg-muted))]">
          This roadmap doesn&apos;t exist or you don&apos;t have access to it.
        </p>
      </div>
    );
  }

  // ─── Derive complexity from node structure ────────────────────────────────────
  const isBranching = roadmap.nodes.some(
    (n) => (n.children && n.children.length > 0) || n.parentId !== null,
  );
  const complexity: "linear" | "branching" = isBranching
    ? "branching"
    : "linear";

  // ─── Derive completedLessonIds from pre-computed node states ──────────────────
  const completedLessonIds = roadmap.nodes
    .filter((n) => n.state === "completed" && n.lessonId)
    .map((n) => n.lessonId);

  // ─── Progress aggregate (UI-SPEC § Roadmap Detail) ───────────────────────────
  const totalNodes = roadmap.nodes.length;
  const doneNodes = roadmap.nodes.filter((n) => n.state === "completed").length;
  const percent = totalNodes > 0 ? Math.round((doneNodes / totalNodes) * 100) : 0;

  // ─── Data State ──────────────────────────────────────────────────────────────
  return (
    <div className="pb-24">
      {/* Page header — h1 + Progress + caption meta */}
      <div className="px-4 pt-6 mb-6">
        <Link
          to="/roadmaps"
          className="inline-flex items-center gap-1 text-[14px] text-[hsl(var(--fg-muted))] hover:text-foreground transition-colors mb-3 min-h-12"
        >
          <ChevronLeft className="h-4 w-4" />
          Roadmaps
        </Link>
        <h1 className="text-[28px] font-semibold leading-[1.2] -tracking-[0.01em] lg:text-[36px] mb-3">
          {roadmap.title}
        </h1>
        <div
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${doneNodes} of ${totalNodes} lessons complete`}
          className="flex flex-col gap-1"
        >
          <Progress value={percent} />
          <p className="text-[12px] leading-[1.4] tracking-[0.005em] text-[hsl(var(--fg-muted))]">
            {doneNodes} of {totalNodes} lessons complete
          </p>
        </div>
      </div>

      {/* Lesson timeline — restyled via tokens; locked nodes have aria-disabled */}
      <RoadmapNodeTree
        nodes={roadmap.nodes}
        completedLessonIds={completedLessonIds}
        roadmapId={roadmap.id}
        complexity={complexity}
      />
    </div>
  );
}
