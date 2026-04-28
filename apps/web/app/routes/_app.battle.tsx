import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { Sword, ScanLine } from "lucide-react";
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

// UI-SPEC § Motion `list-reveal-stagger`.
const listContainerVariants: Variants = {
  hidden: { opacity: 1 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04 } },
};

function buildItemVariants(reduced: boolean | null): Variants {
  return reduced
    ? {
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: { duration: 0.12 } },
      }
    : {
        hidden: { opacity: 0, y: 12 },
        visible: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.32, ease: [0.4, 0, 0.2, 1] as const },
        },
      };
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
      {/* Hero — display-lg "Quiz Battle" + body subtitle (UI-SPEC § Battle Landing) */}
      <div className="text-center mb-10">
        <h1 className="font-display text-[36px] leading-[1.1] -tracking-[0.01em] lg:text-[48px] lg:leading-[1.05]">
          Quiz Battle
        </h1>
        <p className="text-[16px] leading-[1.5] text-[hsl(var(--fg-muted))] mt-3 max-w-md mx-auto">
          Challenge your knowledge against other learners.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="grid w-full grid-cols-3 mb-6">
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

        <TabsContent value="create">
          <CreateTabPanel />
        </TabsContent>

        <TabsContent value="join">
          <JoinTabPanel />
        </TabsContent>

        <TabsContent value="leaderboard">
          <LeaderboardTabPanel
            activeWindow={activeWindow}
            onWindowChange={handleWindowChange}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Create tab — large action card with jewel CTA ────────────────────────────

function CreateTabPanel() {
  return (
    <Card>
      <CardContent className="p-6 flex flex-col gap-4 items-start">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-md)] bg-[hsl(var(--dominant-soft))] text-[hsl(var(--dominant))]">
            <Sword className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="flex flex-col">
            <h2 className="text-[22px] font-semibold leading-[1.25] -tracking-[0.005em]">
              Create battle
            </h2>
            <p className="text-[14px] leading-[1.5] text-[hsl(var(--fg-muted))]">
              Pick a topic, set the length, share the code.
            </p>
          </div>
        </div>
        <Button variant="jewel" asChild className="w-full">
          <Link to="/battle/new">Create battle</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Join tab — large action card with outline CTA ────────────────────────────

function JoinTabPanel() {
  return (
    <Card>
      <CardContent className="p-6 flex flex-col gap-4 items-start">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-md)] bg-[hsl(var(--dominant-soft))] text-[hsl(var(--dominant))]">
            <ScanLine className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="flex flex-col">
            <h2 className="text-[22px] font-semibold leading-[1.25] -tracking-[0.005em]">
              Join battle
            </h2>
            <p className="text-[14px] leading-[1.5] text-[hsl(var(--fg-muted))]">
              Enter the code your opponent shared with you.
            </p>
          </div>
        </div>
        <Button variant="outline" asChild className="w-full">
          <Link to="/battle/join">Join battle</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Leaderboard tab — ranked list with stagger + amethyst-soft top-3 sweep ───

interface LeaderboardTabPanelProps {
  activeWindow: LeaderboardWindow;
  onWindowChange: (value: string) => void;
}

function LeaderboardTabPanel({
  activeWindow,
  onWindowChange,
}: LeaderboardTabPanelProps) {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const itemVariants = buildItemVariants(reducedMotion);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["battle", "leaderboard", activeWindow],
    queryFn: () => fetchLeaderboard(activeWindow),
    staleTime: 30_000,
  });

  const isEmpty = !isLoading && !isError && (data?.entries.length ?? 0) === 0;

  const emptyCopy = useMemo(() => {
    return {
      heading: "No battles played",
      body: "Leaderboard fills up after your first battle.",
    };
  }, []);

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
          <Skeleton className="h-16 w-full rounded-[var(--radius-lg)]" />
          <Skeleton className="h-16 w-full rounded-[var(--radius-lg)]" />
          <Skeleton className="h-16 w-full rounded-[var(--radius-lg)]" />
        </div>
      )}

      {isError && (
        <p
          role="alert"
          className="text-[16px] leading-[1.5] text-[hsl(var(--fg-muted))]"
        >
          Couldn&apos;t load the leaderboard. Try again in a moment.
        </p>
      )}

      {isEmpty && (
        <Card>
          <CardContent className="p-6 flex flex-col items-center text-center gap-3">
            <h3 className="text-[18px] font-medium leading-[1.3]">
              {emptyCopy.heading}
            </h3>
            <p className="text-[14px] leading-[1.5] text-[hsl(var(--fg-muted))] max-w-xs">
              {emptyCopy.body}
            </p>
            <Button
              variant="jewel"
              className="mt-1"
              onClick={() => navigate("/battle?tab=create")}
            >
              Create battle
            </Button>
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && data && data.entries.length > 0 && (
        <ScrollArea className="max-h-[640px] lg:max-h-[560px]">
          <motion.ol
            key={activeWindow}
            variants={listContainerVariants}
            initial="hidden"
            animate="visible"
            aria-label={
              activeWindow === "week"
                ? "Weekly leaderboard top 50"
                : "All-time leaderboard top 50"
            }
            className="flex flex-col gap-1 list-none p-0 m-0"
          >
            {data.entries.map((entry) => (
              <motion.li
                key={entry.userId}
                variants={itemVariants}
                aria-label={`Rank ${entry.rank}`}
              >
                <LeaderboardRow entry={entry} />
              </motion.li>
            ))}
          </motion.ol>
        </ScrollArea>
      )}
    </div>
  );
}
