export interface HealthEvent {
  status: string;
  materializerLagMs: number;
  uptime: number;
  daemonPid: number | null;
  daemonAlive: boolean;
  daemonRestartCount: number;
  repoCount: number;
}

export interface RepoHealth {
  id: string;
  label: string;
  root: string;
  daemonPid: number | null;
  daemonRunning: boolean;
  daemonRestartCount: number;
  daemonUptimeMs: number;
  materializerLagMs: number;
}

export interface SystemHealth {
  status: "ok" | "degraded";
  version: string;
  pid: number;
  uptime: number;
  configuredProvider: string;
  configuredModel: string;
  repoCount: number;
  repos: RepoHealth[];
  ingestStatus: string | null;
  intelligenceReady: boolean;
  degradedReasons: string[];
}
