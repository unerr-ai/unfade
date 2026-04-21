import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { theme, writeBlank, writeLine } from "../cli/ui.js";
import { unregisterRepo } from "../services/registry/registry.js";
import { removeShellHooks } from "../services/shell/installer.js";
import { stopDaemon } from "../utils/ipc.js";
import { logger } from "../utils/logger.js";
import { getDaemonProjectRoot, getProjectDataDir, getUserConfigDir } from "../utils/paths.js";

/**
 * Full teardown for the current repo so you can run `unfade` from a clean slate.
 * With `--global`, also removes `~/.unfade/` and unfade auto-start agents for your user account.
 * Requires `--yes` to avoid accidental data loss.
 */
export async function resetCommand(opts: {
  yes: boolean;
  keepHooks?: boolean;
  global?: boolean;
}): Promise<void> {
  if (!opts.yes) {
    logger.error(
      "Refusing to reset: removes this repo's .unfade/, shell hooks (unless --keep-hooks), and matching auto-start; add --global for ~/.unfade/ and all unfade agents. Re-run with --yes",
    );
    process.exitCode = 1;
    return;
  }

  const cwd = process.cwd();
  const dataDir = getProjectDataDir(cwd);
  const userDir = getUserConfigDir();

  await stopDaemon(cwd);
  if (!opts.global) {
    unregisterRepo(getDaemonProjectRoot(cwd));
  }

  if (!opts.keepHooks) {
    removeShellHooks();
  }

  writeBlank();
  if (existsSync(dataDir)) {
    rmSync(dataDir, { recursive: true, force: true });
    writeLine(`  ${theme.success("✓")} Removed ${theme.muted(dataDir)}`);
  } else {
    writeLine(`  ${theme.muted(`No project data at ${dataDir}`)}`);
  }

  if (opts.global) {
    if (resolve(dataDir) === resolve(userDir)) {
      // Already removed as the project data dir (e.g. cwd is home with no nested git root).
    } else if (existsSync(userDir)) {
      rmSync(userDir, { recursive: true, force: true });
      writeLine(`  ${theme.success("✓")} Removed global ${theme.muted(userDir)}`);
    } else {
      writeLine(`  ${theme.muted(`No global config at ${userDir}`)}`);
    }
  }

  writeLine(
    `  ${theme.muted("Run")} ${theme.cyan("unfade")} ${theme.muted("to set up again.")}`,
  );
  writeBlank();
}
