// FILE: src/services/llm/ollama-cli-guard.ts
// On each CLI session (bare `unfade`, distill, etc.), verify Ollama is reachable and the
// configured model exists. TTY: offer launch (macOS), `ollama pull`, or retry. Non-TTY: warn only.

import { execSync, spawnSync } from "node:child_process";
import * as clack from "@clack/prompts";
import { theme, writeBlank, writeLine } from "../../cli/ui.js";
import { loadConfig } from "../../config/manager.js";
import type { UnfadeConfig } from "../../schemas/config.js";
import { logger } from "../../utils/logger.js";
import { getProjectDataDir } from "../../utils/paths.js";
import { checkOllamaReady, normalizeOllamaOriginForChecks } from "../distill/providers/ai.js";

const SKIP_ENV = "UNFADE_SKIP_OLLAMA_GUARD";

type GuardAction = "retry" | "launch" | "pull" | "skip";

function tryOpenOllamaApp(): boolean {
  if (process.platform !== "darwin") return false;
  try {
    execSync("open -a Ollama", { stdio: "ignore", timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

function tryOllamaPull(model: string): boolean {
  const r = spawnSync("ollama", ["pull", model], {
    stdio: "inherit",
    encoding: "utf-8",
    timeout: 900_000,
  });
  return r.status === 0;
}

function ollamaCliAvailable(): boolean {
  const r = spawnSync("ollama", ["--version"], {
    stdio: "ignore",
    encoding: "utf-8",
    timeout: 4000,
  });
  return r.status === 0;
}

async function runOllamaGuardCore(config: UnfadeConfig): Promise<void> {
  if (config.distill.provider !== "ollama") return;

  const model = config.distill.model?.trim() || "llama3.2";
  const origin = normalizeOllamaOriginForChecks(config.distill.apiBase);

  const maxInteractiveRounds = 8;
  let round = 0;

  while (round < maxInteractiveRounds) {
    round++;
    const result = await checkOllamaReady(origin, model);
    if (result.ready) return;

    writeBlank();
    writeLine(
      `  ${theme.warning("⚠")} ${theme.warning("Ollama")} ${theme.muted("—")} ${theme.muted(result.reason ?? "not ready")}`,
    );
    writeLine(
      `  ${theme.muted(`Endpoint:`)} ${theme.cyan(origin)} ${theme.muted(`· model:`)} ${theme.cyan(model)}`,
    );

    if (!process.stderr.isTTY) {
      writeLine(
        `  ${theme.muted("Fix: start Ollama, run")} ${theme.cyan(`ollama pull ${model}`)}${theme.muted(", or set")} ${theme.cyan(`${SKIP_ENV}=1`)} ${theme.muted("to skip this check.")}`,
      );
      writeBlank();
      return;
    }

    const options: Array<{ value: GuardAction; label: string; hint?: string }> = [
      { value: "retry", label: "Retry check", hint: "after you started Ollama manually" },
    ];
    if (process.platform === "darwin") {
      options.push({
        value: "launch",
        label: "Try opening the Ollama app",
        hint: "macOS only",
      });
    }
    if (ollamaCliAvailable()) {
      options.push({
        value: "pull",
        label: `Pull model (${model})`,
        hint: "runs: ollama pull …",
      });
    }
    options.push({
      value: "skip",
      label: "Continue anyway",
      hint: "distills may fail until Ollama is ready",
    });

    const choice = await clack.select({
      message: "What would you like to do?",
      options,
      initialValue: "retry",
    });

    if (clack.isCancel(choice)) {
      writeLine(`  ${theme.muted("Continuing — Ollama may still be unavailable.")}`);
      writeBlank();
      return;
    }

    const action = choice as GuardAction;
    if (action === "skip") {
      writeLine(`  ${theme.muted("Continuing without fixing Ollama.")}`);
      writeBlank();
      return;
    }

    if (action === "retry") {
      const s = clack.spinner();
      s.start("Checking Ollama again…");
      await new Promise((r) => setTimeout(r, 600));
      s.stop("Done");
      continue;
    }

    if (action === "launch") {
      const s = clack.spinner();
      s.start("Opening Ollama…");
      const ok = tryOpenOllamaApp();
      s.stop(ok ? "Launched Ollama (or app was already running)" : "Could not open Ollama app");
      if (ok) {
        const wait = clack.spinner();
        wait.start("Waiting for Ollama to listen…");
        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 500));
          const probe = await checkOllamaReady(origin, model);
          if (probe.ready) {
            wait.stop("Ollama is up");
            writeBlank();
            return;
          }
        }
        wait.stop("Still not ready — try Retry or Pull model");
      }
      continue;
    }

    if (action === "pull") {
      if (!ollamaCliAvailable()) {
        clack.log.warn("Install the Ollama CLI or add it to PATH, then use Retry.");
        continue;
      }
      const s = clack.spinner();
      s.start(`Pulling ${model}…`);
      const ok = tryOllamaPull(model);
      s.stop(ok ? `Finished: ollama pull ${model}` : "ollama pull failed");
    }
  }

  writeLine(
    `  ${theme.muted("Stopping Ollama prompts after several attempts — fix manually or use Settings.")}`,
  );
  writeBlank();
}

function shouldSkipGuard(): boolean {
  return process.env[SKIP_ENV] === "1" || process.env[SKIP_ENV] === "true";
}

/**
 * Load project config for `cwd` and run the Ollama guard when provider is Ollama.
 */
export async function runOllamaSessionGuard(cwd: string): Promise<void> {
  if (shouldSkipGuard()) {
    logger.debug("Skipping Ollama session guard", { env: SKIP_ENV });
    return;
  }
  const config = loadConfig({ projectDataDir: getProjectDataDir(cwd) });
  await runOllamaGuardCore(config);
}

/**
 * Same guard using an explicit config (e.g. `unfade distill --provider ollama`).
 */
export async function runOllamaGuardForConfig(_cwd: string, config: UnfadeConfig): Promise<void> {
  if (shouldSkipGuard()) {
    logger.debug("Skipping Ollama session guard", { env: SKIP_ENV });
    return;
  }
  await runOllamaGuardCore(config);
}
