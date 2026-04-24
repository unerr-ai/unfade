// FILE: src/services/intelligence/narrative-synthesizer.ts
// 11E.2: Narrative synthesis layer — template-based (no LLM) causal claim generator.
// Reads correlation.json + individual analyzer outputs. Produces narratives.jsonl ring buffer (max 50).
// Each entry: { id, ts, claim, severity, sources, confidence, sourceEventIds }

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../../utils/logger.js";
import { getIntelligenceDir } from "../../utils/paths.js";
import type { CorrelationReport } from "./cross-analyzer.js";
import { type NarrativeSeverity, narrativeTemplates } from "./narrative-templates.js";

export interface NarrativeInsight {
  id: string;
  ts: string;
  claim: string;
  severity: NarrativeSeverity;
  sources: string[];
  confidence: number;
  sourceEventIds: string[];
  correlationId: string;
}

const MAX_NARRATIVES = 50;
const NARRATIVE_FILE = "narratives.jsonl";

/**
 * Run narrative synthesis. Reads correlation.json + analyzer outputs.
 * Produces new narrative insights where templates match.
 * Non-fatal — failures don't affect other intelligence modules.
 */
export function synthesizeNarratives(repoRoot?: string): NarrativeInsight[] {
  try {
    const intelligenceDir = getIntelligenceDir(repoRoot);

    // Load correlation report
    const correlation = loadJsonFile<CorrelationReport>(join(intelligenceDir, "correlation.json"));
    if (!correlation?.correlations?.length) return [];

    // Load all analyzer outputs into a single data map
    const analyzerData = loadAnalyzerData(intelligenceDir);

    // Match templates against correlations
    const newInsights: NarrativeInsight[] = [];
    const now = new Date().toISOString();

    for (const pair of correlation.correlations) {
      for (const template of narrativeTemplates) {
        if (template.triggerCorrelation !== pair.id) continue;

        try {
          if (!template.condition(pair, analyzerData)) continue;

          const claim = template.formatClaim(pair, analyzerData);
          const severity = template.severity(pair, analyzerData);

          const insightId = createHash("sha256")
            .update(`${template.id}:${pair.computedAt}`)
            .digest("hex")
            .slice(0, 16);

          newInsights.push({
            id: insightId,
            ts: now,
            claim,
            severity,
            sources: template.sources,
            confidence: pair.confidence,
            sourceEventIds: [],
            correlationId: pair.id,
          });
        } catch {
          // Skip individual template failures
        }
      }
    }

    if (newInsights.length > 0) {
      appendNarratives(intelligenceDir, newInsights);
    }

    return newInsights;
  } catch (err) {
    logger.debug("Narrative synthesis failed (non-fatal)", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Read all narratives from the ring buffer.
 */
export function readNarratives(repoRoot: string): NarrativeInsight[] {
  try {
    const filePath = join(repoRoot, ".unfade", "intelligence", NARRATIVE_FILE);
    if (!existsSync(filePath)) return [];

    const content = readFileSync(filePath, "utf-8").trim();
    if (!content) return [];

    return content
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as NarrativeInsight;
        } catch {
          return null;
        }
      })
      .filter((n): n is NarrativeInsight => n !== null);
  } catch {
    return [];
  }
}

/**
 * Append new narratives to the ring buffer, enforcing MAX_NARRATIVES limit.
 */
function appendNarratives(intelligenceDir: string, insights: NarrativeInsight[]): void {
  mkdirSync(intelligenceDir, { recursive: true });
  const filePath = join(intelligenceDir, NARRATIVE_FILE);

  // Read existing
  let existing: NarrativeInsight[] = [];
  if (existsSync(filePath)) {
    try {
      const content = readFileSync(filePath, "utf-8").trim();
      existing = content
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line) as NarrativeInsight;
          } catch {
            return null;
          }
        })
        .filter((n): n is NarrativeInsight => n !== null);
    } catch {
      // Start fresh if corrupt
    }
  }

  // Deduplicate by claim hash within last 24h
  const recentClaimHashes = new Set(
    existing
      .filter((n) => Date.now() - new Date(n.ts).getTime() < 86400 * 1000)
      .map((n) => createHash("sha256").update(n.claim).digest("hex").slice(0, 12)),
  );

  const deduped = insights.filter((n) => {
    const hash = createHash("sha256").update(n.claim).digest("hex").slice(0, 12);
    if (recentClaimHashes.has(hash)) return false;
    recentClaimHashes.add(hash);
    return true;
  });

  if (deduped.length === 0) return;

  // Combine and trim to MAX_NARRATIVES
  const all = [...existing, ...deduped].slice(-MAX_NARRATIVES);

  // Atomic rewrite
  const tmp = join(intelligenceDir, `${NARRATIVE_FILE}.tmp.${process.pid}`);
  const content = `${all.map((n) => JSON.stringify(n)).join("\n")}\n`;
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, filePath);
}

function loadJsonFile<T>(path: string): T | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

function loadAnalyzerData(intelligenceDir: string): Record<string, unknown> {
  const files: Record<string, string> = {
    efficiency: "efficiency.json",
    "cost-attribution": "costs.json",
    "comprehension-radar": "comprehension.json",
    "loop-detector": "rejections.idx.json",
    "velocity-tracker": "velocity.json",
    "blind-spot-detector": "alerts.json",
    "prompt-patterns": "prompt-patterns.json",
    "decision-replay": "replays.json",
  };

  const data: Record<string, unknown> = {};
  for (const [key, filename] of Object.entries(files)) {
    const loaded = loadJsonFile<Record<string, unknown>>(join(intelligenceDir, filename));
    if (loaded) data[key] = loaded;
  }

  // Also expose nested data at top level for template convenience
  // e.g., data["alerts"] = data["blind-spot-detector"]
  if (data["blind-spot-detector"]) data.alerts = data["blind-spot-detector"];

  return data;
}
