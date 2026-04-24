import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { EvidenceDrawer } from "@/components/shared/EvidenceDrawer";
import { HeroMetric } from "@/components/shared/HeroMetric";
import { api, type Decision } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app";

const PAGE_SIZE = 15;

/** Transmission Thesis alignment: classify how the decision was made. */
function directionLabel(d: Decision): { text: string; color: string } {
  const cls = d.directionClassification;
  if (cls === "human-directed") return { text: "You directed", color: "text-success" };
  if (cls === "collaborative") return { text: "Collaborative", color: "text-accent" };
  if (cls === "ai-suggested") return { text: "AI suggested", color: "text-warning" };
  // Fallback: use HDS if available
  if (d.humanDirectionScore != null) {
    if (d.humanDirectionScore >= 0.6) return { text: "You directed", color: "text-success" };
    if (d.humanDirectionScore >= 0.35) return { text: "Collaborative", color: "text-accent" };
    return { text: "AI suggested", color: "text-warning" };
  }
  return { text: "Unknown origin", color: "text-muted" };
}

/** How long ago relative to now. */
function relativeDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30)
    return `${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) > 1 ? "s" : ""} ago`;
  return `${Math.floor(diffDays / 30)} month${Math.floor(diffDays / 30) > 1 ? "s" : ""} ago`;
}

export default function DecisionsPage() {
  const persona = useAppStore((s) => s.persona);
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState("30d");
  const [domain, setDomain] = useState("");
  const [page, setPage] = useState(0);
  const [selectedDecision, setSelectedDecision] = useState<Decision | null>(null);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["decisions", search, period, domain, page],
    queryFn: () =>
      api.decisions.list({
        q: search || undefined,
        period,
        domain: domain || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const decisions = data?.data?.decisions ?? [];
  const total = data?.data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const domains = [...new Set(decisions.map((d) => d.domain).filter(Boolean))] as string[];

  const handleRowClick = useCallback((d: Decision) => {
    setSelectedDecision(d);
  }, []);

  // Reset page when filters change
  const updateSearch = (v: string) => {
    setSearch(v);
    setPage(0);
  };
  const updateDomain = (v: string) => {
    setDomain(v);
    setPage(0);
  };
  const updatePeriod = (v: string) => {
    setPeriod(v);
    setPage(0);
  };

  if (persona === "executive") {
    return (
      <div className="space-y-6">
        <HeroMetric
          label="Decisions"
          value={total}
          interpretation={`${total} reasoning artifacts across ${domains.length} domains`}
        />
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-4 font-heading text-2xl font-semibold">Decisions</h1>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => updateSearch(e.target.value)}
          placeholder="Search decisions…"
          className="flex-1 rounded-lg border border-border bg-surface px-4 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent/60 focus:outline-none"
        />
        <select
          value={domain}
          onChange={(e) => updateDomain(e.target.value)}
          className="rounded border border-border bg-raised px-2 py-1.5 text-xs text-foreground"
        >
          <option value="">All domains</option>
          {domains.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select
          value={period}
          onChange={(e) => updatePeriod(e.target.value)}
          className="rounded border border-border bg-raised px-2 py-1.5 text-xs text-foreground"
        >
          <option value="7d">7 days</option>
          <option value="30d">30 days</option>
          <option value="90d">90 days</option>
        </select>
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-12 rounded bg-raised" />
          ))}
        </div>
      ) : (
        <div
          className={cn(
            "rounded-lg border border-border bg-surface p-4 transition-opacity",
            isFetching && "opacity-60",
          )}
        >
          <div className="mb-3 flex items-center justify-between text-xs text-muted">
            <span>{total} decisions found</span>
            {isFetching && <span className="animate-pulse">Loading…</span>}
          </div>

          {/* Decision cards — Transmission Thesis: narrative-diagnostic, not flat table */}
          <div className="space-y-3">
            {decisions.map((d, i) => {
              const direction = directionLabel(d);
              return (
                <button
                  type="button"
                  key={`${d.date}-${i}`}
                  onClick={() => handleRowClick(d)}
                  className="w-full rounded-lg border border-border bg-canvas p-4 text-left transition-colors hover:bg-raised"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">{d.decision}</p>
                      <p className="mt-1 text-xs text-muted line-clamp-2">{d.rationale}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 text-[10px] shrink-0">
                      <span className="text-muted">{relativeDate(d.date)}</span>
                      <span className={direction.color}>{direction.text}</span>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {d.domain && (
                      <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
                        {d.domain}
                      </span>
                    )}
                    {d.projectId && (
                      <span className="rounded bg-muted/10 px-1.5 py-0.5 text-[10px] text-muted">
                        {d.projectId}
                      </span>
                    )}
                    {d.evidenceEventIds && d.evidenceEventIds.length > 0 && (
                      <span className="rounded bg-muted/10 px-1.5 py-0.5 text-[10px] text-muted">
                        {d.evidenceEventIds.length} source event
                        {d.evidenceEventIds.length !== 1 ? "s" : ""}
                      </span>
                    )}
                    {d.humanDirectionScore != null && (
                      <span className="rounded bg-muted/10 px-1.5 py-0.5 text-[10px] text-muted">
                        Direction: {(d.humanDirectionScore * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {decisions.length === 0 && (
            <div className="py-8 text-center text-sm text-muted">No decisions found</div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
                className="rounded px-3 py-1.5 text-xs text-foreground disabled:opacity-40 hover:bg-raised"
              >
                Previous
              </button>
              <span className="text-xs text-muted">
                Page {page + 1} of {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages - 1}
                onClick={() => setPage(page + 1)}
                className="rounded px-3 py-1.5 text-xs text-foreground disabled:opacity-40 hover:bg-raised"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}

      <EvidenceDrawer
        open={!!selectedDecision}
        onClose={() => setSelectedDecision(null)}
        title={selectedDecision?.decision ?? ""}
        entityType="Decision"
        items={
          selectedDecision
            ? [
                {
                  timestamp: `${selectedDecision.date}T12:00:00Z`,
                  source: "distill",
                  summary: selectedDecision.rationale,
                },
              ]
            : []
        }
        metrics={
          selectedDecision
            ? [
                { label: "Domain", value: selectedDecision.domain ?? "—" },
                { label: "Date", value: selectedDecision.date },
                { label: "Project", value: selectedDecision.projectId ?? "—" },
                { label: "Origin", value: directionLabel(selectedDecision).text },
                ...(selectedDecision.humanDirectionScore != null
                  ? [
                      {
                        label: "Direction Score",
                        value: `${(selectedDecision.humanDirectionScore * 100).toFixed(0)}%`,
                      },
                    ]
                  : []),
                ...(selectedDecision.evidenceEventIds?.length
                  ? [
                      {
                        label: "Evidence Events",
                        value: String(selectedDecision.evidenceEventIds.length),
                      },
                    ]
                  : []),
              ]
            : []
        }
      />
    </div>
  );
}
