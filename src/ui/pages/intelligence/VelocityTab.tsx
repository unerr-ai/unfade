import { useState } from "react";
import { CorrelationCard, type CorrelationData } from "@/components/shared/CorrelationCard";
import { EvidenceDrawer } from "@/components/shared/EvidenceDrawer";
import { FreshnessBadge } from "@/components/shared/FreshnessBadge";
import { HeroMetric } from "@/components/shared/HeroMetric";
import { KpiCard } from "@/components/shared/KpiCard";
import { ShowMore } from "@/components/shared/ShowMore";
import { useVelocity } from "@/hooks/useIntelligence";
import { cn } from "@/lib/utils";

interface DomainVelocity {
  currentTurnsToAcceptance: number;
  previousTurnsToAcceptance: number;
  velocityChange: number;
  dataPoints: number;
  trend: "accelerating" | "stable" | "decelerating";
  velocityQuality?: "genuine" | "hollow" | "unknown";
  evidenceEventIds?: string[];
}

export function VelocityTab({ enabled = true }: { enabled?: boolean }) {
  const { data, isLoading } = useVelocity({ enabled });
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
    return <div className="py-12 text-center text-muted">Velocity data is warming up…</div>;

  const overallTrend = (data.overallTrend as string) ?? "stable";
  const magnitude = (data.overallMagnitude as number) ?? 0;
  const byDomain = (data.byDomain as Record<string, DomainVelocity>) ?? {};
  const domains = Object.entries(byDomain);
  const dataPoints = (data.dataPoints as number) ?? 0;
  const correlations = (data.correlations as CorrelationData[]) ?? [];
  const diagnostics = (data.diagnostics as Array<{ severity: string; message: string; actionable: string; evidenceEventIds?: string[] }>) ?? [];

  const trendLabel = overallTrend === "accelerating" ? "↑ Accelerating" : overallTrend === "decelerating" ? "↓ Decelerating" : "→ Stable";

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
            <CorrelationCard key={c.id} correlation={c} onEvidenceClick={(ids) => openEvidence(c.title, ids)} />
          ))}
        </div>
      )}

      <HeroMetric
        label="Velocity Trend"
        value={`${Math.abs(magnitude)}%`}
        interpretation={`${trendLabel} — turns-to-acceptance ${magnitude < 0 ? "decreasing" : magnitude > 0 ? "increasing" : "stable"}`}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Trend" value={trendLabel} />
        <KpiCard label="Magnitude" value={`${Math.abs(magnitude)}%`} interpretation="change in turns" />
        <KpiCard label="Data Points" value={dataPoints} interpretation="qualifying sessions" />
        <KpiCard label="Domains" value={domains.length} interpretation="active areas" />
      </div>

      {domains.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-heading font-semibold">Velocity by Domain</h3>
          <ShowMore
            items={domains}
            initialCount={10}
            label="domains"
            renderItem={([name, dom]) => {
              const maxTurns = Math.max(...domains.map(([, v]) => v.currentTurnsToAcceptance), 1);
              const trendColor = dom.trend === "accelerating" ? "text-success" : dom.trend === "decelerating" ? "text-error" : "text-muted";
              const barColor = dom.trend === "accelerating" ? "bg-success" : dom.trend === "decelerating" ? "bg-error" : "bg-accent";
              return (
                <button
                  type="button"
                  onClick={() => dom.evidenceEventIds?.length && openEvidence(`${name} — velocity evidence`, dom.evidenceEventIds)}
                  className="flex w-full items-center gap-3 py-2 text-sm border-b border-border last:border-b-0 hover:bg-raised/50"
                >
                  <span className="w-24 truncate text-foreground font-medium text-left">{name}</span>
                  <div className="flex-1 h-2 rounded-full bg-raised overflow-hidden">
                    <div className={cn("h-full rounded-full", barColor)} style={{ width: `${(dom.currentTurnsToAcceptance / maxTurns) * 100}%` }} />
                  </div>
                  <span className="w-12 text-right font-mono text-muted">{dom.currentTurnsToAcceptance.toFixed(1)}</span>
                  <span className={cn("w-16 text-right text-xs font-mono", trendColor)}>
                    {dom.velocityChange > 0 ? "+" : ""}{dom.velocityChange}%
                  </span>
                  <span className="w-10 text-right text-xs text-muted">{dom.dataPoints}dp</span>
                  {dom.velocityQuality === "hollow" && (
                    <span className="text-[10px] text-warning">hollow</span>
                  )}
                </button>
              );
            }}
          />
        </div>
      )}

      {diagnostics.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-heading font-semibold">Velocity Diagnostics</h3>
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

      <EvidenceDrawer
        open={drawerState.open}
        onClose={() => setDrawerState((s) => ({ ...s, open: false }))}
        title={drawerState.title}
        items={drawerState.items}
      />
    </div>
  );
}
