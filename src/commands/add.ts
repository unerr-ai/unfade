// FILE: src/commands/add.ts
// UF-303: `unfade add <path>` — register an additional repo in the registry.
// If .unfade/ doesn't exist at the path, runs lightweight init (scaffold + binary).
// Does NOT start the server — just registers.

import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { theme, writeBlank, writeLine } from "../cli/ui.js";
import { ensureBinaries } from "../services/daemon/binary.js";
import { registerRepo } from "../services/registry/registry.js";
import { handleCliError } from "../utils/cli-error.js";

export async function addCommand(targetPath: string): Promise<void> {
  try {
    const repoRoot = resolve(targetPath);

    if (!existsSync(repoRoot)) {
      writeLine(`${theme.error("Error:")} Path does not exist: ${repoRoot}`);
      process.exitCode = 1;
      return;
    }

    const unfadeDir = join(repoRoot, ".unfade");
    if (!existsSync(unfadeDir)) {
      writeLine(`  ${theme.accent("◆")} Initializing ${theme.bold(repoRoot)}...`);
      mkdirSync(unfadeDir, { recursive: true });
      mkdirSync(join(unfadeDir, "state"), { recursive: true });
      mkdirSync(join(unfadeDir, "events"), { recursive: true });
      mkdirSync(join(unfadeDir, "logs"), { recursive: true });

      try {
        ensureBinaries(repoRoot);
        writeLine(`  ${theme.success("✓")} Capture engine binary ready`);
      } catch {
        writeLine(`  ${theme.warning("⚠")} Binary not available — will retry on server start`);
      }
    }

    registerRepo(repoRoot);

    writeBlank();
    writeLine(`  ${theme.success("✓")} Registered ${theme.bold(repoRoot)}`);
    writeLine(
      `  ${theme.muted("Run")} ${theme.cyan("unfade")} ${theme.muted("to start capturing all registered repos.")}`,
    );
    writeBlank();
  } catch (err) {
    handleCliError(err, "add");
  }
}
