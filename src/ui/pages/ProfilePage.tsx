import { useQuery } from "@tanstack/react-query";
import { User } from "lucide-react";
import { RadarChart } from "@/components/charts/RadarChart";
import { EmptyState } from "@/components/shared/EmptyState";
import { HeroMetric } from "@/components/shared/HeroMetric";
import { KpiCard } from "@/components/shared/KpiCard";
import { useMaturity } from "@/hooks/useIntelligence";
import { api } from "@/lib/api";

export default function ProfilePage() {
  const { data: profileResp, isLoading } = useQuery({
    queryKey: ["profile"],
    queryFn: api.profile.get,
    staleTime: 120_000,
  });
  const { data: maturity } = useMaturity();

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-32 rounded-lg bg-raised" />
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-lg bg-raised" />
          ))}
        </div>
      </div>
    );
  }

  const profile = profileResp?.data;
  if (!profile || profile.dataPoints < 2) {
    return (
      <EmptyState
        icon={User}
        title="Profile is building"
        description="The profile builds automatically as you work. Requires at least 2 distills to detect patterns."
      />
    );
  }

  const ds = profile.decisionStyle;
  const domains = profile.domainDistribution ?? [];
  const patterns = (profile.patterns ?? []).filter((p) => p.confidence >= 0.7);
  const topDomain = domains[0]?.domain;

  const traits: string[] = [];
  if (ds.avgAlternativesEvaluated >= 3) traits.push("architectural thinking");
  if (ds.aiModificationRate >= 0.25) traits.push("active steering");
  if (1 - ds.aiAcceptanceRate >= 0.8) traits.push("high-durability decisions");

  const identityLine =
    traits.length > 0
      ? `Your engineering identity: ${traits.join(", ")}${topDomain ? `. Strongest in ${topDomain}.` : ""}`
      : "Your engineering identity is still emerging. Keep working to reveal patterns.";

  return (
    <div>
      <h1 className="mb-4 font-heading text-2xl font-semibold">Profile</h1>

      <div className="space-y-6">
        <HeroMetric
          label="Engineering Identity"
          value={maturity ? `Phase ${maturity.phase}` : "—"}
          interpretation={identityLine}
          maturityPhase={
            maturity ? { phase: maturity.phase, label: maturity.phaseLabel } : undefined
          }
        />

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard
            label="Decisions"
            value={profile.dataPoints}
            interpretation={`${profile.distillCount} distills analyzed`}
          />
          <KpiCard
            label="Alternatives"
            value={ds.avgAlternativesEvaluated.toFixed(1)}
            interpretation={ds.avgAlternativesEvaluated >= 3 ? "architectural" : "direct"}
          />
          <KpiCard
            label="Modification Rate"
            value={`${Math.round(ds.aiModificationRate * 100)}%`}
            interpretation={ds.aiModificationRate >= 0.25 ? "active steering" : "passive"}
          />
          <KpiCard label="Active Domains" value={domains.length} interpretation="distinct areas" />
        </div>

        {domains.length >= 3 && (
          <div className="rounded-lg border border-border bg-surface p-5">
            <h2 className="mb-4 text-sm font-heading font-semibold">Reasoning Profile Shape</h2>
            <RadarChart
              axes={domains.slice(0, 8).map((d) => ({
                label: d.domain,
                value: Math.round(d.percentageOfTotal * 100),
              }))}
            />
          </div>
        )}

        {domains.length > 0 && (
          <div className="rounded-lg border border-border bg-surface p-5">
            <h2 className="mb-3 text-sm font-heading font-semibold">Domain Distribution</h2>
            <div className="space-y-2">
              {domains.map((d) => (
                <div key={d.domain} className="flex items-center gap-3 text-sm">
                  <span className="w-24 truncate font-medium text-foreground">{d.domain}</span>
                  <div className="h-1.5 flex-1 rounded-full bg-raised overflow-hidden">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${Math.round(d.percentageOfTotal * 100)}%` }}
                    />
                  </div>
                  <span className="w-8 text-right font-mono text-xs text-muted">{d.frequency}</span>
                  <span
                    className={`text-xs ${d.depth === "deep" ? "text-success" : d.depth === "moderate" ? "text-warning" : "text-muted"}`}
                  >
                    {d.depth}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {patterns.length > 0 && (
          <div className="rounded-lg border border-border bg-surface p-5">
            <h2 className="mb-3 text-sm font-heading font-semibold">Signature Patterns</h2>
            <p className="mb-4 text-xs text-muted">
              Confidence &gt; 70% — based on {profile.dataPoints} observations
            </p>
            <div className="space-y-3">
              {patterns.map((p, i) => (
                <div key={i} className="rounded-md bg-raised p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-foreground">{p.pattern}</span>
                    <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent">
                      {p.category}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-canvas overflow-hidden">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${Math.round(p.confidence * 100)}%` }}
                    />
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    {p.examples} examples · since {p.observedSince}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-lg border border-border bg-surface p-5">
          <h2 className="mb-3 text-sm font-heading font-semibold">Activity Patterns</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-md bg-raised p-4 text-center">
              <div className="font-mono text-2xl font-bold text-accent">
                {profile.temporalPatterns.avgDecisionsPerDay.toFixed(1)}
              </div>
              <div className="mt-1 text-xs text-muted">Decisions / day</div>
            </div>
            <div className="rounded-md bg-raised p-4 text-center">
              <div className="font-mono text-2xl font-bold text-accent">{profile.dataPoints}</div>
              <div className="mt-1 text-xs text-muted">Total observations</div>
            </div>
          </div>
          {profile.temporalPatterns.mostProductiveHours.length > 0 && (
            <p className="mt-3 text-xs text-muted">
              Most productive:{" "}
              {profile.temporalPatterns.mostProductiveHours.map((h) => `${h}:00`).join(", ")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
