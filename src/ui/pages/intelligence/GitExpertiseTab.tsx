import { useQuery } from "@tanstack/react-query";
import { HeroMetric } from "@/components/shared/HeroMetric";
import { KpiCard } from "@/components/shared/KpiCard";
import { api } from "@/lib/api";
import { interpretScore } from "@/lib/diagnostics";

export function GitExpertiseTab({ enabled = true }: { enabled?: boolean }) {
  const { data: expertise, isLoading: expertiseLoading } = useQuery({
    queryKey: ["intelligence", "expertise-map"],
    queryFn: api.intelligence.expertiseMap,
    staleTime: 120_000,
    enabled,
  });
  const { data: churn } = useQuery({
    queryKey: ["intelligence", "file-churn"],
    queryFn: api.intelligence.fileChurn,
    staleTime: 120_000,
    enabled,
  });

  if (expertiseLoading)
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-32 rounded-lg bg-raised" />
      </div>
    );

  const files = (expertise as { files?: Array<{ path: string; ownership: string }> })?.files ?? [];
  const churnFiles =
    (churn as { files?: Array<{ path: string; churnScore: number }> })?.files ?? [];
  const deepCount = files.filter((f) => f.ownership === "deep").length;
  const totalCount = files.length || 1;

  return (
    <div className="space-y-6">
      <HeroMetric
        label="Expert Domains"
        value={`${deepCount} of ${totalCount}`}
        interpretation={interpretScore("git", Math.round((deepCount / totalCount) * 100))}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <KpiCard label="Files Tracked" value={totalCount} interpretation="with ownership data" />
        <KpiCard label="Deep" value={deepCount} interpretation="files you own deeply" />
        <KpiCard
          label="AI-Dependent"
          value={files.filter((f) => f.ownership === "ai-dependent").length}
          interpretation="high acceptance, low comprehension"
        />
      </div>

      {files.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-heading font-semibold">File Ownership</h3>
          <div className="divide-y divide-border max-h-96 overflow-y-auto">
            {files.slice(0, 20).map((f) => {
              const colors: Record<string, string> = {
                deep: "bg-success/20 text-success",
                familiar: "bg-cyan/20 text-cyan",
                "ai-dependent": "bg-error/20 text-error",
              };
              return (
                <div key={f.path} className="flex items-center gap-3 py-2 text-xs">
                  <span className="flex-1 truncate font-mono text-foreground">{f.path}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 ${colors[f.ownership] ?? "bg-raised text-muted"}`}
                  >
                    {f.ownership}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {churnFiles.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-heading font-semibold">File Churn</h3>
          <div className="space-y-1">
            {churnFiles.slice(0, 10).map((f) => (
              <div key={f.path} className="flex items-center gap-2 text-xs">
                <span className="flex-1 truncate font-mono text-foreground">{f.path}</span>
                <div className="w-16 h-1 rounded-full bg-raised overflow-hidden">
                  <div
                    className="h-full rounded-full bg-warning"
                    style={{ width: `${Math.min(f.churnScore * 100, 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
