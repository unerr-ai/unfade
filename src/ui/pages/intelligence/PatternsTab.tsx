import { HeroMetric } from "@/components/shared/HeroMetric";
import { KpiCard } from "@/components/shared/KpiCard";
import { usePromptPatterns } from "@/hooks/useIntelligence";

export function PatternsTab({ enabled = true }: { enabled?: boolean }) {
  const { data, isLoading } = usePromptPatterns({ enabled });

  if (isLoading)
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-32 rounded-lg bg-raised" />
      </div>
    );
  if (!data) return <div className="py-12 text-center text-muted">Pattern data is warming up…</div>;

  const effective = data.effectivePatterns ?? [];
  const anti = data.antiPatterns ?? [];
  const topPattern = effective[0];

  return (
    <div className="space-y-6">
      <HeroMetric
        label="Top Pattern"
        value={topPattern?.pattern ?? "—"}
        interpretation={
          topPattern
            ? `${Math.round(topPattern.avgDirectionScore * 100)}% effectiveness`
            : "No patterns detected yet"
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Effective" value={effective.length} interpretation="patterns that work" />
        <KpiCard label="Anti-patterns" value={anti.length} interpretation="patterns to improve" />
        <KpiCard label="Prompts Analyzed" value={data.totalPromptsAnalyzed} />
      </div>

      {effective.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-heading font-semibold text-success">
            Effective Patterns
          </h3>
          <div className="space-y-3">
            {effective.map((p, i) => (
              <div key={i} className="rounded-md border border-success/20 bg-success/5 p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-sm text-foreground">{p.pattern}</span>
                  <span className="font-mono text-xs text-success">
                    {Math.round(p.avgDirectionScore * 100)}%
                  </span>
                </div>
                <p className="text-xs text-muted">{p.description}</p>
                <div className="mt-2 text-xs text-muted">{p.occurrences} uses</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {anti.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-heading font-semibold text-error">Anti-patterns</h3>
          <div className="space-y-3">
            {anti.map((p, i) => (
              <div key={i} className="rounded-md border border-error/20 bg-error/5 p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-sm text-foreground">{p.pattern}</span>
                  <span className="font-mono text-xs text-error">
                    {Math.round(p.avgDirectionScore * 100)}%
                  </span>
                </div>
                <p className="text-xs text-muted">{p.description}</p>
                {p.suggestion && <p className="mt-1 text-xs text-accent">💡 {p.suggestion}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
