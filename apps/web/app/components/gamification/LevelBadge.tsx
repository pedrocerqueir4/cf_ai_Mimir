import { useRef, useEffect, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";

interface LevelBadgeProps {
  level: number;
}

export function LevelBadge({ level }: LevelBadgeProps) {
  const prevLevelRef = useRef(level);
  const [isPulsing, setIsPulsing] = useState(false);

  useEffect(() => {
    if (level > prevLevelRef.current) {
      setIsPulsing(true);
      const t = setTimeout(() => setIsPulsing(false), 1500);
      prevLevelRef.current = level;
      return () => clearTimeout(t);
    }
    prevLevelRef.current = level;
  }, [level]);

  return (
    <Badge
      variant="default"
      className={cn("text-sm px-3 py-1", isPulsing && "animate-pulse motion-reduce:animate-none")}
    >
      Lv. {level}
    </Badge>
  );
}
