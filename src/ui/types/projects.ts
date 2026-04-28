export interface RepoEntry {
  id: string;
  root: string;
  label: string;
  lastSeenAt: string;
  capabilities: Record<string, boolean>;
  summary: import("./summary").SummaryJson | null;
}

export interface Project {
  id: string;
  root: string;
  label: string;
  lastSeenAt: string;
  addedVia?: string;
  monitoring: "active" | "paused";
  rootExists: boolean;
  daemon: {
    pid: number | null;
    running: boolean;
    restartCount: number;
    uptimeMs: number;
  } | null;
}

export interface DiscoveredProject {
  path: string;
  name: string;
  label: string;
  hasGit: boolean;
  alreadyRegistered: boolean;
}
