// FILE: src/services/actions/runner.ts
// 12B.1: ActionRunner — event-driven action framework with opt-in config gate,
// atomic file writes, and action logging to .unfade/logs/actions.jsonl.

import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { UnfadeConfig } from "../../schemas/config.js";
import { logger } from "../../utils/logger.js";
import { getLogsDir } from "../../utils/paths.js";

export type ActionTrigger = "intelligence_update" | "session_end" | "schedule_weekly";

export interface ActionRegistration {
  trigger: ActionTrigger;
  name: string;
  configGate: (config: UnfadeConfig) => boolean;
  execute: (ctx: ActionContext) => Promise<ActionOutcome>;
}

export interface ActionContext {
  repoRoot: string;
  config: UnfadeConfig;
  trigger: ActionTrigger;
  payload?: Record<string, unknown>;
}

export interface ActionOutcome {
  action: string;
  target: string | null;
  contentHash: string | null;
  skipped?: boolean;
  reason?: string;
}

interface ActionLogEntry {
  action: string;
  trigger: ActionTrigger;
  target: string | null;
  timestamp: string;
  contentHash: string | null;
  skipped?: boolean;
  reason?: string;
}

export class ActionRunner {
  private actions: ActionRegistration[] = [];

  register(action: ActionRegistration): void {
    this.actions.push(action);
  }

  async fire(trigger: ActionTrigger, ctx: ActionContext): Promise<ActionOutcome[]> {
    if (!ctx.config.actions.enabled) return [];

    const matching = this.actions.filter((a) => a.trigger === trigger);
    const outcomes: ActionOutcome[] = [];

    for (const action of matching) {
      try {
        if (!action.configGate(ctx.config)) {
          outcomes.push({
            action: action.name,
            target: null,
            contentHash: null,
            skipped: true,
            reason: "config_disabled",
          });
          continue;
        }
        const outcome = await action.execute(ctx);
        outcomes.push(outcome);
        logAction(ctx.repoRoot, { ...outcome, trigger, timestamp: new Date().toISOString() });
      } catch (err) {
        logger.debug(`Action ${action.name} failed (non-fatal)`, {
          error: err instanceof Error ? err.message : String(err),
        });
        outcomes.push({
          action: action.name,
          target: null,
          contentHash: null,
          skipped: true,
          reason: "error",
        });
      }
    }

    return outcomes;
  }
}

function logAction(repoRoot: string, entry: ActionLogEntry): void {
  const logsDir = getLogsDir(repoRoot);
  mkdirSync(logsDir, { recursive: true });
  const logFile = join(logsDir, "actions.jsonl");
  appendFileSync(logFile, JSON.stringify(entry) + "\n", "utf-8");
}

// --- Atomic file write utilities ---

/**
 * Write content to a file atomically using tmp+rename.
 * Creates parent directories if needed.
 */
export function atomicWriteFile(filePath: string, content: string): void {
  const dir = join(filePath, "..");
  mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}`;
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, filePath);
}

/**
 * Replace content between marker comments in a file. If markers don't exist, append them.
 * Returns the new content hash.
 */
export function replaceMarkerSection(
  filePath: string,
  markerName: string,
  newContent: string,
): string {
  const beginMarker = `<!-- BEGIN UNFADE ${markerName} -->`;
  const endMarker = `<!-- END UNFADE ${markerName} -->`;
  const section = `${beginMarker}\n${newContent}\n${endMarker}`;
  const contentHash = createHash("sha256").update(newContent).digest("hex").slice(0, 16);

  let fileContent = "";
  if (existsSync(filePath)) {
    fileContent = readFileSync(filePath, "utf-8");
  }

  const beginIdx = fileContent.indexOf(beginMarker);
  const endIdx = fileContent.indexOf(endMarker);

  let updated: string;
  if (beginIdx !== -1 && endIdx !== -1) {
    // Replace existing section
    updated =
      fileContent.slice(0, beginIdx) + section + fileContent.slice(endIdx + endMarker.length);
  } else {
    // Append section
    updated = fileContent ? `${fileContent.trimEnd()}\n\n${section}\n` : `${section}\n`;
  }

  atomicWriteFile(filePath, updated);
  return contentHash;
}

/**
 * Compute content hash for deduplication.
 */
export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}
