import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  Navigate,
  useLocation,
  useNavigate,
  useParams,
} from "react-router";
import { Check, ChevronLeft, Copy } from "lucide-react";
import { toast } from "sonner";
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
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import {
  BattleApiError,
  cancelBattle,
  fetchBattleLobby,
  type BattleLobbyState,
} from "~/lib/api-client";
import { cn } from "~/lib/utils";
import { useSession } from "~/lib/auth-client";
import { ParticipantCard } from "~/components/battle/ParticipantCard";

interface LobbyLocationState {
  battleId?: string;
  joinCode?: string;
  expiresAt?: number;
  questionCount?: 5 | 10 | 15;
}

const POLL_INTERVAL_MS = 2_000;
const COUNTDOWN_DESTRUCTIVE_THRESHOLD_MS = 30_000;

export default function BattleLobbyPage() {
  const { code } = useParams<{ code: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const state = (location.state ?? null) as LobbyLocationState | null;

  // Hard refresh without state: no mapping from joinCode → battleId exists on
  // the server (Plan 04 doesn't expose GET /by-code/:code), so send the user
  // back to /battle to recover.
  if (!state?.battleId) {
    return <Navigate to="/battle" replace />;
  }

  const battleId = state.battleId;
  const displayCode = code ?? state.joinCode ?? "";

  return (
    <LobbyInner
      battleId={battleId}
      displayCode={displayCode}
      initialExpiresAt={state.expiresAt ?? null}
      navigateTo={navigate}
    />
  );
}

interface LobbyInnerProps {
  battleId: string;
  displayCode: string;
  initialExpiresAt: number | null;
  navigateTo: ReturnType<typeof useNavigate>;
}

function LobbyInner({
  battleId,
  displayCode,
  initialExpiresAt,
  navigateTo,
}: LobbyInnerProps) {
  const [copied, setCopied] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Plan 04-11, Task 4: need current user id so ParticipantCard can flag
  // the "(you)" marker on the right slot.
  const { data: session } = useSession();
  const currentUserId = session?.user?.id ?? null;

  const {
    data: lobby,
    isError,
    error,
  } = useQuery<BattleLobbyState, BattleApiError>({
    queryKey: ["battle", battleId],
    queryFn: () => fetchBattleLobby(battleId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      // Stop polling once we've left the lobby phase.
      if (status && status !== "lobby") return false;
      return POLL_INTERVAL_MS;
    },
    refetchIntervalInBackground: false,
  });

  // Auto-navigate when the guest joins (status flips to pre-battle).
  useEffect(() => {
    if (lobby?.status === "pre-battle") {
      navigateTo(`/battle/pre/${encodeURIComponent(battleId)}`, {
        state: {
          battleId,
          winningRoadmapId: lobby.winningRoadmapId,
          winningTopic: lobby.winningTopic,
          poolStatus: lobby.poolStatus,
        },
      });
    }
  }, [lobby, battleId, navigateTo]);

  const expiresAt = lobby?.expiresAt ?? initialExpiresAt ?? null;
  const countdown = useCountdown(expiresAt);

  const handleCopy = useCallback(async () => {
    if (!displayCode) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(displayCode);
      } else {
        // Fallback for older iOS Safari — create hidden textarea.
        const textarea = document.createElement("textarea");
        textarea.value = displayCode;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      toast.success("Code copied to clipboard");
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1_500);
    } catch {
      toast.error("Couldn't copy the code. Select it and copy by hand.");
    }
  }, [displayCode]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleConfirmCancel = useCallback(async () => {
    if (cancelling) return;
    setCancelling(true);
    try {
      await cancelBattle(battleId);
      toast.success("Battle cancelled");
      navigateTo("/battle");
    } catch {
      toast.error("Couldn't cancel. Try again in a moment.");
      setCancelling(false);
      setCancelOpen(false);
    }
  }, [battleId, cancelling, navigateTo]);

  const isExpired =
    lobby?.status === "expired" ||
    (countdown.totalMs !== null && countdown.totalMs <= 0);

  if (isExpired) {
    return <ExpiredState onRestart={() => navigateTo("/battle")} />;
  }

  // Server may transition status to cancelled/completed/etc. if we got here
  // via a race. Surface a generic recovery.
  if (lobby && lobby.status !== "lobby" && lobby.status !== "pre-battle") {
    return (
      <div className="px-4 pt-8 pb-24 mx-auto max-w-[480px]">
        <h1 className="text-xl font-semibold leading-tight mb-4">
          This battle is no longer open
        </h1>
        <p className="text-base text-muted-foreground mb-6">
          Head back to the battle page to start a new one.
        </p>
        <Button className="min-h-12" onClick={() => navigateTo("/battle")}>
          Back to battle
        </Button>
      </div>
    );
  }

  const errorMsg =
    isError && error instanceof BattleApiError
      ? error.serverMessage
      : null;

  const countdownLabel = countdown.formatted
    ? `Lobby expires in ${countdown.formatted}`
    : "Lobby expires in —:—";
  const countdownIsDestructive =
    countdown.totalMs !== null &&
    countdown.totalMs > 0 &&
    countdown.totalMs <= COUNTDOWN_DESTRUCTIVE_THRESHOLD_MS;

  return (
    <div className="px-4 pt-6 pb-24 mx-auto max-w-[480px]">
      <Link
        to="/battle"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground min-h-12"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Back
      </Link>

      <h1 className="text-xl font-semibold leading-tight mt-2 mb-6">
        Waiting for opponent
      </h1>

      {/* Code display */}
      <Card className="mb-6">
        <CardContent className="p-6 flex flex-col items-center gap-3">
          <p className="text-sm text-muted-foreground">Share this code</p>
          <p
            className={cn(
              "text-[28px] font-semibold leading-[1.15] tabular-nums lg:text-[40px]",
              "tracking-[0.35em]",
            )}
            aria-label={`Battle code ${displayCode.split("").join(" ")}`}
          >
            {displayCode}
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        <Button onClick={handleCopy} className="min-h-12 w-full">
          {copied ? (
            <>
              <Check className="h-4 w-4 mr-2" aria-hidden="true" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-4 w-4 mr-2" aria-hidden="true" />
              Copy code
            </>
          )}
        </Button>

      </div>

      {/* Plan 04-11, Task 4: Participants (host + guest) as ParticipantCard
          tiles. Guest slot is a waiting placeholder until the guest joins
          and the lobby-poll response carries guestName/guestLevel/guestXp. */}
      <div className="mt-8 flex flex-col gap-3" aria-live="polite">
        {lobby && (
          <ParticipantCard
            name={lobby.hostName || "Host"}
            image={lobby.hostImage ?? null}
            level={lobby.hostLevel ?? 1}
            xp={lobby.hostXp ?? 0}
            role="host"
            isSelf={currentUserId != null && lobby.hostId === currentUserId}
          />
        )}
        {lobby && lobby.guestId ? (
          <ParticipantCard
            name={lobby.guestName ?? "Guest"}
            image={lobby.guestImage ?? null}
            level={lobby.guestLevel ?? 1}
            xp={lobby.guestXp ?? 0}
            role="guest"
            isSelf={currentUserId != null && lobby.guestId === currentUserId}
          />
        ) : (
          <div className="flex items-center justify-center rounded-lg border border-dashed border-border p-4">
            <p className="text-sm text-muted-foreground">
              Waiting for opponent to join&hellip;
            </p>
          </div>
        )}
        <p
          className={cn(
            "mt-1 text-sm leading-snug tabular-nums",
            countdownIsDestructive
              ? "text-destructive"
              : "text-muted-foreground",
          )}
        >
          {countdownLabel}
        </p>
        {errorMsg && (
          <p role="alert" className="text-sm text-muted-foreground">
            Couldn&apos;t refresh lobby state. Retrying&hellip;
          </p>
        )}
      </div>

      {/* Cancel confirmation */}
      <div className="mt-10">
        <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              className="min-h-12 w-full text-destructive border-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              Cancel battle
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel this battle?</AlertDialogTitle>
              <AlertDialogDescription>
                Your opponent can no longer join with this code.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={cancelling}>
                Keep waiting
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirmCancel}
                disabled={cancelling}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {cancelling ? "Cancelling…" : "Yes, cancel"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

// ─── Countdown helper ────────────────────────────────────────────────────────

interface Countdown {
  totalMs: number | null;
  formatted: string | null;
}

function useCountdown(expiresAt: number | null): Countdown {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (expiresAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [expiresAt]);

  return useMemo(() => {
    if (expiresAt === null) return { totalMs: null, formatted: null };
    const remaining = Math.max(0, expiresAt - now);
    const totalSeconds = Math.floor(remaining / 1_000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const formatted = `${minutes}:${seconds.toString().padStart(2, "0")}`;
    return { totalMs: remaining, formatted };
  }, [expiresAt, now]);
}

// ─── Expired state ───────────────────────────────────────────────────────────

function ExpiredState({ onRestart }: { onRestart: () => void }) {
  return (
    <div className="px-4 pt-8 pb-24 mx-auto max-w-[480px]">
      <Card>
        <CardContent className="p-6 flex flex-col items-center text-center gap-3">
          <h1 className="text-xl font-semibold leading-tight">
            No one joined
          </h1>
          <p className="text-base text-muted-foreground max-w-xs">
            Your lobby expired after 5 minutes. Start a new battle to try
            again.
          </p>
          <Button className="min-h-12" onClick={onRestart}>
            Start over
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
