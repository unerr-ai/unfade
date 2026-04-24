import { Bot, GitBranch, Radio, Terminal } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { CapturedEvent } from "@/types/events";
import type { RepoHealth } from "@/types/health";
import { FreshnessBadge } from "./FreshnessBadge";

interface ActiveSession {
  id: string;
  tool: string;
  icon: typeof Bot;
  project: string;
  startedAt: string;
  files: string[];
  eventCount: number;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function DurationTicker({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsed = now - new Date(startedAt).getTime();
  return <span className="font-mono text-xs text-muted">{formatDuration(elapsed)}</span>;
}

function getToolIcon(source: string) {
  switch (source) {
    case "ai-session":
    case "mcp-active":
      return Bot;
    case "git":
      return GitBranch;
    case "terminal":
      return Terminal;
    default:
      return Radio;
  }
}

function getToolLabel(source: string): string {
  switch (source) {
    case "ai-session":
      return "AI Session";
    case "mcp-active":
      return "MCP Active";
    case "git":
      return "Git Capture";
    case "terminal":
      return "Terminal";
    default:
      return source;
  }
}

function deriveActiveSessions(events: CapturedEvent[], repos: RepoHealth[]): ActiveSession[] {
  const sessions = new Map<string, ActiveSession>();
  const cutoff = Date.now() - 5 * 60 * 1000; // 5 min window

  // Group recent events into sessions by source + project
  for (const ev of events) {
    const ts = new Date(ev.timestamp).getTime();
    if (ts < cutoff) continue;

    const project = ev.content?.project ?? "unknown";
    const key = `${ev.source}:${project}`;

    const existing = sessions.get(key);
    if (existing) {
      existing.eventCount++;
      if (ev.content?.files) {
        for (const f of ev.content.files) {
          if (!existing.files.includes(f)) existing.files.push(f);
        }
      }
      if (ev.timestamp < existing.startedAt) {
        existing.startedAt = ev.timestamp;
      }
    } else {
      sessions.set(key, {
        id: key,
        tool: ev.source,
        icon: getToolIcon(ev.source),
        project,
        startedAt: ev.timestamp,
        files: ev.content?.files?.slice(0, 5) ?? [],
        eventCount: 1,
      });
    }
  }

  // Also add running daemons that may not have recent events
  for (const repo of repos) {
    if (!repo.daemonRunning) continue;
    const key = `daemon:${repo.label}`;
    if (!sessions.has(key) && !sessions.has(`git:${repo.label}`)) {
      const startedAt = new Date(Date.now() - repo.daemonUptimeMs).toISOString();
      sessions.set(key, {
        id: key,
        tool: "git",
        icon: GitBranch,
        project: repo.label,
        startedAt,
        files: [],
        eventCount: 0,
      });
    }
  }

  return Array.from(sessions.values()).sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  );
}

function getDiagnosticMessage(sessions: ActiveSession[], repos: RepoHealth[]): string {
  const aiSessions = sessions.filter((s) => s.tool === "ai-session" || s.tool === "mcp-active");
  if (aiSessions.length > 0) {
    const projects = [...new Set(aiSessions.map((s) => s.project))];
    return `Engine active \u2014 ${aiSessions[0].tool === "mcp-active" ? "MCP" : "AI"} working in ${projects.join(", ")}`;
  }
  const activeRepos = repos.filter((r) => r.daemonRunning);
  if (activeRepos.length > 0) {
    return `Engine active \u2014 watching ${activeRepos.length} project${activeRepos.length > 1 ? "s" : ""}`;
  }
  return "No active sessions";
}

interface ActiveSessionPanelProps {
  events: CapturedEvent[];
  repos: RepoHealth[];
}

export function ActiveSessionPanel({ events, repos }: ActiveSessionPanelProps) {
  const sessions = deriveActiveSessions(events, repos);

  if (sessions.length === 0) return null;

  const diagnostic = getDiagnosticMessage(sessions, repos);

  return (
    <div className="mb-4 rounded-lg border border-border bg-surface p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="h-2 w-2 animate-pulse rounded-full bg-success" />
        <span className="text-xs font-medium text-foreground">{diagnostic}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {sessions.map((session) => {
          const Icon = session.icon;
          return (
            <div
              key={session.id}
              className="flex items-start gap-2.5 rounded-md border border-border bg-raised px-3 py-2"
            >
              <Icon
                size={16}
                className={cn(
                  "mt-0.5 shrink-0",
                  session.tool === "ai-session" || session.tool === "mcp-active"
                    ? "text-accent"
                    : "text-success",
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-foreground truncate">
                    {getToolLabel(session.tool)}
                  </span>
                  <DurationTicker startedAt={session.startedAt} />
                </div>
                <div className="text-[11px] text-muted truncate">{session.project}</div>
                {session.files.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {session.files.slice(0, 3).map((f) => (
                      <span
                        key={f}
                        className="rounded bg-overlay px-1 py-0.5 text-[10px] text-muted truncate max-w-[120px]"
                      >
                        {f.split("/").pop()}
                      </span>
                    ))}
                    {session.files.length > 3 && (
                      <span className="text-[10px] text-muted">+{session.files.length - 3}</span>
                    )}
                  </div>
                )}
                {session.eventCount > 0 && (
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="text-[10px] text-muted">{session.eventCount} events</span>
                    <FreshnessBadge updatedAt={session.startedAt} isLive />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
