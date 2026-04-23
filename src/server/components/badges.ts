// Phase 15 component: badges (freshness, estimate, confidence, source, project)
// Pure functions returning HTML strings.

export interface DataFreshnessBadgeProps {
  updatedAt: string;
}

export function dataFreshnessBadge(props: DataFreshnessBadgeProps): string {
  const ms = Date.now() - new Date(props.updatedAt).getTime();
  const tier = ms < 30_000 ? "live" : ms < 300_000 ? "recent" : ms < 1_800_000 ? "stale" : "cold";
  const colors = {
    live: "text-success",
    recent: "text-success",
    stale: "text-warning",
    cold: "text-muted",
  };
  const dots = { live: "bg-success", recent: "bg-success", stale: "bg-warning", cold: "bg-muted" };
  const labels = { live: "live", recent: "recent", stale: "stale", cold: "cold" };
  const ago = ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)}m`;

  return `<span class="inline-flex items-center gap-1.5 text-xs ${colors[tier]}">
    <span class="w-1.5 h-1.5 rounded-full ${dots[tier]}"></span>
    ${labels[tier]} · ${ago} ago
  </span>`;
}

export function estimateBadge(content: string): string {
  return `<span class="inline-flex items-center gap-1 text-xs" style="border:1px dashed var(--warning);border-radius:4px;padding:1px 6px;background:var(--proxy)">≈ ${content}</span>`;
}

export interface ConfidenceBadgeProps {
  level: "high" | "medium" | "low";
  dataPoints?: number;
}

export function confidenceBadge(props: ConfidenceBadgeProps): string {
  const colors = {
    high: "bg-success/20 text-success",
    medium: "bg-warning/20 text-warning",
    low: "bg-error/20 text-error",
  };
  const label = props.dataPoints ? `${props.level} (${props.dataPoints} sessions)` : props.level;
  return `<span class="inline-flex items-center text-xs px-1.5 py-0.5 rounded ${colors[props.level]}">${label}</span>`;
}

export function sourceBadge(source: string): string {
  const icons: Record<string, string> = { git: "●", "ai-session": "◆", terminal: "■" };
  const colors: Record<string, string> = {
    git: "text-success",
    "ai-session": "text-cyan",
    terminal: "text-muted",
  };
  return `<span class="inline-flex items-center gap-1 text-xs ${colors[source] ?? "text-muted"}">${icons[source] ?? "○"} ${source}</span>`;
}

export function projectBadge(projectName: string): string {
  return `<span class="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-accent/10 text-accent">${projectName}</span>`;
}

export interface SessionAutonomyBadgeProps {
  level: "HIGH" | "MED" | "LOW";
  direction?: number;
  loopRisk?: "low" | "moderate" | "high";
  turns?: number;
}

export function sessionAutonomyBadge(props: SessionAutonomyBadgeProps): string {
  const { level, direction, loopRisk, turns } = props;
  const colors = {
    HIGH: "bg-success/20 text-success",
    MED: "bg-warning/20 text-warning",
    LOW: "bg-error/20 text-error",
  };
  const pulse = level === "LOW" ? " animate-pulse" : "";
  const detail = [
    direction != null ? `${Math.round(direction)}% dir` : null,
    loopRisk ? `loop: ${loopRisk}` : null,
    turns != null ? `${turns} turns` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return `<span class="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded font-semibold ${colors[level]}${pulse}">
    <span class="w-1.5 h-1.5 rounded-full" style="background:currentColor"></span>
    ${level}${detail ? ` <span class="font-normal opacity-75">${detail}</span>` : ""}
  </span>`;
}
