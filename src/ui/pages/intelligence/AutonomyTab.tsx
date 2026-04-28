import { useState } from "react";
import { AreaChart } from "@/components/charts/AreaChart";
import { CorrelationCard, type CorrelationData } from "@/components/shared/CorrelationCard";
import { EvidenceDrawer } from "@/components/shared/EvidenceDrawer";
import { FreshnessBadge } from "@/components/shared/FreshnessBadge";
import { HeroMetric } from "@/components/shared/HeroMetric";
import { KpiCard } from "@/components/shared/KpiCard";
import { MetricDecomposition, type MetricComponentData } from "@/components/shared/MetricDecomposition";
import { ShowMore } from "@/components/shared/ShowMore";
import { useAutonomy } from "@/hooks/useIntelligence";
import { interpretScore } from "@/lib/diagnostics";
import { cn } from "@/lib/utils";

interface DomainDep {
  domain: string;
  acceptanceRate: number;
  comprehension: number;
}

export function AutonomyTab({ enabled = true }: { enabled?: boolean }) {
  const { data, isLoading } = useAutonomy({ enabled });
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
    return <div className="py-12 text-center text-muted">Steering data is warming up…</div>;

  const bd = (data.breakdown as { hds: number; modificationRate: number; alternativesEval: number; comprehensionTrend: number }) ?? {
    hds: 0, modificationRate: 0, alternativesEval: 0, comprehensionTrend: 0,
  };
  const history = ((data.hdsHistory as Array<{ date: string; value: number }>) ?? []).map((h) => ({
    label: h?.date?.slice(5) ?? "",
    value: h?.value ?? 0,
  }));
  const deps: DomainDep[] = (data.dependencyMap as DomainDep[]) ?? [];
  const correlations = (data.correlations as CorrelationData[]) ?? [];
  const independenceIndex = (data.independenceIndex as number) ?? 0;

  const decompositionComponents: MetricComponentData[] = [
    { name: "Direction (HDS)", weight: 0.3, value: bd.hds, contribution: Math.round(bd.hds * 0.3), trend: "stable" },
    { name: "Modification Rate", weight: 0.25, value: bd.modificationRate, contribution: Math.round(bd.modificationRate * 0.25), trend: "stable" },
    { name: "Alternatives Eval", weight: 0.2, value: bd.alternativesEval, contribution: Math.round(bd.alternativesEval * 0.2), trend: "stable" },
    { name: "Comprehension Trend", weight: 0.25, value: bd.comprehensionTrend, contribution: Math.round(bd.comprehensionTrend * 0.25), trend: "stable" },
  ];

  const openEvidence = (title: string, _domain?: string) => {
    setDrawerState({
      open: true,
      title,
      items: [{ timestamp: new Date().toISOString(), source: "ai-session", summary: `Evidence for ${title}` }],
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
              onEvidenceClick={(ids) => openEvidence(c.title)}
            />
          ))}
        </div>
      )}

      <HeroMetric
        label="Steering Precision"
        value={independenceIndex}
        interpretation={interpretScore("autonomy", independenceIndex)}
      />

      <MetricDecomposition
        label="Independence Index Breakdown"
        totalScore={independenceIndex}
        components={decompositionComponents}
        formula="HDS×30% + ModRate×25% + AltEval×20% + CompTrend×25%"
        onComponentClick={(comp) => openEvidence(comp.name)}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Direction (HDS)" value={bd.hds} interpretation="How much you steer" />
        <KpiCard label="Modification" value={bd.modificationRate} interpretation="How much you edit AI output" />
        <KpiCard label="Alternatives" value={bd.alternativesEval} interpretation="Options you evaluated" />
        <KpiCard label="Comprehension" value={bd.comprehensionTrend} interpretation="Track visibility trend" />
      </div>

      {history.length >= 2 && (
        <div className="rounded-lg border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-heading font-semibold">Steering Trend</h3>
          <AreaChart data={history} height={200} />
        </div>
      )}

      {deps.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-heading font-semibold">Domain Steering Map</h3>
          <p className="mb-3 text-xs text-muted">Click a domain to see evidence sessions</p>
          <ShowMore
            items={deps}
            initialCount={10}
            label="domains"
            renderItem={(d) => {
              const risk = d.acceptanceRate > 80 && d.comprehension < 40;
              const loose = d.acceptanceRate > 80;
              return (
                <button
                  type="button"
                  onClick={() => openEvidence(`${d.domain} — steering evidence`, d.domain)}
                  className={cn(
                    "flex w-full items-center gap-4 py-2.5 text-sm border-b border-border last:border-b-0 hover:bg-raised/50",
                    risk && "bg-error/5",
                  )}
                >
                  <span className="w-24 truncate font-medium text-foreground text-left">{d.domain}</span>
                  <span className={cn(
                    "px-2 py-0.5 rounded text-xs font-mono",
                    loose ? "bg-error/20 text-error" : "bg-success/20 text-success",
                  )}>
                    {loose ? "Loose" : "Tight"} — {Math.round(d.acceptanceRate)}% accept
                  </span>
                  <span className={cn(
                    "px-2 py-0.5 rounded text-xs font-mono",
                    d.comprehension < 40 ? "bg-error/20 text-error" : "bg-success/20 text-success",
                  )}>
                    {d.comprehension < 40 ? "Blind" : "Clear"} — {Math.round(d.comprehension)}% vis
                  </span>
                  {risk && <span className="text-xs font-semibold text-error">Risk zone</span>}
                </button>
              );
            }}
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
