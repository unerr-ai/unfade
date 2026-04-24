import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ComparisonBadge } from "./ComparisonBadge";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { FreshnessBadge } from "./FreshnessBadge";

interface MetricDisplayProps {
  value: string | number;
  label: string;
  interpretation?: string;
  unit?: string;
  comparison?: {
    delta: number;
    label: string;
    direction: "up" | "down" | "flat";
    goodDirection?: "up" | "down";
  };
  freshness?: { updatedAt: string; isLive?: boolean };
  confidence?: { level: "high" | "medium" | "low" | "insufficient"; basis?: string };
  className?: string;
  children?: ReactNode;
}

export function MetricDisplay({
  value,
  label,
  interpretation,
  unit,
  comparison,
  freshness,
  confidence,
  className,
  children,
}: MetricDisplayProps) {
  return (
    <div className={cn("rounded-lg border border-border bg-surface p-4", className)}>
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted">
        {label}
      </div>
      <div className="font-mono text-3xl font-bold text-foreground">
        {value}
        {unit && <span className="ml-1 text-lg text-muted">{unit}</span>}
      </div>
      {interpretation && <div className="mt-1 text-xs text-muted">{interpretation}</div>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {comparison && <ComparisonBadge {...comparison} />}
        {freshness && <FreshnessBadge {...freshness} />}
        {confidence && <ConfidenceBadge {...confidence} />}
      </div>
      {children}
    </div>
  );
}
