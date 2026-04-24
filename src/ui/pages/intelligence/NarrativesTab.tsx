import { HeroMetric } from "@/components/shared/HeroMetric";
import { InsightCard } from "@/components/shared/InsightCard";
import { useNarratives } from "@/hooks/useIntelligence";

export function NarrativesTab({ enabled = true }: { enabled?: boolean }) {
  const { data, isLoading } = useNarratives({ enabled });

  if (isLoading)
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-32 rounded-lg bg-raised" />
      </div>
    );
  if (!data) return <div className="py-12 text-center text-muted">Narratives are warming up…</div>;

  const narratives = data.narratives ?? [];
  const diagnostics = narratives.filter((n) => n.type === "diagnostic" || n.severity);
  const prescriptions = narratives.filter((n) => n.type === "prescription" || n.action);

  return (
    <div className="space-y-6">
      <HeroMetric
        label="Narratives"
        value={narratives.length}
        interpretation={
          narratives.length > 5
            ? "Clear signal path"
            : narratives.length > 0
              ? "Threads emerging"
              : "Signal building"
        }
      />

      {narratives.length > 0 && narratives[0].claim && (
        <div className="rounded-lg border border-accent/30 bg-accent/5 p-5">
          <div className="text-[11px] uppercase tracking-wider text-accent mb-2">
            Executive Summary
          </div>
          <p className="text-sm text-foreground">{narratives[0].claim}</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-3 text-sm font-heading font-semibold">Diagnostics</h3>
          {diagnostics.length > 0 ? (
            <div className="space-y-3">
              {diagnostics.slice(0, 5).map((d, i) => (
                <InsightCard
                  key={i}
                  text={d.claim}
                  severity={d.severity as "info" | "warning" | "critical" | undefined}
                  confidence={d.confidence}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">No active diagnostics</p>
          )}
        </div>

        <div>
          <h3 className="mb-3 text-sm font-heading font-semibold">Prescriptions</h3>
          {prescriptions.length > 0 ? (
            <div className="space-y-3">
              {prescriptions.slice(0, 5).map((p, i) => (
                <div key={i} className="rounded-lg border border-border bg-surface p-4">
                  <p className="text-sm text-foreground">{p.action ?? p.claim}</p>
                  {p.estimatedImpact && (
                    <p className="mt-1 text-xs text-accent">Impact: {p.estimatedImpact}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">No prescriptions yet</p>
          )}
        </div>
      </div>
    </div>
  );
}
