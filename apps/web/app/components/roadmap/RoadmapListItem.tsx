import { Link } from "react-router";
import { ChevronRight } from "lucide-react";
import { Card, CardContent } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Progress } from "~/components/ui/progress";

interface RoadmapListItemProps {
  id: string;
  title: string;
  totalLessons: number;
  completedLessons: number;
}

/**
 * UI-SPEC § Roadmap List card — `Card` wrapper, h3 token title, `Badge` status
 * (default = in progress, success = complete — Plan 1 added the success
 * variant), `Progress` bar, lg+ hover lift via card-hover motion.
 */
export function RoadmapListItem({
  id,
  title,
  totalLessons,
  completedLessons,
}: RoadmapListItemProps) {
  const percent =
    totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;
  const isComplete = totalLessons > 0 && completedLessons >= totalLessons;

  return (
    <Link
      to={`/roadmaps/${id}`}
      className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-[var(--radius-lg)]"
    >
      <Card className="min-h-12 transition-transform duration-[var(--dur-base)] motion-reduce:transition-none lg:hover:-translate-y-0.5 lg:hover:shadow-[var(--shadow-md)]">
        <CardContent className="p-4 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0 flex flex-col gap-2">
              {/* Title — h3 token (18/1.3/500) */}
              <p className="text-[18px] font-medium leading-[1.3] truncate">
                {title}
              </p>
              <Badge variant={isComplete ? "success" : "default"}>
                {isComplete ? "Complete" : "In progress"}
              </Badge>
            </div>
            <ChevronRight
              className="h-4 w-4 text-[hsl(var(--fg-muted))] shrink-0 mt-1"
              aria-hidden="true"
            />
          </div>

          {/* Progress bar */}
          <div
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${completedLessons} of ${totalLessons} lessons complete`}
            className="flex flex-col gap-1"
          >
            <Progress value={percent} />
            <p className="text-[12px] leading-[1.4] tracking-[0.005em] text-[hsl(var(--fg-muted))]">
              {completedLessons} of {totalLessons} lessons complete
            </p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
