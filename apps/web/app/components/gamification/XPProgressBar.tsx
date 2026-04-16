import { Progress } from "~/components/ui/progress";
import { Badge } from "~/components/ui/badge";

interface XPProgressBarProps {
  xp: number;
  level: number;
  xpToNextLevel: number;
  progressPercent: number;
}

export function XPProgressBar({ xp, level, xpToNextLevel, progressPercent }: XPProgressBarProps) {
  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-2">
        <Badge variant="default" className="text-sm px-3 py-1">Lv. {level}</Badge>
        <span className="text-sm text-muted-foreground">{xpToNextLevel} XP to Level {level + 1}</span>
      </div>
      <Progress value={progressPercent} className="h-2 transition-[width] duration-400 ease-out" />
      <p className="text-xs text-muted-foreground mt-1">{xp} XP total</p>
    </div>
  );
}
