import { AreaChart } from "@/components/charts/AreaChart";
import { HeroMetric } from "@/components/shared/HeroMetric";
import { KpiCard } from "@/components/shared/KpiCard";
import { useAutonomy } from "@/hooks/useIntelligence";
import { interpretScore } from "@/lib/diagnostics";
import { cn } from "@/lib/utils";

interface DomainDep {
  domain: string;
  acceptanceRate: number;
  comprehension: number;
}

/** Transmission Thesis §2: surface specific vehicle diagnostics, not abstract metrics. */
function buildSteeringDiagnostics(
  deps: DomainDep[],
  bd: { hds: number; modificationRate: number; alternativesEval: number },
): string[] {
  const diagnostics: string[] = [];

  // "Your steering is loose in X domain"
  const looseSteering = deps.filter((d) => d.acceptanceRate > 80);
  if (looseSteering.length > 0) {
    const names = looseSteering.map((d) => d.domain).join(", ");
    diagnostics.push(
      `Your steering is loose in ${names} — accepting ${Math.round(looseSteering[0].acceptanceRate)}% of AI output without modification. The vehicle pulls hard to one side in ${looseSteering.length > 1 ? "these domains" : "this domain"}.`,
    );
  }

  // "You're driving blind in X"
  const blindSpots = deps.filter((d) => d.comprehension < 40);
  if (blindSpots.length > 0) {
    const names = blindSpots.map((d) => d.domain).join(", ");
    diagnostics.push(
      `Driving blind in ${names} — comprehension below 40%. You're navigating unfamiliar track sections without visibility.`,
    );
  }

  // "Drafting without knowing it"
  if (bd.alternativesEval < 20 && bd.hds < 40) {
    diagnostics.push(
      "You may be drafting — low alternatives evaluated combined with low direction. You think you're steering, but you're following the engine's defaults.",
    );
  }

  // "Modification rate too low"
  if (bd.modificationRate < 15 && bd.hds < 50) {
    diagnostics.push(
      "Your modification rate is very low. You're accepting AI output nearly verbatim. Try editing outputs to build your transmission.",
    );
  }

  // Risk zones: high acceptance + low comprehension
  const riskZones = deps.filter((d) => d.acceptanceRate > 80 && d.comprehension < 40);
  if (riskZones.length > 0) {
    const names = riskZones.map((d) => d.domain).join(", ");
    diagnostics.push(
      `Risk zone in ${names}: high acceptance with low comprehension. You're accumulating decisions you didn't actually make and don't fully understand.`,
    );
  }

  if (diagnostics.length === 0) {
    diagnostics.push("No major steering problems detected. Your vehicle is tracking well.");
  }

  return diagnostics;
}

export function AutonomyTab({ enabled = true }: { enabled?: boolean }) {
  const { data, isLoading } = useAutonomy({ enabled });

  if (isLoading)
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-32 rounded-lg bg-raised" />
      </div>
    );
  if (!data)
    return <div className="py-12 text-center text-muted">Steering data is warming up…</div>;

  const bd = data.breakdown;
  const history = (data.hdsHistory ?? []).map((h) => ({ label: h.date.slice(5), value: h.value }));
  const deps: DomainDep[] = data.dependencyMap ?? [];
  const diagnostics = buildSteeringDiagnostics(deps, bd);

  return (
    <div className="space-y-6">
      <HeroMetric
        label="Steering Precision"
        value={data.independenceIndex}
        interpretation={interpretScore("autonomy", data.independenceIndex)}
      />

      {/* Vehicle Diagnostics — the Thesis §2 "here are your steering problems" */}
      {diagnostics.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-heading font-semibold">Vehicle Diagnostics</h3>
          <div className="space-y-2.5">
            {diagnostics.map((d, i) => (
              <div key={i} className="flex gap-3 text-sm">
                <span className="shrink-0 mt-0.5 text-warning">&#9670;</span>
                <p className="text-muted">{d}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Direction (HDS)" value={bd.hds} interpretation="How much you steer" />
        <KpiCard
          label="Modification"
          value={bd.modificationRate}
          interpretation="How much you edit AI output"
        />
        <KpiCard
          label="Alternatives"
          value={bd.alternativesEval}
          interpretation="Options you evaluated"
        />
        <KpiCard
          label="Comprehension"
          value={bd.comprehensionTrend}
          interpretation="Track visibility trend"
        />
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
          <p className="mb-3 text-xs text-muted">
            Where you steer vs. where the engine drives for you
          </p>
          <div className="divide-y divide-border">
            {deps.map((d) => {
              const risk = d.acceptanceRate > 80 && d.comprehension < 40;
              const loose = d.acceptanceRate > 80;
              return (
                <div
                  key={d.domain}
                  className={cn("flex items-center gap-4 py-2.5 text-sm", risk && "bg-error/5")}
                >
                  <span className="w-24 truncate font-medium text-foreground">{d.domain}</span>
                  <span
                    className={cn(
                      "px-2 py-0.5 rounded text-xs font-mono",
                      loose ? "bg-error/20 text-error" : "bg-success/20 text-success",
                    )}
                  >
                    {loose ? "Loose" : "Tight"} — {Math.round(d.acceptanceRate)}% accept
                  </span>
                  <span
                    className={cn(
                      "px-2 py-0.5 rounded text-xs font-mono",
                      d.comprehension < 40
                        ? "bg-error/20 text-error"
                        : "bg-success/20 text-success",
                    )}
                  >
                    {d.comprehension < 40 ? "Blind" : "Clear"} — {Math.round(d.comprehension)}% vis
                  </span>
                  {risk && <span className="text-xs font-semibold text-error">Risk zone</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
