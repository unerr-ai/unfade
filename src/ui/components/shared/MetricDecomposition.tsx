import { cn } from "@/lib/utils";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";

export interface MetricComponentData {
  name: string;
  weight: number;
  value: number;
  contribution: number;
  trend?: "improving" | "stable" | "declining";
}

interface MetricDecompositionProps {
  label: string;
  totalScore: number;
  components: MetricComponentData[];
  formula?: string;
  onComponentClick?: (component: MetricComponentData) => void;
  className?: string;
}

const TREND_ICONS = {
  improving: TrendingUp,
  stable: Minus,
  declining: TrendingDown,
} as const;

const TREND_COLORS = {
  improving: "text-success",
  stable: "text-muted",
  declining: "text-error",
} as const;

export function MetricDecomposition({
  label,
  totalScore,
  components,
  formula,
  onComponentClick,
  className,
}: MetricDecompositionProps) {
  const maxContribution = Math.max(...components.map((c) => c.contribution), 1);

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-baseline justify-between">
        <h4 className="text-sm font-medium text-foreground">{label}</h4>
        <span className="text-2xl font-bold tabular-nums text-foreground">{totalScore}</span>
      </div>

      {formula && (
        <p className="text-[10px] font-mono text-muted bg-raised px-2 py-1 rounded">{formula}</p>
      )}

      <div className="space-y-2">
        {components.map((comp) => {
          const barWidth = Math.max(2, (comp.contribution / maxContribution) * 100);
          const TrendIcon = comp.trend ? TREND_ICONS[comp.trend] : null;
          const trendColor = comp.trend ? TREND_COLORS[comp.trend] : "";

          return (
            <button
              key={comp.name}
              type="button"
              onClick={() => onComponentClick?.(comp)}
              disabled={!onComponentClick}
              className={cn(
                "w-full text-left group",
                onComponentClick && "cursor-pointer hover:bg-raised/50 rounded -mx-1 px-1 py-0.5 transition-colors",
              )}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="text-foreground/80 flex items-center gap-1.5">
                  {comp.name}
                  <span className="text-muted">
                    ({Math.round(comp.weight * 100)}%)
                  </span>
                </span>
                <span className="flex items-center gap-1.5 tabular-nums">
                  <span className="text-foreground font-medium">{Math.round(comp.value)}</span>
                  <span className="text-muted">→</span>
                  <span className="text-accent font-medium">{Math.round(comp.contribution)}</span>
                  {TrendIcon && (
                    <TrendIcon className={cn("h-3 w-3", trendColor)} />
                  )}
                </span>
              </div>

              <div className="mt-1 h-1.5 w-full rounded-full bg-raised overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-300",
                    comp.value >= 70 ? "bg-success" :
                    comp.value >= 40 ? "bg-warning" :
                    "bg-error",
                  )}
                  style={{ width: `${barWidth}%` }}
                />
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between border-t border-border pt-2 text-xs text-muted">
        <span>Sum of weighted contributions</span>
        <span className="font-medium tabular-nums text-foreground">
          {Math.round(components.reduce((s, c) => s + c.contribution, 0))}
        </span>
      </div>
    </div>
  );
}
