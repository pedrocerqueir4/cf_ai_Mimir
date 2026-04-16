import { useParams } from "react-router";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { Skeleton } from "~/components/ui/skeleton";
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
      <div className="px-4 pb-8">
        {/* Header skeleton */}
        <div className="flex items-center gap-2 pt-6 mb-4">
          <Skeleton className="h-8 w-24 rounded" />
        </div>
        <Skeleton className="h-8 w-3/4 rounded mb-6" />
        {/* Node tree skeletons */}
        <div className="flex flex-col gap-3">
          <Skeleton className="w-full h-14 rounded-lg" />
          <Skeleton className="w-full h-14 rounded-lg" />
          <Skeleton className="w-full h-14 rounded-lg" />
          <Skeleton className="w-full h-14 rounded-lg" />
        </div>
      </div>
    );
  }

  // ─── Error State ─────────────────────────────────────────────────────────────
  if (isError || !roadmap) {
    return (
      <div className="px-4 pb-8">
        <div className="flex items-center gap-1 pt-6 mb-4">
          <Link
            to="/roadmaps"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            Roadmaps
          </Link>
        </div>
        <p className="text-base text-muted-foreground">
          This roadmap doesn&apos;t exist or you don&apos;t have access to it.
        </p>
      </div>
    );
  }

  // ─── Derive complexity from node structure ────────────────────────────────────
  // If any node has children, it's branching; otherwise linear
  const isBranching = roadmap.nodes.some(
    (n) => (n.children && n.children.length > 0) || n.parentId !== null
  );
  const complexity: "linear" | "branching" = isBranching ? "branching" : "linear";

  // ─── Derive completedLessonIds from pre-computed node states ──────────────────
  const completedLessonIds = roadmap.nodes
    .filter((n) => n.state === "completed" && n.lessonId)
    .map((n) => n.lessonId);

  // ─── Data State ──────────────────────────────────────────────────────────────
  return (
    <div className="pb-8">
      {/* Page header */}
      <div className="px-4 pt-6 mb-4">
        <Link
          to="/roadmaps"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3 w-fit"
        >
          <ChevronLeft className="h-4 w-4" />
          Roadmaps
        </Link>
        <h1 className="text-xl font-semibold leading-tight">{roadmap.title}</h1>
      </div>

      {/* Node tree — lessons visualization */}
      <div className="mt-4">
        <RoadmapNodeTree
          nodes={roadmap.nodes}
          completedLessonIds={completedLessonIds}
          roadmapId={roadmap.id}
          complexity={complexity}
        />
      </div>
    </div>
  );
}
