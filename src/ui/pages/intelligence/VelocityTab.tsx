import { HeroMetric } from "@/components/shared/HeroMetric";
import { KpiCard } from "@/components/shared/KpiCard";
import { useVelocity } from "@/hooks/useIntelligence";
import { interpretScore } from "@/lib/diagnostics";

export function VelocityTab({ enabled = true }: { enabled?: boolean }) {
  const { data, isLoading } = useVelocity({ enabled });

  if (isLoading)
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-32 rounded-lg bg-raised" />
      </div>
    );
  if (!data)
    return <div className="py-12 text-center text-muted">Velocity data is warming up…</div>;

  const trend = data.overallTrend as "up" | "down" | "flat" | undefined;
  const magnitude = data.overallMagnitude ?? 0;
  const domains = Object.entries(data.byDomain ?? {});

  return (
    <div className="space-y-6">
      <HeroMetric
        label="Velocity"
        value={`${magnitude.toFixed(1)}`}
        unit="decisions/day"
        interpretation={interpretScore("velocity", magnitude, trend)}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Trend"
          value={
            trend === "up" ? "↑ Accelerating" : trend === "down" ? "↓ Decelerating" : "→ Cruising"
          }
        />
        <KpiCard
          label="Data Points"
          value={data.dataPoints ?? 0}
          interpretation="qualifying sessions"
        />
        <KpiCard label="Domains" value={domains.length} interpretation="active areas" />
      </div>

      {domains.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-heading font-semibold">Velocity by Domain</h3>
          <div className="space-y-2">
            {domains.map(([name, d]) => {
              const current = d.turnsToAcceptance?.current ?? 0;
              const maxTurns = Math.max(
                ...domains.map(([, v]) => v.turnsToAcceptance?.current ?? 0),
                1,
              );
              return (
                <div key={name} className="flex items-center gap-3 text-sm">
                  <span className="w-24 truncate text-foreground font-medium">{name}</span>
                  <div className="flex-1 h-2 rounded-full bg-raised overflow-hidden">
                    <div
                      className="h-full rounded-full bg-cyan"
                      style={{ width: `${(current / maxTurns) * 100}%` }}
                    />
                  </div>
                  <span className="w-12 text-right font-mono text-muted">{current.toFixed(1)}</span>
                  <span className="w-16 text-right text-xs text-muted">{d.sessionsCount} sess</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
