import { Folder, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/shared/EmptyState";
import {
  useAddProject,
  useDiscoverProjects,
  useProjectAction,
  useProjects,
  useRepos,
} from "@/hooks/useProjects";
import { cn } from "@/lib/utils";

export default function ProjectsPage() {
  const { data: repos, isLoading: reposLoading } = useRepos();
  const { data: projects } = useProjects();
  const { data: discovered, refetch: doDiscover, isFetching: discovering } = useDiscoverProjects();
  const addProject = useAddProject();
  const projectAction = useProjectAction();
  const [showDiscover, setShowDiscover] = useState(false);

  const projectMap = new Map((projects?.projects ?? []).map((p) => [p.id, p]));

  if (reposLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-48 rounded bg-raised" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-24 rounded-lg bg-raised" />
        ))}
      </div>
    );
  }

  const repoList = repos ?? [];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-heading text-2xl font-semibold">Projects</h1>
        <button
          type="button"
          onClick={() => {
            setShowDiscover(true);
            doDiscover();
          }}
          className="flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-dim"
        >
          <Plus size={14} /> Add Project
        </button>
      </div>

      {repoList.length === 0 ? (
        <EmptyState
          icon={Folder}
          title="No projects registered"
          description="Add a project to start capturing AI activity"
          action={{
            label: "Discover Projects",
            onClick: () => {
              setShowDiscover(true);
              doDiscover();
            },
          }}
        />
      ) : (
        <div className="space-y-3">
          {repoList.map((repo) => {
            const proj = projectMap.get(repo.id);
            const summary = repo.summary;
            const running = proj?.daemonRunning ?? false;

            return (
              <div key={repo.id} className="rounded-lg border border-border bg-surface p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <span
                      className={cn("h-2 w-2 rounded-full", running ? "bg-success" : "bg-warning")}
                    />
                    <span className="font-semibold text-foreground">{repo.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {running ? (
                      <button
                        type="button"
                        onClick={() => projectAction.mutate({ id: repo.id, action: "pause" })}
                        className="rounded px-2 py-1 text-xs text-muted transition-colors hover:bg-raised"
                      >
                        Pause
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => projectAction.mutate({ id: repo.id, action: "resume" })}
                        className="rounded px-2 py-1 text-xs text-accent transition-colors hover:bg-raised"
                      >
                        Resume
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => projectAction.mutate({ id: repo.id, action: "restart" })}
                      className="rounded p-1 text-muted transition-colors hover:bg-raised"
                    >
                      <RefreshCw size={12} />
                    </button>
                  </div>
                </div>
                <div className="text-xs text-muted font-mono truncate mb-2">{repo.root}</div>
                <div className="flex items-center gap-4 text-xs text-muted">
                  <span>{summary?.eventCount24h ?? 0} events (24h)</span>
                  <span>{Math.round(summary?.directionDensity24h ?? 0)}% direction</span>
                  {summary?.topDomain && <span>Domain: {summary.topDomain}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showDiscover && (
        <div className="mt-6 rounded-lg border border-border bg-surface p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-heading font-semibold">Discover Projects</h2>
            <button
              type="button"
              onClick={() => doDiscover()}
              disabled={discovering}
              className="text-xs text-accent"
            >
              {discovering ? "Scanning…" : "Refresh"}
            </button>
          </div>
          {discovered?.projects && discovered.projects.length > 0 ? (
            <div className="space-y-2">
              {discovered.projects
                .filter((p) => !p.alreadyRegistered)
                .map((p) => (
                  <div
                    key={p.path}
                    className="flex items-center justify-between rounded-md bg-raised p-3"
                  >
                    <div>
                      <div className="text-sm font-medium text-foreground">{p.name}</div>
                      <div className="text-xs text-muted font-mono truncate">{p.path}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => addProject.mutate(p.path)}
                      disabled={addProject.isPending}
                      className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-accent-dim disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                ))}
            </div>
          ) : (
            <div className="py-4 text-center text-sm text-muted">
              {discovering ? "Scanning for projects…" : "No new projects found"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
