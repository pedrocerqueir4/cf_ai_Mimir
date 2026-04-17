import { useQuery } from "@tanstack/react-query";
import { Flame, BookOpen, HelpCircle, Trophy, Star, TrendingUp } from "lucide-react";
import { Skeleton } from "~/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Separator } from "~/components/ui/separator";
import { StatCard } from "~/components/gamification/StatCard";
import { fetchUserStats } from "~/lib/api-client";
import { getLocalTimezone } from "~/lib/utils";

export default function ProfilePage() {
  const tz = getLocalTimezone();
  const { data: stats, isLoading, isError } = useQuery({
    queryKey: ["user", "stats"],
    queryFn: () => fetchUserStats(tz),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="px-4 pt-8 pb-24">
        <Skeleton className="h-8 w-32 rounded mb-6" />
        <div className="flex items-center gap-3 mb-6">
          <Skeleton className="h-12 w-12 rounded-full" />
          <div>
            <Skeleton className="h-5 w-32 rounded mb-1" />
            <Skeleton className="h-4 w-48 rounded" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
        </div>
      </div>
    );
  }

  if (isError || !stats) {
    return (
      <div className="px-4 pt-8 pb-24">
        <h1 className="text-xl font-semibold leading-tight mb-4">Your Progress</h1>
        <p className="text-base text-muted-foreground">
          Couldn&apos;t load your stats. Pull to refresh or try again.
        </p>
      </div>
    );
  }

  const initials = stats.name
    ? stats.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "?";

  return (
    <div className="px-4 pt-8 pb-24">
      <h1 className="text-xl font-semibold leading-tight mb-4">Your Progress</h1>

      {/* User header */}
      <div className="flex items-center gap-3 mb-6">
        <Avatar className="h-12 w-12">
          {stats.image && <AvatarImage src={stats.image} alt={stats.name} />}
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        <div>
          <p className="text-base font-semibold leading-tight">{stats.name}</p>
          <p className="text-sm text-muted-foreground">{stats.email}</p>
        </div>
      </div>

      <Separator className="mb-6" />

      {/* Stats grid — 2 columns per UI-SPEC */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="Level"
          value={`Lv. ${stats.level}`}
          icon={<Trophy className="h-5 w-5" />}
        />
        <StatCard
          label="Total XP"
          value={stats.xp.toLocaleString()}
          icon={<Star className="h-5 w-5" />}
        />
        <StatCard
          label="Current Streak"
          value={`${stats.streak} days`}
          icon={<Flame className="h-5 w-5" />}
        />
        <StatCard
          label="Best Streak"
          value={`${stats.longestStreak} days`}
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <StatCard
          label="Lessons Done"
          value={stats.lessonsCompleted}
          icon={<BookOpen className="h-5 w-5" />}
        />
        <StatCard
          label="Quizzes Passed"
          value={stats.questionsCorrect}
          icon={<HelpCircle className="h-5 w-5" />}
        />
      </div>
    </div>
  );
}
