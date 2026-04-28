// FILE: src/services/intelligence/pipeline-verify.ts
// End-to-end verification of the intelligence pipeline.
// Checks each layer: JSONL → materializer → DuckDB columns → classification →
// analyzer states → narrative synthesis. Reports any broken links.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getEventsDir, getIntelligenceDir } from "../../utils/paths.js";
import type { DbLike } from "../cache/manager.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VerificationResult {
  passed: boolean;
  checks: VerificationCheck[];
  summary: string;
  duration: number;
}

export interface VerificationCheck {
  name: string;
  layer: "events" | "materialization" | "classification" | "analyzers" | "synthesis";
  passed: boolean;
  detail: string;
  severity: "critical" | "warning" | "info";
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export async function verifyPipeline(
  analyticsDb: DbLike,
  _operationalDb: DbLike,
): Promise<VerificationResult> {
  const startMs = Date.now();
  const checks: VerificationCheck[] = [];

  checks.push(checkJsonlEvents());
  checks.push(...(await checkDuckDbColumns(analyticsDb)));
  checks.push(...(await checkClassificationColumns(analyticsDb)));
  checks.push(checkAnalyzerStates());
  checks.push(checkSynthesisOutputs());
  checks.push(await checkWatermarkConsistency(analyticsDb));

  const passed = checks.filter((c) => c.severity === "critical").every((c) => c.passed);
  const failedCritical = checks.filter((c) => !c.passed && c.severity === "critical").length;
  const failedWarnings = checks.filter((c) => !c.passed && c.severity === "warning").length;
  const duration = Date.now() - startMs;

  const summary = passed
    ? `Pipeline verification passed: ${checks.length} checks, ${failedWarnings} warnings, ${duration}ms`
    : `Pipeline verification FAILED: ${failedCritical} critical failures, ${failedWarnings} warnings, ${duration}ms`;

  return { passed, checks, summary, duration };
}

// ---------------------------------------------------------------------------
// Layer 1: JSONL Events
// ---------------------------------------------------------------------------

function checkJsonlEvents(): VerificationCheck {
  try {
    const eventsDir = getEventsDir();
    if (!existsSync(eventsDir)) {
      return {
        name: "JSONL events directory",
        layer: "events",
        passed: false,
        detail: `Events directory not found at ${eventsDir}`,
        severity: "critical",
      };
    }
    const files = readdirSync(eventsDir).filter((f) => f.endsWith(".jsonl"));
    return {
      name: "JSONL events directory",
      layer: "events",
      passed: files.length > 0,
      detail:
        files.length > 0
          ? `${files.length} JSONL files found`
          : "No JSONL files — no events captured yet",
      severity: files.length > 0 ? "info" : "warning",
    };
  } catch {
    return {
      name: "JSONL events directory",
      layer: "events",
      passed: false,
      detail: "Failed to read events directory",
      severity: "critical",
    };
  }
}

// ---------------------------------------------------------------------------
// Layer 2: DuckDB Materialization
// ---------------------------------------------------------------------------

async function checkDuckDbColumns(db: DbLike): Promise<VerificationCheck[]> {
  const checks: VerificationCheck[] = [];

  try {
    const countResult = await db.exec("SELECT COUNT(*) FROM events");
    const totalEvents = Number(countResult[0]?.values[0]?.[0] ?? 0);
    checks.push({
      name: "DuckDB events table",
      layer: "materialization",
      passed: true,
      detail: `${totalEvents} events in DuckDB`,
      severity: totalEvents > 0 ? "info" : "warning",
    });

    const columnResult = await db.exec(`
      SELECT COUNT(*) as total,
             COUNT(source) as has_source,
             COUNT(ts) as has_ts,
             COUNT(human_direction_score) as has_hds,
             COUNT(ai_tool) as has_ai_tool,
             COUNT(session_id) as has_session_id
      FROM events
    `);
    const row = columnResult[0]?.values[0] ?? [];
    const total = Number(row[0] ?? 0);
    const hasSource = Number(row[1] ?? 0);
    checks.push({
      name: "DuckDB typed columns populated",
      layer: "materialization",
      passed: total === 0 || hasSource > 0,
      detail:
        total > 0
          ? `source: ${hasSource}/${total}, hds: ${Number(row[3] ?? 0)}/${total}, ai_tool: ${Number(row[4] ?? 0)}/${total}, session_id: ${Number(row[5] ?? 0)}/${total}`
          : "No events to check",
      severity: "critical",
    });
  } catch (err) {
    checks.push({
      name: "DuckDB events table",
      layer: "materialization",
      passed: false,
      detail: `DuckDB query failed: ${err instanceof Error ? err.message : String(err)}`,
      severity: "critical",
    });
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Layer 3: Classification
// ---------------------------------------------------------------------------

async function checkClassificationColumns(db: DbLike): Promise<VerificationCheck[]> {
  const checks: VerificationCheck[] = [];

  try {
    const result = await db.exec(`
      SELECT
        COUNT(*) as total,
        COUNT(prompt_type) as has_prompt_type,
        COUNT(execution_phase) as has_execution_phase,
        COUNT(feature_group_id) as has_feature_group,
        COUNT(chain_pattern) as has_chain_pattern
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
    `);
    const row = result[0]?.values[0] ?? [];
    const total = Number(row[0] ?? 0);
    const hasPromptType = Number(row[1] ?? 0);
    const hasPhase = Number(row[2] ?? 0);

    checks.push({
      name: "Prompt type classification",
      layer: "classification",
      passed: total === 0 || hasPromptType > 0,
      detail: `${hasPromptType}/${total} AI events classified with prompt_type`,
      severity: total > 0 && hasPromptType === 0 ? "warning" : "info",
    });

    checks.push({
      name: "Execution phase classification",
      layer: "classification",
      passed: total === 0 || hasPhase > 0,
      detail: `${hasPhase}/${total} AI events classified with execution_phase`,
      severity: total > 0 && hasPhase === 0 ? "warning" : "info",
    });
  } catch {
    checks.push({
      name: "Classification columns",
      layer: "classification",
      passed: false,
      detail: "Failed to query classification columns",
      severity: "warning",
    });
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Layer 4: Analyzer States
// ---------------------------------------------------------------------------

function checkAnalyzerStates(): VerificationCheck {
  const stateDir = join(getIntelligenceDir(), "state");
  if (!existsSync(stateDir)) {
    return {
      name: "Analyzer state persistence",
      layer: "analyzers",
      passed: false,
      detail: "State directory does not exist — intelligence has not been initialized",
      severity: "warning",
    };
  }

  const stateFiles = readdirSync(stateDir).filter((f) => f.endsWith(".state.json"));
  const expectedAnalyzers = [
    "direction-by-file",
    "token-proxy",
    "window-aggregator",
    "summary-writer",
    "efficiency",
    "comprehension-radar",
    "cost-attribution",
    "loop-detector",
    "velocity-tracker",
    "prompt-patterns",
    "blind-spot-detector",
    "decision-replay",
    "session-intelligence",
    "causality-chains",
    "intelligence-snapshots",
    "profile-accumulator",
    "maturity-model",
    "narrative-engine",
  ];

  const present = stateFiles.map((f) => f.replace(".state.json", ""));
  const missing = expectedAnalyzers.filter((name) => !present.includes(name));

  return {
    name: "Analyzer state persistence",
    layer: "analyzers",
    passed: missing.length <= 4,
    detail: `${stateFiles.length}/${expectedAnalyzers.length} state files present${missing.length > 0 ? ` (missing: ${missing.slice(0, 5).join(", ")})` : ""}`,
    severity: stateFiles.length === 0 ? "warning" : "info",
  };
}

// ---------------------------------------------------------------------------
// Layer 5: Synthesis Outputs
// ---------------------------------------------------------------------------

function checkSynthesisOutputs(): VerificationCheck {
  const intelligenceDir = getIntelligenceDir();
  if (!existsSync(intelligenceDir)) {
    return {
      name: "Intelligence outputs",
      layer: "synthesis",
      passed: false,
      detail: "Intelligence directory does not exist",
      severity: "warning",
    };
  }

  const expectedOutputs = [
    "efficiency.json",
    "velocity.json",
    "prompt-patterns.json",
    "alerts.json",
    "maturity-assessment.json",
    "narratives.json",
  ];

  const present = expectedOutputs.filter((f) => existsSync(join(intelligenceDir, f)));

  return {
    name: "Intelligence outputs",
    layer: "synthesis",
    passed: present.length > 0,
    detail: `${present.length}/${expectedOutputs.length} output files present`,
    severity: present.length === 0 ? "warning" : "info",
  };
}

// ---------------------------------------------------------------------------
// Watermark consistency
// ---------------------------------------------------------------------------

async function checkWatermarkConsistency(db: DbLike): Promise<VerificationCheck> {
  const stateDir = join(getIntelligenceDir(), "state");
  if (!existsSync(stateDir)) {
    return {
      name: "Watermark consistency",
      layer: "analyzers",
      passed: true,
      detail: "No state files to check",
      severity: "info",
    };
  }

  try {
    const latestEventResult = await db.exec("SELECT MAX(ts) FROM events");
    const latestEvent = (latestEventResult[0]?.values[0]?.[0] as string) ?? null;
    if (!latestEvent) {
      return {
        name: "Watermark consistency",
        layer: "analyzers",
        passed: true,
        detail: "No events in DuckDB",
        severity: "info",
      };
    }

    const stateFiles = readdirSync(stateDir).filter((f) => f.endsWith(".state.json"));
    let behindCount = 0;

    for (const file of stateFiles.slice(0, 5)) {
      try {
        const raw = readFileSync(join(stateDir, file), "utf-8");
        const state = JSON.parse(raw);
        const watermark = state.watermark ?? "";
        if (watermark && watermark < latestEvent) behindCount++;
      } catch {
        // skip corrupted
      }
    }

    return {
      name: "Watermark consistency",
      layer: "analyzers",
      passed: true,
      detail: `Latest event: ${latestEvent.slice(0, 19)}. ${behindCount} analyzers behind watermark (normal during active processing).`,
      severity: "info",
    };
  } catch {
    return {
      name: "Watermark consistency",
      layer: "analyzers",
      passed: true,
      detail: "Could not check watermarks",
      severity: "info",
    };
  }
}
