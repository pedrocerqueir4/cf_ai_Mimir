import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { fetchRoadmaps, type RoadmapListItem as RoadmapListItemType } from "~/lib/api-client";
import { RoadmapListItem } from "~/components/roadmap/RoadmapListItem";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";

// UI-SPEC § Motion `list-reveal-stagger`:
//   320ms total, 40ms stagger per item, opacity 0→1 + translateY 12px→0.
//   Reduced motion: all items appear simultaneously, opacity 0→1 120ms.
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

type FilterTab = "all" | "in_progress" | "complete";

export default function RoadmapsPage() {
  const reducedMotion = useReducedMotion();
  const itemVariants = buildItemVariants(reducedMotion);
  const [filter, setFilter] = useState<FilterTab>("all");

  const { data: roadmaps, isLoading } = useQuery({
    queryKey: ["roadmaps"],
    queryFn: fetchRoadmaps,
  });

  // Only show roadmaps with status "complete" (hide generating / failed)
  // The API may or may not include a `status` field — guard defensively
  const visibleRoadmaps = useMemo<RoadmapListItemType[] | undefined>(() => {
    if (!roadmaps) return undefined;
    return roadmaps.filter(
      (r) => !("status" in r) || (r as { status?: string }).status === "complete",
    );
  }, [roadmaps]);

  const filteredRoadmaps = useMemo<RoadmapListItemType[] | undefined>(() => {
    if (!visibleRoadmaps) return undefined;
    if (filter === "all") return visibleRoadmaps;
    return visibleRoadmaps.filter((r) => {
      const total = r.totalLessons ?? 0;
      const done = r.completedLessons ?? 0;
      const isComplete = total > 0 && done >= total;
      return filter === "complete" ? isComplete : !isComplete;
    });
  }, [visibleRoadmaps, filter]);

  return (
    <div className="px-4 pt-6 pb-24">
      {/* Page header — h1 + Generate roadmap CTA right-aligned (UI-SPEC § Roadmap List) */}
      <div className="flex items-center justify-between gap-3 mb-6">
        <h1 className="text-[28px] font-semibold leading-[1.2] -tracking-[0.01em] lg:text-[36px]">
          Roadmaps
        </h1>
        <Button asChild>
          <Link to="/chat">Generate roadmap</Link>
        </Button>
      </div>

      {/* Filter tabs — All / In progress / Complete (UI-SPEC § Roadmap List) */}
      <Tabs
        value={filter}
        onValueChange={(v) => setFilter(v as FilterTab)}
        className="mb-6"
      >
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="all" className="min-h-12">
            All
          </TabsTrigger>
          <TabsTrigger value="in_progress" className="min-h-12">
            In progress
          </TabsTrigger>
          <TabsTrigger value="complete" className="min-h-12">
            Complete
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Loading state */}
      {isLoading && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="w-full h-[96px] rounded-[var(--radius-lg)]" />
          <Skeleton className="w-full h-[96px] rounded-[var(--radius-lg)]" />
          <Skeleton className="w-full h-[96px] rounded-[var(--radius-lg)]" />
        </div>
      )}

      {/* Empty state — copy lock per UI-SPEC § Copywriting Contract */}
      {!isLoading && (!visibleRoadmaps || visibleRoadmaps.length === 0) && (
        <div className="flex flex-col items-center justify-center text-center py-16 gap-4">
          <h2 className="text-[22px] font-semibold leading-[1.25] -tracking-[0.005em]">
            No roadmaps yet
          </h2>
          <p className="text-[14px] leading-[1.5] text-[hsl(var(--fg-muted))] max-w-sm">
            Tell Mimir what you want to learn and we&apos;ll build a roadmap in seconds.
          </p>
          <Button variant="jewel" asChild>
            <Link to="/chat">Start your first roadmap</Link>
          </Button>
        </div>
      )}

      {/* Filtered-empty state — when there are roadmaps but the active tab is empty */}
      {!isLoading &&
        visibleRoadmaps &&
        visibleRoadmaps.length > 0 &&
        filteredRoadmaps &&
        filteredRoadmaps.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center py-12 gap-2">
            <p className="text-[14px] leading-[1.5] text-[hsl(var(--fg-muted))]">
              {filter === "complete"
                ? "No completed roadmaps yet."
                : "No roadmaps in progress."}
            </p>
          </div>
        )}

      {/* Data state — card grid (1 col mobile, 2 col lg+) with stagger reveal */}
      {!isLoading && filteredRoadmaps && filteredRoadmaps.length > 0 && (
        <motion.ul
          key={filter}
          variants={listContainerVariants}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-1 gap-4 lg:grid-cols-2 list-none p-0 m-0"
        >
          {filteredRoadmaps.map((roadmap) => (
            <motion.li key={roadmap.id} variants={itemVariants}>
              <RoadmapListItem
                id={roadmap.id}
                title={roadmap.title}
                totalLessons={roadmap.totalLessons}
                completedLessons={roadmap.completedLessons}
              />
            </motion.li>
          ))}
        </motion.ul>
      )}
    </div>
  );
}
