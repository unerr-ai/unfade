// FILE: src/services/intelligence/cross-project.ts
// Cross-project intelligence — compares analyzer states across multiple
// registered projects to surface transferable patterns, expertise gaps,
// efficiency discrepancies, and methodology drift. Read-only: never
// modifies per-project state (federated intelligence model).

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { logger } from "../../utils/logger.js";
import { getIntelligenceDir } from "../../utils/paths.js";
import type { IncrementalState } from "./incremental-state.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CrossProjectInsightType =
  | "pattern-transfer"
  | "domain-expertise"
  | "efficiency-gap"
  | "methodology-drift";

export interface CrossProjectInsight {
  type: CrossProjectInsightType;
  projects: string[];
  insight: string;
  actionable: boolean;
  confidence: number;
  evidence: Array<{ project: string; metric: string; value: unknown }>;
}

export interface CrossProjectReport {
  insights: CrossProjectInsight[];
  projectsAnalyzed: number;
  computedAt: string;
}

// ---------------------------------------------------------------------------
// State loading (federated read-only)
// ---------------------------------------------------------------------------

interface ProjectSnapshot {
  projectId: string;
  efficiency?: { aes?: number; output?: { aes?: number } };
  loopDetector?: { output?: { stuckLoops?: unknown[] } };
  windowAggregator?: {
    windows?: Record<string, { directionDensity?: number; eventCount?: number }>;
  };
  promptPatterns?: {
    output?: {
      effectivePatterns?: Array<{ domain?: string; pattern?: string; acceptanceRate?: number }>;
    };
  };
  velocityTracker?: { output?: { byDomain?: Record<string, { trend?: string }> } };
  comprehensionRadar?: { output?: { overall?: number } };
  maturityModel?: { currentPhase?: number; dimensions?: Array<{ name: string; score: number }> };
}

function loadProjectStates(): ProjectSnapshot[] {
  const projects: ProjectSnapshot[] = [];

  try {
    const registryPath = join(getUserStateDir(), "registry.v1.json");
    if (!existsSync(registryPath)) return loadSingleProjectFallback();

    const registry = JSON.parse(readFileSync(registryPath, "utf-8")) as {
      repos?: Array<{ id: string; label: string }>;
    };

    if (!registry.repos || registry.repos.length === 0) return loadSingleProjectFallback();

    const stateDir = join(getIntelligenceDir(), "state");
    if (!existsSync(stateDir)) return [];

    const analyzerStates = loadAnalyzerStates(stateDir);
    if (analyzerStates.size === 0) return [];

    for (const repo of registry.repos) {
      projects.push(buildSnapshot(repo.id, analyzerStates));
    }

    if (projects.length < 2) {
      return loadSingleProjectFallback();
    }
  } catch {
    return loadSingleProjectFallback();
  }

  return projects;
}

function loadSingleProjectFallback(): ProjectSnapshot[] {
  try {
    const stateDir = join(getIntelligenceDir(), "state");
    if (!existsSync(stateDir)) return [];

    const analyzerStates = loadAnalyzerStates(stateDir);
    if (analyzerStates.size === 0) return [];

    return [buildSnapshot("default", analyzerStates)];
  } catch {
    return [];
  }
}

function loadAnalyzerStates(stateDir: string): Map<string, Record<string, unknown>> {
  const analyzerStates = new Map<string, Record<string, unknown>>();
  const stateFiles = readdirSync(stateDir).filter((f) => f.endsWith(".state.json"));

  for (const file of stateFiles) {
    try {
      const name = file.replace(".state.json", "");
      const raw = readFileSync(join(stateDir, file), "utf-8");
      const parsed = JSON.parse(raw);
      analyzerStates.set(name, parsed.value ?? parsed);
    } catch {
      // skip corrupted state files
    }
  }

  return analyzerStates;
}

function buildSnapshot(
  projectId: string,
  analyzerStates: Map<string, Record<string, unknown>>,
): ProjectSnapshot {
  return {
    projectId,
    efficiency: analyzerStates.get("efficiency") as ProjectSnapshot["efficiency"],
    loopDetector: analyzerStates.get("loop-detector") as ProjectSnapshot["loopDetector"],
    windowAggregator: analyzerStates.get(
      "window-aggregator",
    ) as ProjectSnapshot["windowAggregator"],
    promptPatterns: analyzerStates.get("prompt-patterns") as ProjectSnapshot["promptPatterns"],
    velocityTracker: analyzerStates.get("velocity-tracker") as ProjectSnapshot["velocityTracker"],
    comprehensionRadar: analyzerStates.get(
      "comprehension-radar",
    ) as ProjectSnapshot["comprehensionRadar"],
    maturityModel: analyzerStates.get("maturity-model") as ProjectSnapshot["maturityModel"],
  };
}

function getUserStateDir(): string {
  const { join: joinPath } = require("node:path") as typeof import("node:path");
  const home = process.env.UNFADE_HOME ?? joinPath(require("node:os").homedir(), ".unfade");
  return joinPath(home, "state");
}

// ---------------------------------------------------------------------------
// Insight computation
// ---------------------------------------------------------------------------

export async function computeCrossProjectInsights(
  projectStatesOverride?: Map<string, Map<string, IncrementalState<unknown>>>,
): Promise<CrossProjectInsight[]> {
  const insights: CrossProjectInsight[] = [];

  const snapshots = projectStatesOverride
    ? snapshotsFromOverride(projectStatesOverride)
    : loadProjectStates();

  if (snapshots.length < 1) return [];

  try {
    insights.push(...detectPatternTransfers(snapshots));
    insights.push(...detectEfficiencyGaps(snapshots));
    insights.push(...detectDomainExpertise(snapshots));
    insights.push(...detectMethodologyDrift(snapshots));
  } catch (err) {
    logger.debug("Cross-project insight computation failed (non-fatal)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return insights.sort((a, b) => b.confidence - a.confidence).slice(0, 20);
}

function snapshotsFromOverride(
  states: Map<string, Map<string, IncrementalState<unknown>>>,
): ProjectSnapshot[] {
  const snapshots: ProjectSnapshot[] = [];
  for (const [projectId, analyzerStates] of states) {
    const snapshot: ProjectSnapshot = { projectId };
    for (const [name, state] of analyzerStates) {
      const val = state.value as Record<string, unknown>;
      switch (name) {
        case "efficiency":
          snapshot.efficiency = val;
          break;
        case "loop-detector":
          snapshot.loopDetector = val;
          break;
        case "window-aggregator":
          snapshot.windowAggregator = val;
          break;
        case "prompt-patterns":
          snapshot.promptPatterns = val;
          break;
        case "velocity-tracker":
          snapshot.velocityTracker = val;
          break;
        case "comprehension-radar":
          snapshot.comprehensionRadar = val;
          break;
        case "maturity-model":
          snapshot.maturityModel = val;
          break;
      }
    }
    snapshots.push(snapshot);
  }
  return snapshots;
}

// ---------------------------------------------------------------------------
// Pattern transfer detection
// ---------------------------------------------------------------------------

function detectPatternTransfers(snapshots: ProjectSnapshot[]): CrossProjectInsight[] {
  const insights: CrossProjectInsight[] = [];

  for (let i = 0; i < snapshots.length; i++) {
    for (let j = i + 1; j < snapshots.length; j++) {
      const a = snapshots[i];
      const b = snapshots[j];

      const aPatterns = a.promptPatterns?.output?.effectivePatterns ?? [];
      const bPatterns = b.promptPatterns?.output?.effectivePatterns ?? [];

      for (const pattern of aPatterns) {
        if (!pattern.domain || !pattern.pattern) continue;
        const bHasSameDomain = bPatterns.some((bp) => bp.domain === pattern.domain);
        const bHasSamePattern = bPatterns.some((bp) => bp.pattern === pattern.pattern);

        if (bHasSameDomain && !bHasSamePattern && (pattern.acceptanceRate ?? 0) > 0.6) {
          insights.push({
            type: "pattern-transfer",
            projects: [a.projectId, b.projectId],
            insight: `"${pattern.pattern}" works well in ${a.projectId} (${pattern.domain}) — consider applying it to ${b.projectId}`,
            actionable: true,
            confidence: Math.min(0.9, (pattern.acceptanceRate ?? 0.5) * 1.2),
            evidence: [
              { project: a.projectId, metric: "effective-pattern", value: pattern.pattern },
              { project: a.projectId, metric: "acceptance-rate", value: pattern.acceptanceRate },
            ],
          });
        }
      }
    }
  }

  return insights;
}

// ---------------------------------------------------------------------------
// Efficiency gap detection
// ---------------------------------------------------------------------------

function detectEfficiencyGaps(snapshots: ProjectSnapshot[]): CrossProjectInsight[] {
  const insights: CrossProjectInsight[] = [];

  const projectAES = snapshots
    .map((s) => ({
      project: s.projectId,
      aes: s.efficiency?.output?.aes ?? s.efficiency?.aes ?? null,
    }))
    .filter((p): p is { project: string; aes: number } => p.aes !== null);

  if (projectAES.length < 2) return insights;

  projectAES.sort((a, b) => b.aes - a.aes);
  const best = projectAES[0];
  const worst = projectAES[projectAES.length - 1];

  if (best.aes - worst.aes > 15) {
    insights.push({
      type: "efficiency-gap",
      projects: [best.project, worst.project],
      insight: `${best.project} has ${best.aes - worst.aes} points higher AI efficiency than ${worst.project}. Investigate what makes ${best.project} more effective.`,
      actionable: true,
      confidence: Math.min(0.85, (best.aes - worst.aes) / 50),
      evidence: [
        { project: best.project, metric: "AES", value: best.aes },
        { project: worst.project, metric: "AES", value: worst.aes },
      ],
    });
  }

  return insights;
}

// ---------------------------------------------------------------------------
// Domain expertise detection
// ---------------------------------------------------------------------------

function detectDomainExpertise(snapshots: ProjectSnapshot[]): CrossProjectInsight[] {
  const insights: CrossProjectInsight[] = [];

  const allDomains = new Map<string, Array<{ project: string; trend: string }>>();

  for (const snap of snapshots) {
    const byDomain = snap.velocityTracker?.output?.byDomain ?? {};
    for (const [domain, data] of Object.entries(byDomain)) {
      const arr = allDomains.get(domain) ?? [];
      arr.push({ project: snap.projectId, trend: data.trend ?? "stable" });
      allDomains.set(domain, arr);
    }
  }

  for (const [domain, projectEntries] of allDomains) {
    if (projectEntries.length < 2) continue;
    const accelerating = projectEntries.filter((p) => p.trend === "accelerating");
    const decelerating = projectEntries.filter((p) => p.trend === "decelerating");

    if (accelerating.length > 0 && decelerating.length > 0) {
      insights.push({
        type: "domain-expertise",
        projects: [...accelerating.map((p) => p.project), ...decelerating.map((p) => p.project)],
        insight: `${domain}: velocity accelerating in ${accelerating.map((p) => p.project).join(", ")} but decelerating in ${decelerating.map((p) => p.project).join(", ")}. Cross-pollinate techniques.`,
        actionable: true,
        confidence: 0.65,
        evidence: projectEntries.map((p) => ({
          project: p.project,
          metric: `${domain}-velocity-trend`,
          value: p.trend,
        })),
      });
    }
  }

  return insights;
}

// ---------------------------------------------------------------------------
// Methodology drift detection
// ---------------------------------------------------------------------------

function detectMethodologyDrift(snapshots: ProjectSnapshot[]): CrossProjectInsight[] {
  const insights: CrossProjectInsight[] = [];

  const phaseScores = snapshots
    .map((s) => ({
      project: s.projectId,
      phase: s.maturityModel?.currentPhase ?? null,
      direction: s.maturityModel?.dimensions?.find((d) => d.name === "direction")?.score ?? null,
      loopResilience:
        s.maturityModel?.dimensions?.find((d) => d.name === "loop-resilience")?.score ?? null,
    }))
    .filter((p) => p.phase !== null);

  if (phaseScores.length < 2) return insights;

  for (let i = 0; i < phaseScores.length; i++) {
    for (let j = i + 1; j < phaseScores.length; j++) {
      const a = phaseScores[i];
      const b = phaseScores[j];

      if (a.direction != null && b.direction != null && Math.abs(a.direction - b.direction) > 0.3) {
        const higher = a.direction > b.direction ? a : b;
        const lower = a.direction > b.direction ? b : a;
        insights.push({
          type: "methodology-drift",
          projects: [higher.project, lower.project],
          insight: `Direction scores diverging: ${higher.project} at ${Math.round(higher.direction! * 100)}% vs ${lower.project} at ${Math.round(lower.direction! * 100)}%. Methodology drift may indicate different AI interaction habits forming.`,
          actionable: true,
          confidence: Math.min(0.8, Math.abs(a.direction! - b.direction!) * 2),
          evidence: [
            { project: higher.project, metric: "direction-score", value: higher.direction },
            { project: lower.project, metric: "direction-score", value: lower.direction },
          ],
        });
      }
    }
  }

  return insights;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export function writeCrossProjectReport(report: CrossProjectReport): void {
  try {
    const dir = getIntelligenceDir();
    mkdirSync(dir, { recursive: true });
    const target = join(dir, "cross-project-insights.json");
    const tmp = `${target}.tmp.${process.pid}`;
    writeFileSync(tmp, JSON.stringify(report, null, 2), "utf-8");
    renameSync(tmp, target);
  } catch (err) {
    logger.debug("Failed to write cross-project report", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function readCrossProjectReport(): CrossProjectReport | null {
  try {
    const path = join(getIntelligenceDir(), "cross-project-insights.json");
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8")) as CrossProjectReport;
  } catch {
    return null;
  }
}

/**
 * Full pipeline: compute insights + write report. Called from repo-manager
 * after the DAG scheduler + substrate complete.
 */
export async function runCrossProjectIntelligence(): Promise<CrossProjectReport> {
  const insights = await computeCrossProjectInsights();
  const report: CrossProjectReport = {
    insights,
    projectsAnalyzed: 1,
    computedAt: new Date().toISOString(),
  };
  writeCrossProjectReport(report);
  return report;
}
