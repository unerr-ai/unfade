import { useCorrelations } from "@/hooks/useIntelligence";
import { CorrelationCard, type CorrelationData } from "./CorrelationCard";
import { ShowMore } from "./ShowMore";

interface CorrelationPanelProps {
  filterAnalyzer?: string;
  maxVisible?: number;
  onEvidenceClick?: (eventIds: string[]) => void;
}

export function CorrelationPanel({
  filterAnalyzer,
  maxVisible = 5,
  onEvidenceClick,
}: CorrelationPanelProps) {
  const { data } = useCorrelations();

  const allCorrelations: CorrelationData[] = ((data as any)?.data ?? []).map((c: any) => ({
    id: c.id ?? "",
    type: c.type ?? "",
    severity: c.severity ?? "info",
    title: c.title ?? "",
    explanation: c.explanation ?? "",
    analyzers: c.analyzers ?? [],
    domain: c.domain,
    evidenceEventIds: c.evidenceEventIds ?? [],
    actionable: c.actionable ?? "",
    detectedAt: c.detectedAt ?? "",
  }));

  const filtered = filterAnalyzer
    ? allCorrelations.filter((c) => c.analyzers.includes(filterAnalyzer))
    : allCorrelations;

  const sorted = [...filtered].sort((a, b) => {
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    return (severityOrder[a.severity] ?? 2) - (severityOrder[b.severity] ?? 2);
  });

  if (sorted.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-heading font-semibold">
          Cross-Analyzer Patterns
          <span className="ml-2 text-xs font-normal text-muted">({sorted.length})</span>
        </h3>
      </div>
      <ShowMore
        items={sorted}
        initialCount={maxVisible}
        label="patterns"
        renderItem={(c) => (
          <div className="mb-2">
            <CorrelationCard
              correlation={c}
              onEvidenceClick={onEvidenceClick}
            />
          </div>
        )}
      />
    </div>
  );
}
