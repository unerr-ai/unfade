import { useState } from "react";
import { CorrelationCard, type CorrelationData } from "@/components/shared/CorrelationCard";
import { EvidenceDrawer } from "@/components/shared/EvidenceDrawer";
import { FreshnessBadge } from "@/components/shared/FreshnessBadge";
import { HeroMetric } from "@/components/shared/HeroMetric";
import { KpiCard } from "@/components/shared/KpiCard";
import { ShowMore } from "@/components/shared/ShowMore";
import { useCosts } from "@/hooks/useIntelligence";
import { costDiagnostic } from "@/lib/diagnostics";
import { cn } from "@/lib/utils";

interface CostDimension {
  key: string;
  eventCount: number;
  estimatedCost: number;
  percentage: number;
  evidenceEventIds?: string[];
}

export function CostTab({ enabled = true }: { enabled?: boolean }) {
  const { data, isLoading } = useCosts({ enabled });
  const [drawerState, setDrawerState] = useState<{
    open: boolean;
    title: string;
    items: Array<{ timestamp: string; source: string; summary: string }>;
  }>({ open: false, title: "", items: [] });

  if (isLoading)
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-32 rounded-lg bg-raised" />
      </div>
    );
  if (!data) return <div className="py-12 text-center text-muted">Cost data is warming up…</div>;

  const costPerDecision = (data.costPerDirectedDecision as number) ?? 0;
  const total = (data.totalEstimatedCost as number) ?? 0;
  const byModel = (data.byModel as CostDimension[]) ?? [];
  const byDomain = (data.byDomain as CostDimension[]) ?? [];
  const wasteRatio = (data.wasteRatio as number) ?? 0;
  const correlations = (data.correlations as CorrelationData[]) ?? [];
  const diagnostics = (data.diagnostics as Array<{ severity: string; message: string; actionable: string; evidenceEventIds?: string[] }>) ?? [];
  const disclaimer = data.disclaimer as string | undefined;

  const openEvidence = (title: string, eventIds: string[]) => {
    setDrawerState({
      open: true,
      title,
      items: eventIds.map((id) => ({
        timestamp: new Date().toISOString(),
        source: "ai-session",
        summary: `Session ${id}`,
      })),
    });
  };

  return (
    <div className="space-y-6">
      {data.freshness && (
        <FreshnessBadge updatedAt={(data.freshness as { updatedAt: string }).updatedAt} />
      )}

      {correlations.length > 0 && (
        <div className="space-y-3">
          {correlations.map((c) => (
            <CorrelationCard
              key={c.id}
              correlation={c}
              onEvidenceClick={(ids) => openEvidence(c.title, ids)}
            />
          ))}
        </div>
      )}

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
          interpretation={(data.period as string) ?? "this period"}
        />
        <KpiCard
          label="Waste Ratio"
          value={`${Math.round(wasteRatio * 100)}%`}
          interpretation={wasteRatio > 0.2 ? "High — review abandoned sessions" : "Acceptable"}
        />
        <KpiCard
          label="Projected Monthly"
          value={`$${((data.projectedMonthlyCost as number) ?? 0).toFixed(0)}`}
          badge="estimate"
        />
      </div>

      {byModel.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-heading font-semibold">Cost by Model</h3>
          <ShowMore
            items={byModel}
            initialCount={10}
            label="models"
            renderItem={(dim) => {
              const maxCost = Math.max(...byModel.map((d) => d.estimatedCost), 1);
              return (
                <button
                  type="button"
                  onClick={() => dim.evidenceEventIds?.length && openEvidence(`${dim.key} — cost evidence`, dim.evidenceEventIds)}
                  className={cn(
                    "flex w-full items-center gap-3 py-2 text-sm border-b border-border last:border-b-0",
                    dim.evidenceEventIds?.length && "cursor-pointer hover:bg-raised/50",
                  )}
                >
                  <span className="w-28 truncate text-foreground font-medium text-left">{dim.key}</span>
                  <div className="flex-1 h-2 rounded-full bg-raised overflow-hidden">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${(dim.estimatedCost / maxCost) * 100}%` }}
                    />
                  </div>
                  <span className="w-16 text-right font-mono text-muted">${dim.estimatedCost.toFixed(2)}</span>
                  <span className="w-12 text-right text-xs text-muted">{dim.eventCount}</span>
                  <span className="w-10 text-right text-xs text-muted">{dim.percentage}%</span>
                </button>
              );
            }}
          />
        </div>
      )}

      {byDomain.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-heading font-semibold">Cost by Domain</h3>
          <ShowMore
            items={byDomain}
            initialCount={10}
            label="domains"
            renderItem={(dim) => (
              <button
                type="button"
                onClick={() => dim.evidenceEventIds?.length && openEvidence(`${dim.key} — domain cost evidence`, dim.evidenceEventIds)}
                className="flex w-full items-center gap-3 py-2 text-sm border-b border-border last:border-b-0 hover:bg-raised/50"
              >
                <span className="w-28 truncate text-foreground font-medium text-left">{dim.key}</span>
                <span className="w-12 text-right text-xs text-muted">{dim.eventCount} sess</span>
                <span className="w-10 text-right text-xs text-muted">{dim.percentage}%</span>
                {dim.evidenceEventIds && dim.evidenceEventIds.length > 0 && (
                  <span className="text-[10px] text-accent">{dim.evidenceEventIds.length} events</span>
                )}
              </button>
            )}
          />
        </div>
      )}

      {diagnostics.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-heading font-semibold">Cost Diagnostics</h3>
          <ShowMore
            items={diagnostics}
            initialCount={3}
            label="diagnostics"
            renderItem={(diag) => (
              <div className={cn(
                "rounded-md border p-3 mb-2",
                diag.severity === "critical" ? "border-error/30 bg-error/5" :
                diag.severity === "warning" ? "border-warning/30 bg-warning/5" :
                "border-border bg-surface",
              )}>
                <p className="text-sm text-foreground">{diag.message}</p>
                <p className="text-xs text-accent mt-1">{diag.actionable}</p>
              </div>
            )}
          />
        </div>
      )}

      {disclaimer && (
        <p className="text-xs text-muted rounded-md border border-dashed border-warning p-3 bg-warning/5">
          {disclaimer}
        </p>
      )}

      <EvidenceDrawer
        open={drawerState.open}
        onClose={() => setDrawerState((s) => ({ ...s, open: false }))}
        title={drawerState.title}
        items={drawerState.items}
      />
    </div>
  );
}
