import { cn } from "@/lib/utils";
import { ComparisonBadge } from "./ComparisonBadge";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { FreshnessBadge } from "./FreshnessBadge";

interface HeroMetricProps {
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
  maturityPhase?: { phase: number; label: string };
  className?: string;
}

const MATURITY_COLORS = ["text-muted", "text-warning", "text-cyan", "text-success"];

export function HeroMetric({
  value,
  label,
  interpretation,
  unit,
  comparison,
  freshness,
  confidence,
  maturityPhase,
  className,
}: HeroMetricProps) {
  return (
    <div className={cn("relative rounded-lg border border-border bg-surface p-6", className)}>
      {maturityPhase && (
        <div className="absolute right-4 top-4 flex items-center gap-1.5">
          <span
            className={cn(
              "font-mono text-xs font-semibold",
              MATURITY_COLORS[Math.min(maturityPhase.phase - 1, 3)],
            )}
          >
            Phase {maturityPhase.phase}
          </span>
          <span className="text-[10px] text-muted">{maturityPhase.label}</span>
        </div>
      )}
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted">
        {label}
      </div>
      <div className="font-mono text-5xl font-bold text-foreground">
        {value}
        {unit && <span className="ml-2 text-xl text-muted">{unit}</span>}
      </div>
      {interpretation && <div className="mt-2 text-sm text-muted">{interpretation}</div>}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {comparison && <ComparisonBadge {...comparison} />}
        {freshness && <FreshnessBadge {...freshness} />}
        {confidence && <ConfidenceBadge {...confidence} />}
      </div>
    </div>
  );
}
