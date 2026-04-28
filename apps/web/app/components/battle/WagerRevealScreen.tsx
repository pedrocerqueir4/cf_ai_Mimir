import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "~/lib/utils";
import {
  SlotMachineReel,
  type SlotMachineReelItemBase,
} from "./SlotMachineReel";

/**
 * Full-viewport component for the SECOND pre-battle reveal (wager tier).
 *
 * UI-SPEC §Pre-Battle Reveals copy:
 *   - Heading during spin:       "Picking wager…"
 *   - Heading on lock:           "Wager locked"
 *   - Tier-locked body on lock:  "You'll each risk {percent}% of your XP."
 *
 * UI-SPEC §Slot-machine reveal animation — wager reveal items alternate host
 * and guest proposed tiers, each rendering as `{tier}%` (Display, weight 600,
 * tabular-nums) with an `XP` Label underneath. The winning tier (server-side
 * coin flip) lands at FINAL_INDEX.
 */
export type WagerTier = 10 | 15 | 20;

interface WagerRevealReelItem extends SlotMachineReelItemBase {
  id: string;
  tier: WagerTier;
}

export interface WagerRevealScreenProps {
  hostTier: WagerTier;
  guestTier: WagerTier;
  /** Server-side random pick from `[hostTier, guestTier]`. Applied to both players (D-17). */
  appliedTier: WagerTier;
  /** Called ~500ms after the reel's 1s idle-hold so the parent can advance. */
  onComplete: () => void;
}

const REEL_LENGTH = 40;
const FINAL_INDEX = 37;
const POST_SETTLE_ADVANCE_MS = 750;

function buildWagerReelItems({
  hostTier,
  guestTier,
  appliedTier,
}: {
  hostTier: WagerTier;
  guestTier: WagerTier;
  appliedTier: WagerTier;
}): WagerRevealReelItem[] {
  // Alternating host / guest tiers as decoys. When both tiers are equal
  // (e.g. both players picked 20%), add the third tier as a distractor so
  // the reel doesn't look static.
  const cycle: WagerTier[] = hostTier === guestTier
    ? [hostTier, guestTier, ([10, 15, 20] as WagerTier[]).find((t) => t !== hostTier)!]
    : [hostTier, guestTier];

  const items: WagerRevealReelItem[] = [];
  for (let i = 0; i < REEL_LENGTH; i++) {
    if (i === FINAL_INDEX) {
      items.push({ id: `winner-${i}`, tier: appliedTier });
    } else {
      const pick = cycle[i % cycle.length]!;
      items.push({ id: `tier-${i}`, tier: pick });
    }
  }
  return items;
}

export function WagerRevealScreen({
  hostTier,
  guestTier,
  appliedTier,
  onComplete,
}: WagerRevealScreenProps) {
  const [settled, setSettled] = useState(false);
  const items = useMemo(
    () => buildWagerReelItems({ hostTier, guestTier, appliedTier }),
    [hostTier, guestTier, appliedTier],
  );

  function handleReelSettled() {
    setSettled(true);
    window.setTimeout(() => {
      onComplete();
    }, POST_SETTLE_ADVANCE_MS);
  }

  const heading = settled ? "Wager locked" : "Picking wager\u2026";
  // UI-SPEC §Pre-Battle Reveals copy — "You'll each risk {percent}% of your XP."
  const lockedBody = `You'll each risk ${appliedTier}% of your XP.`;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-8">
      <motion.h1
        key={heading}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="mb-8 text-[22px] font-semibold leading-[1.25] -tracking-[0.005em]"
      >
        {heading}
      </motion.h1>

      <SlotMachineReel<WagerRevealReelItem>
        items={items}
        finalIndex={FINAL_INDEX}
        spinningLabel="Picking wager"
        lockedLabel={(item) => `Wager locked: ${item.tier}% of XP`}
        onAnimationComplete={handleReelSettled}
        renderItem={(item, isActive) => (
          <div
            className={cn(
              "flex h-full w-full flex-col items-center justify-center gap-0.5 px-4",
            )}
          >
            <span
              className={cn(
                "font-display text-[28px] leading-[1.15] tabular-nums lg:text-[36px]",
                isActive ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {item.tier}%
            </span>
            <span className="text-sm font-normal leading-snug text-muted-foreground">
              XP
            </span>
          </div>
        )}
      />

      {settled && (
        <motion.p
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, delay: 0.1 }}
          className="mt-8 max-w-md text-center text-base leading-relaxed text-muted-foreground"
        >
          {lockedBody}
        </motion.p>
      )}
    </div>
  );
}
