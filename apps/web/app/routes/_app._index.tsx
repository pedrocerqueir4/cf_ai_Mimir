import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Skeleton } from "~/components/ui/skeleton";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { XPProgressBar } from "~/components/gamification/XPProgressBar";
import { StreakCounter } from "~/components/gamification/StreakCounter";
import { fetchUserStats } from "~/lib/api-client";
import { getLocalTimezone } from "~/lib/utils";

export default function HomePage() {
  const tz = getLocalTimezone();
  const { data: stats, isLoading } = useQuery({
    queryKey: ["user", "stats"],
    queryFn: () => fetchUserStats(tz),
    staleTime: 30_000,
  });

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = stats?.name?.split(" ")[0] ?? "";

  if (isLoading) {
    return (
      <div className="px-4 pt-8 pb-24">
        <Skeleton className="h-6 w-48 rounded mb-6" />
        <Skeleton className="h-20 w-full rounded-lg mb-4" />
        <Skeleton className="h-24 w-full rounded-lg mb-4" />
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="px-4 pt-8 pb-24">
      <p className="text-base text-muted-foreground mb-6">
        {greeting}{firstName ? `, ${firstName}` : ""}
      </p>

      <Card className="mb-4">
        <CardContent className="p-4">
          <XPProgressBar
            xp={stats?.xp ?? 0}
            level={stats?.level ?? 1}
            xpToNextLevel={stats?.xpToNextLevel ?? 100}
            progressPercent={stats?.progressPercent ?? 0}
          />
        </CardContent>
      </Card>

      <div className="mb-4">
        <StreakCounter
          streak={stats?.streak ?? 0}
          longestStreak={stats?.longestStreak ?? 0}
          todayCompleted={stats?.todayLessonCompleted ?? false}
        />
      </div>

      {stats?.lastActiveRoadmapId ? (
        <Button variant="default" className="w-full min-h-12" asChild>
          <Link to={`/roadmaps/${stats.lastActiveRoadmapId}`}>
            Continue Learning
          </Link>
        </Button>
      ) : (
        <Button variant="default" className="w-full min-h-12" asChild>
          <Link to="/chat">Start Your First Roadmap</Link>
        </Button>
      )}
    </div>
  );
}
