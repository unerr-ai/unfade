// FILE: src/commands/daemon.ts
// `unfade daemon stop` — gracefully stop the capture engine via IPC.
// Power user command, not shown in primary help.

import pc from "picocolors";
import { USER_TERMS } from "../constants/terminology.js";
import { queryDaemonStatus, stopDaemon } from "../utils/ipc.js";

/**
 * Stop the capture engine by sending a stop command via IPC.
 * Falls back to SIGTERM via PID file if IPC fails.
 */
export async function daemonStopCommand(): Promise<void> {
  process.stderr.write(pc.dim(`${USER_TERMS.daemonStopping}...\n`));

  const resp = await stopDaemon();

  if (resp.ok) {
    process.stderr.write(`${pc.green("✓")} ${USER_TERMS.daemonStopped}\n`);
  } else {
    process.stderr.write(`${pc.yellow("✗")} ${resp.error}\n`);
    process.exitCode = 1;
  }
}

/**
 * Show capture engine status via IPC.
 */
export async function daemonStatusCommand(): Promise<void> {
  const resp = await queryDaemonStatus();

  if (resp.ok && resp.data) {
    const data = resp.data;
    process.stderr.write(`${pc.green("●")} ${USER_TERMS.daemonRunning}\n`);

    if (data.uptime !== undefined) {
      process.stderr.write(pc.dim(`  Uptime: ${data.uptime}s\n`));
    }
    if (data.events_today !== undefined) {
      process.stderr.write(pc.dim(`  Events today: ${data.events_today}\n`));
    }
    if (data.watchers) {
      const watchers = data.watchers as Record<string, string[]>;
      for (const [name, paths] of Object.entries(watchers)) {
        process.stderr.write(pc.dim(`  ${name}: ${(paths as string[]).length} path(s)\n`));
      }
    }
  } else {
    process.stderr.write(`${pc.red("○")} ${USER_TERMS.daemonStopped}\n`);
    if (resp.error) {
      process.stderr.write(pc.dim(`  ${resp.error}\n`));
    }
  }
}
