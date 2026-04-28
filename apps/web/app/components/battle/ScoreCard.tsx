import { useEffect } from "react";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "framer-motion";
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
 * Phase 06 Plan 03 — UI-SPEC § Battle Room ScoreCard:
 *   - Score number renders in `mono-num` (Rubik Mono One, tabular-nums) so
 *     digit width is stable during the count-up.
 *   - Self side highlights with `--dominant-soft` background + `--dominant`
 *     border to read as the active player without burning the amethyst on
 *     the opponent card.
 *   - Name + side label use `body-sm` (14/1.5) in `--fg-muted`.
 *
 * Phase 04 contracts preserved verbatim:
 *   - Spring-driven count-up (only triggered on `score` prop change, which
 *     fires per-question `reveal` per UI-SPEC).
 *   - ConnectionDot positioned absolutely top-right; doesn't shift the row.
 *   - Server-authoritative scoring untouched (SEC-06).
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
  // Plan 06-06 audit fix: under prefers-reduced-motion the score snaps to
  // the new value (stiffness/damping bumped so the spring resolves in <1
  // frame). This matches UI-SPEC § Motion `xp-gain` reduced-motion contract
  // ("Number snaps to new value, halo replaced with bg-success-soft flash").
  const prefersReducedMotion = useReducedMotion();
  const motionValue = useMotionValue(score);
  const spring = useSpring(motionValue, {
    stiffness: prefersReducedMotion ? 10000 : 100,
    damping: prefersReducedMotion ? 100 : 20,
  });
  const rounded = useTransform(spring, (v) => Math.max(0, Math.round(v)));

  useEffect(() => {
    motionValue.set(score);
  }, [score, motionValue]);

  return (
    <Card
      className={cn(
        "relative flex h-20 w-full items-center gap-3 px-4 py-2 lg:h-24",
        isSelf
          ? "border-2 border-[hsl(var(--dominant))] bg-[hsl(var(--dominant-soft))]"
          : "border border-[hsl(var(--border))]",
      )}
    >
      {/* Avatar */}
      <Avatar
        className={cn(
          "h-8 w-8 shrink-0",
          isSelf && "ring-2 ring-[hsl(var(--dominant))]",
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
            "truncate text-[14px] font-normal leading-[1.5]",
            isSelf
              ? "text-[hsl(var(--dominant))] font-semibold"
              : "text-[hsl(var(--fg-muted))]",
          )}
        >
          {displayName}
        </p>
      </div>

      {/* Score — `mono-num` Rubik Mono One; count-up via framer-motion. */}
      <motion.span
        aria-label={`${displayName} score`}
        className="font-display tabular-nums text-[28px] leading-[1.15] lg:text-[36px] lg:leading-[1.1] text-foreground"
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
