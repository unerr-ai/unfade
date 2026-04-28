import { useState } from "react";
import type { EvidenceEvent } from "@/lib/api";
import { sourceBadgeClass, sourceLabel, typeLabel } from "@/lib/event-labels";
import { cn } from "@/lib/utils";

/** Render a single evidence event card — reusable across Decisions, Distill, and evidence drawers. */
export function EvidenceEventCard({ event }: { event: EvidenceEvent }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-center gap-2 text-xs text-muted">
        <span>{new Date(event.timestamp).toLocaleString()}</span>
        <span className={cn("rounded px-1.5 py-0.5", sourceBadgeClass(event.source))}>
          {sourceLabel(event.source)}
        </span>
        <span className="rounded bg-raised px-1.5 py-0.5">{typeLabel(event.type)}</span>
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
