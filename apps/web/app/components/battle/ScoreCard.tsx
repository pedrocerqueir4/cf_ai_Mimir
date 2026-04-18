import { useEffect } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Card } from "~/components/ui/card";
import { cn } from "~/lib/utils";
import {
  ConnectionDot,
  type ConnectionDotState,
} from "~/components/battle/ConnectionDot";

interface ScoreCardProps {
  user: {
    name: string;
    image?: string | null;
  };
  score: number;
  /** True for the user's OWN card — gets accent border + avatar ring. */
  isSelf: boolean;
  /** Corner dot state; wired from useBattleSocket status + opponent state. */
  connectionState: ConnectionDotState;
  /** Override the default label ("You" for self, `user.name` otherwise). */
  label?: string;
}

/**
 * Per-player score card (UI-SPEC §Score display pattern).
 *
 * - Height: 80px mobile / 96px desktop.
 * - Self: accent border (`border-2 border-primary`) + 2px accent ring on
 *   the avatar.
 * - Opponent: neutral border (`border border-border`).
 * - Score renders at Display size (28/40, weight 600) + `tabular-nums` so
 *   the digits don't jitter during the count-up.
 * - Count-up is a framer-motion spring (`stiffness: 100, damping: 20`) —
 *   per UI-SPEC: "running tally updates AFTER each question resolves"
 *   (on reveal), NOT per-millisecond. Rendering real-time would leak
 *   opponent state.
 * - ConnectionDot positioned top-right via absolute positioning so it
 *   doesn't shift the main row on state changes.
 */
export function ScoreCard({
  user,
  score,
  isSelf,
  connectionState,
  label,
}: ScoreCardProps) {
  const displayName = label ?? (isSelf ? "You" : user.name);
  const initials = getInitials(user.name);

  // Animate the displayed number via spring — triggered by score-prop change
  // (which only happens on `reveal` event dispatch per UI-SPEC).
  const motionValue = useMotionValue(score);
  const spring = useSpring(motionValue, { stiffness: 100, damping: 20 });
  const rounded = useTransform(spring, (v) => Math.max(0, Math.round(v)));

  useEffect(() => {
    motionValue.set(score);
  }, [score, motionValue]);

  return (
    <Card
      className={cn(
        "relative flex h-20 w-full items-center gap-3 px-4 py-2 lg:h-24",
        isSelf ? "border-2 border-primary" : "border border-border",
      )}
    >
      {/* Avatar */}
      <Avatar
        className={cn(
          "h-8 w-8 shrink-0",
          isSelf && "ring-2 ring-primary",
        )}
      >
        {user.image ? (
          <AvatarImage src={user.image} alt={displayName} />
        ) : null}
        <AvatarFallback className="text-xs">{initials}</AvatarFallback>
      </Avatar>

      {/* Name column */}
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate text-base leading-tight",
            isSelf ? "text-primary font-semibold" : "text-foreground",
          )}
        >
          {displayName}
        </p>
      </div>

      {/* Score — Display role, tabular-nums, count-up via framer-motion. */}
      <motion.span
        aria-label={`${displayName} score`}
        className="text-[28px] font-semibold tabular-nums leading-none lg:text-[40px]"
      >
        {rounded}
      </motion.span>

      {/* Corner connection dot */}
      <div className="absolute right-2 top-2">
        <ConnectionDot state={connectionState} />
      </div>
    </Card>
  );
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
