import { RadarChart } from "@/components/charts/RadarChart";
import { HeroMetric } from "@/components/shared/HeroMetric";
import { KpiCard } from "@/components/shared/KpiCard";
import { useMaturity } from "@/hooks/useIntelligence";
import { getPhaseInfo, MATURITY_PHASES } from "@/lib/maturity";
import { cn } from "@/lib/utils";

export function MaturityTab({ enabled = true }: { enabled?: boolean }) {
  const { data, isLoading } = useMaturity({ enabled });

  if (isLoading)
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-32 rounded-lg bg-raised" />
      </div>
    );
  if (!data)
    return <div className="py-12 text-center text-muted">Vehicle assessment is warming up…</div>;

  const phase = getPhaseInfo(data.phase);
  const dims = Object.entries(data.dimensions ?? {});
  const reqs = data.nextPhaseRequirements ?? [];
  const nextPhase = data.phase < 4 ? getPhaseInfo(data.phase + 1) : null;

  return (
    <div className="space-y-6">
      <HeroMetric
        label="Vehicle Phase"
        value={phase.label}
        interpretation={phase.diagnostic}
        maturityPhase={{ phase: data.phase, label: phase.label }}
      />

      {/* Phase progression — visual timeline of vehicle construction */}
      <div className="rounded-lg border border-border bg-surface p-5">
        <h3 className="mb-4 text-sm font-heading font-semibold">Vehicle Construction Progress</h3>
        <div className="flex items-center gap-1">
          {MATURITY_PHASES.map((p) => (
            <div key={p.phase} className="flex-1">
              <div
                className={cn(
                  "h-2 rounded-full transition-colors",
                  p.phase <= data.phase ? "bg-accent" : "bg-border",
                )}
              />
              <div className="mt-2 text-center">
                <div
                  className={cn(
                    "text-[10px] font-medium",
                    p.phase === data.phase ? "text-foreground" : "text-muted",
                  )}
                >
                  {p.label}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <KpiCard
          label="Current Phase"
          value={phase.label}
          interpretation={`Phase ${data.phase} of 4`}
        />
        <KpiCard
          label="Overall Score"
          value={`${Math.round((data.overallScore ?? 0) * 100)}%`}
          interpretation="Drivetrain completeness"
        />
        {data.bottleneck && (
          <KpiCard
            label="Bottleneck"
            value={data.bottleneck.dimension}
            interpretation={`This component limits your next upshift (${Math.round((data.bottleneck?.score ?? 0) * 100)}%)`}
          />
        )}
      </div>

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

      {/* Transmission Thesis §3: "Here is what to build next" — prescriptive, specific */}
      {reqs.length > 0 && (
        <div className="rounded-lg border border-accent/30 bg-accent/5 p-5">
          <h3 className="mb-1 text-sm font-heading font-semibold">
            {nextPhase ? `Build Guide: Reaching ${nextPhase.label}` : "Maintaining Tuned Vehicle"}
          </h3>
          {nextPhase && <p className="mb-3 text-xs text-muted">{nextPhase.description}</p>}
          <div className="space-y-2">
            {reqs.map((r, i) => (
              <div key={i} className="flex items-start gap-3 text-sm">
                <span className={cn("mt-0.5 shrink-0", r.met ? "text-success" : "text-warning")}>
                  {r.met ? "✓" : "○"}
                </span>
                <span className={r.met ? "text-foreground" : "text-muted"}>{r.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
