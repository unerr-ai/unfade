import { useState } from "react";
import { AreaChart } from "@/components/charts/AreaChart";
import { CorrelationCard, type CorrelationData } from "@/components/shared/CorrelationCard";
import { EvidenceDrawer } from "@/components/shared/EvidenceDrawer";
import { FreshnessBadge } from "@/components/shared/FreshnessBadge";
import { HeroMetric } from "@/components/shared/HeroMetric";
import { KpiCard } from "@/components/shared/KpiCard";
import { MetricDecomposition, type MetricComponentData } from "@/components/shared/MetricDecomposition";
import { ShowMore } from "@/components/shared/ShowMore";
import { useEfficiency } from "@/hooks/useIntelligence";
import { cn } from "@/lib/utils";

interface SubMetric {
  value: number;
  weight: number;
  confidence: string;
  dataPoints: number;
  evidenceEventIds?: string[];
}

export function EfficiencyTab({ enabled = true }: { enabled?: boolean }) {
  const { data, isLoading } = useEfficiency({ enabled });
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
  if (!data)
    return <div className="py-12 text-center text-muted">Efficiency data is warming up…</div>;

  const aes = (data.aes as number) ?? 0;
  const trend = data.trend as string | null;
  const subMetrics = (data.subMetrics as Record<string, SubMetric>) ?? {};
  const history = ((data.history as Array<{ date: string; aes: number }>) ?? []).map((h) => ({
    label: h.date?.slice(5) ?? "",
    value: h.aes ?? 0,
  }));
  const topInsight = data.topInsight as string | null;
  const correlations = (data.correlations as CorrelationData[]) ?? [];
  const diagnostics = (data.diagnostics as Array<{ severity: string; message: string; actionable: string; evidenceEventIds?: string[] }>) ?? [];

  const METRIC_LABELS: Record<string, string> = {
    directionDensity: "Direction Density",
    tokenEfficiency: "Token Efficiency",
    iterationRatio: "Iteration Ratio",
    contextLeverage: "Context Leverage",
    modificationDepth: "Modification Depth",
    comprehensionEfficiency: "Comprehension Efficiency",
  };

  const decompositionComponents: MetricComponentData[] = Object.entries(subMetrics).map(([key, m]) => ({
    name: METRIC_LABELS[key] ?? key,
    weight: m.weight,
    value: m.value,
    contribution: Math.round(m.value * m.weight),
    trend: undefined,
  }));

  const openEvidence = (title: string, eventIds: string[]) => {
    setDrawerState({
      open: true,
      title,
      items: eventIds.map((id) => ({
        timestamp: new Date().toISOString(),
        source: "ai-session",
        summary: `Event ${id}`,
      })),
    });
  };

  return (
    <div className="space-y-6">
      {data.freshness && (
        <FreshnessBadge updatedAt={(data.freshness as { updatedAt: string }).updatedAt} isLive={(data.freshness as { isLive?: boolean }).isLive} />
      )}

      {correlations.length > 0 && (
        <div className="space-y-3">
          {correlations.map((c) => (
            <CorrelationCard key={c.id} correlation={c} onEvidenceClick={(ids) => openEvidence(c.title, ids)} />
          ))}
        </div>
      )}

      <HeroMetric
        label="AI Efficiency Score"
        value={aes}
        interpretation={data.interpretation as string}
        freshness={data.freshness as any}
        confidence={data.confidenceInfo as any}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="AES" value={aes} interpretation="out of 100" />
        <KpiCard label="Trend" value={trend === "improving" ? "↑ Improving" : trend === "declining" ? "↓ Declining" : "→ Stable"} />
        <KpiCard label="Sub-metrics" value={Object.keys(subMetrics).length} interpretation="dimensions tracked" />
        {topInsight && <KpiCard label="Top Insight" value={topInsight.slice(0, 40)} />}
      </div>

      <MetricDecomposition
        label="AES Breakdown"
        totalScore={aes}
        components={decompositionComponents}
        formula="Σ (subMetric.value × subMetric.weight)"
        onComponentClick={(comp) => {
          const key = Object.entries(METRIC_LABELS).find(([, label]) => label === comp.name)?.[0] ?? comp.name;
          const metric = subMetrics[key];
          if (metric?.evidenceEventIds?.length) {
            openEvidence(`${comp.name} — evidence`, metric.evidenceEventIds);
          }
        }}
      />

      {Object.entries(subMetrics).length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-heading font-semibold">Sub-Metric Detail</h3>
          <ShowMore
            items={Object.entries(subMetrics)}
            initialCount={6}
            label="sub-metrics"
            renderItem={([key, m]) => (
              <button
                type="button"
                onClick={() => m.evidenceEventIds?.length && openEvidence(`${METRIC_LABELS[key] ?? key} — evidence`, m.evidenceEventIds)}
                className="flex w-full items-center gap-3 py-2 text-sm border-b border-border last:border-b-0 hover:bg-raised/50"
              >
                <span className="w-36 truncate text-foreground font-medium text-left">{METRIC_LABELS[key] ?? key}</span>
                <div className="flex-1 h-2 rounded-full bg-raised overflow-hidden">
                  <div
                    className={cn("h-full rounded-full", m.value >= 70 ? "bg-success" : m.value >= 40 ? "bg-warning" : "bg-error")}
                    style={{ width: `${m.value}%` }}
                  />
                </div>
                <span className="w-10 text-right font-mono text-muted">{m.value}</span>
                <span className="w-10 text-right text-xs text-muted">{Math.round(m.weight * 100)}%</span>
                <span className="w-10 text-right text-xs text-muted">{m.dataPoints}dp</span>
                {m.evidenceEventIds && m.evidenceEventIds.length > 0 && (
                  <span className="text-[10px] text-accent">{m.evidenceEventIds.length} events</span>
                )}
              </button>
            )}
          />
        </div>
      )}

      {history.length >= 2 && (
        <div className="rounded-lg border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-heading font-semibold">AES Trend</h3>
          <AreaChart data={history} height={200} />
        </div>
      )}

      {diagnostics.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-heading font-semibold">Efficiency Diagnostics</h3>
          <ShowMore
            items={diagnostics}
            initialCount={3}
            label="diagnostics"
            renderItem={(diag) => (
              <button
                type="button"
                onClick={() => diag.evidenceEventIds?.length && openEvidence(diag.message, diag.evidenceEventIds)}
                className={cn(
                  "w-full text-left rounded-md border p-3 mb-2 transition-colors",
                  diag.severity === "critical" ? "border-error/30 bg-error/5 hover:bg-error/10" :
                  diag.severity === "warning" ? "border-warning/30 bg-warning/5 hover:bg-warning/10" :
                  "border-border bg-surface hover:bg-raised/50",
                )}
              >
                <p className="text-sm text-foreground">{diag.message}</p>
                <p className="text-xs text-accent mt-1">{diag.actionable}</p>
                {diag.evidenceEventIds && diag.evidenceEventIds.length > 0 && (
                  <span className="text-[10px] text-accent mt-1 inline-block">{diag.evidenceEventIds.length} source events</span>
                )}
              </button>
            )}
          />
        </div>
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
