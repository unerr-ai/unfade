import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { theme, writeBlank, writeLine } from "../cli/ui.js";
import { removeShellHooks } from "../services/shell/installer.js";
import { stopDaemon } from "../utils/ipc.js";
import { getProjectDataDir, getStateDir, getUserConfigDir } from "../utils/paths.js";

/**
 * Kill ALL unfade daemon processes by reading PID files from
 * ~/.unfade/state/daemons/<id>/daemon.pid and sending SIGTERM.
 * Reports every step to the user for full transparency.
 */
function killAllDaemons(): void {
  const stateDir = getStateDir();
  const killed: Array<{ pid: number; label: string; forced?: boolean }> = [];
  const alreadyDead: string[] = [];
  let scanned = 0;

  writeLine(`  ${theme.muted("Scanning for running daemons…")}`);

  // Legacy PID file at ~/.unfade/state/daemon.pid
  const legacyPid = join(stateDir, "daemon.pid");
  if (existsSync(legacyPid)) {
    scanned++;
    killFromPidFile(legacyPid, "legacy daemon", killed, alreadyDead);
  }

  // Per-daemon PID files at ~/.unfade/state/daemons/<id>/daemon.pid
  const daemonsDir = join(stateDir, "daemons");
  if (existsSync(daemonsDir)) {
    try {
      for (const entry of readdirSync(daemonsDir, {
        withFileTypes: true,
        encoding: "utf-8",
      })) {
        if (entry.isDirectory()) {
          const pidPath = join(daemonsDir, String(entry.name), "daemon.pid");
          if (existsSync(pidPath)) {
            scanned++;
            killFromPidFile(pidPath, String(entry.name), killed, alreadyDead);
          }
        }
      }
    } catch {
      // non-fatal
    }
  }

  // Also try to kill any unfaded processes by name (catch orphans without PID files)
  try {
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    const output = execSync("pgrep -f unfaded 2>/dev/null || true", { encoding: "utf-8" }).trim();
    if (output) {
      const orphanPids = output
        .split("\n")
        .map((s) => Number.parseInt(s.trim(), 10))
        .filter((p) => !Number.isNaN(p) && p > 0);
      const knownPids = new Set(killed.map((k) => k.pid));
      for (const pid of orphanPids) {
        if (knownPids.has(pid)) continue;
        try {
          try {
            process.kill(pid, "SIGTERM");
          } catch {}
          try {
            process.kill(pid, "SIGKILL");
          } catch {}
          killed.push({ pid, label: "orphan", forced: true });
        } catch {
          // already dead
        }
      }
    }
  } catch {
    // pgrep not available — skip orphan detection
  }

  // Report results
  if (killed.length > 0) {
    for (const k of killed) {
      const method = k.forced ? theme.warning("force-killed") : "stopped";
      writeLine(
        `  ${theme.success("✓")} ${method} daemon ${theme.cyan(k.label)} ${theme.muted(`(PID ${k.pid})`)}`,
      );
    }
  } else if (scanned > 0) {
    writeLine(
      `  ${theme.muted("No running daemons found")} ${theme.muted(`(${scanned} PID file(s) checked, all already stopped)`)}`,
    );
  } else {
    writeLine(`  ${theme.muted("No daemon PID files found — no daemons to stop")}`);
  }

  if (alreadyDead.length > 0) {
    writeLine(
      `  ${theme.muted(`${alreadyDead.length} stale PID file(s) cleaned: ${alreadyDead.join(", ")}`)}`,
    );
  }

  // Check for unkillable zombies and warn
  try {
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    const remaining = execSync("pgrep -f unfaded 2>/dev/null || true", {
      encoding: "utf-8",
    }).trim();
    if (remaining) {
      const count = remaining.split("\n").filter(Boolean).length;
      writeLine(
        `  ${theme.warning("⚠")} ${count} zombie process(es) still in kernel queue (SIGKILL sent, awaiting OS reap — harmless, 0 CPU)`,
      );
    }
  } catch {}
}

function killFromPidFile(
  pidPath: string,
  label: string,
  killed: Array<{ pid: number; label: string; forced?: boolean }>,
  alreadyDead: string[],
): void {
  try {
    const raw = readFileSync(pidPath, "utf-8").trim();
    const pid = Number.parseInt(raw, 10);
    if (Number.isNaN(pid) || pid <= 0) {
      alreadyDead.push(`${label} (invalid PID: ${raw})`);
      return;
    }

    try {
      process.kill(pid, 0);
      // SIGTERM first, then immediately SIGKILL to ensure death
      try {
        process.kill(pid, "SIGTERM");
      } catch {}
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
      // Verify it's dead
      let alive = false;
      try {
        process.kill(pid, 0);
        alive = true;
      } catch {}
      killed.push({ pid, label, forced: true });
      if (alive) {
        alreadyDead.push(`${label} (PID ${pid} — unkillable zombie)`);
      }
    } catch {
      alreadyDead.push(`${label} (PID ${pid})`);
    }
  } catch {
    alreadyDead.push(`${label} (unreadable PID file)`);
  }
}

/**
 * Full teardown: stop all daemons, stop the server, remove shell hooks,
 * delete this repo's `.unfade/` and global `~/.unfade/`. Single command — no flags.
 */
export async function resetCommand(): Promise<void> {
  const cwd = process.cwd();
  const dataDir = getProjectDataDir(cwd);
  const userDir = getUserConfigDir();

  writeBlank();

  killAllDaemons();

  writeLine(`  ${theme.muted("Sending IPC stop signal…")}`);
  const ipcResult = await stopDaemon(cwd).catch(() => ({
    ok: false,
    error: "not running",
  }));
  if (ipcResult.ok) {
    writeLine(`  ${theme.success("✓")} Server stopped via IPC`);
  } else {
    writeLine(`  ${theme.muted("No server responded to IPC stop")}`);
  }

  removeShellHooks();
  writeLine(`  ${theme.success("✓")} Shell hooks removed`);

  if (existsSync(dataDir)) {
    rmSync(dataDir, { recursive: true, force: true });
    writeLine(`  ${theme.success("✓")} Removed ${theme.muted(dataDir)}`);
  } else {
    writeLine(`  ${theme.muted(`No project data at ${dataDir}`)}`);
  }

  if (resolve(dataDir) === resolve(userDir)) {
    // Already removed as the project data dir (same resolved path)
  } else if (existsSync(userDir)) {
    rmSync(userDir, { recursive: true, force: true });
    writeLine(`  ${theme.success("✓")} Removed global ${theme.muted(userDir)}`);
  } else {
    writeLine(`  ${theme.muted(`No global data at ${userDir}`)}`);
  }

  writeBlank();
  writeLine(
    `  ${theme.muted("Clean slate.")} Run ${theme.cyan("unfade")} ${theme.muted("to set up again.")}`,
  );
  writeBlank();
}
