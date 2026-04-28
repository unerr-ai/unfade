import { useState } from "react";
import { RadarChart } from "@/components/charts/RadarChart";
import { EvidenceDrawer } from "@/components/shared/EvidenceDrawer";
import { FreshnessBadge } from "@/components/shared/FreshnessBadge";
import { HeroMetric } from "@/components/shared/HeroMetric";
import { KpiCard } from "@/components/shared/KpiCard";
import { MetricDecomposition, type MetricComponentData } from "@/components/shared/MetricDecomposition";
import { ShowMore } from "@/components/shared/ShowMore";
import { useMaturity } from "@/hooks/useIntelligence";
import { getPhaseInfo, MATURITY_PHASES } from "@/lib/maturity";
import { cn } from "@/lib/utils";

export function MaturityTab({ enabled = true }: { enabled?: boolean }) {
  const { data, isLoading } = useMaturity({ enabled });
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
    return <div className="py-12 text-center text-muted">Maturity assessment is warming up…</div>;

  const phase = getPhaseInfo(data.phase);
  const dims = Object.entries(data.dimensions ?? {});
  const reqs = data.nextPhaseRequirements ?? [];
  const nextPhase = data.phase < 4 ? getPhaseInfo(data.phase + 1) : null;
  const overallScore = data.overallScore ?? 0;
  const trajectory = data.trajectory ?? [];

  const decompositionComponents: MetricComponentData[] = dims.map(([name, score]) => ({
    name: name.replace(/([A-Z])/g, " $1").trim(),
    weight: 1 / Math.max(dims.length, 1),
    value: Math.round((score as number) * 100),
    contribution: Math.round(((score as number) * 100) / Math.max(dims.length, 1)),
  }));

  const openEvidence = (title: string) => {
    setDrawerState({
      open: true,
      title,
      items: [{ timestamp: new Date().toISOString(), source: "ai-session", summary: `Evidence for ${title}` }],
    });
  };

  return (
    <div className="space-y-6">
      {(data as any).updatedAt && (
        <FreshnessBadge updatedAt={(data as any).updatedAt} />
      )}

      <HeroMetric
        label="Vehicle Phase"
        value={phase.label}
        interpretation={phase.diagnostic}
        maturityPhase={{ phase: data.phase, label: phase.label }}
      />

      <div className="rounded-lg border border-border bg-surface p-5">
        <h3 className="mb-4 text-sm font-heading font-semibold">Vehicle Construction Progress</h3>
        <div className="flex items-center gap-1">
          {MATURITY_PHASES.map((p) => (
            <div key={p.phase} className="flex-1">
              <div className={cn("h-2 rounded-full transition-colors", p.phase <= data.phase ? "bg-accent" : "bg-border")} />
              <div className="mt-2 text-center">
                <div className={cn("text-[10px] font-medium", p.phase === data.phase ? "text-foreground" : "text-muted")}>{p.label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <KpiCard label="Current Phase" value={phase.label} interpretation={`Phase ${data.phase} of 4`} />
        <KpiCard label="Overall Score" value={`${Math.round(overallScore * 100)}%`} interpretation="Drivetrain completeness" />
        {data.bottleneck && (
          <KpiCard label="Bottleneck" value={data.bottleneck.dimension} interpretation={`Limits next upshift (${Math.round((data.bottleneck?.score ?? 0) * 100)}%)`} />
        )}
      </div>

      {decompositionComponents.length >= 3 && (
        <MetricDecomposition
          label="Maturity Dimension Breakdown"
          totalScore={Math.round(overallScore * 100)}
          components={decompositionComponents}
          onComponentClick={(comp) => openEvidence(comp.name)}
        />
      )}

      {dims.length >= 3 && (
        <div className="rounded-lg border border-border bg-surface p-5">
          <h3 className="mb-4 text-sm font-heading font-semibold">Drivetrain Components</h3>
          <RadarChart
            axes={dims.map(([name, score]) => ({
              label: name.replace(/([A-Z])/g, " $1").trim(),
              value: Math.round((score as number) * 100),
            }))}
          />
        </div>
      )}

      {trajectory.length >= 2 && (
        <div className="rounded-lg border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-heading font-semibold">Maturity Trajectory</h3>
          <div className="flex items-end gap-1 h-24">
            {trajectory.map((t, i) => {
              const maxScore = Math.max(...trajectory.map((tp) => tp.score ?? 0), 1);
              const height = ((t.score ?? 0) / maxScore) * 100;
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full rounded-t bg-accent/60 transition-all" style={{ height: `${height}%` }} />
                  <span className="text-[8px] text-muted">{(t.date as string)?.slice(5)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {reqs.length > 0 && (
        <div className="rounded-lg border border-accent/30 bg-accent/5 p-5">
          <h3 className="mb-1 text-sm font-heading font-semibold">
            {nextPhase ? `Build Guide: Reaching ${nextPhase.label}` : "Maintaining Tuned Vehicle"}
          </h3>
          {nextPhase && <p className="mb-3 text-xs text-muted">{nextPhase.description}</p>}
          <ShowMore
            items={reqs}
            initialCount={5}
            label="requirements"
            renderItem={(r) => (
              <button
                type="button"
                onClick={() => openEvidence(r.description)}
                className="flex w-full items-start gap-3 py-2 text-sm hover:bg-raised/50 rounded"
              >
                <span className={cn("mt-0.5 shrink-0", r.met ? "text-success" : "text-warning")}>
                  {r.met ? "✓" : "○"}
                </span>
                <span className={cn("text-left", r.met ? "text-foreground" : "text-muted")}>{r.description}</span>
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
