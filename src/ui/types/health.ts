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
  pid: number;
  uptime: number;
  repoCount: number;
  repos: RepoHealth[];
  intelligenceReady: boolean;
  ingestStatus?: string;
  configuredProvider?: string;
  degradedReasons?: string[];
}
