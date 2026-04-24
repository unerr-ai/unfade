import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { EmptyState } from "@/components/shared/EmptyState";
import { FreshnessBadge } from "@/components/shared/FreshnessBadge";
import { NarrativeHeadline } from "@/components/shared/NarrativeHeadline";
import { api } from "@/lib/api";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export default function DistillPage() {
  const [date, setDate] = useState(todayStr());
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["distill", date],
    queryFn: () => api.distill.byDate(date),
    staleTime: 60_000,
    retry: false,
  });

  const regenerate = useMutation({
    mutationFn: () => api.distill.generate(date),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["distill", date] }),
  });

  const hasContent = !!data?.content;
  const metadata = data?.metadata;

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
        {data?.synthesizedBy && <FreshnessBadge updatedAt={new Date().toISOString()} />}
      </div>

      {isLoading ? (
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
      ) : (
        <div className="space-y-6">
          {metadata && (
            <NarrativeHeadline
              text={`Today you made ${metadata.decisions ?? 0} decisions across ${metadata.domains?.length ?? 0} domains.${metadata.deadEnds ? ` ${metadata.deadEnds} dead ends explored.` : ""}`}
            />
          )}

          <div className="rounded-lg border border-border bg-surface p-6">
            <div className="prose-unfade max-w-none text-sm text-foreground [&_h1]:text-xl [&_h1]:font-heading [&_h1]:font-semibold [&_h1]:mt-6 [&_h1]:mb-3 [&_h2]:text-lg [&_h2]:font-heading [&_h2]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2 [&_p]:mb-3 [&_p]:leading-relaxed [&_ul]:mb-3 [&_ul]:ml-6 [&_ul]:list-disc [&_ol]:mb-3 [&_ol]:ml-6 [&_ol]:list-decimal [&_li]:mb-1 [&_code]:bg-raised [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono [&_pre]:bg-raised [&_pre]:border [&_pre]:border-border [&_pre]:rounded-lg [&_pre]:p-4 [&_pre]:overflow-x-auto [&_pre]:my-3 [&_blockquote]:border-l-[3px] [&_blockquote]:border-accent [&_blockquote]:pl-4 [&_blockquote]:my-3 [&_blockquote]:text-muted [&_blockquote]:italic [&_strong]:text-foreground [&_strong]:font-semibold [&_a]:text-accent [&_a]:hover:text-accent-dim">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.content}</ReactMarkdown>
            </div>
          </div>

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
