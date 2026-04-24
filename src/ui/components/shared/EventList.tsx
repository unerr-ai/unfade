import { cn } from "@/lib/utils";
import type { CapturedEvent } from "@/types/events";

interface EventListProps {
  events: CapturedEvent[];
  maxItems?: number;
  className?: string;
}

const SOURCE_COLORS: Record<string, string> = {
  git: "text-success",
  "ai-session": "text-accent",
  "mcp-active": "text-accent",
  terminal: "text-cyan",
};

export function EventList({ events, maxItems = 10, className }: EventListProps) {
  const visible = events.slice(0, maxItems);

  if (visible.length === 0) {
    return <div className="py-6 text-center text-sm text-muted">No events captured yet</div>;
  }

  return (
    <div className={cn("divide-y divide-border", className)}>
      {visible.map((ev) => (
        <div key={ev.id} className="flex items-center gap-3 py-2.5 text-sm">
          <span className="w-[72px] shrink-0 font-mono text-xs text-muted">
            {new Date(ev.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
          <span
            className={cn(
              "w-14 shrink-0 text-xs font-medium uppercase",
              SOURCE_COLORS[ev.source] ?? "text-muted",
            )}
          >
            {ev.source === "ai-session" ? "AI" : ev.source}
          </span>
          <span className="min-w-0 flex-1 truncate text-foreground">
            {ev.content?.summary ?? ev.type}
          </span>
          {ev.content?.project && (
            <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
              {ev.content.project}
            </span>
          )}
          {ev.content?.branch && (
            <span className="shrink-0 rounded bg-muted/10 px-1.5 py-0.5 text-[10px] text-muted font-mono">
              {ev.content.branch}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
