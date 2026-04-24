import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useHealth } from "@/hooks/useHealth";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type LogLevel = "debug" | "info" | "warn" | "error";
type ComponentFilter = "all" | "daemon" | "materializer" | "intelligence" | "server";

const COMPONENT_OPTIONS: { value: ComponentFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "daemon", label: "Capture Engine" },
  { value: "materializer", label: "Materializer" },
  { value: "intelligence", label: "Intelligence" },
  { value: "server", label: "Server" },
];

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: "text-muted",
  info: "text-foreground",
  warn: "text-warning",
  error: "text-error",
};

const LEVEL_BADGES: Record<LogLevel, string> = {
  debug: "bg-muted/20 text-muted",
  info: "bg-accent/20 text-accent",
  warn: "bg-warning/20 text-warning",
  error: "bg-error/20 text-error",
};

const PAGE_SIZE = 50;

/** Relative timestamp for readability. */
function relativeTime(ts: string): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 60_000) return "just now";
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return `${Math.floor(diffMs / 86_400_000)}d ago`;
}

export default function LogsPage() {
  const [levels, setLevels] = useState<Set<LogLevel>>(new Set(["info", "warn", "error"]));
  const [component, setComponent] = useState<ComponentFilter>("all");
  const [search, setSearch] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [showCount, setShowCount] = useState(PAGE_SIZE);
  const logRef = useRef<HTMLDivElement>(null);
  const { data: health } = useHealth();

  const { data, isFetching } = useQuery({
    queryKey: ["logs"],
    queryFn: () => api.logs.list({ limit: 200 }),
    staleTime: 10_000,
    refetchInterval: 10_000,
  });

  const allLogs = data?.logs ?? [];

  // Client-side filtering
  const filtered = allLogs.filter((l) => {
    if (!levels.has(l.level)) return false;
    if (component !== "all" && !l.component.toLowerCase().includes(component)) return false;
    if (search && !l.message.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Progressive disclosure: show only `showCount` logs, with "Load more"
  const visible = filtered.slice(0, showCount);
  const hasMore = filtered.length > showCount;

  useEffect(() => {
    if (autoScroll && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [autoScroll, visible.length]);

  const toggleLevel = (level: LogLevel) => {
    setLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
    setShowCount(PAGE_SIZE);
  };

  const daemons = health?.repos ?? [];

  const diagnosticMessage = (() => {
    if (!health?.sseLive) return { text: "Connecting to system…", color: "text-muted" };

    const downDaemons = daemons.filter((d) => !d.daemonRunning);
    if (downDaemons.length > 0) {
      const names = downDaemons.map((d) => d.label).join(", ");
      return { text: `Capture engine down: ${names}`, color: "text-error" };
    }

    const lagging = daemons.filter((d) => d.materializerLagMs > 30_000);
    if (lagging.length > 0) {
      const names = lagging
        .map((d) => `${d.label} (${Math.round(d.materializerLagMs / 1000)}s)`)
        .join(", ");
      return { text: `Materializer lagging: ${names}`, color: "text-warning" };
    }

    const restarted = daemons.filter((d) => d.daemonRestartCount > 0);
    if (restarted.length > 0) {
      return {
        text: `Capture engine restarted ${restarted.reduce((s, d) => s + d.daemonRestartCount, 0)} time(s)`,
        color: "text-warning",
      };
    }

    return { text: "All systems nominal", color: "text-success" };
  })();

  return (
    <div className="flex h-[calc(100vh-160px)] flex-col">
      <h1 className="mb-4 font-heading text-2xl font-semibold">System Logs</h1>

      {daemons.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {daemons.map((d) => (
            <div key={d.id} className="rounded-lg border border-border bg-surface p-3">
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    d.daemonRunning ? "bg-success" : "bg-warning",
                  )}
                />
                <span className="text-sm font-medium text-foreground truncate">{d.label}</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted">
                <span>PID {d.daemonPid ?? "—"}</span>
                <span>{Math.round(d.materializerLagMs / 1000)}s lag</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mb-3 flex items-center gap-2 text-xs">
        {(["debug", "info", "warn", "error"] as const).map((level) => (
          <button
            key={level}
            type="button"
            onClick={() => toggleLevel(level)}
            className={cn(
              "rounded-md border px-2.5 py-1.5 transition-colors",
              levels.has(level)
                ? `border-transparent ${LEVEL_BADGES[level]}`
                : "border-border text-muted hover:bg-overlay",
            )}
          >
            {level.toUpperCase()}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        <select
          value={component}
          onChange={(e) => {
            setComponent(e.target.value as ComponentFilter);
            setShowCount(PAGE_SIZE);
          }}
          className="rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-foreground focus:border-accent/60 focus:outline-none"
        >
          {COMPONENT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setShowCount(PAGE_SIZE);
          }}
          placeholder="Search logs…"
          className="ml-2 flex-1 rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-foreground placeholder:text-muted focus:border-accent/60 focus:outline-none"
        />
        <label className="ml-auto flex items-center gap-1.5 cursor-pointer text-muted">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="accent-accent"
          />
          Auto-scroll
        </label>
      </div>

      <div
        ref={logRef}
        className="flex-1 overflow-y-auto rounded-lg border border-border bg-canvas p-3 font-mono text-xs"
      >
        {isFetching && visible.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="animate-pulse text-muted">Loading logs…</div>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted">
            No logs matching filters
          </div>
        ) : (
          <>
            {visible.map((log, i) => (
              <div key={i} className={cn("py-0.5", LEVEL_COLORS[log.level])}>
                <span className="text-muted" title={new Date(log.timestamp).toLocaleString()}>
                  [{relativeTime(log.timestamp)}]
                </span>{" "}
                <span className={cn("rounded px-1 py-0.5 text-[10px]", LEVEL_BADGES[log.level])}>
                  {log.level}
                </span>{" "}
                <span className="text-cyan">[{log.component}]</span> {log.message}
              </div>
            ))}
            {hasMore && (
              <button
                type="button"
                onClick={() => setShowCount((c) => c + PAGE_SIZE)}
                className="mt-2 w-full rounded border border-border py-1.5 text-center text-xs text-muted hover:bg-raised"
              >
                Show more ({filtered.length - showCount} remaining)
              </button>
            )}
          </>
        )}
      </div>

      <div className="mt-2 flex items-center gap-1.5 text-xs text-muted">
        <span className={diagnosticMessage.color}>{diagnosticMessage.text}</span>
        <span>&middot;</span>
        <span>
          {visible.length} of {filtered.length} log entries
          {isFetching && " (refreshing…)"}
        </span>
      </div>
    </div>
  );
}
