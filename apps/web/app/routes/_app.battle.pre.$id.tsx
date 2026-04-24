import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  cancelBattle,
  fetchBattleLobby,
  retryBattlePool,
  startBattle,
  submitWager,
  type BattleLobbyState,
  type PoolRetryResponse,
} from "~/lib/api-client";
import { applyWagerResponseToCache } from "~/lib/battle-wager-cache";
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
  | "stuck"
  | "error";

const POLL_INTERVAL_MS = 2_000;
const COUNTDOWN_SECONDS = 3;
const COUNTDOWN_TICK_MS = 1_000;
/**
 * How long we let poolStatus stay 'generating' in the 'loading' phase before
 * we surface a user-visible "stuck" recovery pane. Gap 04-10: bounded UX for
 * BattleQuestionGenerationWorkflow failures that don't flip to
 * poolStatus='failed' promptly (e.g., transient Workers AI outage still
 * retrying — we give ~5x headroom over the tightened ~9s workflow budget).
 */
const POOL_STUCK_THRESHOLD_MS = 45_000;

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
  // Gap 04-10: track when 'loading' phase first observed poolStatus='generating'
  // so we can transition to 'stuck' after 45s of no progress. useRef (not
  // useState) because a wall-clock reference must not trigger re-renders.
  const loadingStartedAtRef = useRef<number | null>(null);
  // Gap 04-11: separate ref for the 'waiting-for-opponent' watchdog. When
  // both wagers have been submitted but the server-side pool hasn't marked
  // ready within 45s, we ALSO show the stuck pane. Separate ref from
  // `loadingStartedAtRef` so the two timers don't collide when phase flips
  // back and forth.
  const waitingStartedAtRef = useRef<number | null>(null);
  // Which phase armed the current stuck-pane timer — drives which ref the
  // "Keep waiting" handler resets and which phase we return to.
  const [stuckReason, setStuckReason] = useState<"loading" | "waiting" | null>(
    null,
  );
  const [cancelling, setCancelling] = useState(false);
  // Gap 04-13: retry state for the host-only 'Retry pool generation' CTA.
  // Decoupled from `cancelling` so the two CTAs can be in-flight independently
  // (in practice they cannot — the stuck pane only shows one at a time — but
  // keep the state isolated for clarity).
  const [retrying, setRetrying] = useState(false);

  // Controls whether TanStack Query keeps polling. Stops the instant we
  // transition into a reveal so the lobby doesn't keep hitting the API
  // while the animations play. Also stops in 'stuck' — no point burning
  // API calls once we've surfaced the stuck-pane (T-04-gap-06 mitigation).
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

  // ─── Gap 04-10 + 04-11: pool-generating elapsed-time watchdog ────────
  // Two arming conditions:
  //   (a) Plan 04-10: `loading` phase + poolStatus === 'generating' for >45s
  //   (b) Plan 04-11: `waiting-for-opponent` phase + both wagers submitted
  //       + poolStatus !== 'ready' for >45s
  // Both transition to the 'stuck' phase with the same user-facing pane.
  // Separate refs (loadingStartedAtRef vs waitingStartedAtRef) so the two
  // timers don't collide when phase flips back and forth; `stuckReason`
  // tracks which phase armed the current timer so handleKeepWaiting
  // resets the correct ref + returns to the right phase.
  useEffect(() => {
    const bothProposed =
      lobby?.hostWagerTier != null && lobby?.guestWagerTier != null;
    const poolNotReady = lobby?.poolStatus !== "ready";

    const shouldArmLoading =
      phase === "loading" && lobby?.poolStatus === "generating";
    const shouldArmWaiting =
      phase === "waiting-for-opponent" && bothProposed && poolNotReady;

    if (shouldArmLoading) {
      if (loadingStartedAtRef.current === null) {
        loadingStartedAtRef.current = Date.now();
        setStuckReason("loading");
        return;
      }
      const elapsed = Date.now() - loadingStartedAtRef.current;
      if (elapsed > POOL_STUCK_THRESHOLD_MS) {
        setPhase("stuck");
      }
      return;
    }

    if (shouldArmWaiting) {
      if (waitingStartedAtRef.current === null) {
        waitingStartedAtRef.current = Date.now();
        setStuckReason("waiting");
        return;
      }
      const elapsed = Date.now() - waitingStartedAtRef.current;
      if (elapsed > POOL_STUCK_THRESHOLD_MS) {
        setPhase("stuck");
      }
      return;
    }

    // Neither armed → reset whichever ref had been set, and clear
    // stuckReason if it matches the ref we just reset. We leave
    // `stuckReason` alone when `phase === 'stuck'` so the keep-waiting
    // handler still knows which timer to reset.
    if (phase !== "stuck") {
      if (loadingStartedAtRef.current !== null) {
        loadingStartedAtRef.current = null;
      }
      if (waitingStartedAtRef.current !== null) {
        waitingStartedAtRef.current = null;
      }
      if (stuckReason !== null) {
        setStuckReason(null);
      }
    }
  }, [lobby, phase, stuckReason]);

  // ─── Wager submission ────────────────────────────────────────────────
  const handleSubmitWager = useCallback(async () => {
    setSubmittingWager(true);
    try {
      const response = await submitWager(battleId, selectedTier);
      // Plan 04-11, Task 1: apply the server response to the
      // ["battle", battleId, "lobby-pre"] cache UNCONDITIONALLY on any 2xx,
      // not only when the server reports bothProposed. Previously the FIRST
      // submitter would see a stale `hostWagerTier: null` / `guestWagerTier:
      // null` lobby on the very next poll, and the phase-transition
      // useEffect would bounce the UI back to the `wager-propose` phase —
      // looked like the submit did nothing. The pure helper also forwards
      // appliedTier when bothProposed so the roadmap reveal can fire
      // without waiting for the next poll round-trip.
      queryClient.setQueryData<BattleLobbyState | undefined>(
        ["battle", battleId, "lobby-pre"],
        (prev) =>
          applyWagerResponseToCache(
            prev,
            {
              tier: response.tier,
              bothProposed: response.bothProposed,
              appliedTier: response.appliedTier,
              hostWagerAmount: response.hostWagerAmount,
              guestWagerAmount: response.guestWagerAmount,
            },
            currentUserId,
            selectedTier,
          ),
      );
      // Still invalidate so a follow-up network poll will reconcile any
      // server-side fields we didn't merge (e.g., pool status).
      queryClient.invalidateQueries({
        queryKey: ["battle", battleId, "lobby-pre"],
      });
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

  // ─── Gap 04-10: stuck-pane CTAs ─────────────────────────────────────
  const handleCancelStuck = useCallback(async () => {
    if (cancelling) return;
    setCancelling(true);
    try {
      // Best-effort: host cancel flips battles.status='expired'. Guest
      // will 403 (host-only endpoint) — that's fine, the navigation is
      // the primary outcome. Battle auto-expires on the lobby alarm or
      // stays orphaned; the orphaned-row tech-debt note from 04-09 still
      // applies.
      await cancelBattle(battleId);
    } catch {
      // Intentional swallow — navigation is the primary outcome.
    } finally {
      navigate("/battle", { replace: true });
    }
  }, [battleId, cancelling, navigate]);

  const handleKeepWaiting = useCallback(() => {
    // Reset the appropriate elapsed-time ref so the 45s window restarts,
    // then drop back to the phase that armed the watchdog. Polling resumes
    // because pollActive re-derives true for both 'loading' and
    // 'waiting-for-opponent'. If we can't tell which armed it (shouldn't
    // happen), fall back to 'loading'.
    if (stuckReason === "waiting") {
      waitingStartedAtRef.current = Date.now();
      setPhase("waiting-for-opponent");
    } else {
      loadingStartedAtRef.current = Date.now();
      setPhase("loading");
    }
  }, [stuckReason]);

  // ─── Gap 04-13: host-only pool retry CTA ─────────────────────────────
  // Only shown to the host (UI gate: lobby.hostId === currentUserId). The
  // backend is also host-gated (403 for guests) — the conditional render is
  // defense-in-depth + UX polish.
  //
  // Response discriminator:
  //   - {status: 'ready'}             → 200: no-op, let the phase effect promote
  //   - {status: 'generating', restarted: true}  → 202: we just fired a new run
  //   - {status: 'generating', inFlight: true}   → 409: a recent run is still alive
  //   - 4xx/5xx other                 → error toast, stay on StuckPane
  const handleRetryPool = useCallback(async () => {
    // WARN-7: defensive guard against a fast-remount race where lobby
    // becomes null OR the current user is no longer the host between
    // render (canRetry=true) and click. StuckPane should not render
    // without a resolved lobby + host identity, but belt-and-suspenders.
    if (!lobby || lobby.hostId !== currentUserId) return;
    if (retrying) return;
    setRetrying(true);
    try {
      const response: PoolRetryResponse = await retryBattlePool(battleId);
      if (response.status === "ready") {
        // Idempotent no-op: the workflow finished between our last poll and
        // the retry click. Invalidate the lobby-pre query so the phase
        // effect promotes to roadmap-reveal on the next tick.
        queryClient.invalidateQueries({
          queryKey: ["battle", battleId, "lobby-pre"],
        });
        toast("Pool is ready — loading the battle…");
        return;
      }
      // status === 'generating' AND restarted === true → new workflow fired.
      // Reset whichever ref owned the stuck timer and drop back to the
      // matching phase. If we can't tell, fall back to 'loading'.
      if (stuckReason === "waiting") {
        waitingStartedAtRef.current = Date.now();
        setPhase("waiting-for-opponent");
      } else {
        loadingStartedAtRef.current = Date.now();
        setPhase("loading");
      }
      queryClient.invalidateQueries({
        queryKey: ["battle", battleId, "lobby-pre"],
      });
      toast("Retrying pool generation…");
    } catch (err) {
      if (err instanceof BattleApiError) {
        // 409 in-flight path: backend says a recent workflow is still
        // running. Stay on StuckPane; nudge the user to wait.
        const isInFlight409 =
          err.status === 409 &&
          err.body !== null &&
          typeof err.body === "object" &&
          "inFlight" in (err.body as Record<string, unknown>) &&
          (err.body as Record<string, unknown>).inFlight === true;
        if (isInFlight409) {
          toast.warning(
            "A retry is already running — try again in a moment.",
          );
          return;
        }
        toast.error(
          err.serverMessage ?? "Couldn't retry pool generation.",
        );
        return;
      }
      toast.error("Couldn't retry pool generation.");
    } finally {
      setRetrying(false);
    }
  }, [battleId, currentUserId, lobby, queryClient, retrying, stuckReason]);

  // ─── Reveal-sequence handlers ────────────────────────────────────────
  const handleRoadmapRevealComplete = useCallback(() => {
    setPhase("wager-reveal");
  }, []);

  const handleWagerRevealComplete = useCallback(() => {
    setPhase("countdown");
  }, []);

  const handleCountdownComplete = useCallback(async () => {
    setPhase("starting");
    // /api/battle/:id/start is host-only (returns 403 for the guest and 409
    // if the host's request already flipped the battle to 'active'). Both
    // clients reach this handler at countdown-end, so branching here is
    // what keeps the guest out of the error pane. The guest navigates
    // straight to /battle/room/:id; the BattleRoom DO's `handleHello`
    // snapshot + subsequent `question` broadcast drive the guest from
    // pre-battle → active on their WS connection. See debug session
    // `battle-guest-disconnect-start`.
    const isHost = lobby != null && lobby.hostId === currentUserId;
    try {
      if (isHost) {
        await startBattle(battleId);
      }
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
  }, [battleId, currentUserId, lobby, navigate]);

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
  if (phase === "stuck") {
    const canRetry =
      lobby != null &&
      currentUserId != null &&
      lobby.hostId === currentUserId;
    return (
      <StuckPane
        cancelling={cancelling}
        onCancel={handleCancelStuck}
        onKeepWaiting={handleKeepWaiting}
        canRetry={canRetry}
        retrying={retrying}
        onRetry={handleRetryPool}
      />
    );
  }

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

// Gap 04-10: surfaced when poolStatus has been 'generating' for > 45s in
// the 'loading' phase. Distinct from ErrorPane — this is a RECOVERABLE UX
// state (user can wait longer or bail) whereas 'error' is terminal.
function StuckPane({
  cancelling,
  onCancel,
  onKeepWaiting,
  canRetry,
  retrying,
  onRetry,
}: {
  cancelling: boolean;
  onCancel: () => void;
  onKeepWaiting: () => void;
  canRetry: boolean;
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md text-center">
        <h1 className="mb-2 text-xl font-semibold leading-tight">
          Taking longer than expected
        </h1>
        <p className="mb-6 text-base text-muted-foreground">
          The AI is taking longer than usual to prepare your questions. This
          may be a temporary outage &mdash; you can cancel and try again, or
          keep waiting.
        </p>
        <div className="flex flex-col gap-3">
          <Button
            onClick={onCancel}
            className="w-full"
            size="lg"
            disabled={cancelling || retrying}
            variant="destructive"
          >
            {cancelling ? "Cancelling\u2026" : "Cancel and try again"}
          </Button>
          {canRetry && (
            <Button
              onClick={onRetry}
              className="w-full"
              size="lg"
              variant="secondary"
              disabled={cancelling || retrying}
            >
              {retrying ? "Retrying…" : "Retry pool generation"}
            </Button>
          )}
          <Button
            onClick={onKeepWaiting}
            className="w-full"
            size="lg"
            variant="outline"
            disabled={cancelling || retrying}
          >
            Keep waiting
          </Button>
        </div>
      </div>
    </div>
  );
}
