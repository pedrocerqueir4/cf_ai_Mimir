import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "~/components/ui/card";
import { ScrollArea } from "~/components/ui/scroll-area";
import { cn } from "~/lib/utils";
import type { RoadmapListItem } from "~/lib/api-client";

interface RoadmapPickerProps {
  roadmaps: RoadmapListItem[] | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  emptyState?: ReactNode;
  /** If provided, heading override (defaults to UI-SPEC "Pick your topic"). */
  heading?: string;
}

/**
 * Vertical list of selectable roadmap cards (UI-SPEC §Roadmap picker).
 * Full card clickable, min-h-16 (64px). Selected state: accent border + check.
 * Wraps in ScrollArea when > 6 items to cap visible height.
 */
export function RoadmapPicker({
  roadmaps,
  selectedId,
  onSelect,
  emptyState,
  heading = "Pick your topic",
}: RoadmapPickerProps) {
  const hasRoadmaps = roadmaps !== null && roadmaps.length > 0;

  return (
    <section aria-labelledby="roadmap-picker-heading">
      <h2
        id="roadmap-picker-heading"
        className="text-[22px] font-semibold leading-[1.25] -tracking-[0.005em] mb-3"
      >
        {heading}
      </h2>

      {!hasRoadmaps && emptyState}

      {hasRoadmaps && (
        <ScrollArea
          className={cn(
            roadmaps!.length > 6 ? "max-h-[480px]" : "max-h-none",
          )}
        >
          <div
            role="radiogroup"
            aria-label="Pick a roadmap"
            className="flex flex-col gap-2"
          >
            {roadmaps!.map((roadmap) => {
              const isSelected = roadmap.id === selectedId;
              const percent =
                roadmap.totalLessons > 0
                  ? Math.round(
                      (roadmap.completedLessons / roadmap.totalLessons) * 100,
                    )
                  : 0;
              return (
                <button
                  key={roadmap.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => onSelect(roadmap.id)}
                  className={cn(
                    "block w-full text-left",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] rounded-[var(--radius-lg)]",
                  )}
                >
                  <Card
                    className={cn(
                      "min-h-16 p-4 transition-colors",
                      isSelected
                        ? "border-2 border-[hsl(var(--dominant))] bg-[hsl(var(--dominant-soft))]"
                        : "border border-[hsl(var(--border))] hover:bg-[hsl(var(--bg-subtle))]",
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p
                          className={cn(
                            "text-[18px] font-medium leading-[1.3] truncate",
                            isSelected && "text-[hsl(var(--dominant))]",
                          )}
                        >
                          {roadmap.title}
                        </p>
                        <p className="text-[14px] leading-[1.5] text-[hsl(var(--fg-muted))] mt-1">
                          {roadmap.completedLessons} of {roadmap.totalLessons}{" "}
                          lessons complete &middot; {percent}%
                        </p>
                      </div>
                      {isSelected && (
                        <Check
                          className="h-5 w-5 text-[hsl(var(--dominant))] shrink-0"
                          aria-hidden="true"
                        />
                      )}
                    </div>
                  </Card>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </section>
  );
}
