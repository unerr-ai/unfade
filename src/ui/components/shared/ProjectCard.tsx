import { getPhaseInfo } from "@/lib/maturity";
import { cn } from "@/lib/utils";
import type { RepoEntry } from "@/types/projects";

interface ProjectCardProps {
  repo: RepoEntry;
  onClick: () => void;
  maturityPhase?: number;
  className?: string;
}

export function ProjectCard({ repo, onClick, maturityPhase, className }: ProjectCardProps) {
  const summary = repo.summary;
  const eventCount = summary?.eventCount24h ?? 0;
  const direction = summary?.directionDensity24h ?? 0;
  const phase = maturityPhase ? getPhaseInfo(maturityPhase) : null;
  const lastActivity = repo.lastSeenAt ? formatTimeAgo(new Date(repo.lastSeenAt)) : "no activity";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-lg border border-border bg-surface p-4 text-left transition-colors hover:bg-raised",
        className,
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-sm text-foreground truncate">{repo.label}</span>
        {phase && (
          <span className="text-[10px] font-mono font-semibold" style={{ color: phase.color }}>
            Phase {maturityPhase}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs text-muted">
        <span>{eventCount} events (24h)</span>
        <span>·</span>
        <span>{Math.round(direction)}% direction</span>
        <span className="ml-auto">{lastActivity}</span>
      </div>
    </button>
  );
}

function formatTimeAgo(date: Date): string {
  const ms = Date.now() - date.getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}
