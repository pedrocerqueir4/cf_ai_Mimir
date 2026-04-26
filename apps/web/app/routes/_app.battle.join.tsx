import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import {
  JoinCodeInput,
  JOIN_CODE_LENGTH,
} from "~/components/battle/JoinCodeInput";
import { RoadmapPicker } from "~/components/battle/RoadmapPicker";
import {
  BattleApiError,
  fetchRoadmaps,
  joinBattle,
  type RoadmapListItem,
} from "~/lib/api-client";
import { BATTLE_STARTER_TOPICS } from "~/lib/battle-presets";

// Stable synthetic id for preset topics so the RoadmapPicker radio group
// can track selection without colliding with real roadmap ids.
const PRESET_ID_PREFIX = "preset:";
const presetId = (topic: string) => `${PRESET_ID_PREFIX}${topic}`;

const PRESET_ROADMAPS: RoadmapListItem[] = BATTLE_STARTER_TOPICS.map(
  (topic) => ({
    id: presetId(topic),
    title: topic,
    topic,
    complexity: "linear",
    status: "complete",
    totalLessons: 0,
    completedLessons: 0,
    createdAt: new Date(0).toISOString(),
  }),
);

export default function BattleJoinPage() {
  const navigate = useNavigate();

  const [joinCode, setJoinCode] = useState<string>("");
  const [selectedRoadmapId, setSelectedRoadmapId] = useState<string | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  const {
    data: roadmaps,
    isLoading: roadmapsLoading,
    isError: roadmapsError,
  } = useQuery({
    queryKey: ["roadmaps"],
    queryFn: fetchRoadmaps,
  });

  const visibleRoadmaps =
    roadmaps?.filter(
      (r) => !("status" in r) || (r as { status?: string }).status === "complete",
    ) ?? null;

  const hasOwnRoadmaps = (visibleRoadmaps?.length ?? 0) > 0;

  // If the user has no roadmaps, fall back to the preset starter list.
  const pickerRoadmaps: RoadmapListItem[] | null = roadmapsLoading
    ? null
    : hasOwnRoadmaps
      ? visibleRoadmaps
      : PRESET_ROADMAPS;

  // Reset selected id when the picker swaps between own/preset lists.
  useEffect(() => {
    setSelectedRoadmapId(null);
  }, [hasOwnRoadmaps]);

  const codeComplete = joinCode.length === JOIN_CODE_LENGTH;
  const canSubmit = codeComplete && selectedRoadmapId !== null && !submitting;

  const handleCodeChange = (next: string) => {
    setJoinCode(next);
    if (codeError) setCodeError(null);
    if (generalError) setGeneralError(null);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setCodeError(null);
    setGeneralError(null);
    try {
      // Preset ids aren't real roadmap rows. The server accepts an alternate
      // `presetTopic` field — branches past the IDOR roadmap-ownership check
      // and uses the raw topic string as the pool lookup handle. Own roadmaps
      // send `roadmapId` and go through the ownership-verified path.
      const isPreset = selectedRoadmapId!.startsWith(PRESET_ID_PREFIX);
      const response = await joinBattle(
        isPreset
          ? {
              joinCode,
              presetTopic: selectedRoadmapId!.slice(PRESET_ID_PREFIX.length),
            }
          : {
              joinCode,
              roadmapId: selectedRoadmapId!,
            },
      );

      navigate(`/battle/pre/${encodeURIComponent(response.battleId)}`, {
        state: {
          status: response.status,
          battleId: response.battleId,
          winningRoadmapId: response.winningRoadmapId,
          winningTopic: response.winningTopic,
          poolTopicId: response.poolTopicId,
          workflowRunId:
            response.status === "generating"
              ? response.workflowRunId
              : undefined,
        },
      });
    } catch (err) {
      if (err instanceof BattleApiError) {
        const mapped = mapJoinError(err);
        if (mapped.target === "code") setCodeError(mapped.message);
        else setGeneralError(mapped.message);
      } else {
        setGeneralError("Connection lost. Check your network and try again.");
      }
      toast.error("Couldn't join battle");
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

      <h1 className="text-xl font-semibold leading-tight mt-2 mb-6">
        Enter join code
      </h1>

      <div className="flex flex-col gap-8">
        <JoinCodeInput
          value={joinCode}
          onChange={handleCodeChange}
          error={codeError}
        />

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
            roadmaps={pickerRoadmaps}
            selectedId={selectedRoadmapId}
            onSelect={setSelectedRoadmapId}
            emptyState={
              <Card>
                <CardContent className="p-6 text-base text-muted-foreground">
                  You don&apos;t have any roadmaps yet. Pick one of the starter
                  topics to join this battle.
                </CardContent>
              </Card>
            }
          />
        )}

        {!hasOwnRoadmaps && !roadmapsLoading && !roadmapsError && (
          <p className="text-sm text-muted-foreground -mt-6">
            Starter topics let you jump into a battle even without your own
            roadmap.
          </p>
        )}

        {generalError && (
          <p role="alert" className="text-sm text-destructive">
            {generalError}
          </p>
        )}

        <Button
          className="min-h-12"
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          {submitting ? "Joining…" : "Join battle"}
        </Button>
      </div>
    </div>
  );
}

function mapJoinError(
  err: BattleApiError,
): { target: "code" | "general"; message: string } {
  const serverMsg = err.serverMessage?.toLowerCase() ?? "";

  if (err.status === 404) {
    return {
      target: "code",
      message:
        "No battle found with this code. Check the code and try again.",
    };
  }
  if (err.status === 410) {
    return {
      target: "code",
      message:
        "This lobby expired. Ask your opponent to start a new one.",
    };
  }
  if (err.status === 400) {
    if (serverMsg.includes("two players") || serverMsg.includes("full")) {
      return {
        target: "code",
        message: "This battle already has two players.",
      };
    }
    if (serverMsg.includes("your own")) {
      return {
        target: "code",
        message: "You can't join your own battle.",
      };
    }
    if (serverMsg.includes("ended") || serverMsg.includes("completed")) {
      return {
        target: "code",
        message: "This battle has already ended.",
      };
    }
    if (serverMsg.includes("already") && serverMsg.includes("battle")) {
      return {
        target: "general",
        message:
          "You're already in another battle. Finish or cancel it first.",
      };
    }
  }
  if (err.status === 401) {
    return {
      target: "general",
      message: "Session expired. Sign in again to rejoin.",
    };
  }
  if (err.status === 429) {
    return {
      target: "general",
      message:
        "Too many battles started. Wait a minute before trying again.",
    };
  }
  return {
    target: "general",
    message: err.serverMessage || "Something went wrong. Try again.",
  };
}
