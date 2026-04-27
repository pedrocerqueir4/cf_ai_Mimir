import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, useNavigate, useParams } from "react-router";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { BattleTimer } from "~/components/battle/BattleTimer";
import { ScoreCard } from "~/components/battle/ScoreCard";
import { BattleQuestion } from "~/components/battle/BattleQuestion";
import { ReconnectOverlay } from "~/components/battle/ReconnectOverlay";
import { useBattleSocket } from "~/hooks/useBattleSocket";
import { useBattleStore } from "~/stores/battle-store";
import {
  fetchBattleLobby,
  type BattleLobbyState,
} from "~/lib/api-client";
import { useSession } from "~/lib/auth-client";

const TIMER_TICK_MS = 100;

export default function BattleRoomPage() {
  const { id: routeBattleId } = useParams<{ id: string }>();
  if (!routeBattleId) return <Navigate to="/battle" replace />;
  return <BattleRoomInner battleId={routeBattleId} />;
}

function BattleRoomInner({ battleId }: { battleId: string }) {
  const navigate = useNavigate();
  const { data: session } = useSession();
  const myUserId = (session?.user?.id ?? null) as string | null;

  // Pull a fresh lobby snapshot so we can seed the store (hostId, guestId,
  // opponentName, totalQuestions) BEFORE the WS opens — the hook's first
  // snapshot event from the server will overwrite the live fields.
  const { data: lobby, isError: lobbyError } = useQuery<BattleLobbyState>({
    queryKey: ["battle", battleId, "lobby-room"],
    queryFn: () => fetchBattleLobby(battleId),
    staleTime: 60_000,
  });

  // Initialise the store once we know who we are.
  useEffect(() => {
    if (!lobby || !myUserId) return;
    const state = useBattleStore.getState();
    // Only initialise once per battle id — subsequent re-renders stay no-op.
    if (state.battleId === battleId && state.myUserId === myUserId) return;
    const isHost = lobby.hostId === myUserId;
    const opponentName = isHost
      ? lobby.guestName ?? "Opponent"
      : lobby.hostName ?? "Opponent";
    state.initBattle({
      battleId,
      myUserId,
      myRole: isHost ? "host" : "guest",
      hostId: lobby.hostId,
      guestId: lobby.guestId ?? "",
      opponentName,
      totalQuestions: lobby.questionCount,
    });
  }, [battleId, lobby, myUserId]);

  // IDOR defence-in-depth — bounce if we somehow landed here not as a
  // participant. The websocket-auth-guard would reject us at upgrade time
  // anyway, but this short-circuits before we even try.
  useEffect(() => {
    if (!lobby || !myUserId) return;
    if (lobby.hostId !== myUserId && lobby.guestId !== myUserId) {
      navigate("/battle", { replace: true });
    }
  }, [lobby, myUserId, navigate]);

  // Open the WS. Gated on having initialised the store so the onopen-hello
  // carries a valid lastSeenQuestionIdx.
  const storeReady = Boolean(
    lobby && myUserId && useBattleStore.getState().myUserId === myUserId,
  );
  const { status, send } = useBattleSocket(storeReady ? battleId : null);

  // Local timer tick — 100ms interval keeps the ring smooth without
  // touching server authority.
  useEffect(() => {
    const id = window.setInterval(() => {
      useBattleStore.getState().tickTimer();
    }, TIMER_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  // Pull live state. useBattleStore is a hook — we subscribe to all fields
  // used in render so any change re-renders.
  const phase = useBattleStore((s) => s.phase);
  const connectionState = useBattleStore((s) => s.connectionState);
  const opponentConnectionState = useBattleStore(
    (s) => s.opponentConnectionState,
  );
  const disconnectGraceRemainingMs = useBattleStore(
    (s) => s.disconnectGraceRemainingMs,
  );
  const currentQuestion = useBattleStore((s) => s.currentQuestion);
  const currentQuestionIdx = useBattleStore((s) => s.currentQuestionIdx);
  const totalQuestions = useBattleStore((s) => s.totalQuestions);
  const scores = useBattleStore((s) => s.scores);
  const mySelectedOptionId = useBattleStore((s) => s.mySelectedOptionId);
  const myAnswerLocked = useBattleStore((s) => s.myAnswerLocked);
  const revealCorrectOptionId = useBattleStore((s) => s.revealCorrectOptionId);
  const timeRemainingMs = useBattleStore((s) => s.timeRemainingMs);
  const opponentName = useBattleStore((s) => s.opponentName);
  const hostId = useBattleStore((s) => s.hostId);
  const guestId = useBattleStore((s) => s.guestId);

  // Navigate to results once the server emits `end`.
  useEffect(() => {
    if (phase === "ended") {
      navigate(`/battle/results/${encodeURIComponent(battleId)}`);
    }
  }, [phase, battleId, navigate]);

  // If 4 retries fail we have no WS — send the user to results with a
  // self-forfeit flag so Plan 08 can render the loss copy.
  useEffect(() => {
    if (status === "failed") {
      navigate(
        `/battle/results/${encodeURIComponent(battleId)}?forfeit=self`,
        { replace: true },
      );
    }
  }, [status, battleId, navigate]);

  // Multi-tab eviction (close code 4001) — terminal; do NOT retry.
  const isMoved = phase === "moved" || status === "moved";

  // Self-card connection dot — derived from hook status.
  const selfDot =
    status === "open"
      ? "connected"
      : status === "reconnecting"
        ? "reconnecting"
        : "forfeit-imminent";

  const myScore = myUserId ? scores[myUserId] ?? 0 : 0;
  const opponentId = useMemo(() => {
    if (!myUserId) return null;
    if (hostId && hostId !== myUserId) return hostId;
    if (guestId && guestId !== myUserId) return guestId;
    return null;
  }, [myUserId, hostId, guestId]);
  const opponentScore = opponentId ? scores[opponentId] ?? 0 : 0;

  // ── Error / terminal renders ──────────────────────────────────────────
  if (lobbyError) {
    return (
      <TerminalScreen
        heading="Something went wrong"
        body="We couldn't load this battle. It may have ended or expired."
        onBack={() => navigate("/battle", { replace: true })}
      />
    );
  }

  if (isMoved) {
    return (
      <TerminalScreen
        heading="Battle moved to another device"
        body="You opened this battle in another tab or on another device. Return there to keep playing."
        onBack={() => navigate("/battle", { replace: true })}
      />
    );
  }

  if (!lobby || !myUserId) {
    return <LoadingPane />;
  }

  // ── Main battle-room render ───────────────────────────────────────────
  return (
    <>
      <div className="mx-auto flex min-h-screen max-w-[720px] flex-col gap-6 bg-background pb-8">
        {/* Top frosted bar — ScoreCard me / BattleTimer / ScoreCard opponent.
            UI-SPEC § Battle Room. Sticky below the AppShell status bar. */}
        <div className="sticky top-14 z-30 flex items-center gap-3 border-b border-[hsl(var(--border))] bg-[var(--bg-frosted)] backdrop-blur-md supports-[not_(backdrop-filter:blur(16px))]:bg-card px-4 py-3">
          <div className="flex-1 min-w-0">
            <ScoreCard
              user={{
                name: session?.user?.name ?? "You",
                image: session?.user?.image ?? null,
              }}
              score={myScore}
              isSelf
              connectionState={selfDot}
            />
          </div>
          <div className="shrink-0">
            <BattleTimer timeRemainingMs={timeRemainingMs} />
          </div>
          <div className="flex-1 min-w-0">
            <ScoreCard
              user={{
                name: opponentName ?? "Opponent",
                image: null,
              }}
              score={opponentScore}
              isSelf={false}
              connectionState={opponentConnectionState}
            />
          </div>
        </div>

        {/* Round indicator */}
        <div
          role="status"
          aria-live="polite"
          className="px-4 text-center text-[14px] leading-[1.5] text-[hsl(var(--fg-muted))]"
        >
          Round {Math.min(currentQuestionIdx + 1, totalQuestions)} of{" "}
          {totalQuestions}
        </div>

        {/* Question */}
        <div className="px-4">
        {currentQuestion ? (
          <BattleQuestion
            question={currentQuestion}
            mySelectedOptionId={mySelectedOptionId}
            isAnswered={myAnswerLocked}
            revealCorrectOptionId={revealCorrectOptionId}
            opponentName={opponentName ?? "your opponent"}
            onSelect={(optionId) => {
              // Guard: clicking twice on the same option is a no-op; the
              // store's `setMySelectedOption` flips `myAnswerLocked` which
              // flips `disabled` on the button next render.
              if (myAnswerLocked) return;
              useBattleStore.getState().setMySelectedOption(optionId);
              send({ action: "answer", optionId });
            }}
          />
        ) : (
          <Card className="p-4 text-[14px] leading-[1.5] text-[hsl(var(--fg-muted))]">
            {status === "connecting"
              ? "Connecting\u2026"
              : "Waiting for the first question\u2026"}
          </Card>
        )}
        </div>
      </div>

      {/* Reconnect overlay — fires based on phase transitions. */}
      <ReconnectOverlay
        open={
          phase === "opponent-reconnecting" || phase === "reconnecting"
        }
        opponentName={opponentName ?? "Opponent"}
        graceRemainingMs={disconnectGraceRemainingMs ?? 30_000}
        isSelfDisconnect={phase === "reconnecting"}
      />
    </>
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
        Loading battle\u2026
      </p>
    </div>
  );
}

function TerminalScreen({
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
          Back
        </Button>
      </Card>
    </div>
  );
}
