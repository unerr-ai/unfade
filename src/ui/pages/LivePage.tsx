import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef, useState } from "react";
import { ActiveSessionPanel } from "@/components/shared/ActiveSessionPanel";
import { EvidenceDrawer } from "@/components/shared/EvidenceDrawer";
import { FreshnessBadge } from "@/components/shared/FreshnessBadge";
import { useLiveEvents } from "@/hooks/useEvents";
import { useHealth } from "@/hooks/useHealth";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app";
import type { CapturedEvent } from "@/types/events";

type SourceFilter = "all" | "git" | "ai-session" | "terminal";

const SOURCE_COLORS: Record<string, string> = {
  git: "text-success",
  "ai-session": "text-accent",
  "mcp-active": "text-accent",
  terminal: "text-cyan",
};

export default function LivePage() {
  const { data: events } = useLiveEvents();
  const { data: health } = useHealth();
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [selectedEvent, setSelectedEvent] = useState<CapturedEvent | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  const filtered = (events ?? []).filter((ev) => {
    if (sourceFilter !== "all" && ev.source !== sourceFilter) return false;
    if (activeProjectId && ev.content?.project !== activeProjectId) return false;
    return true;
  });

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 64,
    overscan: 10,
  });

  const [autoScroll, setAutoScroll] = useState(true);
  useEffect(() => {
    if (autoScroll && parentRef.current && filtered.length > 0) {
      parentRef.current.scrollTop = parentRef.current.scrollHeight;
    }
  }, [filtered.length, autoScroll]);

  const repos = health?.repos ?? [];
  const daemonAlive = repos.some((r) => r.daemonRunning);
  const gitCount = (events ?? []).filter((e) => e.source === "git").length;
  const aiCount = (events ?? []).filter(
    (e) => e.source === "ai-session" || e.source === "mcp-active",
  ).length;
  const termCount = (events ?? []).filter((e) => e.source === "terminal").length;

  return (
    <div className="flex h-[calc(100vh-160px)] flex-col">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-heading text-2xl font-semibold">Live</h1>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              daemonAlive ? "bg-success animate-pulse" : "bg-warning",
            )}
          />
          <span className="text-xs text-muted">
            {daemonAlive ? "Engines running" : "Connecting\u2026"}
          </span>
        </div>
      </div>

      <ActiveSessionPanel events={events ?? []} repos={repos} />

      <div className="mb-4 flex items-center gap-2 text-xs">
        {(["all", "git", "ai-session", "terminal"] as const).map((src) => (
          <button
            key={src}
            type="button"
            onClick={() => setSourceFilter(src)}
            className={cn(
              "rounded-md border px-2.5 py-1.5 transition-colors",
              sourceFilter === src
                ? "border-accent bg-accent/10 text-accent"
                : "border-border text-muted hover:bg-overlay",
            )}
          >
            {src === "all"
              ? "All"
              : src === "ai-session"
                ? "AI"
                : src.charAt(0).toUpperCase() + src.slice(1)}
          </button>
        ))}
        <span className="ml-auto text-muted">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="accent-accent"
            />
            Auto-scroll
          </label>
        </span>
      </div>

      <div
        ref={parentRef}
        className="flex-1 overflow-y-auto rounded-lg border border-border bg-surface"
      >
        {filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted">
            No live events yet. Start coding — the capture engine is watching.
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const ev = filtered[virtualItem.index];
              return (
                <div
                  key={virtualItem.key}
                  ref={virtualizer.measureElement}
                  data-index={virtualItem.index}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${virtualItem.start}px)` }}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedEvent(ev)}
                    className="flex w-full items-center gap-3 border-b border-border px-4 py-2.5 text-left text-sm transition-colors hover:bg-raised"
                  >
                    <span className="w-[72px] shrink-0 font-mono text-xs text-muted">
                      {new Date(ev.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </span>
                    <span
                      className={cn(
                        "w-14 shrink-0 text-xs font-medium uppercase",
                        SOURCE_COLORS[ev.source] ?? "text-muted",
                      )}
                    >
                      {ev.source === "ai-session" ? "AI" : ev.source}
                    </span>
                    <span className="rounded bg-raised px-1.5 py-0.5 text-[10px] text-muted">
                      {ev.type}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-foreground">
                      {ev.content?.summary ?? ""}
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
                    <FreshnessBadge updatedAt={ev.timestamp} isLive />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-4 text-xs text-muted">
        <span>{filtered.length} events</span>
        <span>{gitCount} commits</span>
        <span>{aiCount} sessions</span>
        <span>{termCount} commands</span>
      </div>

      <EvidenceDrawer
        open={!!selectedEvent}
        onClose={() => setSelectedEvent(null)}
        title={selectedEvent?.content?.summary ?? "Event Detail"}
        entityType={selectedEvent?.source}
        freshness={selectedEvent?.timestamp}
        items={
          selectedEvent
            ? [
                {
                  timestamp: selectedEvent.timestamp,
                  source: selectedEvent.source,
                  summary: selectedEvent.content?.summary ?? selectedEvent.type,
                  rawData: selectedEvent,
                },
              ]
            : []
        }
        metrics={
          selectedEvent
            ? [
                { label: "Source", value: selectedEvent.source },
                { label: "Type", value: selectedEvent.type },
                { label: "Project", value: selectedEvent.content?.project ?? "—" },
                { label: "Branch", value: selectedEvent.content?.branch ?? "—" },
                ...(selectedEvent.content?.files?.length
                  ? [{ label: "Files touched", value: String(selectedEvent.content.files.length) }]
                  : []),
              ]
            : []
        }
      />
    </div>
  );
}
