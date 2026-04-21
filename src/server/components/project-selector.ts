// Phase 15 component: project selector + project card
// Pure functions returning HTML strings.

export interface ProjectSelectorProps {
  repos: Array<{
    id: string;
    label: string;
    lastSeenAt?: string;
    eventCount24h?: number;
    aes?: number;
  }>;
  currentProjectId: string;
}

export function projectSelector(props: ProjectSelectorProps): string {
  const options = props.repos.map((r) => {
    const selected = r.id === props.currentProjectId ? " selected" : "";
    return `<option value="${r.id}"${selected}>${r.label}</option>`;
  });

  return `<select id="project-filter" class="bg-raised border border-border rounded px-2 py-0.5 text-xs text-foreground font-mono" style="max-width:180px" onchange="window.__unfade.setProject(this.value)">
    <option value=""${!props.currentProjectId ? " selected" : ""}>All Projects</option>
    ${options.join("\n")}
  </select>`;
}

export interface ProjectCardProps {
  id: string;
  label: string;
  eventCount24h: number;
  aes: number | null;
  lastActivity: string;
  directionDensity?: number;
}

export function projectCard(props: ProjectCardProps): string {
  const aesHtml =
    props.aes != null
      ? `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-mono ${props.aes >= 60 ? "bg-success/20 text-success" : props.aes >= 40 ? "bg-warning/20 text-warning" : "bg-error/20 text-error"}">AES: ${props.aes}</span>`
      : `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-mono bg-raised text-muted">AES: --</span>`;

  const ago = timeSince(props.lastActivity);

  return `<a href="/?project=${props.id}" onclick="event.preventDefault();window.__unfade.setProject('${props.id}')" class="bg-surface border border-border rounded-lg p-4 hover:border-accent/40 transition-colors cursor-pointer no-underline block">
    <div class="flex items-center justify-between mb-2">
      <span class="font-body text-sm font-semibold text-foreground truncate">${props.label}</span>
      ${aesHtml}
    </div>
    <div class="text-xs text-muted">${props.eventCount24h} events (24h)</div>
    <div class="text-xs text-muted mt-1">${ago}</div>
  </a>`;
}

function timeSince(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}
