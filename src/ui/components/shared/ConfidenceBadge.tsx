import { cn } from "@/lib/utils";

interface ConfidenceBadgeProps {
  level: "high" | "medium" | "low" | "insufficient";
  basis?: string;
}

const COLORS: Record<string, string> = {
  high: "bg-success/20 text-success",
  medium: "bg-warning/20 text-warning",
  low: "bg-error/20 text-error",
  insufficient: "bg-muted/20 text-muted",
};

export function ConfidenceBadge({ level, basis }: ConfidenceBadgeProps) {
  return (
    <span
      className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-xs", COLORS[level])}
      title={basis ? `Confidence based on: ${basis}` : undefined}
    >
      {level}
      {basis && <span className="ml-1 opacity-75">({basis})</span>}
    </span>
  );
}
