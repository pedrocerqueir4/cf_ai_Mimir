import { useMemo, useState } from "react";
import { Map } from "lucide-react";
import { motion } from "framer-motion";
import { BATTLE_STARTER_TOPICS } from "~/lib/battle-presets";
import { cn } from "~/lib/utils";
import {
  SlotMachineReel,
  type SlotMachineReelItemBase,
} from "./SlotMachineReel";

/**
 * Full-viewport component for the FIRST pre-battle reveal (roadmap pick).
 *
 * UI-SPEC §Pre-Battle Reveals copy:
 *   - Heading during spin: "Picking topic…"
 *   - Heading on lock:     "Topic locked"
 *
 * UI-SPEC §Slot-machine reveal animation — roadmap reveal items = roadmap
 * name (Display 28/40 mobile-desktop, weight 600) + Lucide `Map` icon left.
 * Distractors: topic-adjacent strings from BATTLE_STARTER_TOPICS interleaved
 * with the two actually-proposed roadmaps.
 */
interface RoadmapRevealReelItem extends SlotMachineReelItemBase {
  id: string;
  title: string;
}

export interface RoadmapRevealScreenProps {
  /** Topic for the host's proposed roadmap. Used to build distractors. */
  hostTopic: string;
  /** Topic for the guest's proposed roadmap (falls back to host if missing). */
  guestTopic: string;
  /** The winning roadmap topic — what the reel settles on. */
  winningTopic: string;
  /** Called ~500ms after the reel's 1s idle-hold so the parent can advance. */
  onComplete: () => void;
}

// Reel target: 40 items with winner at index 37. Matches UI-SPEC "roughly 40
// items, with the server-picked winner positioned so that it lands dead-center
// of the visible area at the final offset."
const REEL_LENGTH = 40;
const FINAL_INDEX = 37;
const POST_SETTLE_ADVANCE_MS = 750;

/**
 * Build the reel item list. The pool alternates (host, guest, decoys) so each
 * visible row during the spin looks plausibly like the winner. The winning
 * topic is placed exactly at FINAL_INDEX.
 */
function buildRoadmapReelItems({
  hostTopic,
  guestTopic,
  winningTopic,
}: {
  hostTopic: string;
  guestTopic: string;
  winningTopic: string;
}): RoadmapRevealReelItem[] {
  const decoyTopics = BATTLE_STARTER_TOPICS.slice(0, 3);
  const pool: string[] = [hostTopic, guestTopic, ...decoyTopics].filter(
    Boolean,
  );
  // Dedupe while preserving order — avoids "Foo / Foo / Foo" repeats when
  // both players proposed the same roadmap.
  const seen = new Set<string>();
  const dedupedPool = pool.filter((t) => {
    const key = t.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const cycle = dedupedPool.length > 0 ? dedupedPool : [winningTopic];

  const items: RoadmapRevealReelItem[] = [];
  for (let i = 0; i < REEL_LENGTH; i++) {
    if (i === FINAL_INDEX) {
      items.push({ id: `winner-${i}`, title: winningTopic });
    } else {
      const pick = cycle[i % cycle.length]!;
      items.push({ id: `decoy-${i}`, title: pick });
    }
  }
  return items;
}

export function RoadmapRevealScreen({
  hostTopic,
  guestTopic,
  winningTopic,
  onComplete,
}: RoadmapRevealScreenProps) {
  const [settled, setSettled] = useState(false);
  const items = useMemo(
    () => buildRoadmapReelItems({ hostTopic, guestTopic, winningTopic }),
    [hostTopic, guestTopic, winningTopic],
  );

  function handleReelSettled() {
    setSettled(true);
    // Reel's internal idle hold (1s) already elapsed before it invoked this
    // callback; we add a short extra beat so the heading change reads.
    window.setTimeout(() => {
      onComplete();
    }, POST_SETTLE_ADVANCE_MS);
  }

  const heading = settled ? "Topic locked" : "Picking topic\u2026";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-8">
      <motion.h1
        key={heading}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="mb-8 text-xl font-semibold leading-tight"
      >
        {heading}
      </motion.h1>

      <SlotMachineReel<RoadmapRevealReelItem>
        items={items}
        finalIndex={FINAL_INDEX}
        spinningLabel="Picking topic"
        lockedLabel={(item) => `Topic locked: ${item.title}`}
        onAnimationComplete={handleReelSettled}
        renderItem={(item, isActive) => (
          <div
            className={cn(
              "flex h-full w-full items-center justify-center gap-3 px-4",
              isActive && "text-foreground",
            )}
          >
            <Map
              className={cn(
                "h-6 w-6 shrink-0",
                isActive ? "text-primary" : "text-muted-foreground",
              )}
              aria-hidden
            />
            <span
              className={cn(
                "truncate text-[28px] font-semibold leading-tight lg:text-[40px]",
                isActive ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {item.title}
            </span>
          </div>
        )}
      />
    </div>
  );
}
