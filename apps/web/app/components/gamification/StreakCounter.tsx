import { Flame } from "lucide-react";
import { Card, CardContent } from "~/components/ui/card";

interface StreakCounterProps {
  streak: number;
  longestStreak: number;
  todayCompleted: boolean;
}

export function StreakCounter({ streak, longestStreak, todayCompleted }: StreakCounterProps) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <Flame
          className={`h-8 w-8 flex-shrink-0 ${streak > 0 ? "text-[hsl(30_80%_55%)]" : "text-muted-foreground"}`}
          aria-hidden="true"
        />
        <div>
          <p className="text-2xl font-semibold leading-none">{streak}</p>
          <p className="text-sm text-muted-foreground">day streak</p>
          {streak > 0 && !todayCompleted && (
            <p className="text-xs text-[hsl(30_80%_55%)] mt-1">Complete 1 lesson to keep your streak</p>
          )}
          {streak > 0 && todayCompleted && (
            <p className="text-xs text-[hsl(160_60%_45%)] mt-1">You kept your streak today!</p>
          )}
          {streak === 0 && (
            <p className="text-xs text-muted-foreground mt-1">Start a streak — complete a lesson today</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
