import { useState } from "react";
import { EvidenceDrawer } from "@/components/shared/EvidenceDrawer";
import { FreshnessBadge } from "@/components/shared/FreshnessBadge";
import { HeroMetric } from "@/components/shared/HeroMetric";
import { ShowMore } from "@/components/shared/ShowMore";
import { useNarratives } from "@/hooks/useIntelligence";
import { cn } from "@/lib/utils";

interface NarrativeItem {
  id: string;
  type: string;
  headline: string;
  body: string;
  importance: number;
  evidenceEventIds?: string[];
  relatedAnalyzers?: string[];
  createdAt?: string;
}

const TYPE_COLORS: Record<string, { border: string; bg: string; label: string }> = {
  diagnostic: { border: "border-warning/30", bg: "bg-warning/5", label: "Diagnostic" },
  prescription: { border: "border-accent/30", bg: "bg-accent/5", label: "Prescription" },
  progress: { border: "border-success/30", bg: "bg-success/5", label: "Progress" },
  correlation: { border: "border-violet-500/30", bg: "bg-violet-500/5", label: "Correlation" },
};

const ANALYZER_LABELS: Record<string, string> = {
  efficiency: "Efficiency",
  "comprehension-radar": "Comprehension",
  "cost-attribution": "Cost",
  "loop-detector": "Loops",
  "velocity-tracker": "Velocity",
  "prompt-patterns": "Patterns",
  "blind-spot-detector": "Blind Spots",
  "decision-replay": "Decisions",
};

export function NarrativesTab({ enabled = true }: { enabled?: boolean }) {
  const { data, isLoading } = useNarratives({ enabled });
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
  if (!data) return <div className="py-12 text-center text-muted">Narratives are warming up…</div>;

  const narratives: NarrativeItem[] = (data.narratives ?? []).map((n: any) => ({
    id: n.id ?? `n-${Math.random()}`,
    type: n.type ?? "diagnostic",
    headline: n.headline ?? n.claim ?? "",
    body: n.body ?? "",
    importance: n.importance ?? 0.5,
    evidenceEventIds: n.evidenceEventIds ?? [],
    relatedAnalyzers: n.relatedAnalyzers ?? [],
    createdAt: n.createdAt,
  }));

  const executiveSummary = (data as any).executiveSummary as string | undefined;
  const updatedAt = (data as any).updatedAt as string | undefined;

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
      {updatedAt && <FreshnessBadge updatedAt={updatedAt} />}

      <HeroMetric
        label="Narratives"
        value={narratives.length}
        interpretation={
          narratives.length > 5 ? "Rich intelligence — multiple signal threads"
          : narratives.length > 0 ? "Threads emerging"
          : "Signal building"
        }
      />

      {executiveSummary && (
        <div className="rounded-lg border border-accent/30 bg-accent/5 p-5">
          <div className="text-[11px] uppercase tracking-wider text-accent mb-2">Executive Summary</div>
          <p className="text-sm text-foreground leading-relaxed">{executiveSummary}</p>
        </div>
      )}

      {narratives.length > 0 && (
        <ShowMore
          items={narratives}
          initialCount={8}
          label="narratives"
          renderItem={(n) => {
            const style = TYPE_COLORS[n.type] ?? TYPE_COLORS.diagnostic;
            const hasEvidence = (n.evidenceEventIds?.length ?? 0) > 0;
            return (
              <button
                type="button"
                onClick={() => hasEvidence && openEvidence(n.headline, n.evidenceEventIds!)}
                disabled={!hasEvidence}
                className={cn(
                  "w-full text-left rounded-lg border p-4 mb-3 transition-colors",
                  style.border, style.bg,
                  hasEvidence && "cursor-pointer hover:opacity-90",
                )}
              >
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", style.border, "bg-surface")}>
                    {style.label}
                  </span>
                  {n.relatedAnalyzers && n.relatedAnalyzers.length > 0 && n.relatedAnalyzers.map((a) => (
                    <span key={a} className="rounded bg-raised px-1.5 py-0.5 text-[10px] text-muted">
                      {ANALYZER_LABELS[a] ?? a}
                    </span>
                  ))}
                  {hasEvidence && (
                    <span className="text-[10px] text-accent">{n.evidenceEventIds!.length} events</span>
                  )}
                </div>
                <h4 className="text-sm font-medium text-foreground">{n.headline}</h4>
                {n.body && <p className="text-xs text-foreground/70 mt-1 leading-relaxed">{n.body}</p>}
              </button>
            );
          }}
        />
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
