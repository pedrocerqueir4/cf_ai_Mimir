import { cn } from "~/lib/utils";

export type WagerTier = 10 | 15 | 20;

interface WagerTierPickerProps {
  value: WagerTier;
  onChange: (value: WagerTier) => void;
  /** Optional — user's current XP used to preview the absolute wager amount. */
  currentXp?: number;
}

const TIERS: WagerTier[] = [10, 15, 20];
const MIN_WAGER_XP = 10;

function computeWager(xp: number, tier: WagerTier): number {
  const pct = Math.floor((xp * tier) / 100);
  return Math.max(MIN_WAGER_XP, pct);
}

/**
 * Three-button segmented picker for wager tier (UI-SPEC §Wager tier).
 * Shows "10%", "15%", "20%" + computed XP preview when currentXp provided.
 * Footnote: "Minimum wager is 10 XP."
 */
export function WagerTierPicker({
  value,
  onChange,
  currentXp,
}: WagerTierPickerProps) {
  return (
    <section aria-labelledby="wager-heading">
      <h2
        id="wager-heading"
        className="text-xl font-semibold leading-tight mb-1"
      >
        What are you risking?
      </h2>
      <p className="text-sm text-muted-foreground mb-3">
        You&apos;ll each pick a tier. A coin flip decides which one sticks.
      </p>
      <div
        role="radiogroup"
        aria-labelledby="wager-heading"
        className="grid grid-cols-3 gap-2"
      >
        {TIERS.map((tier) => {
          const isSelected = tier === value;
          const preview =
            typeof currentXp === "number"
              ? `${computeWager(currentXp, tier)} XP`
              : null;
          return (
            <button
              key={tier}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onChange(tier)}
              className={cn(
                "flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-lg border px-3 py-2 transition-colors",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isSelected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-muted/40",
              )}
            >
              <span className="text-xl font-semibold leading-tight tabular-nums">
                {tier}%
              </span>
              {preview && (
                <span className="text-sm font-normal leading-snug tabular-nums">
                  {preview}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="text-sm text-muted-foreground mt-2">
        Minimum wager is 10 XP.
      </p>
    </section>
  );
}
