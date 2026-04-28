import { useState } from "react";
import { CorrelationCard, type CorrelationData } from "@/components/shared/CorrelationCard";
import { EvidenceDrawer } from "@/components/shared/EvidenceDrawer";
import { FreshnessBadge } from "@/components/shared/FreshnessBadge";
import { HeroMetric } from "@/components/shared/HeroMetric";
import { KpiCard } from "@/components/shared/KpiCard";
import { ShowMore } from "@/components/shared/ShowMore";
import { usePromptPatterns } from "@/hooks/useIntelligence";

interface EffectivePattern {
  domain: string;
  pattern: string;
  acceptanceRate: number;
  sampleSize: number;
  entities?: string[];
  exampleSessionIds?: string[];
}

interface AntiPattern {
  domain: string;
  pattern: string;
  rejectionRate: number;
  suggestion: string;
  exampleSessionIds?: string[];
}

export function PatternsTab({ enabled = true }: { enabled?: boolean }) {
  const { data, isLoading } = usePromptPatterns({ enabled });
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
  if (!data) return <div className="py-12 text-center text-muted">Pattern data is warming up…</div>;

  const effective = (data.effectivePatterns as EffectivePattern[]) ?? [];
  const anti = (data.antiPatterns as AntiPattern[]) ?? [];
  const totalAnalyzed = (data.totalPromptsAnalyzed as number) ?? 0;
  const correlations = (data.correlations as CorrelationData[]) ?? [];
  const diagnostics = (data.diagnostics as Array<{ severity: string; message: string; actionable: string; evidenceEventIds?: string[] }>) ?? [];
  const topPattern = effective[0];

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
            <CorrelationCard
              key={c.id}
              correlation={c}
              onEvidenceClick={(ids) => openEvidence(c.title, ids)}
            />
          ))}
        </div>
      )}

      <HeroMetric
        label="Top Pattern"
        value={topPattern?.pattern ?? "—"}
        interpretation={
          topPattern
            ? `${Math.round(topPattern.acceptanceRate * 100)}% effectiveness across ${topPattern.sampleSize} sessions`
            : "No patterns detected yet"
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Effective" value={effective.length} interpretation="patterns that work" />
        <KpiCard label="Anti-patterns" value={anti.length} interpretation="patterns to improve" />
        <KpiCard label="Prompts Analyzed" value={totalAnalyzed} />
      </div>

      {effective.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-heading font-semibold text-success">Effective Patterns</h3>
          <ShowMore
            items={effective}
            initialCount={5}
            label="patterns"
            renderItem={(p) => (
              <button
                type="button"
                onClick={() => p.exampleSessionIds?.length && openEvidence(`${p.domain} — effective pattern sessions`, p.exampleSessionIds)}
                className="w-full text-left rounded-md border border-success/20 bg-success/5 p-4 mb-2 hover:bg-success/10 transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-sm text-foreground">{p.pattern}</span>
                  <span className="font-mono text-xs text-success">{Math.round(p.acceptanceRate * 100)}%</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted">
                  <span className="font-mono bg-raised px-1.5 py-0.5 rounded">{p.domain}</span>
                  <span>{p.sampleSize} sessions</span>
                  {p.exampleSessionIds && p.exampleSessionIds.length > 0 && (
                    <span className="text-accent">{p.exampleSessionIds.length} examples</span>
                  )}
                </div>
              </button>
            )}
          />
        </div>
      )}

      {anti.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-heading font-semibold text-error">Anti-patterns</h3>
          <ShowMore
            items={anti}
            initialCount={5}
            label="anti-patterns"
            renderItem={(p) => (
              <button
                type="button"
                onClick={() => p.exampleSessionIds?.length && openEvidence(`${p.domain} — anti-pattern sessions`, p.exampleSessionIds)}
                className="w-full text-left rounded-md border border-error/20 bg-error/5 p-4 mb-2 hover:bg-error/10 transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-sm text-foreground">{p.pattern}</span>
                  <span className="font-mono text-xs text-error">{Math.round(p.rejectionRate * 100)}%</span>
                </div>
                <p className="text-xs text-accent mt-1">{p.suggestion}</p>
                <div className="flex items-center gap-3 mt-2 text-xs text-muted">
                  <span className="font-mono bg-raised px-1.5 py-0.5 rounded">{p.domain}</span>
                  {p.exampleSessionIds && p.exampleSessionIds.length > 0 && (
                    <span className="text-accent">{p.exampleSessionIds.length} examples</span>
                  )}
                </div>
              </button>
            )}
          />
        </div>
      )}

      {diagnostics.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-heading font-semibold">Pattern Diagnostics</h3>
          <ShowMore
            items={diagnostics}
            initialCount={3}
            label="diagnostics"
            renderItem={(diag) => (
              <div className="rounded-md border border-border bg-surface p-3 mb-2">
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
