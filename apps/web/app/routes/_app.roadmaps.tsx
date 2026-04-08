import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { fetchRoadmaps } from "~/lib/api-client";
import { RoadmapListItem } from "~/components/roadmap/RoadmapListItem";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";

export default function RoadmapsPage() {
  const navigate = useNavigate();

  const { data: roadmaps, isLoading } = useQuery({
    queryKey: ["roadmaps"],
    queryFn: fetchRoadmaps,
  });

  // Only show roadmaps with status "complete" (hide generating / failed)
  // The API may or may not include a `status` field — guard defensively
  const visibleRoadmaps = roadmaps?.filter(
    (r) => !("status" in r) || (r as { status?: string }).status === "complete"
  );

  return (
    <div className="px-4 pb-8">
      {/* Page title — Heading (20px, semibold), pt-6 */}
      <h1 className="text-xl font-semibold leading-tight pt-6 pb-4">
        Your Roadmaps
      </h1>

      {/* Loading state — 3 skeleton rows, h-[72px], gap-2 */}
      {isLoading && (
        <div className="flex flex-col gap-2">
          <Skeleton className="w-full h-[72px] rounded-lg" />
          <Skeleton className="w-full h-[72px] rounded-lg" />
          <Skeleton className="w-full h-[72px] rounded-lg" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && (!visibleRoadmaps || visibleRoadmaps.length === 0) && (
        <div className="flex flex-col items-center justify-center text-center py-16 gap-4">
          <h2 className="text-xl font-semibold leading-tight">
            No roadmaps yet
          </h2>
          <p className="text-base text-muted-foreground max-w-xs">
            Start a conversation in Chat to generate your first learning
            roadmap.
          </p>
          <Button onClick={() => navigate("/chat")}>Go to Chat</Button>
        </div>
      )}

      {/* Data state — list of roadmaps */}
      {!isLoading && visibleRoadmaps && visibleRoadmaps.length > 0 && (
        <div className="flex flex-col gap-2">
          {visibleRoadmaps.map((roadmap) => (
            <RoadmapListItem
              key={roadmap.id}
              id={roadmap.id}
              title={roadmap.title}
              totalLessons={roadmap.totalLessons}
              completedLessons={roadmap.completedLessons}
            />
          ))}
        </div>
      )}
    </div>
  );
}
