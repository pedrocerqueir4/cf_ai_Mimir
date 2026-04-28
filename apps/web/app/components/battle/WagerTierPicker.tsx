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
        className="text-[22px] font-semibold leading-[1.25] -tracking-[0.005em] mb-1"
      >
        What are you risking?
      </h2>
      <p className="text-[14px] leading-[1.5] text-[hsl(var(--fg-muted))] mb-3">
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
                "flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-[var(--radius-md)] border px-3 py-2 transition-colors",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]",
                isSelected
                  ? "border-[hsl(var(--dominant))] bg-[hsl(var(--dominant-soft))] text-[hsl(var(--dominant))]"
                  : "border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] text-[hsl(var(--fg-muted))] hover:bg-[hsl(var(--bg-subtle))]",
              )}
            >
              <span className="font-display tabular-nums text-[22px] leading-[1.15]">
                {tier}%
              </span>
              {preview && (
                <span className="text-[14px] font-normal leading-[1.5] tabular-nums">
                  {preview}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="text-[14px] leading-[1.5] text-[hsl(var(--fg-muted))] mt-2">
        Minimum wager is 10 XP.
      </p>
    </section>
  );
}
