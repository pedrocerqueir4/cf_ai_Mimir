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
 * Single leaderboard row (UI-SPEC §Leaderboard row).
 * Height 64px. Rank column (40px), 32px avatar, flex-1 name, right-aligned Net XP.
 * Ranks 1-3: accent-bordered circle. Ranks 4+: muted foreground number.
 * Net XP: Heading 20/600 + tabular-nums, prefixed +/-.
 */
export function LeaderboardRow({ entry }: LeaderboardRowProps) {
  const isTopThree = entry.rank <= 3;
  const xpPrefix = entry.netXp > 0 ? "+" : entry.netXp < 0 ? "-" : "";
  const xpAbs = Math.abs(entry.netXp);

  return (
    <div
      className={cn(
        "flex items-center gap-3 h-16 px-3 rounded-lg",
        "hover:bg-muted/50 lg:hover:bg-muted/50",
      )}
    >
      {/* Rank — 40px fixed column */}
      <div className="w-10 flex justify-center">
        {isTopThree ? (
          <div
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-full border-2 border-primary",
              "text-[28px] font-semibold leading-[1.15] tabular-nums text-primary lg:text-[40px] lg:h-12 lg:w-12",
            )}
            aria-label={`Rank ${entry.rank}`}
          >
            {entry.rank}
          </div>
        ) : (
          <span
            className="text-[28px] font-semibold leading-[1.15] tabular-nums text-muted-foreground lg:text-[40px]"
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
      <p className="text-base font-normal leading-snug flex-1 min-w-0 truncate max-w-[200px]">
        {entry.name || "Unknown"}
      </p>

      {/* Net XP — right-aligned Heading 20/600 + tabular-nums */}
      <p
        className="text-xl font-semibold leading-tight tabular-nums"
        aria-label={`Net XP ${xpPrefix}${xpAbs}`}
      >
        {xpPrefix}
        {xpAbs}
      </p>
    </div>
  );
}
