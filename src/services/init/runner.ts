// FILE: src/services/init/runner.ts
// 8-step init orchestrator. Each step is idempotent.
// Progress tracked in .unfade/state/init_progress.json.
// Only step 1 (scaffold) is fatal — all others tolerate failure.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { InitProgress } from "../../schemas/init-progress.js";
import { sendIPCCommand } from "../../utils/ipc.js";
import { logger } from "../../utils/logger.js";
import { getBinDir, getProjectDataDir, getStateDir } from "../../utils/paths.js";
import { ensureBinaries, isDaemonRunning, registerRepo, startDaemon } from "../daemon/binary.js";
import { generateFirstDistill } from "../distill/first-distill.js";
import { installShellHooks } from "../shell/installer.js";
import { installAutostart } from "./autostart.js";
import { fingerprint } from "./fingerprint.js";
import { detectLlm } from "./llm-detect.js";
import {
  isStepCompleted,
  loadProgress,
  markInitCompleted,
  markStepCompleted,
  markStepFailed,
} from "./progress.js";
import {
  renderBanner,
  renderComplete,
  renderFirstDistill,
  renderLlmResult,
  renderResumed,
  renderShellHookInfo,
  renderStepDone,
  renderStepFailed,
  renderStepSkipped,
} from "./renderer.js";
import { scaffold } from "./scaffold.js";

/**
 * Update the distill provider in config.json.
 */
function updateConfigProvider(cwd: string, provider: string, model: string | null): void {
  const configPath = join(getProjectDataDir(cwd), "config.json");
  if (!existsSync(configPath)) return;

  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    config.distill = config.distill ?? {};
    config.distill.provider = provider;
    if (model) config.distill.model = model;
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
  } catch {
    logger.debug("Failed to update config provider");
  }
}

/**
 * Run the 8-step init sequence.
 * Each step is idempotent — re-runs skip completed steps.
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

  // Step 2: Fingerprint
  await runStep(cwd, progress, "fingerprint", () => {
    const fp = fingerprint(cwd);
    return fp.primaryDomain ? `primary: ${fp.primaryDomain}` : undefined;
  });

  // Step 3: Binary
  await runStep(cwd, progress, "binary", () => {
    const result = ensureBinaries(cwd);
    return result.source === "existing" ? "already present" : result.source;
  });

  // Step 4: Shell hooks
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

  // Step 5: Auto-start
  await runStep(cwd, progress, "autostart", () => {
    const daemonBin = join(
      getBinDir(cwd),
      process.platform === "win32" ? "unfaded.exe" : "unfaded",
    );
    const projectDir = getProjectDataDir(cwd);
    const stateDir = getStateDir(cwd);
    const result = installAutostart(daemonBin, projectDir, stateDir);
    if (result.alreadyPresent) return "already registered";
    if (!result.installed) return "skipped";
    return result.platform;
  });

  // Step 6: LLM detect
  await runStep(cwd, progress, "llm-detect", () => {
    const result = detectLlm();
    updateConfigProvider(cwd, result.provider, result.model);
    renderLlmResult(result.provider, result.model);
    return result.provider === "none"
      ? "structured summaries"
      : `${result.provider}/${result.model}`;
  });

  // Step 7: Start daemon
  await runStep(cwd, progress, "start-daemon", () => {
    if (isDaemonRunning(cwd)) return "already running";
    const projectDir = getProjectDataDir(cwd);
    const pid = startDaemon(cwd, projectDir);
    registerRepo(projectDir);
    return `pid ${pid}`;
  });

  // Step 8: Backfill
  await runStep(cwd, progress, "backfill", async () => {
    const resp = await sendIPCCommand({ cmd: "backfill", args: { days: 30 } }, cwd, 30000);
    if (!resp.ok) return `skipped: ${resp.error}`;
    const count = (resp.data as Record<string, unknown>)?.count ?? 0;
    return `${count} events`;
  });

  // First distill (bonus, not a tracked step).
  try {
    // Give the writer a moment to flush backfill events.
    await sleep(500);
    const distill = generateFirstDistill(cwd);
    if (distill) {
      renderFirstDistill(distill.eventsProcessed, distill.decisions, distill.date);
    }
  } catch (err) {
    logger.debug("First distill failed", { error: String(err) });
  }

  markInitCompleted(cwd, progress);
  renderComplete();
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

    // Step 1 (scaffold) is fatal.
    if (step === "scaffold") {
      renderStepFailed(step, message);
      throw err;
    }

    markStepFailed(cwd, progress, step, message);
    renderStepFailed(step, message);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
