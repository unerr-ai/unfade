// FILE: src/commands/doctor.ts
// UF-203: Diagnostic command — prints path layout, process health, and registry state.
// Pure fs reads, no network calls, no LLM. Must complete in < 200ms.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { theme, writeBlank, writeLine } from "../cli/ui.js";
import {
  getBinDir,
  getEventsDir,
  getLogsDir,
  getProjectDataDir,
  getStateDir,
  getUserConfigDir,
  getUserStateDir,
} from "../utils/paths.js";

interface PathCheck {
  label: string;
  path: string;
  exists: boolean;
  detail?: string;
}

interface ProcessCheck {
  label: string;
  alive: boolean;
  pid: number | null;
  detail?: string;
}

export async function doctorCommand(): Promise<void> {
  const cwd = process.cwd();

  writeLine(`\n  ${theme.brand("unfade doctor")}`);
  writeBlank();

  const pathChecks = checkPaths(cwd);
  const processChecks = checkProcesses(cwd);
  const registryCheck = checkRegistry();

  writeLine(`  ${theme.bold("Paths")}`);
  for (const p of pathChecks) {
    const icon = p.exists ? theme.success("✓") : theme.error("✗");
    const detail = p.detail ? theme.muted(` (${p.detail})`) : "";
    writeLine(`    ${icon} ${p.label}: ${theme.muted(p.path)}${detail}`);
  }

  writeBlank();
  writeLine(`  ${theme.bold("Processes")}`);
  for (const p of processChecks) {
    const icon = p.alive ? theme.success("✓") : theme.warning("–");
    const pidStr = p.pid ? theme.muted(` pid ${p.pid}`) : "";
    const detail = p.detail ? theme.muted(` (${p.detail})`) : "";
    writeLine(`    ${icon} ${p.label}${pidStr}${detail}`);
  }

  writeBlank();
  writeLine(`  ${theme.bold("Registry")}`);
  writeLine(`    ${registryCheck}`);

  writeBlank();
}

function checkPaths(cwd: string): PathCheck[] {
  const checks: PathCheck[] = [
    { label: "Global config", path: getUserConfigDir(), exists: false },
    { label: "Global state", path: getUserStateDir(), exists: false },
    { label: "Project data", path: getProjectDataDir(cwd), exists: false },
    { label: "Project events", path: getEventsDir(cwd), exists: false },
    { label: "Project state", path: getStateDir(cwd), exists: false },
    { label: "Project logs", path: getLogsDir(cwd), exists: false },
    { label: "Daemon binary", path: join(getBinDir(cwd), "unfaded"), exists: false },
  ];

  for (const c of checks) {
    c.exists = existsSync(c.path);
    if (c.exists && c.label === "Project events") {
      try {
        const entries = require("node:fs").readdirSync(c.path) as string[];
        const jsonlCount = entries.filter((e: string) => e.endsWith(".jsonl")).length;
        c.detail = `${jsonlCount} event file${jsonlCount !== 1 ? "s" : ""}`;
      } catch {
        // ignore
      }
    }
  }

  return checks;
}

function checkProcesses(cwd: string): ProcessCheck[] {
  const checks: ProcessCheck[] = [];

  const daemonPidFile = join(getStateDir(cwd), "daemon.pid");
  const daemonPid = readPid(daemonPidFile);
  checks.push({
    label: "Capture engine",
    alive: daemonPid !== null && isProcessAlive(daemonPid),
    pid: daemonPid,
    detail: daemonPid === null ? "no pid file" : undefined,
  });

  const serverJsonFile = join(getStateDir(cwd), "server.json");
  const serverInfo = readJsonSafe<{ pid?: number; port?: number }>(serverJsonFile);
  const serverPid = typeof serverInfo?.pid === "number" ? serverInfo.pid : null;
  checks.push({
    label: "HTTP server",
    alive: serverPid !== null && isProcessAlive(serverPid),
    pid: serverPid,
    detail: serverInfo?.port
      ? `port ${serverInfo.port}`
      : serverPid === null
        ? "no server.json"
        : undefined,
  });

  const healthFile = join(getStateDir(cwd), "health.json");
  const health = readJsonSafe<{ status?: string; uptime_seconds?: number }>(healthFile);
  if (health) {
    const age = healthFileAgeSeconds(healthFile);
    checks.push({
      label: "Health report",
      alive: age !== null && age < 120,
      pid: null,
      detail:
        age !== null ? `${Math.round(age)}s ago, status: ${health.status ?? "?"}` : "unreadable",
    });
  }

  return checks;
}

function checkRegistry(): string {
  const reposFile = join(getUserStateDir(), "repos.json");
  if (!existsSync(reposFile)) {
    return `${theme.warning("–")} ${theme.muted("No repos.json found at")} ${theme.muted(reposFile)}`;
  }

  try {
    const raw = JSON.parse(readFileSync(reposFile, "utf-8"));
    if (!Array.isArray(raw)) {
      return `${theme.error("✗")} repos.json is not an array`;
    }
    const paths = raw.map((r: { path?: string }) => r.path ?? "?");
    return `${theme.success("✓")} ${raw.length} repo${raw.length !== 1 ? "s" : ""} registered: ${theme.muted(paths.join(", "))}`;
  } catch {
    return `${theme.error("✗")} repos.json is corrupt or unreadable`;
  }
}

function readPid(filePath: string): number | null {
  if (!existsSync(filePath)) return null;
  try {
    const val = Number.parseInt(readFileSync(filePath, "utf-8").trim(), 10);
    return Number.isNaN(val) || val <= 0 ? null : val;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readJsonSafe<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

function healthFileAgeSeconds(filePath: string): number | null {
  try {
    const stat = statSync(filePath);
    return (Date.now() - stat.mtimeMs) / 1000;
  } catch {
    return null;
  }
}
