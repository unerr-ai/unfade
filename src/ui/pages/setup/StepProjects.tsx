import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, FolderGit2, Loader2, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface StepProjectsProps {
  onComplete: () => void;
  onBack?: () => void;
}

export function StepProjects({ onComplete, onBack }: StepProjectsProps) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [customPath, setCustomPath] = useState("");
  const [initialized, setInitialized] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["setup", "discover"],
    queryFn: api.setup.discoverProjects,
  });

  const addProject = useMutation({
    mutationFn: (path: string) => api.setup.addProject(path),
    onSuccess: (_, path) => {
      setSelected((prev) => new Set(prev).add(path));
      qc.invalidateQueries({ queryKey: ["setup", "discover"] });
    },
  });

  const projects = data?.projects ?? [];
  const cwd = data?.cwd ?? "";

  // Auto-select CWD project and already-registered projects on first load
  useEffect(() => {
    if (initialized || projects.length === 0) return;
    const autoSelected = new Set<string>();

    for (const p of projects) {
      // Auto-select already registered projects
      if (p.alreadyRegistered) {
        autoSelected.add(p.path);
      }
      // Auto-select the project matching CWD
      if (cwd && (p.path === cwd || cwd.startsWith(p.path + "/"))) {
        autoSelected.add(p.path);
      }
    }

    if (autoSelected.size > 0) {
      setSelected(autoSelected);
    }
    setInitialized(true);
  }, [projects, cwd, initialized]);

  // Group projects by parent directory
  const grouped = useMemo(() => {
    const filtered = projects.filter((p) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        (p.name || p.label || "").toLowerCase().includes(q) || p.path.toLowerCase().includes(q)
      );
    });

    const groups: Record<string, typeof filtered> = {};
    for (const p of filtered) {
      const parts = p.path.split("/");
      // Use grandparent/parent as group key (e.g. "~/IdeaProjects")
      const parentDir = parts.slice(0, -1).join("/");
      const home = p.path.match(/^\/Users\/[^/]+|^\/home\/[^/]+/)?.[0] ?? "";
      const groupKey = home ? parentDir.replace(home, "~") : parentDir;
      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push(p);
    }

    // Sort groups by key, then projects within each group by name
    return Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dir, projs]) => ({
        dir,
        projects: projs.sort((a, b) =>
          (a.name || a.label || "").localeCompare(b.name || b.label || ""),
        ),
      }));
  }, [projects, search]);

  const totalVisible = grouped.reduce((sum, g) => sum + g.projects.length, 0);

  const toggleProject = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const selectAll = () => {
    const allPaths = grouped.flatMap((g) => g.projects.map((p) => p.path));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of allPaths) next.add(p);
      return next;
    });
  };

  const deselectAll = () => {
    const allPaths = new Set(grouped.flatMap((g) => g.projects.map((p) => p.path)));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of allPaths) next.delete(p);
      return next;
    });
  };

  const allSelected =
    totalVisible > 0 && grouped.every((g) => g.projects.every((p) => selected.has(p.path)));

  const handleContinue = async () => {
    // Register any newly selected (not already registered) projects
    const toRegister = projects.filter((p) => selected.has(p.path) && !p.alreadyRegistered);

    for (const p of toRegister) {
      try {
        await addProject.mutateAsync(p.path);
      } catch {
        // Continue with rest
      }
    }
    onComplete();
  };

  const isCwdProject = (path: string) =>
    Boolean(cwd && (path === cwd || cwd.startsWith(path + "/")));

  return (
    <div className="space-y-5">
      <div>
        <h2 className="mb-1.5 text-lg font-heading font-semibold">Choose projects to track</h2>
        <p className="text-sm text-muted">
          Select which repositories to monitor for reasoning capture.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted">
          <Loader2 size={16} className="animate-spin" /> Scanning for projects…
        </div>
      ) : (
        <>
          {/* Search + bulk actions */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter projects…"
                className="w-full rounded-lg border border-border bg-canvas pl-9 pr-8 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={allSelected ? deselectAll : selectAll}
              className="shrink-0 rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted hover:text-foreground hover:bg-raised transition-colors"
            >
              {allSelected ? "Deselect all" : "Select all"}
            </button>
          </div>

          {/* Project list — scrollable */}
          <div className="max-h-[380px] overflow-y-auto rounded-lg border border-border bg-canvas p-1 scrollbar-thin">
            {grouped.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted">
                {search ? "No projects match your filter" : "No git repositories found"}
              </div>
            ) : (
              <div className="space-y-3 p-2">
                {grouped.map(({ dir, projects: groupProjects }) => (
                  <div key={dir}>
                    <div className="mb-1.5 text-xs font-medium text-muted tracking-wide">{dir}</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {groupProjects.map((p) => {
                        const isSelected = selected.has(p.path);
                        const isCwd = isCwdProject(p.path);
                        return (
                          <button
                            key={p.path}
                            type="button"
                            onClick={() => toggleProject(p.path)}
                            className={cn(
                              "flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-all",
                              isSelected
                                ? "border-accent/40 bg-accent/5"
                                : "border-transparent hover:bg-raised",
                            )}
                          >
                            <div
                              className={cn(
                                "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                                isSelected
                                  ? "border-accent bg-accent"
                                  : "border-muted/50 bg-transparent",
                              )}
                            >
                              {isSelected && <Check size={10} className="text-white" />}
                            </div>
                            <FolderGit2
                              size={14}
                              className={cn("shrink-0", isSelected ? "text-accent" : "text-muted")}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={cn(
                                    "text-sm font-medium truncate",
                                    isSelected ? "text-foreground" : "text-foreground/70",
                                  )}
                                >
                                  {p.name || p.label}
                                </span>
                                {isCwd && (
                                  <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                                    current
                                  </span>
                                )}
                                {p.alreadyRegistered && (
                                  <span className="shrink-0 rounded bg-success/15 px-1.5 py-0.5 text-[10px] font-medium text-success">
                                    tracked
                                  </span>
                                )}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Custom path input */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={customPath}
              onChange={(e) => setCustomPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && customPath.trim()) {
                  addProject.mutate(customPath.trim());
                  setCustomPath("");
                }
              }}
              placeholder="Add custom project path…"
              className="flex-1 rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-foreground placeholder:text-muted font-mono focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <button
              type="button"
              onClick={() => {
                if (customPath.trim()) {
                  addProject.mutate(customPath.trim());
                  setCustomPath("");
                }
              }}
              disabled={!customPath.trim() || addProject.isPending}
              className="rounded-lg border border-border px-3 py-2 text-sm text-muted hover:text-foreground hover:bg-raised disabled:opacity-50 transition-colors"
            >
              <Plus size={14} />
            </button>
          </div>

          {/* Summary + navigation */}
          <div className="flex items-center justify-between rounded-lg border border-border bg-raised/50 px-4 py-2.5">
            <span className="text-sm text-muted">
              <span className="font-semibold text-foreground">{selected.size}</span> project
              {selected.size !== 1 ? "s" : ""} selected
            </span>
            {selected.size > 0 && <span className="text-xs text-muted">ready to track</span>}
          </div>

          <div className="flex gap-3">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-muted hover:text-foreground hover:bg-raised transition-colors"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={handleContinue}
              disabled={selected.size === 0 || addProject.isPending}
              className="flex-1 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-dim disabled:opacity-50"
            >
              {addProject.isPending ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 size={14} className="animate-spin" /> Registering projects…
                </span>
              ) : (
                "Continue"
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
