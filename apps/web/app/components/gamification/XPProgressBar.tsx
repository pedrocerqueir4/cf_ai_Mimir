import { Progress } from "~/components/ui/progress";
import { Badge } from "~/components/ui/badge";

interface XPProgressBarProps {
  xp: number;
  level: number;
  xpToNextLevel: number;
  progressPercent: number;
}

export function XPProgressBar({
  xp,
  level,
  xpToNextLevel,
  progressPercent,
}: XPProgressBarProps) {
  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-2">
        <Badge variant="default" className="text-sm px-3 py-1">
          Lv. {level}
        </Badge>
        <span className="text-[12px] leading-[1.4] tracking-[0.005em] text-[hsl(var(--fg-muted))]">
          {xpToNextLevel} XP to Level {level + 1}
        </span>
      </div>
      {/* UI-SPEC § Component Contract Progress row — `xp` variant adds the
          emerald-tinted gradient + count-up motion when value increases. */}
      <Progress variant="xp" value={progressPercent} className="h-2" />
      <p className="text-[12px] leading-[1.4] tracking-[0.005em] text-[hsl(var(--fg-muted))] mt-1">
        {xp} XP total
      </p>
    </div>
  );
}
