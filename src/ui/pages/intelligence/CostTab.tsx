import { HeroMetric } from "@/components/shared/HeroMetric";
import { KpiCard } from "@/components/shared/KpiCard";
import { useCosts } from "@/hooks/useIntelligence";
import { costDiagnostic } from "@/lib/diagnostics";

export function CostTab({ enabled = true }: { enabled?: boolean }) {
  const { data, isLoading } = useCosts({ enabled });

  if (isLoading)
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-32 rounded-lg bg-raised" />
      </div>
    );
  if (!data) return <div className="py-12 text-center text-muted">Cost data is warming up…</div>;

  const costPerDecision = data.costPerDirectedDecision ?? 0;
  const total = data.totalEstimatedCost ?? 0;
  const models = Object.entries(data.byModel ?? {});
  const wasteRatio = data.wasteRatio ?? 0;

  return (
    <div className="space-y-6">
      <HeroMetric
        label="Cost per Decision"
        value={`$${costPerDecision.toFixed(2)}`}
        interpretation={costDiagnostic(costPerDecision)}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Total Spend"
          value={`$${total.toFixed(2)}`}
          badge="estimate"
          interpretation={data.period ?? "this period"}
        />
        <KpiCard
          label="Waste Ratio"
          value={`${Math.round(wasteRatio * 100)}%`}
          interpretation={wasteRatio > 0.2 ? "High — review abandoned sessions" : "Acceptable"}
        />
        <KpiCard
          label="Projected Monthly"
          value={`$${(data.projectedMonthlyCost ?? 0).toFixed(0)}`}
          badge="estimate"
        />
      </div>

      {models.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-heading font-semibold">Cost by Model</h3>
          <div className="space-y-2">
            {models.map(([name, m]) => {
              const maxCost = Math.max(...models.map(([, v]) => v.cost), 1);
              return (
                <div key={name} className="flex items-center gap-3 text-sm">
                  <span className="w-28 truncate text-foreground font-medium">{name}</span>
                  <div className="flex-1 h-2 rounded-full bg-raised overflow-hidden">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${(m.cost / maxCost) * 100}%` }}
                    />
                  </div>
                  <span className="w-16 text-right font-mono text-muted">${m.cost.toFixed(2)}</span>
                  <span className="w-12 text-right text-xs text-muted">{m.sessions}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {data.disclaimer && (
        <p
          className="text-xs text-muted"
          style={{
            border: "1px dashed var(--color-warning)",
            borderRadius: 6,
            padding: "8px 12px",
            background: "var(--color-proxy)",
          }}
        >
          ≈ {data.disclaimer}
        </p>
      )}
    </div>
  );
}
