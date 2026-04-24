import { cn } from "@/lib/utils";

interface ComparisonBadgeProps {
  delta: number;
  label: string;
  direction: "up" | "down" | "flat";
  goodDirection?: "up" | "down";
}

export function ComparisonBadge({
  delta,
  label,
  direction,
  goodDirection = "up",
}: ComparisonBadgeProps) {
  const isGood = direction === "flat" ? null : direction === goodDirection;
  const arrow = direction === "up" ? "↑" : direction === "down" ? "↓" : "→";
  const color = isGood === null ? "text-muted" : isGood ? "text-success" : "text-warning";

  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", color)}>
      {arrow} {Math.abs(delta)}% {label}
    </span>
  );
}
