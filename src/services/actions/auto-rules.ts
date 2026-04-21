// FILE: src/services/actions/auto-rules.ts
// 12B.4: Auto-rule action — on intelligence update, extract patterns and write to target rule file.
// Rate limited: max 1 write per day. Deduplicates by content hash.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { UnfadeConfig } from "../../schemas/config.js";
import { logger } from "../../utils/logger.js";
import { getProjectDataDir } from "../../utils/paths.js";
import { extractHighConfidencePatterns, formatRules, type RuleTarget } from "./rule-formatter.js";
import type { ActionContext, ActionOutcome, ActionRegistration } from "./runner.js";
import { atomicWriteFile, contentHash, replaceMarkerSection } from "./runner.js";

const MAX_RULES_PER_WRITE = 10;
let lastWriteDate = "";

/**
 * Detect which rule target is appropriate for this project.
 * Config override takes precedence, then directory detection.
 */
export function detectRuleTarget(
  repoRoot: string,
  config: UnfadeConfig,
): { target: RuleTarget; path: string } | null {
  // Config override
  if (config.actions.ruleTarget) {
    const ext = config.actions.ruleTarget;
    if (ext.endsWith(".mdc")) return { target: "cursor", path: join(repoRoot, ext) };
    if (ext.includes("CLAUDE")) return { target: "claude", path: join(repoRoot, ext) };
    return { target: "copilot", path: join(repoRoot, ext) };
  }

  // Directory detection
  if (existsSync(join(repoRoot, ".cursor"))) {
    return { target: "cursor", path: join(repoRoot, ".cursor", "rules", "unfade.mdc") };
  }
  if (existsSync(join(repoRoot, "CLAUDE.md")) || existsSync(join(repoRoot, ".claude"))) {
    return { target: "claude", path: join(repoRoot, "CLAUDE.md") };
  }
  if (existsSync(join(repoRoot, ".github"))) {
    return { target: "copilot", path: join(repoRoot, ".github", "copilot-instructions.md") };
  }

  return null;
}

async function executeAutoRules(ctx: ActionContext): Promise<ActionOutcome> {
  const today = new Date().toISOString().slice(0, 10);

  // Rate limit: max 1 write per day
  if (lastWriteDate === today) {
    return {
      action: "auto_rules",
      target: null,
      contentHash: null,
      skipped: true,
      reason: "rate_limited",
    };
  }

  // Read prompt-patterns.json
  const patternsPath = join(
    getProjectDataDir(ctx.repoRoot),
    "intelligence",
    "prompt-patterns.json",
  );
  if (!existsSync(patternsPath)) {
    return {
      action: "auto_rules",
      target: null,
      contentHash: null,
      skipped: true,
      reason: "no_patterns",
    };
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(readFileSync(patternsPath, "utf-8"));
  } catch {
    return {
      action: "auto_rules",
      target: null,
      contentHash: null,
      skipped: true,
      reason: "parse_error",
    };
  }

  const patterns = extractHighConfidencePatterns(data).slice(0, MAX_RULES_PER_WRITE);
  if (patterns.length === 0) {
    return {
      action: "auto_rules",
      target: null,
      contentHash: null,
      skipped: true,
      reason: "no_high_confidence",
    };
  }

  const detected = detectRuleTarget(ctx.repoRoot, ctx.config);
  if (!detected) {
    return {
      action: "auto_rules",
      target: null,
      contentHash: null,
      skipped: true,
      reason: "no_target",
    };
  }

  const { target, path } = detected;
  const ruleText = formatRules(target, patterns, today);
  const hash = contentHash(ruleText);

  // Dedup: check if content matches what's already written
  if (existsSync(path)) {
    const existing = readFileSync(path, "utf-8");
    if (existing.includes(hash)) {
      return {
        action: "auto_rules",
        target: path,
        contentHash: hash,
        skipped: true,
        reason: "duplicate",
      };
    }
  }

  // Write rules
  if (target === "cursor") {
    // Cursor .mdc files are fully owned by unfade — atomic overwrite
    atomicWriteFile(path, ruleText);
  } else {
    // CLAUDE.md and copilot-instructions use marker sections
    replaceMarkerSection(path, "RULES", ruleText);
  }

  lastWriteDate = today;
  logger.debug("Auto-rules written", { target: path, patternCount: patterns.length });

  return { action: "auto_rules", target: path, contentHash: hash };
}

export const autoRulesAction: ActionRegistration = {
  trigger: "intelligence_update",
  name: "auto_rules",
  configGate: (config) => config.actions.autoRules,
  execute: executeAutoRules,
};
