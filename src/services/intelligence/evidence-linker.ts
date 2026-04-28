// FILE: src/services/intelligence/evidence-linker.ts
// Layer 4 IP-1.2: Evidence linker — builds per-metric evidence chains from analyzer outputs.
//
// Three responsibilities:
//   1. Per-metric grouping — groups sourceEventIds by sub-metric dimension
//   2. Cross-analyzer merging — merges evidence from multiple analyzers for correlations
//   3. Evidence persistence — writes/reads per-analyzer evidence JSON files
//
// Every metric, diagnostic, and correlation in the UI can drill down to source events.
// This module provides the data for that drill-down.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EvidenceChain, EvidenceEntry } from "../../schemas/intelligence-presentation.js";
import { logger } from "../../utils/logger.js";
import type { DbLike } from "../cache/manager.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface EvidenceLinkerConfig {
  intelligenceDir: string;
  analytics: DbLike;
}

/** Analyzer output shape expected by the evidence linker. */
export interface AnalyzerOutputWithEvidence {
  /** Sub-metric breakdowns with associated event IDs. */
  metrics?: Array<{
    name: string;
    scope?: string;
    value: number;
    sourceEventIds?: string[];
  }>;
  /** Global source event IDs (when no sub-metric breakdown exists). */
  sourceEventIds?: string[];
  /** Analyzer confidence level. */
  confidence?: number;
}

// ─── Build Evidence Chains ──────────────────────────────────────────────────

/**
 * Build evidence chains for a single analyzer's output.
 * Groups source events by sub-metric dimension, enriches with DuckDB metadata.
 */
export async function buildEvidenceChains(
  analyzerName: string,
  output: AnalyzerOutputWithEvidence,
  config: EvidenceLinkerConfig,
): Promise<EvidenceChain[]> {
  const chains: EvidenceChain[] = [];

  if (output.metrics && output.metrics.length > 0) {
    for (const metric of output.metrics) {
      const eventIds = metric.sourceEventIds ?? [];
      if (eventIds.length === 0) continue;

      const events = await enrichEventIds(eventIds, metric.value, config.analytics);

      chains.push({
        metric: metric.name,
        scope: metric.scope,
        events,
        analyzers: [analyzerName],
        confidence: output.confidence ?? 0.5,
      });
    }
  } else if (output.sourceEventIds && output.sourceEventIds.length > 0) {
    const events = await enrichEventIds(output.sourceEventIds, 1.0, config.analytics);

    chains.push({
      metric: analyzerName,
      events,
      analyzers: [analyzerName],
      confidence: output.confidence ?? 0.5,
    });
  }

  return chains;
}

// ─── Merge Evidence Chains ──────────────────────────────────────────────────

/**
 * Merge evidence chains from multiple analyzers into a cross-analyzer chain.
 * Deduplicates shared events, preserves highest contribution score per event.
 */
export function mergeEvidenceChains(
  chains: EvidenceChain[],
  correlationType: string,
): EvidenceChain {
  const eventMap = new Map<string, EvidenceEntry>();
  const allAnalyzers = new Set<string>();
  let totalConfidence = 0;

  for (const chain of chains) {
    for (const analyzer of chain.analyzers) allAnalyzers.add(analyzer);
    totalConfidence += chain.confidence;

    for (const event of chain.events) {
      const existing = eventMap.get(event.eventId);
      if (!existing || event.contribution > existing.contribution) {
        eventMap.set(event.eventId, event);
      }
    }
  }

  const events = Array.from(eventMap.values())
    .sort((a, b) => b.contribution - a.contribution);

  return {
    metric: correlationType,
    events,
    analyzers: Array.from(allAnalyzers),
    confidence: chains.length > 0 ? totalConfidence / chains.length : 0,
  };
}

// ─── Persistence ────────────────────────────────────────────────────────────

/**
 * Persist evidence chains to disk.
 * File: ~/.unfade/intelligence/evidence/<analyzerName>.json
 */
export async function writeEvidenceFile(
  analyzerName: string,
  chains: EvidenceChain[],
  intelligenceDir: string,
): Promise<void> {
  try {
    const evidenceDir = join(intelligenceDir, "evidence");
    if (!existsSync(evidenceDir)) mkdirSync(evidenceDir, { recursive: true });

    const path = join(evidenceDir, `${analyzerName}.json`);
    writeFileSync(path, JSON.stringify(chains, null, 2), "utf-8");
  } catch (err) {
    logger.debug("Failed to write evidence file", {
      analyzer: analyzerName,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Load evidence chains for a specific analyzer (served by API on demand).
 */
export async function loadEvidenceFile(
  analyzerName: string,
  intelligenceDir: string,
): Promise<EvidenceChain[]> {
  try {
    const path = join(intelligenceDir, "evidence", `${analyzerName}.json`);
    if (!existsSync(path)) return [];
    return JSON.parse(readFileSync(path, "utf-8")) as EvidenceChain[];
  } catch {
    return [];
  }
}

/**
 * Build and persist evidence for all analyzers in a single pass.
 * Called by the scheduler after each DAG run (Phase 6).
 */
export async function buildAndPersistAllEvidence(
  analyzerOutputs: Map<string, AnalyzerOutputWithEvidence>,
  config: EvidenceLinkerConfig,
): Promise<{ analyzersProcessed: number; chainsBuilt: number }> {
  let analyzersProcessed = 0;
  let chainsBuilt = 0;

  for (const [name, output] of analyzerOutputs) {
    try {
      const chains = await buildEvidenceChains(name, output, config);
      if (chains.length > 0) {
        await writeEvidenceFile(name, chains, config.intelligenceDir);
        chainsBuilt += chains.length;
      }
      analyzersProcessed++;
    } catch (err) {
      logger.debug("Evidence building failed for analyzer", {
        analyzer: name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { analyzersProcessed, chainsBuilt };
}

// ─── Event Enrichment ───────────────────────────────────────────────────────

/**
 * Enrich event IDs with metadata from DuckDB for display in evidence chains.
 * Gracefully handles missing events (pruned, not yet materialized).
 */
async function enrichEventIds(
  eventIds: string[],
  metricValue: number,
  analytics: DbLike,
): Promise<EvidenceEntry[]> {
  if (eventIds.length === 0) return [];

  try {
    const placeholders = eventIds.map((_, i) => `$${i + 1}`).join(", ");
    const result = await analytics.exec(
      `SELECT id, ts, source, type, content_summary
       FROM events
       WHERE id IN (${placeholders})`,
      eventIds,
    );

    const rows = result[0]?.values ?? [];
    const eventMap = new Map<string, EvidenceEntry>();

    for (const row of rows) {
      const id = row[0] as string;
      eventMap.set(id, {
        eventId: id,
        timestamp: String(row[1] ?? ""),
        source: (row[2] as string) ?? "",
        type: (row[3] as string) ?? "",
        summary: (row[4] as string) ?? "",
        contribution: 0,
        role: "context",
      });
    }

    const totalEvents = eventIds.length;
    return eventIds
      .map((id, i) => {
        const entry = eventMap.get(id);
        if (!entry) return null;

        const position = i / totalEvents;
        entry.contribution = Math.round((1 - position * 0.5) * metricValue * 100) / 100;
        entry.role = i === 0 ? "primary" : i < 3 ? "corroborating" : "context";

        return entry;
      })
      .filter((e): e is EvidenceEntry => e !== null);
  } catch {
    return eventIds.map((id, i) => ({
      eventId: id,
      timestamp: "",
      source: "",
      type: "",
      summary: "",
      contribution: i === 0 ? metricValue : metricValue * 0.5,
      role: i === 0 ? ("primary" as const) : ("context" as const),
    }));
  }
}
