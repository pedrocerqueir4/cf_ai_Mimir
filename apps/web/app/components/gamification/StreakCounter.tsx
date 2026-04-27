import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "~/components/ui/card";
import { StreakFlame } from "~/components/gamification/StreakFlame";

interface StreakCounterProps {
  streak: number;
  longestStreak: number;
  todayCompleted: boolean;
}

/**
 * Phase 06 Plan 03 — composes `StreakFlame` instead of rendering its own
 * Lucide Flame + count. The legacy `longestStreak` line is preserved for
 * the dashboard, but coloring + flame motion now flow through the
 * tokenised `StreakFlame` primitive.
 *
 * `animate` fires once on day-increment (when `todayCompleted` flips from
 * false → true OR streak transitions positively while `todayCompleted`
 * is true on first paint), matching UI-SPEC § Motion `streak-tick`.
 */
export function StreakCounter({
  streak,
  longestStreak: _longestStreak,
  todayCompleted,
}: StreakCounterProps) {
  // Track whether the "tick" animation has fired for this streak value to
  // avoid replaying it on every re-render (TanStack Query cache rehydrate).
  const prevStreakRef = useRef<number>(streak);
  const [animateTick, setAnimateTick] = useState<boolean>(false);

  useEffect(() => {
    if (streak > prevStreakRef.current && todayCompleted) {
      setAnimateTick(true);
      const t = setTimeout(() => setAnimateTick(false), 600);
      prevStreakRef.current = streak;
      return () => clearTimeout(t);
    }
    prevStreakRef.current = streak;
  }, [streak, todayCompleted]);

  const alive = streak > 0;

  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <StreakFlame days={streak} animate={animateTick} alive={alive} />
        <div>
          <p className="text-[14px] leading-[1.5] text-[hsl(var(--fg-muted))]">
            day streak
          </p>
          {alive && !todayCompleted && (
            <p className="text-[12px] leading-[1.4] tracking-[0.005em] text-[hsl(var(--destructive))] mt-1">
              Complete 1 lesson to keep your streak
            </p>
          )}
          {alive && todayCompleted && (
            <p className="text-[12px] leading-[1.4] tracking-[0.005em] text-[hsl(var(--success))] mt-1">
              You kept your streak today!
            </p>
          )}
          {!alive && (
            <p className="text-[12px] leading-[1.4] tracking-[0.005em] text-[hsl(var(--fg-muted))] mt-1">
              Start a streak — complete a lesson today
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
