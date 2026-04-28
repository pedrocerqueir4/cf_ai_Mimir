import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Flame,
  BookOpen,
  HelpCircle,
  Star,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { Skeleton } from "~/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { StatCard } from "~/components/gamification/StatCard";
import { LevelBadge } from "~/components/gamification/LevelBadge";
import { fetchUserStats } from "~/lib/api-client";
import { signOut } from "~/lib/auth-client";
import { getLocalTimezone } from "~/lib/utils";

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

export default function ProfilePage() {
  const navigate = useNavigate();
  const tz = getLocalTimezone();
  const reducedMotion = useReducedMotion();
  const itemVariants = buildItemVariants(reducedMotion);
  const [signingOut, setSigningOut] = useState(false);

  const {
    data: stats,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["user", "stats"],
    queryFn: () => fetchUserStats(tz),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="px-4 pt-8 pb-24">
        <div className="flex items-center gap-3 mb-8">
          <Skeleton className="h-16 w-16 rounded-full" />
          <div className="flex flex-col gap-2 flex-1">
            <Skeleton className="h-7 w-40 rounded" />
            <Skeleton className="h-5 w-20 rounded" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-28 rounded-[var(--radius-lg)]" />
          <Skeleton className="h-28 rounded-[var(--radius-lg)]" />
          <Skeleton className="h-28 rounded-[var(--radius-lg)]" />
          <Skeleton className="h-28 rounded-[var(--radius-lg)]" />
          <Skeleton className="h-28 rounded-[var(--radius-lg)]" />
          <Skeleton className="h-28 rounded-[var(--radius-lg)]" />
        </div>
      </div>
    );
  }

  if (isError || !stats) {
    return (
      <div className="px-4 pt-8 pb-24">
        <h1 className="text-[28px] font-semibold leading-[1.2] -tracking-[0.01em] lg:text-[36px] mb-4">
          Profile
        </h1>
        <p className="text-[16px] leading-[1.5] text-[hsl(var(--fg-muted))]">
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

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
      navigate("/auth/sign-in", { replace: true });
    } catch {
      setSigningOut(false);
    }
  };

  return (
    <div className="px-4 pt-8 pb-24">
      {/* Header row — Avatar + display name (h1) + LevelBadge per UI-SPEC § Profile */}
      <div className="flex items-center gap-4 mb-8">
        <Avatar className="h-16 w-16 shrink-0">
          {stats.image && <AvatarImage src={stats.image} alt={stats.name} />}
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        <div className="flex flex-col gap-2 min-w-0 flex-1">
          <h1 className="text-[28px] font-semibold leading-[1.2] -tracking-[0.01em] lg:text-[36px] truncate">
            {stats.name}
          </h1>
          <div className="flex items-center gap-2">
            <LevelBadge level={stats.level} />
            <span className="text-[14px] leading-[1.5] text-[hsl(var(--fg-muted))] truncate">
              {stats.email}
            </span>
          </div>
        </div>
      </div>

      {/* Stats grid — 2 col mobile, reuses Plan 3 StatCard (now widened to ReactNode value) */}
      <motion.dl
        variants={listContainerVariants}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-2 gap-3 mb-10"
      >
        <motion.div variants={itemVariants}>
          <StatCard
            label="Level"
            value={stats.level}
            icon={<Trophy className="h-5 w-5" aria-hidden="true" />}
          />
        </motion.div>
        <motion.div variants={itemVariants}>
          <StatCard
            label="Total XP"
            value={stats.xp.toLocaleString()}
            icon={<Star className="h-5 w-5" aria-hidden="true" />}
          />
        </motion.div>
        <motion.div variants={itemVariants}>
          <StatCard
            label="Current streak"
            value={stats.streak}
            icon={<Flame className="h-5 w-5" aria-hidden="true" />}
          />
        </motion.div>
        <motion.div variants={itemVariants}>
          <StatCard
            label="Best streak"
            value={stats.longestStreak}
            icon={<TrendingUp className="h-5 w-5" aria-hidden="true" />}
          />
        </motion.div>
        <motion.div variants={itemVariants}>
          <StatCard
            label="Lessons done"
            value={stats.lessonsCompleted}
            icon={<BookOpen className="h-5 w-5" aria-hidden="true" />}
          />
        </motion.div>
        <motion.div variants={itemVariants}>
          <StatCard
            label="Quizzes passed"
            value={stats.questionsCorrect}
            icon={<HelpCircle className="h-5 w-5" aria-hidden="true" />}
          />
        </motion.div>
      </motion.dl>

      {/* Sign-out — AlertDialog confirmation per UI-SPEC § Copywriting Contract destructive row */}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="outline"
            className="w-full text-[hsl(var(--destructive))] border-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive-soft))] hover:text-[hsl(var(--destructive))]"
          >
            Sign out
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out?</AlertDialogTitle>
            <AlertDialogDescription>
              You&apos;ll need to sign in again to keep learning.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={signingOut}>Stay</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleSignOut}
              disabled={signingOut}
              className="bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-fg))] hover:bg-[hsl(var(--destructive))]/90"
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
