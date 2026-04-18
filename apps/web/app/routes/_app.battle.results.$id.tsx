import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";
import { toast } from "sonner";
import { Trophy } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { cn } from "~/lib/utils";
import { useSession } from "~/lib/auth-client";
import {
  fetchBattleLobby,
  type BattleLobbyState,
} from "~/lib/api-client";
import { useBattleStore } from "~/stores/battle-store";

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
 * Plan 08 gap: xpTransferred is currently 0 from the DO end event and the
 * lobby fallback doesn't expose wager amounts on the final row yet. We
 * render whatever is available; the `?forfeit=self` query from the room
 * route signals we should force the loser-forfeit copy regardless.
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
    // Only fetch the fallback when the store doesn't already have the
    // result — saves a network round-trip in the normal flow.
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
      // Without the live end-event we don't know outcome kind for certain;
      // treat winnerId === myUserId as a win, winnerId === null as draw.
      // Opponent name uses whichever participant I'm not.
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

  // Force the forfeit-loss copy path when the room route redirected here
  // with ?forfeit=self (4 retries exhausted).
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
        `Level up! You\u2019re now Level ${effective.newLevel}.`,
      );
    }
  }, [effective?.leveledUp, effective?.newLevel]);

  if (!myUserId) {
    return <Navigate to="/auth/sign-in" replace />;
  }

  // Still loading the fallback — hold on the skeleton.
  if (!effective && lobbyPending) {
    return <LoadingPane />;
  }

  // Neither the store nor the lobby fallback yielded data — likely the
  // user hard-refreshed long after the DO self-destructed AND the battles
  // row no longer resolves. Give them a graceful exit.
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

  // Plan 08 gap note: xpTransferred is 0 until the DO's endBattle wires
  // the atomic XP batch. Rather than show "+0 XP", show a pending
  // placeholder so UAT readers aren't misled.
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <Card className="flex w-full max-w-md flex-col items-center gap-4 p-8">
        {/* Outcome badge */}
        <div
          className={cn(
            "flex h-16 w-16 items-center justify-center rounded-full",
            isWin ? "bg-primary" : "bg-muted",
          )}
        >
          <Trophy
            className={cn(
              "h-8 w-8",
              isWin ? "text-primary-foreground" : "text-muted-foreground",
            )}
            aria-hidden="true"
          />
        </div>

        {/* Heading — Display 28/40 weight 600 */}
        <h1 className="text-center text-[28px] font-semibold leading-tight lg:text-[40px]">
          {heading}
        </h1>

        {/* XP transfer body */}
        <p className="text-center text-base text-muted-foreground">
          {xpBody}
        </p>

        {/* Score comparison row — Display sizes, tabular-nums */}
        <div className="flex items-center gap-4">
          <span
            className={cn(
              "text-[28px] font-semibold tabular-nums leading-none lg:text-[40px]",
              isWin ? "text-primary" : "text-foreground",
            )}
          >
            {myScore}
          </span>
          <span className="text-sm text-muted-foreground">vs</span>
          <span
            className={cn(
              "text-[28px] font-semibold tabular-nums leading-none lg:text-[40px]",
              !isWin && !isDraw ? "text-primary" : "text-foreground",
            )}
          >
            {opponentScore}
          </span>
        </div>

        {/* CTAs */}
        <Button
          className="w-full"
          size="lg"
          autoFocus
          onClick={() => navigate("/battle?tab=create")}
        >
          Play again
        </Button>
        <Button
          variant="ghost"
          className="w-full"
          size="lg"
          onClick={() => navigate("/battle")}
        >
          Back to battle
        </Button>
      </Card>
    </div>
  );
}

function LoadingPane() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <p
        role="status"
        aria-live="polite"
        className="text-base text-muted-foreground"
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
        <h1 className="mb-2 text-xl font-semibold leading-tight">{heading}</h1>
        <p className="mb-6 text-base text-muted-foreground">{body}</p>
        <Button onClick={onBack} className="w-full" size="lg">
          Back to battle
        </Button>
      </Card>
    </div>
  );
}
