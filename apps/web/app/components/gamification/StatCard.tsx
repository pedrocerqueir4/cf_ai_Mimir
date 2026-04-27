import type { ReactNode } from "react";
import { Card, CardContent } from "~/components/ui/card";
import { cn } from "~/lib/utils";

interface StatCardProps {
  label: string;
  /**
   * Primary stat value. Accepts strings, numbers, or any ReactNode so that
   * callers can compose richer primitives (`XPCounterDisplay`,
   * `StreakFlame`, `LevelBadge`) directly into the value slot. Optional when
   * `renderValue` is provided.
   */
  value?: ReactNode;
  /**
   * Render-prop alternative to `value` for callers that need to construct
   * the primary node lazily or thread additional context. When both are
   * present, `renderValue` wins.
   */
  renderValue?: () => ReactNode;
  icon?: ReactNode;
  /**
   * Optional delta line (`caption` token) shown below the primary value.
   * Positive deltas render in `--success`, negative in `--destructive`,
   * neutral strings render in `--fg-muted`.
   */
  delta?: { value: string; tone?: "positive" | "negative" | "neutral" };
  className?: string;
}

/**
 * Phase 06 Plan 03 — Stats Grid contract (UI-SPEC § Stats Grid):
 *
 *   <dt> label  (`label` token, `--fg-muted`, top)
 *   <dd> primary number (`display-md` Rubik Mono One, `--fg`)
 *   <dd> delta (caption, emerald or ruby)
 *
 * The component now renders semantic `<dt>` / `<dd>` so a parent `<dl>` on
 * the dashboard wires up the Stats Grid A11y contract automatically.
 */
export function StatCard({
  label,
  value,
  renderValue,
  icon,
  delta,
  className,
}: StatCardProps) {
  const primary = renderValue ? renderValue() : value;

  const deltaToneClass =
    delta?.tone === "negative"
      ? "text-[hsl(var(--destructive))]"
      : delta?.tone === "neutral"
        ? "text-[hsl(var(--fg-muted))]"
        : "text-[hsl(var(--success))]";

  return (
    <Card className={cn("min-h-12", className)}>
      <CardContent className="flex flex-col gap-1 p-4">
        {icon && <div className="text-[hsl(var(--fg-muted))]">{icon}</div>}
        <dt className="text-[13px] font-medium leading-[1.3] tracking-[0.01em] text-[hsl(var(--fg-muted))]">
          {label}
        </dt>
        <dd className="font-display tabular-nums text-foreground text-[28px] leading-[1.15] lg:text-[36px] lg:leading-[1.1]">
          {primary}
        </dd>
        {delta && (
          <dd
            className={cn(
              "text-[12px] leading-[1.4] tracking-[0.005em]",
              deltaToneClass,
            )}
          >
            {delta.value}
          </dd>
        )}
      </CardContent>
    </Card>
  );
}
