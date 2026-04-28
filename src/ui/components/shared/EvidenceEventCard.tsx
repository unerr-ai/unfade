import { useState } from "react";
import type { EvidenceEvent } from "@/lib/api";
import { sourceBadgeClass, sourceLabel, typeLabel } from "@/lib/event-labels";
import { cn } from "@/lib/utils";

interface EvidenceEventCardProps {
  event: EvidenceEvent;
  contribution?: number;
  role?: "primary" | "corroborating" | "context";
}

const ROLE_STYLES = {
  primary: "border-l-accent",
  corroborating: "border-l-warning",
  context: "border-l-muted",
} as const;

export function EvidenceEventCard({ event, contribution, role }: EvidenceEventCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={cn(
        "rounded-md border border-border p-3",
        role && "border-l-2",
        role && ROLE_STYLES[role],
      )}
    >
        <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted min-w-0">
          <span className="whitespace-nowrap">{new Date(event.timestamp).toLocaleString()}</span>
          <span className={cn("rounded px-1.5 py-0.5 shrink-0", sourceBadgeClass(event.source))}>
            {sourceLabel(event.source)}
          </span>
          <span className="rounded bg-raised px-1.5 py-0.5 shrink-0">{typeLabel(event.type)}</span>
        </div>

        {(contribution !== undefined || role) && (
          <div className="flex items-center gap-1.5 shrink-0">
            {role && (
              <span className={cn(
                "rounded px-1 py-0.5 text-[10px]",
                role === "primary" ? "bg-accent/20 text-accent" :
                role === "corroborating" ? "bg-warning/20 text-warning" :
                "bg-muted/20 text-muted",
              )}>
                {role}
              </span>
            )}
            {contribution !== undefined && (
              <span className="text-[10px] tabular-nums text-muted">
                {Math.round(contribution * 100)}%
              </span>
            )}
          </div>
        )}
      </div>

      {event.conversationTitle && (
        <p className="mt-1 text-xs font-medium text-accent">{event.conversationTitle}</p>
      )}

      <p className="mt-1 text-sm text-foreground">{event.summary}</p>

      {event.branch && (
        <div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted">
          <span className="font-mono rounded bg-raised px-1 py-0.5">{event.branch}</span>
        </div>
      )}

      {event.files && event.files.length > 0 && (
        <div className="mt-1.5">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-[10px] text-muted hover:text-foreground"
          >
            {expanded ? "Hide" : "Show"} {event.files.length} file
            {event.files.length !== 1 ? "s" : ""}
          </button>
          {expanded && (
            <div className="mt-1 space-y-0.5">
              {event.files.map((f) => (
                <div key={f} className="font-mono text-[10px] text-muted truncate">
                  {f}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {event.detail && <p className="mt-1.5 text-xs text-muted line-clamp-3">{event.detail}</p>}
    </div>
  );
}
