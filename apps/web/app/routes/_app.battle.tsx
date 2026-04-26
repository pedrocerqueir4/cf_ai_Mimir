import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Skeleton } from "~/components/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "~/components/ui/tabs";
import { LeaderboardRow } from "~/components/battle/LeaderboardRow";
import { fetchLeaderboard } from "~/lib/api-client";

type TopTab = "create" | "join" | "leaderboard";
type LeaderboardWindow = "week" | "all";

function isTopTab(v: string | null): v is TopTab {
  return v === "create" || v === "join" || v === "leaderboard";
}

function isLeaderboardWindow(v: string | null): v is LeaderboardWindow {
  return v === "week" || v === "all";
}

export default function BattlePage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const rawTab = searchParams.get("tab");
  const activeTab: TopTab = isTopTab(rawTab) ? rawTab : "create";

  const rawWindow = searchParams.get("window");
  const activeWindow: LeaderboardWindow = isLeaderboardWindow(rawWindow)
    ? rawWindow
    : "week";

  const handleTabChange = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", value);
    setSearchParams(next, { replace: true });
  };

  const handleWindowChange = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("window", value);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="px-4 pt-8 pb-24">
      <h1 className="text-xl font-semibold leading-tight mb-4">Battle</h1>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="create" className="min-h-12">
            Create
          </TabsTrigger>
          <TabsTrigger value="join" className="min-h-12">
            Join
          </TabsTrigger>
          <TabsTrigger value="leaderboard" className="min-h-12">
            Leaderboard
          </TabsTrigger>
        </TabsList>

        <TabsContent value="create" className="mt-6">
          <CreateTabPanel />
        </TabsContent>

        <TabsContent value="join" className="mt-6">
          <JoinTabPanel />
        </TabsContent>

        <TabsContent value="leaderboard" className="mt-6">
          <LeaderboardTabPanel
            activeWindow={activeWindow}
            onWindowChange={handleWindowChange}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Create tab ──────────────────────────────────────────────────────────────

function CreateTabPanel() {
  const navigate = useNavigate();
  return (
    <Card>
      <CardContent className="p-6 flex flex-col gap-4">
        <h2 className="text-xl font-semibold leading-tight">
          Challenge someone
        </h2>
        <p className="text-base text-muted-foreground leading-snug">
          Pick a topic you&apos;ve studied, set the length, and share the code.
        </p>
        <Button
          className="min-h-12"
          onClick={() => navigate("/battle/new")}
        >
          Create battle
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Join tab ────────────────────────────────────────────────────────────────

function JoinTabPanel() {
  const navigate = useNavigate();
  return (
    <Card>
      <CardContent className="p-6 flex flex-col gap-4">
        <h2 className="text-xl font-semibold leading-tight">Join a battle</h2>
        <p className="text-base text-muted-foreground leading-snug">
          Enter the 6-character code your opponent shared with you.
        </p>
        <Button
          className="min-h-12"
          onClick={() => navigate("/battle/join")}
        >
          Join battle
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Leaderboard tab ─────────────────────────────────────────────────────────

interface LeaderboardTabPanelProps {
  activeWindow: LeaderboardWindow;
  onWindowChange: (value: string) => void;
}

function LeaderboardTabPanel({
  activeWindow,
  onWindowChange,
}: LeaderboardTabPanelProps) {
  const navigate = useNavigate();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["battle", "leaderboard", activeWindow],
    queryFn: () => fetchLeaderboard(activeWindow),
    staleTime: 30_000,
  });

  const isEmpty = !isLoading && !isError && (data?.entries.length ?? 0) === 0;

  const emptyCopy = useMemo(() => {
    if (activeWindow === "week") {
      return {
        heading: "No battles yet this week",
        body: "Start a battle to put yourself on the board.",
      };
    }
    return {
      heading: "No battles yet",
      body: "Start a battle to put yourself on the board.",
    };
  }, [activeWindow]);

  return (
    <div className="flex flex-col gap-4">
      <Tabs value={activeWindow} onValueChange={onWindowChange}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="week" className="min-h-12">
            This week
          </TabsTrigger>
          <TabsTrigger value="all" className="min-h-12">
            All time
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading && (
        <div className="flex flex-col gap-2" aria-label="Loading leaderboard">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      )}

      {isError && (
        <p role="alert" className="text-base text-muted-foreground">
          Couldn&apos;t load the leaderboard. Try again in a moment.
        </p>
      )}

      {isEmpty && (
        <Card>
          <CardContent className="p-6 flex flex-col items-center text-center gap-3">
            <h3 className="text-xl font-semibold leading-tight">
              {emptyCopy.heading}
            </h3>
            <p className="text-base text-muted-foreground max-w-xs">
              {emptyCopy.body}
            </p>
            <Button
              className="min-h-12"
              onClick={() => navigate("/battle?tab=create")}
            >
              Create battle
            </Button>
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && data && data.entries.length > 0 && (
        <ScrollArea className="max-h-[640px] lg:max-h-[560px]">
          <ul
            aria-label={
              activeWindow === "week"
                ? "Weekly leaderboard top 50"
                : "All-time leaderboard top 50"
            }
            className="flex flex-col gap-1"
          >
            {data.entries.map((entry) => (
              <li key={entry.userId}>
                <LeaderboardRow entry={entry} />
              </li>
            ))}
          </ul>
        </ScrollArea>
      )}
    </div>
  );
}
