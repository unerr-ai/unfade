import { RadarChart } from "@/components/charts/RadarChart";
import { HeroMetric } from "@/components/shared/HeroMetric";
import { InsightCard } from "@/components/shared/InsightCard";
import { KpiCard } from "@/components/shared/KpiCard";
import { useComprehension } from "@/hooks/useIntelligence";
import { interpretScore } from "@/lib/diagnostics";

export function ComprehensionTab({ enabled = true }: { enabled?: boolean }) {
  const { data, isLoading } = useComprehension({ enabled });

  if (isLoading)
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-32 rounded-lg bg-raised" />
        <div className="h-64 rounded-lg bg-raised" />
      </div>
    );
  if (!data)
    return <div className="py-12 text-center text-muted">Comprehension data is warming up…</div>;

  const overall = data.overall ?? 0;
  const modules = Object.entries(data.byModule ?? {});
  const blindSpots = data.blindSpots ?? [];

  return (
    <div className="space-y-6">
      <HeroMetric
        label="Comprehension Score"
        value={`${overall}%`}
        interpretation={data.interpretation}
        freshness={data.freshness}
        confidence={data.confidenceInfo}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Modules Covered"
          value={modules.length}
          interpretation="distinct code areas"
        />
        <KpiCard
          label="Blind Spots"
          value={blindSpots.length}
          interpretation={blindSpots.length > 0 ? "areas needing attention" : "none detected"}
        />
        <KpiCard
          label="Overall"
          value={`${overall}%`}
          interpretation={interpretScore("comprehension", overall)}
        />
      </div>

      {modules.length >= 3 && (
        <div className="rounded-lg border border-border bg-surface p-5">
          <h3 className="mb-4 text-sm font-heading font-semibold">Module Comprehension</h3>
          <RadarChart
            axes={modules
              .slice(0, 8)
              .map(([name, m]) => ({ label: name, value: (m as any)?.score ?? 0 }))}
          />
        </div>
      )}

      {modules.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-heading font-semibold">Module Detail</h3>
          <div className="divide-y divide-border">
            {modules.map(([name, m]) => {
              const mod = m as any;
              return (
                <div key={name} className="flex items-center gap-4 py-2.5 text-sm">
                  <span className="w-32 truncate font-medium text-foreground">{name}</span>
                  <div className="h-1.5 flex-1 rounded-full bg-raised overflow-hidden">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${mod?.score ?? 0}%` }}
                    />
                  </div>
                  <span className="w-10 text-right font-mono text-muted">{mod?.score ?? 0}</span>
                  <span className="w-16 text-right text-xs text-muted">
                    {mod?.sessions ?? 0} sess
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {blindSpots.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-heading font-semibold">Blind Spots</h3>
          {blindSpots.map((bs, i) => (
            <InsightCard
              key={i}
              text={`${bs.module}: ${bs.reason ?? "Low comprehension sustained"}`}
              severity="warning"
              action={{ label: `Review ${bs.module}`, href: "/intelligence" }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
