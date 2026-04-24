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
  capabilities: Record<string, boolean>;
  status: "active" | "paused" | "error";
  daemonPid: number | null;
  daemonRunning: boolean;
  materializerLagMs: number;
}

export interface DiscoveredProject {
  path: string;
  name: string;
  label: string;
  hasGit: boolean;
  alreadyRegistered: boolean;
}
