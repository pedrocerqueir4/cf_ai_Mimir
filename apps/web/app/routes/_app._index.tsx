import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { Skeleton } from "~/components/ui/skeleton";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { StatCard } from "~/components/gamification/StatCard";
import { LevelBadge } from "~/components/gamification/LevelBadge";
import { XPCounterDisplay } from "~/components/gamification/XPCounterDisplay";
import { StreakFlame } from "~/components/gamification/StreakFlame";
import {
  fetchUserStats,
  fetchRoadmaps,
  type RoadmapListItem,
} from "~/lib/api-client";
import { getLocalTimezone } from "~/lib/utils";

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

export default function HomePage() {
  const tz = getLocalTimezone();
  const { data: stats, isLoading: isLoadingStats } = useQuery({
    queryKey: ["user", "stats"],
    queryFn: () => fetchUserStats(tz),
    staleTime: 30_000,
  });
  const { data: roadmaps } = useQuery<RoadmapListItem[]>({
    queryKey: ["roadmaps", "list"],
    queryFn: () => fetchRoadmaps(),
    staleTime: 30_000,
  });

  const reducedMotion = useReducedMotion();
  const itemVariants = buildItemVariants(reducedMotion);

  // Track previous XP across renders so XPCounterDisplay can drive a
  // count-up + emerald glow halo whenever a fresh stats payload arrives
  // with a positive delta. UI-SPEC § Motion `xp-gain`.
  const prevXpRef = useRef<number | undefined>(undefined);
  const xp = stats?.xp ?? 0;
  const previousXp = prevXpRef.current;
  // Update ref AFTER consuming previous value so the first render passes
  // `previousValue={undefined}` (snap, no animation) and subsequent
  // renders pass the value from the prior render.
  if (stats !== undefined) {
    prevXpRef.current = xp;
  }

  // Streak-tick on day-increment — flag is consumed by StreakFlame.
  const prevStreakRef = useRef<number>(stats?.streak ?? 0);
  const dayIncrementedToday =
    !!stats &&
    stats.todayLessonCompleted === true &&
    stats.streak > prevStreakRef.current;
  if (stats !== undefined) {
    prevStreakRef.current = stats.streak;
  }

  const hour = new Date().getHours();
  const greetingBase =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = stats?.name?.split(" ")[0] ?? "";
  const greeting = firstName ? `${greetingBase}, ${firstName}` : greetingBase;
  const subtitle =
    stats?.lastActiveRoadmapId !== undefined && stats?.lastActiveRoadmapId !== null
      ? "Pick up where you left off."
      : "Tell Mimir what you want to learn next.";

  if (isLoadingStats) {
    return (
      <div className="px-4 pt-8 pb-24">
        <Skeleton className="h-9 w-64 rounded mb-2" />
        <Skeleton className="h-5 w-48 rounded mb-24" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-28 rounded-lg" />
        </div>
      </div>
    );
  }

  const level = stats?.level ?? 1;
  const streak = stats?.streak ?? 0;
  const roadmapCount = roadmaps?.length ?? 0;

  return (
    <div className="flex flex-col px-4 pt-8 pb-24">
      {/* Greeting block — h1 + body-sm subtitle, bottom margin 96px
          (`--space-4xl`) per UI-SPEC § Dashboard. */}
      <header className="mb-24">
        <h1 className="text-[28px] font-semibold leading-[1.2] -tracking-[0.01em] lg:text-[36px] lg:leading-[1.2] text-foreground">
          {greeting}
        </h1>
        <p className="mt-1 text-[14px] leading-[1.5] text-[hsl(var(--fg-muted))]">
          {subtitle}
        </p>
      </header>

      {/* Stats grid — 2x2 mobile / 4-up lg+, list-reveal-stagger.
          UI-SPEC § Dashboard A11y locks `<dl>`/`<dt>`/`<dd>` semantics; the
          parent `<dl>` here is the dt/dd container, and StatCard renders the
          dt + dd internals. */}
      <motion.dl
        variants={listContainerVariants}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-2 gap-4 lg:grid-cols-4"
      >
        <motion.div variants={itemVariants}>
          <StatCard
            label="XP"
            renderValue={() => (
              <XPCounterDisplay
                value={xp}
                previousValue={previousXp}
                size="display-md"
              />
            )}
          />
        </motion.div>
        <motion.div variants={itemVariants}>
          <StatCard
            label="Level"
            renderValue={() => <LevelBadge level={level} />}
          />
        </motion.div>
        <motion.div variants={itemVariants}>
          <StatCard
            label="Streak"
            renderValue={() => (
              <StreakFlame
                days={streak}
                animate={dayIncrementedToday}
                alive={streak > 0}
              />
            )}
          />
        </motion.div>
        <motion.div variants={itemVariants}>
          <StatCard label="Roadmaps" value={roadmapCount} />
        </motion.div>
      </motion.dl>

      {/* Continue learning row */}
      <section className="mt-12">
        <h2 className="text-[22px] font-semibold leading-[1.25] -tracking-[0.005em] mb-4">
          Continue learning
        </h2>
        {stats?.lastActiveRoadmapId ? (
          <Card>
            <CardContent className="p-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <p className="text-[14px] leading-[1.5] text-[hsl(var(--fg-muted))]">
                Resume your most recent roadmap.
              </p>
              <Button variant="default" className="w-full lg:w-auto" asChild>
                <Link to={`/roadmaps/${stats.lastActiveRoadmapId}`}>
                  Continue
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <p className="text-[14px] leading-[1.5] text-[hsl(var(--fg-muted))]">
                No active roadmap yet.
              </p>
              <Button variant="default" className="w-full lg:w-auto" asChild>
                <Link to="/chat">Start Your First Roadmap</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </section>

      {/* Recent battles list — minimal placeholder list backed by an empty
          state when no battle history is wired into the dashboard yet. The
          container preserves the section rhythm so future plans can drop
          a real list in without restructuring. */}
      <section className="mt-12">
        <h2 className="text-[22px] font-semibold leading-[1.25] -tracking-[0.005em] mb-4">
          Recent battles
        </h2>
        <Card>
          <CardContent className="p-4">
            <p className="text-[14px] leading-[1.5] text-[hsl(var(--fg-muted))]">
              Your recent battles will appear here.
            </p>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
