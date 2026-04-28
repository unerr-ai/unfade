import { useState } from "react";
import { RadarChart } from "@/components/charts/RadarChart";
import { ConfidenceBadge } from "@/components/shared/ConfidenceBadge";
import { CorrelationCard, type CorrelationData } from "@/components/shared/CorrelationCard";
import { EvidenceDrawer } from "@/components/shared/EvidenceDrawer";
import { FreshnessBadge } from "@/components/shared/FreshnessBadge";
import { HeroMetric } from "@/components/shared/HeroMetric";
import { KpiCard } from "@/components/shared/KpiCard";
import { ShowMore } from "@/components/shared/ShowMore";
import { useComprehension } from "@/hooks/useIntelligence";
import { interpretScore } from "@/lib/diagnostics";
import { cn } from "@/lib/utils";

export function ComprehensionTab({ enabled = true }: { enabled?: boolean }) {
  const { data, isLoading } = useComprehension({ enabled });
  const [drawerState, setDrawerState] = useState<{
    open: boolean;
    title: string;
    items: Array<{ timestamp: string; source: string; summary: string }>;
  }>({ open: false, title: "", items: [] });

  if (isLoading)
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-32 rounded-lg bg-raised" />
        <div className="h-64 rounded-lg bg-raised" />
      </div>
    );
  if (!data)
    return <div className="py-12 text-center text-muted">Comprehension data is warming up…</div>;

  const overall = (data.overall as number) ?? 0;
  const modules = Object.entries((data.byModule as Record<string, any>) ?? {});
  const blindSpots = (data.blindSpots as string[]) ?? [];
  const blindSpotAlerts = (data.blindSpotAlerts as Array<{
    module: string;
    score: number;
    eventCount: number;
    suggestion: string;
    evidenceEventIds?: string[];
  }>) ?? [];
  const diagnostics = (data.diagnostics as Array<{ severity: string; message: string; actionable: string; evidenceEventIds?: string[] }>) ?? [];
  const correlations = (data.correlations as CorrelationData[]) ?? [];

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
        <FreshnessBadge updatedAt={data.freshness.updatedAt} isLive={data.freshness.isLive} />
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
        label="Comprehension Score"
        value={`${overall}%`}
        interpretation={data.interpretation}
        freshness={data.freshness}
        confidence={data.confidenceInfo}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Modules Covered" value={modules.length} interpretation="distinct code areas" />
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
        {data.confidenceInfo && (
          <div className="flex items-center justify-center">
            <ConfidenceBadge level={data.confidenceInfo.level as any} basis={data.confidenceInfo.basis} />
          </div>
        )}
      </div>

      {modules.length >= 3 && (
        <div className="rounded-lg border border-border bg-surface p-5">
          <h3 className="mb-4 text-sm font-heading font-semibold">Module Comprehension</h3>
          <RadarChart
            axes={modules.map(([name, m]) => ({
              label: name,
              value: (m as any)?.score ?? 0,
            }))}
          />
        </div>
      )}

      {modules.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-heading font-semibold">Module Detail</h3>
          <ShowMore
            items={modules}
            initialCount={10}
            label="modules"
            renderItem={([name, m]) => {
              const mod = m as any;
              const eventIds = mod?.evidenceEventIds ?? [];
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => eventIds.length > 0 && openEvidence(`${name} — comprehension evidence`, eventIds)}
                  className={cn(
                    "flex w-full items-center gap-4 py-2.5 text-sm border-b border-border last:border-b-0",
                    eventIds.length > 0 && "cursor-pointer hover:bg-raised/50",
                  )}
                >
                  <span className="w-32 truncate font-medium text-foreground text-left">{name}</span>
                  <div className="h-1.5 flex-1 rounded-full bg-raised overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        (mod?.score ?? 0) >= 70 ? "bg-success" : (mod?.score ?? 0) >= 40 ? "bg-warning" : "bg-error",
                      )}
                      style={{ width: `${mod?.score ?? 0}%` }}
                    />
                  </div>
                  <span className="w-10 text-right font-mono text-muted">{mod?.score ?? 0}</span>
                  <span className="w-16 text-right text-xs text-muted">
                    {mod?.decisionsCount ?? mod?.sessions ?? 0} sess
                  </span>
                  {eventIds.length > 0 && (
                    <span className="text-[10px] text-accent">{eventIds.length} events</span>
                  )}
                </button>
              );
            }}
          />
        </div>
      )}

      {blindSpotAlerts.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-heading font-semibold">Blind Spots</h3>
          <ShowMore
            items={blindSpotAlerts}
            initialCount={5}
            label="blind spots"
            renderItem={(alert) => (
              <button
                type="button"
                onClick={() => alert.evidenceEventIds?.length && openEvidence(`${alert.module} — blind spot evidence`, alert.evidenceEventIds)}
                className="w-full text-left rounded-md border border-warning/20 bg-warning/5 p-4 mb-2 hover:bg-warning/10 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm text-foreground">{alert.module}</span>
                  <span className="text-xs font-mono text-warning">{alert.score}/100</span>
                </div>
                <p className="text-xs text-muted mt-1">{alert.suggestion}</p>
                {alert.evidenceEventIds && alert.evidenceEventIds.length > 0 && (
                  <span className="text-[10px] text-accent mt-1 inline-block">{alert.evidenceEventIds.length} source events</span>
                )}
              </button>
            )}
          />
        </div>
      )}

      {diagnostics.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-heading font-semibold">Diagnostics</h3>
          <ShowMore
            items={diagnostics}
            initialCount={3}
            label="diagnostics"
            renderItem={(diag) => (
              <div
                className={cn(
                  "rounded-md border p-3 mb-2",
                  diag.severity === "critical" ? "border-error/30 bg-error/5" :
                  diag.severity === "warning" ? "border-warning/30 bg-warning/5" :
                  "border-border bg-surface",
                )}
              >
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
