import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { RoadmapPicker } from "~/components/battle/RoadmapPicker";
import {
  QuestionCountPicker,
  type QuestionCount,
} from "~/components/battle/QuestionCountPicker";
import {
  WagerTierPicker,
  type WagerTier,
} from "~/components/battle/WagerTierPicker";
import {
  BattleApiError,
  createBattle,
  fetchRoadmaps,
  fetchUserStats,
} from "~/lib/api-client";
import { getLocalTimezone } from "~/lib/utils";

export default function BattleNewPage() {
  const navigate = useNavigate();
  const tz = getLocalTimezone();

  const {
    data: roadmaps,
    isLoading: roadmapsLoading,
    isError: roadmapsError,
  } = useQuery({
    queryKey: ["roadmaps"],
    queryFn: fetchRoadmaps,
  });

  // XP is needed to show the per-tier preview. We tolerate errors here — the
  // picker renders without previews if XP is unavailable.
  const { data: userStats } = useQuery({
    queryKey: ["user", "stats"],
    queryFn: () => fetchUserStats(tz),
    staleTime: 30_000,
  });

  const [selectedRoadmapId, setSelectedRoadmapId] = useState<string | null>(
    null,
  );
  const [questionCount, setQuestionCount] = useState<QuestionCount>(10);
  const [wagerTier] = useState<WagerTier>(10);
  // Intentionally keep wagerTier here for UX parity with the create form;
  // the actual wager proposal happens in Plan 06's pre-battle step. The
  // picker here is illustrative — users see their options before committing.
  const [wagerTierLocal, setWagerTierLocal] = useState<WagerTier>(wagerTier);

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const visibleRoadmaps =
    roadmaps?.filter(
      (r) => !("status" in r) || (r as { status?: string }).status === "complete",
    ) ?? null;

  const canSubmit = selectedRoadmapId !== null && !submitting;

  const handleSubmit = async () => {
    if (!selectedRoadmapId || submitting) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const response = await createBattle({
        roadmapId: selectedRoadmapId,
        questionCount,
      });
      navigate(`/battle/lobby/${encodeURIComponent(response.joinCode)}`, {
        state: {
          battleId: response.battleId,
          joinCode: response.joinCode,
          expiresAt: response.expiresAt,
          questionCount: response.questionCount,
        },
      });
    } catch (err) {
      if (err instanceof BattleApiError) {
        setErrorMsg(mapCreateError(err));
      } else {
        setErrorMsg("Connection lost. Check your network and try again.");
      }
      toast.error("Couldn't create battle");
      setSubmitting(false);
    }
  };

  return (
    <div className="px-4 pt-6 pb-24 mx-auto max-w-[480px]">
      <Link
        to="/battle"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground min-h-12"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Back
      </Link>

      <h1 className="text-xl font-semibold leading-tight mt-2 mb-1">
        Create battle
      </h1>
      <p className="text-base text-muted-foreground leading-snug mb-6">
        Pick a topic you&apos;ve studied, set the length, and share the code.
      </p>

      <div className="flex flex-col gap-8">
        {roadmapsLoading && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-20 w-full rounded-lg" />
            <Skeleton className="h-20 w-full rounded-lg" />
          </div>
        )}

        {roadmapsError && (
          <Card>
            <CardContent className="p-6 text-base text-muted-foreground">
              Couldn&apos;t load your roadmaps. Try again in a moment.
            </CardContent>
          </Card>
        )}

        {!roadmapsLoading && !roadmapsError && (
          <RoadmapPicker
            roadmaps={visibleRoadmaps}
            selectedId={selectedRoadmapId}
            onSelect={setSelectedRoadmapId}
            emptyState={
              <Card>
                <CardContent className="p-6 flex flex-col items-center text-center gap-3">
                  <p className="text-base text-muted-foreground">
                    You don&apos;t have any roadmaps yet. Create one from the
                    Chat tab to battle on it.
                  </p>
                  <Button
                    className="min-h-12"
                    onClick={() => navigate("/chat")}
                  >
                    Go to Chat
                  </Button>
                </CardContent>
              </Card>
            }
          />
        )}

        <QuestionCountPicker
          value={questionCount}
          onChange={setQuestionCount}
        />

        <WagerTierPicker
          value={wagerTierLocal}
          onChange={setWagerTierLocal}
          currentXp={userStats?.xp}
        />

        {errorMsg && (
          <p role="alert" className="text-sm text-destructive">
            {errorMsg}
          </p>
        )}

        <Button
          className="min-h-12"
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          {submitting ? "Creating…" : "Create battle"}
        </Button>
      </div>
    </div>
  );
}

function mapCreateError(err: BattleApiError): string {
  const serverMsg = err.serverMessage?.toLowerCase() ?? "";
  if (err.status === 400 && serverMsg.includes("xp")) {
    return "You need at least 10 XP to create a battle. Earn XP from lessons first.";
  }
  if (err.status === 400 && serverMsg.includes("already")) {
    return "You're already in another battle. Finish or cancel it first.";
  }
  if (err.status === 401) {
    return "Session expired. Sign in again to rejoin.";
  }
  if (err.status === 429) {
    return "Too many battles started. Wait a minute before trying again.";
  }
  return err.serverMessage || "Something went wrong. Try again.";
}
