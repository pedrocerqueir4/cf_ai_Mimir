import { Link } from "react-router";
import { ChevronRight } from "lucide-react";
import { Card, CardContent } from "~/components/ui/card";
import { Progress } from "~/components/ui/progress";

interface RoadmapListItemProps {
  id: string;
  title: string;
  totalLessons: number;
  completedLessons: number;
}

export function RoadmapListItem({
  id,
  title,
  totalLessons,
  completedLessons,
}: RoadmapListItemProps) {
  const percent =
    totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;

  return (
    <Link to={`/roadmaps/${id}`} className="block">
      <Card className="min-h-12">
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex-1 min-w-0">
              {/* Title — Body role, semibold exception per UI-SPEC */}
              <p className="text-base font-semibold leading-snug truncate">
                {title}
              </p>
              {/* Progress label — Label role (14px/400), muted-foreground */}
              <p className="text-sm text-muted-foreground mt-1">
                {completedLessons} of {totalLessons} lessons complete
              </p>
              {/* Progress bar — 4px height, accent fill, full width */}
              <div
                role="progressbar"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${completedLessons} of ${totalLessons} lessons complete`}
                className="mt-2"
              >
                <Progress value={percent} className="h-1" />
              </div>
            </div>
            {/* Chevron — muted-foreground, right-aligned */}
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
