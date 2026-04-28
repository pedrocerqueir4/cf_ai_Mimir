import { motion, useReducedMotion } from "framer-motion";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { cn } from "~/lib/utils";
import type { LeaderboardEntry } from "~/lib/api-client";

interface LeaderboardRowProps {
  entry: LeaderboardEntry;
}

function initialsOf(name: string): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((n) => n[0])
    .filter(Boolean)
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/**
 * Single leaderboard row (UI-SPEC §Leaderboard).
 * - Rank column (40px), 32px avatar, flex-1 name, right-aligned net XP.
 * - Top 3: amethyst-soft border + gradient sweep on mount (battle-win-style).
 * - Reduced motion → static gradient + no sweep.
 * - aria-label on rank ensures screen reader announces position.
 */
export function LeaderboardRow({ entry }: LeaderboardRowProps) {
  const isTopThree = entry.rank <= 3;
  const reducedMotion = useReducedMotion();
  const xpPrefix = entry.netXp > 0 ? "+" : entry.netXp < 0 ? "-" : "";
  const xpAbs = Math.abs(entry.netXp);

  // UI-SPEC § Leaderboard — top 3 get an amethyst-soft border with a subtle
  // gradient sweep on mount. Implemented as a one-shot box-shadow keyframe so
  // the row catches the eye, then settles. Reduced motion: static border-only.
  const sweepAnim = !isTopThree || reducedMotion
    ? undefined
    : {
        initial: {
          boxShadow: "0 0 0 0 rgba(167,139,250,0)",
        },
        animate: {
          boxShadow: [
            "0 0 0 0 rgba(167,139,250,0)",
            "0 0 16px 0 rgba(167,139,250,0.45)",
            "0 0 0 0 rgba(167,139,250,0)",
          ],
        },
        transition: { duration: 0.8, ease: [0.4, 0, 0.2, 1] as const },
      };

  return (
    <motion.div
      {...(sweepAnim ?? {})}
      aria-label={`Rank ${entry.rank}`}
      className={cn(
        "flex items-center gap-3 h-16 px-3 rounded-[var(--radius-lg)] border",
        isTopThree
          ? "border-[hsl(var(--dominant-soft))] bg-[hsl(var(--dominant-soft))]/30"
          : "border-transparent",
        "hover:bg-[hsl(var(--bg-subtle))]",
      )}
    >
      {/* Rank — 40px fixed column */}
      <div className="w-10 flex justify-center">
        {isTopThree ? (
          <div
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-full border-2 border-[hsl(var(--dominant))]",
              "font-display tabular-nums text-[22px] leading-[1.15] text-[hsl(var(--dominant))] lg:text-[28px] lg:h-12 lg:w-12",
            )}
            aria-label={`Rank ${entry.rank}`}
          >
            {entry.rank}
          </div>
        ) : (
          <span
            className="font-display tabular-nums text-[22px] leading-[1.15] text-[hsl(var(--fg-muted))] lg:text-[28px]"
            aria-label={`Rank ${entry.rank}`}
          >
            {entry.rank}
          </span>
        )}
      </div>

      {/* Avatar — 32px */}
      <Avatar className="h-8 w-8 shrink-0">
        {entry.image && <AvatarImage src={entry.image} alt={entry.name} />}
        <AvatarFallback>{initialsOf(entry.name)}</AvatarFallback>
      </Avatar>

      {/* Name — flex-1, truncate at 200px */}
      <p className="text-[16px] leading-[1.5] flex-1 min-w-0 truncate max-w-[200px]">
        {entry.name || "Unknown"}
      </p>

      {/* Net XP — right-aligned mono-num emerald/ruby tint */}
      <p
        className={cn(
          "font-display tabular-nums text-[18px] leading-[1.3]",
          entry.netXp > 0
            ? "text-[hsl(var(--success))]"
            : entry.netXp < 0
              ? "text-[hsl(var(--destructive))]"
              : "text-foreground",
        )}
        aria-label={`Net XP ${xpPrefix}${xpAbs}`}
      >
        {xpPrefix}
        {xpAbs}
      </p>
    </motion.div>
  );
}
