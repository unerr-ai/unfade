// FILE: src/commands/daemon.ts
// `unfade daemon stop|status|restart|update` — manage the capture engine.
// Power user commands, not shown in primary help.

import { theme } from "../cli/ui.js";
import { USER_TERMS } from "../constants/terminology.js";
import {
  isDaemonOutdated,
  isDaemonRunning,
  startDaemon,
  updateDaemonBinary,
} from "../services/daemon/binary.js";
import { queryDaemonStatus, stopDaemon } from "../utils/ipc.js";
import { logger } from "../utils/logger.js";
import { getDaemonProjectRoot } from "../utils/paths.js";

/**
 * Stop the capture engine by sending a stop command via IPC.
 * Falls back to SIGTERM via PID file if IPC fails.
 */
export async function daemonStopCommand(): Promise<void> {
  process.stderr.write(theme.muted(`${USER_TERMS.daemonStopping}...\n`));

  const resp = await stopDaemon();

  if (resp.ok) {
    process.stderr.write(`${theme.success("✓")} ${USER_TERMS.daemonStopped}\n`);
  } else {
    process.stderr.write(`${theme.warning("✗")} ${resp.error}\n`);
    process.exitCode = 1;
  }
}

/**
 * Restart the capture engine (stop + start).
 */
export async function daemonRestartCommand(): Promise<void> {
  const cwd = process.cwd();

  // Stop if running
  if (isDaemonRunning(cwd)) {
    process.stderr.write(theme.muted(`${USER_TERMS.daemonStopping}...\n`));
    const resp = await stopDaemon();
    if (!resp.ok) {
      process.stderr.write(`${theme.warning("✗")} ${resp.error}\n`);
      process.exitCode = 1;
      return;
    }
    // Brief pause for socket cleanup
    await new Promise((r) => setTimeout(r, 500));
  }

  // Start
  try {
    const pid = startDaemon(cwd, getDaemonProjectRoot(cwd));
    process.stderr.write(`${theme.success("✓")} Capture engine restarted (PID ${pid})\n`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${theme.error("✗")} Failed to start capture engine: ${msg}\n`);
    process.exitCode = 1;
  }
}

/**
 * Update the daemon binary to the latest version and restart.
 */
export async function daemonUpdateCommand(): Promise<void> {
  const cwd = process.cwd();

  if (!isDaemonOutdated(cwd)) {
    process.stderr.write(`${theme.success("✓")} Capture engine is already up to date\n`);
    return;
  }

  process.stderr.write(theme.muted("Updating capture engine binary...\n"));

  const paths = updateDaemonBinary(cwd);
  if (!paths) {
    process.stderr.write(
      `${theme.error("✗")} No update source available (no Go source or prebuilt package found)\n`,
    );
    process.exitCode = 1;
    return;
  }

  process.stderr.write(`${theme.success("✓")} Binary updated (${paths.source})\n`);

  // Restart if daemon was running
  if (isDaemonRunning(cwd)) {
    process.stderr.write(theme.muted("Restarting capture engine with new binary...\n"));
    await daemonRestartCommand();
  } else {
    process.stderr.write(
      theme.muted("Capture engine is not running — start it with `unfade init`\n"),
    );
  }
}

/**
 * Auto-check for daemon updates and apply if needed.
 * Called silently on bare `unfade` invocations.
 * Returns true if an update was applied.
 */
export async function checkAndUpdateDaemon(cwd: string): Promise<boolean> {
  try {
    if (!isDaemonRunning(cwd) || !isDaemonOutdated(cwd)) return false;

    logger.debug("Capture engine update detected — rebuilding and restarting...");

    const paths = updateDaemonBinary(cwd);
    if (!paths) return false;

    // Stop old daemon
    await stopDaemon(cwd);
    await new Promise((r) => setTimeout(r, 500));

    // Start new daemon
    const pid = startDaemon(cwd, getDaemonProjectRoot(cwd));
    logger.debug(`Capture engine updated and restarted (PID ${pid})`);
    return true;
  } catch (err) {
    logger.debug("Auto-update check failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Show capture engine status via IPC.
 */
export async function daemonStatusCommand(): Promise<void> {
  const resp = await queryDaemonStatus();

  if (resp.ok && resp.data) {
    const data = resp.data;
    process.stderr.write(`${theme.success("●")} ${USER_TERMS.daemonRunning}\n`);

    if (data.uptime !== undefined) {
      process.stderr.write(theme.muted(`  Uptime: ${data.uptime}s\n`));
    }
    if (data.events_today !== undefined) {
      process.stderr.write(theme.muted(`  Events today: ${data.events_today}\n`));
    }
    if (data.watchers) {
      const watchers = data.watchers as Record<string, string[]>;
      for (const [name, paths] of Object.entries(watchers)) {
        process.stderr.write(theme.muted(`  ${name}: ${(paths as string[]).length} path(s)\n`));
      }
    }
  } else {
    process.stderr.write(`${theme.error("○")} ${USER_TERMS.daemonStopped}\n`);
    if (resp.error) {
      process.stderr.write(theme.muted(`  ${resp.error}\n`));
    }
  }
}
