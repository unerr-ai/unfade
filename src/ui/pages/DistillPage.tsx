import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  GitBranch,
  Lightbulb,
  RefreshCw,
  Scale,
  Skull,
  Sparkles,
  Zap,
} from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { FreshnessBadge } from "@/components/shared/FreshnessBadge";
import type {
  ContinuityThread,
  EnrichedDeadEndResponse,
  EnrichedDecisionResponse,
  EnrichedDistillResponse,
  EnrichedTradeOffResponse,
} from "@/lib/api";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/* ── Tier badge ── */
function TierBadge({ tier }: { tier: string }) {
  const styles: Record<string, string> = {
    primary: "bg-accent/10 text-accent border-accent/30",
    supporting: "bg-muted/10 text-muted border-border",
    background: "bg-surface text-muted border-border",
  };
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
        styles[tier] ?? styles.background,
      )}
    >
      {tier}
    </span>
  );
}

/* ── Section wrapper ── */
function Section({
  icon,
  title,
  count,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 text-foreground">
        {icon}
        <h2 className="font-heading text-base font-semibold">{title}</h2>
        {count != null && count > 0 && (
          <span className="rounded-full bg-overlay px-2 py-0.5 text-[10px] font-medium text-muted">
            {count}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

/* ── Decision card (primary tier — full detail) ── */
function PrimaryDecisionCard({ d }: { d: EnrichedDecisionResponse }) {
  return (
    <div className="rounded-lg border border-accent/20 bg-accent/5 p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-foreground">{d.decision}</p>
        <TierBadge tier={d.tier} />
      </div>
      <p className="text-xs text-muted leading-relaxed">{d.rationale}</p>
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted">
        {d.domain && <span className="rounded bg-overlay px-1.5 py-0.5 font-mono">{d.domain}</span>}
        {d.impactScore != null && <span>Impact: {d.impactScore.toFixed(1)}</span>}
        {d.causalTrigger && (
          <span className="flex items-center gap-1">
            <Zap size={10} /> {d.causalTrigger}
          </span>
        )}
        {d.outcome && (
          <span className="flex items-center gap-1">
            <ArrowRight size={10} /> {d.outcome}
          </span>
        )}
        {d.directionClassification && <span className="italic">{d.directionClassification}</span>}
      </div>
    </div>
  );
}

/* ── Supporting decisions (compact list) ── */
function SupportingDecisionRow({ d }: { d: EnrichedDecisionResponse }) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-border bg-surface px-3 py-2">
      <CircleDot size={12} className="mt-0.5 shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-foreground">{d.decision}</p>
        {d.domain && (
          <span className="mt-0.5 inline-block rounded bg-overlay px-1.5 py-0.5 text-[10px] font-mono text-muted">
            {d.domain}
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Trade-off card ── */
function TradeOffCard({ t }: { t: EnrichedTradeOffResponse }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 space-y-2">
      <p className="text-sm text-foreground">{t.tradeOff}</p>
      <div className="flex gap-4 text-xs">
        <span className="flex items-center gap-1 text-success">
          <Sparkles size={12} /> Chose: {t.chose}
        </span>
        <span className="flex items-center gap-1 text-muted line-through">
          Rejected: {t.rejected}
        </span>
      </div>
      {t.context && <p className="text-[11px] text-muted">{t.context}</p>}
    </div>
  );
}

/* ── Dead-end card ── */
function DeadEndCard({ d }: { d: EnrichedDeadEndResponse }) {
  return (
    <div className="rounded-lg border border-error/20 bg-error/5 p-4 space-y-2">
      <p className="text-sm text-foreground">{d.description}</p>
      <p className="text-xs text-muted">{d.attemptSummary}</p>
      <div className="flex flex-wrap gap-3 text-[11px] text-muted">
        {d.timeSpentMinutes != null && <span>{d.timeSpentMinutes}m spent</span>}
        {d.resolution && <span>Resolution: {d.resolution}</span>}
        <span className="italic">Detected: {d.detectionMethod}</span>
      </div>
    </div>
  );
}

/* ── Continuity thread row ── */
function ThreadRow({ t }: { t: ContinuityThread }) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-border bg-surface px-3 py-2">
      <span
        className={cn(
          "mt-0.5 h-2 w-2 shrink-0 rounded-full",
          t.resolved ? "bg-success" : "bg-warning",
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-foreground">{t.question}</p>
        <div className="mt-0.5 flex gap-2 text-[10px] text-muted">
          <span className="rounded bg-overlay px-1.5 py-0.5 font-mono">{t.domain}</span>
          {t.continuedFrom && <span>from {t.continuedFrom}</span>}
        </div>
      </div>
    </div>
  );
}

/* ── V1 fallback (raw markdown) ── */
function MarkdownFallback({ markdown }: { markdown: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-6">
      <div className="prose-unfade max-w-none text-sm text-foreground [&_h1]:text-xl [&_h1]:font-heading [&_h1]:font-semibold [&_h1]:mt-6 [&_h1]:mb-3 [&_h2]:text-lg [&_h2]:font-heading [&_h2]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2 [&_p]:mb-3 [&_p]:leading-relaxed [&_ul]:mb-3 [&_ul]:ml-6 [&_ul]:list-disc [&_ol]:mb-3 [&_ol]:ml-6 [&_ol]:list-decimal [&_li]:mb-1 [&_code]:bg-raised [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono [&_pre]:bg-raised [&_pre]:border [&_pre]:border-border [&_pre]:rounded-lg [&_pre]:p-4 [&_pre]:overflow-x-auto [&_pre]:my-3 [&_blockquote]:border-l-[3px] [&_blockquote]:border-accent [&_blockquote]:pl-4 [&_blockquote]:my-3 [&_blockquote]:text-muted [&_blockquote]:italic [&_strong]:text-foreground [&_strong]:font-semibold [&_a]:text-accent [&_a]:hover:text-accent-dim">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      </div>
    </div>
  );
}

/* ── V2 structured view ── */
function EnrichedDistillView({ data }: { data: Extract<EnrichedDistillResponse, { version: 2 }> }) {
  const {
    narrative,
    decisions,
    tradeOffs,
    deadEnds,
    breakthroughs,
    patterns,
    continuityThreads,
    meta,
  } = data;
  const primary = decisions.filter((d) => d.tier === "primary");
  const supporting = decisions.filter((d) => d.tier === "supporting");
  const openThreads = continuityThreads.filter((t) => !t.resolved);
  const resolvedThreads = continuityThreads.filter((t) => t.resolved);

  return (
    <div className="space-y-8">
      {/* Narrative arc headline */}
      {narrative?.arc && (
        <div className="rounded-lg border border-accent/30 bg-accent/5 p-5">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-accent">
            {narrative.arc.type}
          </div>
          <p className="text-lg font-heading font-semibold text-foreground">
            {narrative.arc.headline}
          </p>
          <p className="mt-2 text-sm text-muted leading-relaxed">{narrative.arc.openingContext}</p>
        </div>
      )}

      {/* Key Decisions (primary) */}
      {primary.length > 0 && (
        <Section icon={<GitBranch size={16} />} title="Key Decisions" count={primary.length}>
          <div className="space-y-3">
            {primary.map((d, i) => (
              <PrimaryDecisionCard key={`pri-${i}`} d={d} />
            ))}
          </div>
        </Section>
      )}

      {/* Also Decided (supporting) */}
      {supporting.length > 0 && (
        <Section icon={<CircleDot size={16} />} title="Also Decided" count={supporting.length}>
          <div className="space-y-2">
            {supporting.map((d, i) => (
              <SupportingDecisionRow key={`sup-${i}`} d={d} />
            ))}
          </div>
        </Section>
      )}

      {/* Trade-offs */}
      {tradeOffs.length > 0 && (
        <Section icon={<Scale size={16} />} title="Trade-offs" count={tradeOffs.length}>
          <div className="space-y-3">
            {tradeOffs.map((t, i) => (
              <TradeOffCard key={`to-${i}`} t={t} />
            ))}
          </div>
        </Section>
      )}

      {/* Dead Ends */}
      {deadEnds.length > 0 && (
        <Section icon={<Skull size={16} />} title="Dead Ends" count={deadEnds.length}>
          <div className="space-y-3">
            {deadEnds.map((d, i) => (
              <DeadEndCard key={`de-${i}`} d={d} />
            ))}
          </div>
        </Section>
      )}

      {/* Breakthroughs */}
      {breakthroughs.length > 0 && (
        <Section icon={<Lightbulb size={16} />} title="Breakthroughs" count={breakthroughs.length}>
          <div className="space-y-2">
            {breakthroughs.map((b, i) => (
              <div key={`bt-${i}`} className="rounded-lg border border-success/20 bg-success/5 p-3">
                <p className="text-sm text-foreground">{b.description}</p>
                {b.trigger && (
                  <p className="mt-1 text-[11px] text-muted flex items-center gap-1">
                    <Zap size={10} /> Trigger: {b.trigger}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Patterns */}
      {patterns.length > 0 && (
        <Section icon={<Sparkles size={16} />} title="Patterns">
          <div className="flex flex-wrap gap-2">
            {patterns.map((p, i) => (
              <span
                key={`pat-${i}`}
                className="rounded-full border border-border bg-overlay px-3 py-1 text-xs text-foreground"
              >
                {p}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* Continuity Threads */}
      {(openThreads.length > 0 || resolvedThreads.length > 0) && (
        <Section
          icon={<AlertTriangle size={16} />}
          title="Continuity Threads"
          count={openThreads.length + resolvedThreads.length}
        >
          {openThreads.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wider text-warning">
                Open Questions
              </h3>
              {openThreads.map((t, i) => (
                <ThreadRow key={`open-${i}`} t={t} />
              ))}
            </div>
          )}
          {resolvedThreads.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wider text-success">
                Resolved from Previous Days
              </h3>
              {resolvedThreads.map((t, i) => (
                <ThreadRow key={`res-${i}`} t={t} />
              ))}
            </div>
          )}
        </Section>
      )}

      {/* Closing state + meta footer */}
      {(narrative?.arc?.closingState || meta) && (
        <div className="space-y-3 border-t border-border pt-6">
          {narrative?.arc?.closingState && (
            <p className="text-sm italic text-muted">{narrative.arc.closingState}</p>
          )}
          {meta && (
            <div className="flex flex-wrap gap-4 text-[11px] text-muted">
              <span>{meta.eventsProcessed} events processed</span>
              <span>Synthesized by {meta.synthesizedBy}</span>
              {meta.dayShape && (
                <>
                  <span>Dominant: {meta.dayShape.dominantDomain}</span>
                  <span>Arc: {meta.dayShape.arcType}</span>
                </>
              )}
              {meta.signalCounts && (
                <span>
                  {meta.signalCounts.primary}P / {meta.signalCounts.supporting}S /{" "}
                  {meta.signalCounts.background}B signals
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Main page ── */
export default function DistillPage() {
  const [date, setDate] = useState(todayStr());
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["distill-enriched", date],
    queryFn: () => api.distill.enriched(date),
    staleTime: 60_000,
    retry: false,
  });

  const regenerate = useMutation({
    mutationFn: () => api.distill.generate(date),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["distill-enriched", date] }),
  });

  const hasContent = data != null;

  return (
    <div>
      <h1 className="mb-4 font-heading text-2xl font-semibold">Distill</h1>

      <div className="mb-6 flex items-center gap-4">
        <button
          type="button"
          onClick={() => setDate(addDays(date, -1))}
          className="rounded-md border border-border bg-raised px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-overlay"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="font-mono text-base text-foreground">{date}</span>
        <button
          type="button"
          onClick={() => setDate(addDays(date, 1))}
          disabled={date >= todayStr()}
          className="rounded-md border border-border bg-raised px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-overlay disabled:opacity-40"
        >
          <ChevronRight size={16} />
        </button>
        {data?.lastUpdated && <FreshnessBadge updatedAt={data.lastUpdated} />}
      </div>

      {error ? (
        <ErrorState
          error={error}
          onRetry={() => qc.invalidateQueries({ queryKey: ["distill-enriched", date] })}
        />
      ) : isLoading ? (
        <div className="animate-pulse space-y-4">
          <div className="h-16 rounded-lg bg-raised" />
          <div className="h-64 rounded-lg bg-raised" />
        </div>
      ) : !hasContent ? (
        <EmptyState
          title={`No distill for ${date}`}
          description="Capture some activity first, or generate a distill now."
          action={{ label: "Generate Distill", onClick: () => regenerate.mutate() }}
        />
      ) : data.version === 2 ? (
        <div className="space-y-6">
          <EnrichedDistillView data={data} />

          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => regenerate.mutate()}
              disabled={regenerate.isPending}
              className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-dim disabled:opacity-50"
            >
              <RefreshCw size={14} className={regenerate.isPending ? "animate-spin" : ""} />
              Re-generate Distill
            </button>
            {regenerate.isPending && <span className="text-xs text-muted">Generating…</span>}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <MarkdownFallback markdown={data.markdown} />

          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => regenerate.mutate()}
              disabled={regenerate.isPending}
              className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-dim disabled:opacity-50"
            >
              <RefreshCw size={14} className={regenerate.isPending ? "animate-spin" : ""} />
              Re-generate Distill
            </button>
            {regenerate.isPending && <span className="text-xs text-muted">Generating…</span>}
          </div>
        </div>
      )}
    </div>
  );
}
