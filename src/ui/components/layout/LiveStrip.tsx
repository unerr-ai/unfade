import { useEffect } from "react";
import { FreshnessBadge } from "@/components/shared/FreshnessBadge";
import { useHealth } from "@/hooks/useHealth";
import { useRepos } from "@/hooks/useProjects";
import { useSummary } from "@/hooks/useSummary";
import { useAppStore } from "@/stores/app";

export function LiveStrip() {
  const { activeProjectId, setActiveProject } = useAppStore();
  const { data: health } = useHealth();
  const { data: summary } = useSummary();
  const { data: repos } = useRepos();

  const repoList = repos ?? [];
  const updatedAt = summary?.updatedAt ?? new Date().toISOString();
  const eventCount = summary?.eventCount24h ?? 0;
  const daemonAlive = health?.repos?.[0]?.daemonRunning ?? false;

  useEffect(() => {
    if (activeProjectId && repoList.length > 0) {
      const found = repoList.some((r) => r.id === activeProjectId);
      if (!found) setActiveProject("");
    }
  }, [activeProjectId, repoList, setActiveProject]);

  return (
    <div className="flex h-10 shrink-0 items-center border-t border-border bg-surface px-4 font-mono text-[11px] text-muted">
      <select
        value={activeProjectId}
        onChange={(e) => setActiveProject(e.target.value)}
        className="max-w-[180px] rounded border border-border bg-raised px-2 py-0.5 text-xs text-foreground"
      >
        <option value="">All Projects</option>
        {repoList.map((r) => (
          <option key={r.id} value={r.id}>
            {r.label}
          </option>
        ))}
      </select>

      <span className="ml-3 flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${daemonAlive ? "bg-success" : "bg-warning"}`} />
        <span>{daemonAlive ? "Connected" : "Connecting…"}</span>
      </span>

      <span className="ml-auto flex items-center gap-3">
        <FreshnessBadge updatedAt={updatedAt} isLive={health?.sseLive} />
        <span>{eventCount} events (24h)</span>
      </span>
    </div>
  );
}
