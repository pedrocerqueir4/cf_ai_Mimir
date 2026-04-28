import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";
import { motion, useReducedMotion } from "framer-motion";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { cn } from "~/lib/utils";
import { useSession } from "~/lib/auth-client";
import {
  fetchBattleLobby,
  type BattleLobbyState,
} from "~/lib/api-client";
import { useBattleStore } from "~/stores/battle-store";
import { triggerConfetti } from "~/components/gamification/CelebrationConfetti";

/**
 * Results screen — renders after the DO emits `end` (or after a
 * self-forfeit bailout from the room route).
 *
 * Data source priority:
 * 1. `useBattleStore().endResult` — populated live during the battle.
 *    Preferred because it carries xpTransferred + (future) level-up fields.
 * 2. `fetchBattleLobby(battleId)` fallback — used on hard-refresh when the
 *    store is empty. Plan 04's `GET /api/battle/:id` returns the persisted
 *    `battles` row with winnerId + finalScore fields; we reconstruct a
 *    best-effort endResult from that.
 * 3. Graceful "Battle results expired" fallback if neither source has data.
 *
 * Plan 06-04 visual contract (UI-SPEC § Battle Results):
 *   - Winner banner: display-lg Rubik Mono One name + score, top margin
 *     `--space-4xl` (96px) per UI-SPEC.
 *   - Motion: `battle-win` for winner side (scale 0.9→1.04→1, gradient
 *     sweep on score, jewel-burst confetti); `battle-loss` for loser side
 *     (opacity + translateY 8px, ruby border glow once).
 *   - CTAs: Rematch (jewel) / Back (outline).
 *   - Reduced-motion gates all motion via useReducedMotion().
 */
export default function BattleResultsPage() {
  const { id: routeBattleId } = useParams<{ id: string }>();
  if (!routeBattleId) return <Navigate to="/battle" replace />;
  return <BattleResultsInner battleId={routeBattleId} />;
}

function BattleResultsInner({ battleId }: { battleId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const forceForfeit = searchParams.get("forfeit") === "self";
  const reducedMotion = useReducedMotion();

  const { data: session } = useSession();
  const myUserId = (session?.user?.id ?? null) as string | null;

  const endResult = useBattleStore((s) => s.endResult);
  const storeHostId = useBattleStore((s) => s.hostId);
  const storeGuestId = useBattleStore((s) => s.guestId);
  const storeOpponentName = useBattleStore((s) => s.opponentName);

  // Hard-refresh fallback — TanStack Query caches the persisted lobby row.
  const { data: lobbyFallback, isPending: lobbyPending } = useQuery<
    BattleLobbyState
  >({
    queryKey: ["battle", battleId, "lobby-results"],
    queryFn: () => fetchBattleLobby(battleId),
    staleTime: 60_000,
    enabled: !endResult,
  });

  // Refresh the user-stats cache so the bottom nav / stat card pick up
  // any XP change immediately.
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ["user", "stats"] });
    queryClient.invalidateQueries({ queryKey: ["battle", "leaderboard"] });
  }, [queryClient]);

  // Derive display data from whichever source is available.
  const view = useMemo(() => {
    if (endResult && myUserId && storeHostId) {
      const hostScore = endResult.hostScore;
      const guestScore = endResult.guestScore;
      const isHost = myUserId === storeHostId;
      const myScore = isHost ? hostScore : guestScore;
      const opponentScore = isHost ? guestScore : hostScore;
      const isWin = endResult.winnerId === myUserId;
      const isDraw = endResult.winnerId === null;
      return {
        source: "store" as const,
        isWin,
        isDraw,
        outcome: endResult.outcome,
        myScore,
        opponentScore,
        xpTransferred: endResult.xpTransferred,
        opponentName: storeOpponentName ?? "Opponent",
        leveledUp: endResult.leveledUp ?? false,
        newLevel: endResult.newLevel,
      };
    }
    if (lobbyFallback && myUserId) {
      const isHost = lobbyFallback.hostId === myUserId;
      const opponentName = isHost
        ? lobbyFallback.guestName ?? "Opponent"
        : lobbyFallback.hostName ?? "Opponent";
      const isCompleted = lobbyFallback.status === "completed";
      const isForfeit = lobbyFallback.status === "forfeited";
      return {
        source: "fallback" as const,
        isWin: false,
        isDraw: !isCompleted && !isForfeit,
        outcome: isForfeit
          ? ("forfeit" as const)
          : ("decisive" as const),
        myScore: 0,
        opponentScore: 0,
        xpTransferred: 0,
        opponentName,
        leveledUp: false,
        newLevel: undefined,
      };
    }
    return null;
  }, [endResult, lobbyFallback, myUserId, storeHostId, storeOpponentName]);

  const effective = useMemo(() => {
    if (!view) return null;
    if (!forceForfeit) return view;
    return {
      ...view,
      isWin: false,
      isDraw: false,
      outcome: "forfeit" as const,
    };
  }, [view, forceForfeit]);

  // Level-up toast — fires once on mount if Plan 08 eventually populates
  // the leveledUp/newLevel fields.
  useEffect(() => {
    if (effective?.leveledUp && typeof effective.newLevel === "number") {
      toast.success(
        `Level up! You’re now Level ${effective.newLevel}.`,
      );
    }
  }, [effective?.leveledUp, effective?.newLevel]);

  // battle-win confetti — fires ONCE on mount if the user won, with the
  // jewel palette (amethyst + ruby + emerald hex tints from Plan 1's
  // CelebrationConfetti). Reduced-motion gating is delegated to canvas-
  // confetti via `disableForReducedMotion: true`.
  useEffect(() => {
    if (effective?.isWin) {
      triggerConfetti({ palette: "jewel" });
    }
    // Run only when the win flag flips on; effect runs once per result load.
  }, [effective?.isWin]);

  if (!myUserId) {
    return <Navigate to="/auth/sign-in" replace />;
  }

  if (!effective && lobbyPending) {
    return <LoadingPane />;
  }

  if (!effective) {
    return (
      <FallbackScreen
        heading="Battle results expired"
        body="We couldn't load this battle's results. Start a new battle to keep playing."
        onBack={() => navigate("/battle", { replace: true })}
      />
    );
  }

  const {
    isWin,
    isDraw,
    outcome,
    myScore,
    opponentScore,
    xpTransferred,
    opponentName,
  } = effective;

  // Heading + body copy per UI-SPEC §Results Screen.
  const heading = isWin
    ? "You won"
    : isDraw
      ? "Well played"
      : `${opponentName} won`;

  let xpBody: string;
  if (outcome === "both-dropped") {
    xpBody = "Connection lost on both sides. Wagers refunded.";
  } else if (outcome === "forfeit") {
    xpBody = isWin
      ? `${opponentName} forfeited. You took ${xpTransferred} XP.`
      : `You forfeited. ${opponentName} took ${xpTransferred} XP.`;
  } else if (isWin) {
    xpBody = `You took ${xpTransferred} XP from ${opponentName}.`;
  } else if (isDraw) {
    xpBody = "Wagers refunded.";
  } else {
    xpBody = `${opponentName} took ${xpTransferred} XP from you.`;
  }

  if (xpTransferred === 0 && outcome !== "both-dropped") {
    xpBody =
      outcome === "forfeit"
        ? isWin
          ? `${opponentName} forfeited. Wagers are being settled.`
          : `You forfeited. Wagers are being settled.`
        : isWin
          ? `You won against ${opponentName}. Wagers are being settled.`
          : isDraw
            ? "Wagers refunded."
            : `${opponentName} won. Wagers are being settled.`;
  }

  // UI-SPEC § Motion `battle-win` — winner side: scale [0.9, 1.04, 1] +
  // gradient sweep on score + jewel-burst confetti (~800ms ease-celebrate).
  // Reduced: opacity 0→1 200ms only.
  const winnerAnim = reducedMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        transition: { duration: 0.2 },
      }
    : {
        initial: { opacity: 0, scale: 0.9 },
        animate: { opacity: 1, scale: [0.9, 1.04, 1] as [number, number, number] },
        transition: { duration: 0.8, ease: [0.34, 1.56, 0.64, 1] as const },
      };

  // UI-SPEC § Motion `battle-loss` — loser side: opacity + translateY 8px +
  // ruby border glow once (~320ms ease-soft). Reduced: opacity-only 200ms.
  const loserAnim = reducedMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        transition: { duration: 0.2 },
      }
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.32, ease: [0.4, 0, 0.2, 1] as const },
      };

  return (
    <div className="flex min-h-screen flex-col items-center bg-background px-4 pb-12">
      <motion.div
        {...(isWin ? winnerAnim : loserAnim)}
        className={cn(
          "w-full max-w-md mt-24 rounded-[var(--radius-xl)]",
          // Loser side gets a one-shot ruby border glow per battle-loss motion.
          !isWin &&
            !isDraw &&
            !reducedMotion &&
            "shadow-[var(--shadow-glow-ruby)]",
        )}
      >
        <Card className="flex w-full flex-col items-center gap-6 p-8">
          {/* Winner banner — display-lg Rubik Mono One */}
          <h1
            className={cn(
              "text-center font-display leading-[1.05] -tracking-[0.01em]",
              "text-[36px] lg:text-[48px]",
            )}
          >
            {heading}
          </h1>

          {/* Score row — winner score gets a gradient sweep (battle-win) */}
          <div className="flex items-center gap-6">
            <span
              className={cn(
                "font-display tabular-nums text-[36px] leading-[1.05] lg:text-[48px]",
                isWin
                  ? "bg-gradient-to-r from-[hsl(var(--celebration-from))] to-[hsl(var(--celebration-to))] bg-clip-text text-transparent"
                  : "text-foreground",
              )}
            >
              {myScore}
            </span>
            <span className="text-[14px] leading-[1.5] text-[hsl(var(--fg-muted))]">
              vs
            </span>
            <span
              className={cn(
                "font-display tabular-nums text-[36px] leading-[1.05] lg:text-[48px]",
                !isWin && !isDraw
                  ? "bg-gradient-to-r from-[hsl(var(--celebration-from))] to-[hsl(var(--celebration-to))] bg-clip-text text-transparent"
                  : "text-foreground",
              )}
            >
              {opponentScore}
            </span>
          </div>

          {/* XP body */}
          <p className="text-center text-[16px] leading-[1.5] text-[hsl(var(--fg-muted))]">
            {xpBody}
          </p>

          {/* CTAs — Rematch jewel + Back outline (UI-SPEC § Battle Results) */}
          <div className="flex flex-col gap-3 w-full pt-2">
            <Button
              variant="jewel"
              className="w-full"
              autoFocus
              onClick={() => navigate("/battle?tab=create")}
            >
              Rematch
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => navigate("/battle")}
            >
              Back
            </Button>
          </div>
        </Card>
      </motion.div>
    </div>
  );
}

function LoadingPane() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <p
        role="status"
        aria-live="polite"
        className="text-[16px] leading-[1.5] text-[hsl(var(--fg-muted))]"
      >
        Loading results&hellip;
      </p>
    </div>
  );
}

function FallbackScreen({
  heading,
  body,
  onBack,
}: {
  heading: string;
  body: string;
  onBack: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <Card className="w-full max-w-md p-8 text-center">
        <h1 className="mb-2 text-[22px] font-semibold leading-[1.25] -tracking-[0.005em]">
          {heading}
        </h1>
        <p className="mb-6 text-[16px] leading-[1.5] text-[hsl(var(--fg-muted))]">
          {body}
        </p>
        <Button variant="jewel" onClick={onBack} className="w-full">
          Back to battle
        </Button>
      </Card>
    </div>
  );
}
