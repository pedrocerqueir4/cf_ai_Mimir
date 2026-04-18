import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Navigate,
  useLocation,
  useNavigate,
  useParams,
} from "react-router";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { useSession } from "~/lib/auth-client";
import {
  BattleApiError,
  fetchBattleLobby,
  startBattle,
  submitWager,
  type BattleLobbyState,
} from "~/lib/api-client";
import { Button } from "~/components/ui/button";
import { WagerTierPicker, type WagerTier } from "~/components/battle/WagerTierPicker";
import { RoadmapRevealScreen } from "~/components/battle/RoadmapRevealScreen";
import { WagerRevealScreen } from "~/components/battle/WagerRevealScreen";

// ─── State-machine phase (UI-SPEC + 04-06 <interfaces>) ─────────────────────
// loading                  → waiting for poolStatus === "ready"
// wager-propose            → user has not yet proposed their wager tier
// waiting-for-opponent     → user proposed; opponent still pending
// roadmap-reveal           → both proposed + appliedWagerTier returned → run
//                            RoadmapRevealScreen
// wager-reveal             → roadmap reveal complete → run WagerRevealScreen
// countdown                → wager reveal complete → render 3 → 2 → 1
// starting                 → countdown hit 0 → startBattle + navigate
// error                    → terminal failure state (pool failed, unauthorized,
//                            battle cancelled, etc.)
type Phase =
  | "loading"
  | "wager-propose"
  | "waiting-for-opponent"
  | "roadmap-reveal"
  | "wager-reveal"
  | "countdown"
  | "starting"
  | "error";

const POLL_INTERVAL_MS = 2_000;
const COUNTDOWN_SECONDS = 3;
const COUNTDOWN_TICK_MS = 1_000;

export default function BattlePrePage() {
  const { id: routeBattleId } = useParams<{ id: string }>();
  const location = useLocation();

  if (!routeBattleId) {
    return <Navigate to="/battle" replace />;
  }

  // Pre-populate the route from navigation state if available (set by
  // /battle/join and /battle/lobby). Purely cosmetic — the poll is
  // authoritative.
  const initialState = (location.state ?? null) as {
    battleId?: string;
    winningTopic?: string | null;
  } | null;

  return (
    <BattlePreInner
      battleId={routeBattleId}
      initialWinningTopic={initialState?.winningTopic ?? null}
    />
  );
}

function BattlePreInner({
  battleId,
  initialWinningTopic: _initialWinningTopic,
}: {
  battleId: string;
  initialWinningTopic: string | null;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const currentUserId = (session?.user?.id ?? null) as string | null;

  const [phase, setPhase] = useState<Phase>("loading");
  const [selectedTier, setSelectedTier] = useState<WagerTier>(15);
  const [submittingWager, setSubmittingWager] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Controls whether TanStack Query keeps polling. Stops the instant we
  // transition into a reveal so the lobby doesn't keep hitting the API
  // while the animations play.
  const pollActive = phase === "loading" ||
    phase === "wager-propose" ||
    phase === "waiting-for-opponent";

  const { data: lobby, error: lobbyError } = useQuery<
    BattleLobbyState,
    BattleApiError
  >({
    queryKey: ["battle", battleId, "lobby-pre"],
    queryFn: () => fetchBattleLobby(battleId),
    refetchInterval: (query) => {
      if (!pollActive) return false;
      const data = query.state.data;
      if (!data) return POLL_INTERVAL_MS;
      // Stop polling once we have everything we need to start the reveals.
      if (
        data.poolStatus === "ready" &&
        data.hostWagerTier != null &&
        data.guestWagerTier != null &&
        data.appliedWagerTier != null
      ) {
        return false;
      }
      return POLL_INTERVAL_MS;
    },
    refetchIntervalInBackground: false,
    enabled: pollActive,
  });

  // ─── IDOR defense-in-depth ────────────────────────────────────────────
  // The server 403s non-participants, but if a malicious fetch/injected
  // route somehow landed here, bounce back to /battle. Only runs once
  // we know both ids.
  useEffect(() => {
    if (!lobby || !currentUserId) return;
    const isParticipant =
      lobby.hostId === currentUserId || lobby.guestId === currentUserId;
    if (!isParticipant) {
      navigate("/battle", { replace: true });
    }
  }, [lobby, currentUserId, navigate]);

  // ─── Error surface for polling errors ────────────────────────────────
  useEffect(() => {
    if (!lobbyError) return;
    if (lobbyError.status === 403) {
      navigate("/battle", { replace: true });
      return;
    }
    setErrorMessage(
      lobbyError.serverMessage ??
        "Something went wrong starting the battle. Try again.",
    );
    setPhase("error");
  }, [lobbyError, navigate]);

  // ─── Phase transitions driven by lobby polling ───────────────────────
  useEffect(() => {
    if (!lobby || !currentUserId) return;

    // Cancelled / expired / completed lobby → bail.
    if (
      lobby.status === "expired" ||
      lobby.status === "completed" ||
      lobby.status === "forfeited"
    ) {
      setErrorMessage(
        "Something went wrong starting the battle. Try again.",
      );
      setPhase("error");
      return;
    }

    if (lobby.poolStatus === "failed") {
      setErrorMessage(
        "Something went wrong starting the battle. Try again.",
      );
      setPhase("error");
      return;
    }

    // Only drive transitions from the in-flight phases; once a reveal is
    // running it owns the phase.
    if (
      phase !== "loading" &&
      phase !== "wager-propose" &&
      phase !== "waiting-for-opponent"
    ) {
      return;
    }

    const myTierProposed =
      lobby.hostId === currentUserId
        ? lobby.hostWagerTier != null
        : lobby.guestWagerTier != null;
    const bothProposed =
      lobby.hostWagerTier != null && lobby.guestWagerTier != null;

    // Both proposed + pool ready + appliedTier → jump to roadmap reveal.
    if (
      bothProposed &&
      lobby.appliedWagerTier != null &&
      lobby.poolStatus === "ready"
    ) {
      setPhase("roadmap-reveal");
      return;
    }

    if (!myTierProposed) {
      setPhase("wager-propose");
      return;
    }

    // My tier proposed, waiting on opponent (or the pool to become ready).
    setPhase("waiting-for-opponent");
  }, [lobby, currentUserId, phase]);

  // ─── Wager submission ────────────────────────────────────────────────
  const handleSubmitWager = useCallback(async () => {
    setSubmittingWager(true);
    try {
      const response = await submitWager(battleId, selectedTier);
      // If *we* were the second proposer, the response carries the applied
      // tier immediately — force an invalidate so the lobby query picks it
      // up on its next tick (or immediately in flight).
      queryClient.invalidateQueries({
        queryKey: ["battle", battleId, "lobby-pre"],
      });
      if (response.bothProposed && response.appliedTier != null) {
        // Seed an optimistic lobby update so the reveal can fire without
        // waiting for the next poll cycle.
        queryClient.setQueryData<BattleLobbyState | undefined>(
          ["battle", battleId, "lobby-pre"],
          (prev) =>
            prev
              ? {
                  ...prev,
                  hostWagerTier:
                    prev.hostId === currentUserId
                      ? (selectedTier as 10 | 15 | 20)
                      : prev.hostWagerTier,
                  guestWagerTier:
                    prev.guestId === currentUserId
                      ? (selectedTier as 10 | 15 | 20)
                      : prev.guestWagerTier,
                  appliedWagerTier: response.appliedTier,
                }
              : prev,
        );
      }
      setPhase("waiting-for-opponent");
    } catch (err) {
      const apiError =
        err instanceof BattleApiError
          ? err
          : new BattleApiError(0, null, "Unknown wager error");
      toast.error(
        apiError.serverMessage ??
          "Couldn't submit your wager. Try again.",
      );
    } finally {
      setSubmittingWager(false);
    }
  }, [battleId, selectedTier, queryClient, currentUserId]);

  // ─── Reveal-sequence handlers ────────────────────────────────────────
  const handleRoadmapRevealComplete = useCallback(() => {
    setPhase("wager-reveal");
  }, []);

  const handleWagerRevealComplete = useCallback(() => {
    setPhase("countdown");
  }, []);

  const handleCountdownComplete = useCallback(async () => {
    setPhase("starting");
    try {
      await startBattle(battleId);
      navigate(`/battle/room/${encodeURIComponent(battleId)}`, {
        state: { battleId },
      });
    } catch (err) {
      const apiError =
        err instanceof BattleApiError
          ? err
          : new BattleApiError(0, null, "Unknown start error");
      setErrorMessage(
        apiError.serverMessage ??
          "Something went wrong starting the battle. Try again.",
      );
      setPhase("error");
    }
  }, [battleId, navigate]);

  // ─── Derived data for the reveals ────────────────────────────────────
  const revealData = useMemo(() => {
    if (!lobby) return null;
    const hostTopic =
      lobby.hostRoadmapTitle ?? lobby.winningTopic ?? "Host topic";
    const guestTopic =
      lobby.guestRoadmapTitle ?? lobby.winningTopic ?? "Guest topic";
    const winningTopic =
      lobby.winningTopic ?? lobby.hostRoadmapTitle ?? hostTopic;
    return {
      hostTopic,
      guestTopic,
      winningTopic,
      hostTier: (lobby.hostWagerTier ?? 10) as WagerTier,
      guestTier: (lobby.guestWagerTier ?? 10) as WagerTier,
      appliedTier: (lobby.appliedWagerTier ?? 10) as WagerTier,
    };
  }, [lobby]);

  const opponentName = useMemo(() => {
    if (!lobby || !currentUserId) return "your opponent";
    return lobby.hostId === currentUserId
      ? (lobby.guestName ?? "your opponent")
      : (lobby.hostName ?? "your opponent");
  }, [lobby, currentUserId]);

  // ─── Render ──────────────────────────────────────────────────────────
  if (phase === "error") {
    return (
      <ErrorPane
        message={errorMessage ??
          "Something went wrong starting the battle. Try again."}
        onBack={() => navigate("/battle", { replace: true })}
      />
    );
  }

  if (phase === "loading") {
    return <LoadingPane />;
  }

  if (phase === "wager-propose") {
    return (
      <WagerProposePane
        selectedTier={selectedTier}
        onSelect={setSelectedTier}
        onSubmit={handleSubmitWager}
        submitting={submittingWager}
      />
    );
  }

  if (phase === "waiting-for-opponent") {
    return <WaitingPane opponentName={opponentName} />;
  }

  if (phase === "roadmap-reveal" && revealData) {
    return (
      <RoadmapRevealScreen
        hostTopic={revealData.hostTopic}
        guestTopic={revealData.guestTopic}
        winningTopic={revealData.winningTopic}
        onComplete={handleRoadmapRevealComplete}
      />
    );
  }

  if (phase === "wager-reveal" && revealData) {
    return (
      <WagerRevealScreen
        hostTier={revealData.hostTier}
        guestTier={revealData.guestTier}
        appliedTier={revealData.appliedTier}
        onComplete={handleWagerRevealComplete}
      />
    );
  }

  if (phase === "countdown") {
    return <CountdownPane onComplete={handleCountdownComplete} />;
  }

  if (phase === "starting") {
    return <LoadingPane message="Starting battle\u2026" />;
  }

  // Fallback — never should render. Keeps TS exhaustive.
  return <LoadingPane />;
}

// ─── Sub-screens ──────────────────────────────────────────────────────

function LoadingPane({
  message = "Preparing your battle\u2026",
}: {
  message?: string;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-8">
      <Loader2
        className="mb-4 h-10 w-10 animate-spin text-primary"
        aria-hidden
      />
      <p
        role="status"
        aria-live="polite"
        className="text-base text-muted-foreground"
      >
        {message}
      </p>
    </div>
  );
}

function WagerProposePane({
  selectedTier,
  onSelect,
  onSubmit,
  submitting,
}: {
  selectedTier: WagerTier;
  onSelect: (tier: WagerTier) => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md">
        <h1 className="mb-2 text-xl font-semibold leading-tight">
          Propose your wager
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          You&apos;ll each pick a tier. A coin flip decides which one sticks.
        </p>
        <WagerTierPicker value={selectedTier} onChange={onSelect} />
        <Button
          className="mt-6 w-full"
          size="lg"
          onClick={onSubmit}
          disabled={submitting}
        >
          {submitting ? "Submitting\u2026" : "Lock in wager"}
        </Button>
      </div>
    </div>
  );
}

function WaitingPane({ opponentName }: { opponentName: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-8">
      <Loader2
        className="mb-4 h-10 w-10 animate-spin text-primary"
        aria-hidden
      />
      <p
        role="status"
        aria-live="polite"
        className="text-base text-muted-foreground text-center"
      >
        Waiting for {opponentName} to pick their wager&hellip;
      </p>
    </div>
  );
}

function CountdownPane({ onComplete }: { onComplete: () => void }) {
  const [count, setCount] = useState<number>(COUNTDOWN_SECONDS);

  useEffect(() => {
    if (count <= 0) {
      // Trigger start on the next tick so the "1…" frame paints first.
      const t = window.setTimeout(() => onComplete(), COUNTDOWN_TICK_MS);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(
      () => setCount((prev) => prev - 1),
      COUNTDOWN_TICK_MS,
    );
    return () => window.clearTimeout(t);
  }, [count, onComplete]);

  const label =
    count === COUNTDOWN_SECONDS
      ? `Battle starts in ${count}\u2026`
      : count > 0
        ? `\u2026${count}\u2026`
        : "\u2026";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-8">
      <motion.p
        key={count}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2 }}
        role="status"
        aria-live="polite"
        className="text-[28px] font-semibold leading-tight tabular-nums text-foreground lg:text-[40px]"
      >
        {label}
      </motion.p>
    </div>
  );
}

function ErrorPane({
  message,
  onBack,
}: {
  message: string;
  onBack: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md text-center">
        <h1 className="mb-2 text-xl font-semibold leading-tight">
          Couldn&apos;t start the battle
        </h1>
        <p className="mb-6 text-base text-muted-foreground">{message}</p>
        <Button onClick={onBack} className="w-full" size="lg">
          Back to battle
        </Button>
      </div>
    </div>
  );
}
