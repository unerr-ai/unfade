// FILE: src/services/init/runner.ts
// Phase 5.7: Simplified 4-step init wizard (setup-only, no server start).
// Steps: scaffold → binary → shell hooks → LLM config.
// No daemon spawn. No autostart. No backfill. The server handles all of that.

import { join } from "node:path";
import { theme, writeBlank, writeLine } from "../../cli/ui.js";
import type { InitProgress } from "../../schemas/init-progress.js";
import { logger } from "../../utils/logger.js";
import { getBinDir, getDaemonProjectRoot, getProjectDataDir } from "../../utils/paths.js";
import { ensureBinaries } from "../daemon/binary.js";
import { registerRepo } from "../registry/registry.js";
import { installShellHooks } from "../shell/installer.js";
import { applyWizardSelectionToConfig, runInteractiveLlmOnboarding } from "./llm-wizard.js";
import {
  isStepCompleted,
  loadProgress,
  markInitCompleted,
  markStepCompleted,
  markStepFailed,
} from "./progress.js";
import {
  renderBanner,
  renderLlmResult,
  renderResumed,
  renderShellHookInfo,
  renderStepDone,
  renderStepFailed,
  renderStepSkipped,
} from "./renderer.js";
import { scaffold } from "./scaffold.js";

/**
 * Run the 4-step init sequence (setup-only).
 * Does NOT start the server, daemon, or any background processes.
 * After init completes, user runs `unfade` to start the server.
 */
export async function runInit(cwd: string): Promise<void> {
  const { progress, resumed } = loadProgress(cwd);

  renderBanner();
  if (resumed) renderResumed();

  // Step 1: Scaffold (FATAL)
  await runStep(cwd, progress, "scaffold", () => {
    const result = scaffold(cwd);
    return result.created ? undefined : "already existed";
  });

  // Step 2: Binary
  await runStep(cwd, progress, "binary", () => {
    const result = ensureBinaries(cwd);
    return result.source === "existing" ? "already present" : result.source;
  });

  // Step 3: Shell hooks
  await runStep(cwd, progress, "shell-hooks", () => {
    const sendBin = join(
      getBinDir(cwd),
      process.platform === "win32" ? "unfade-send.exe" : "unfade-send",
    );
    const result = installShellHooks(sendBin);
    if (result.installed) {
      renderShellHookInfo(result.shell);
    }
    if (result.alreadyPresent) return "already installed";
    if (!result.installed) return "skipped";
    return result.shell;
  });

  // Step 4: LLM config wizard
  if (!isStepCompleted(progress, "llm-detect")) {
    const selection = await runInteractiveLlmOnboarding(cwd);
    try {
      applyWizardSelectionToConfig(cwd, selection);
      markStepCompleted(cwd, progress, "llm-detect");
      renderStepDone(
        "llm-detect",
        selection.provider === "none"
          ? "structured summaries"
          : `${selection.provider}/${selection.model ?? "default"}`,
      );
      renderLlmResult(selection.provider, selection.model, 7654);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      markStepFailed(cwd, progress, "llm-detect", message);
      renderStepFailed("llm-detect", message);
    }
  } else {
    renderStepSkipped("llm-detect");
  }

  // Register repo in global registry
  registerRepo(getDaemonProjectRoot(cwd));

  markInitCompleted(cwd, progress);

  writeBlank();
  writeLine(
    `  ${theme.success("✓")} ${theme.bold("Setup complete.")} Run ${theme.cyan("unfade")} to start capturing and analyzing.`,
  );
  writeBlank();
}

/**
 * Execute a single init step with idempotency, error handling, and rendering.
 */
async function runStep(
  cwd: string,
  progress: InitProgress,
  step: Parameters<typeof isStepCompleted>[1],
  fn: () => string | undefined | Promise<string | undefined>,
): Promise<void> {
  if (isStepCompleted(progress, step)) {
    renderStepSkipped(step);
    return;
  }

  try {
    const detail = await fn();
    markStepCompleted(cwd, progress, step);
    renderStepDone(step, detail);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (step === "scaffold") {
      renderStepFailed(step, message);
      throw err;
    }

    markStepFailed(cwd, progress, step, message);
    renderStepFailed(step, message);
  }
}
