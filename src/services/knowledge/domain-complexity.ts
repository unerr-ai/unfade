// FILE: src/services/knowledge/domain-complexity.ts
// Layer 2.5 KE-15.3: Domain complexity inference.
// Heuristic computation of a complexity modifier (0.5 – 1.5) that modulates
// how fast comprehension decays for a given domain. Complex domains
// (distributed systems, many deps) decay faster; simple utilities decay slower.
//
// Signals used (§9):
//   - Interaction count (from domain_comprehension — proxy for scope)
//   - Average engagement quality (from domain_comprehension)
//   - Fact count for this domain (from CozoDB entity relationships)
//   - Decision density (facts with decision predicates / total facts)
//
// Returns: 0.5 (distributed-system) → 0.7 (complex) → 1.0 (standard) → 1.5 (simple)

import type { CozoDb } from "cozo-node";
import { logger } from "../../utils/logger.js";
import type { DbLike } from "../cache/manager.js";

// ─── Complexity Bands (§9) ──────────────────────────────────────────────────

const COMPLEXITY_SIMPLE = 1.5;
const COMPLEXITY_STANDARD = 1.0;
const COMPLEXITY_COMPLEX = 0.7;
const COMPLEXITY_DISTRIBUTED = 0.5;

// ─── CozoDB Escaping ────────────────────────────────────────────────────────

function escCozo(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Infer the complexity modifier for a domain based on available signals.
 *
 * Returns a value between 0.5 (very complex, fast decay) and 1.5 (simple, slow decay).
 * Updates the domain_comprehension.complexity_modifier column.
 */
export async function inferDomainComplexity(
  domain: string,
  projectId: string,
  analytics: DbLike,
  cozo: CozoDb,
): Promise<number> {
  const signals = await gatherComplexitySignals(domain, projectId, analytics, cozo);
  const modifier = computeModifier(signals);

  await updateComplexityModifier(domain, projectId, modifier, analytics);

  return modifier;
}

/**
 * Batch-infer complexity for all active domains in a project.
 * Called during daily distill pipeline.
 */
export async function inferAllDomainComplexities(
  projectId: string,
  analytics: DbLike,
  cozo: CozoDb,
): Promise<Map<string, number>> {
  const results = new Map<string, number>();

  try {
    const domainResult = await analytics.exec(
      `SELECT DISTINCT domain FROM domain_comprehension WHERE project_id = $1`,
      [projectId],
    );

    const domains = (domainResult[0]?.values ?? []).map((r) => r[0] as string);

    for (const domain of domains) {
      const modifier = await inferDomainComplexity(domain, projectId, analytics, cozo);
      results.set(domain, modifier);
    }
  } catch (err) {
    logger.debug("Failed to batch-infer domain complexities", {
      projectId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return results;
}

// ─── Signal Gathering ───────────────────────────────────────────────────────

interface ComplexitySignals {
  interactionCount: number;
  avgEngagementQuality: number;
  factCount: number;
  decisionFactCount: number;
}

async function gatherComplexitySignals(
  domain: string,
  projectId: string,
  analytics: DbLike,
  cozo: CozoDb,
): Promise<ComplexitySignals> {
  const signals: ComplexitySignals = {
    interactionCount: 0,
    avgEngagementQuality: 3,
    factCount: 0,
    decisionFactCount: 0,
  };

  // DuckDB: interaction count and engagement quality
  try {
    const result = await analytics.exec(
      `SELECT interaction_count, engagement_quality
       FROM domain_comprehension
       WHERE domain = $1 AND project_id = $2`,
      [domain, projectId],
    );
    const row = result[0]?.values[0];
    if (row) {
      signals.interactionCount = (row[0] as number) ?? 0;
      signals.avgEngagementQuality = (row[1] as number) ?? 3;
    }
  } catch {
    // domain_comprehension may not have this domain yet
  }

  // CozoDB: count facts related to this domain
  try {
    const domainEsc = escCozo(domain);
    const factResult = await cozo.run(
      `?[count(id)] := *fact{id, context, invalid_at}, invalid_at = '', is_in(context, '${domainEsc}')`,
    );
    const rows = (factResult as { rows?: unknown[][] }).rows ?? [];
    if (rows.length > 0) {
      signals.factCount = (rows[0][0] as number) ?? 0;
    }
  } catch {
    // CozoDB query may fail if relations don't exist yet or context search not supported
    // Fall back to interaction-count-based heuristic
  }

  // CozoDB: count decision facts (predicates in the decision category)
  try {
    const domainEsc = escCozo(domain);
    const decisionResult = await cozo.run(
      `?[count(id)] := *fact{id, predicate, context, invalid_at},
        invalid_at = '',
        is_in(context, '${domainEsc}'),
        predicate in ['DECIDED', 'CHOSEN_OVER', 'REPLACED_BY', 'SWITCHED_FROM', 'ADOPTED', 'DEPRECATED']`,
    );
    const rows = (decisionResult as { rows?: unknown[][] }).rows ?? [];
    if (rows.length > 0) {
      signals.decisionFactCount = (rows[0][0] as number) ?? 0;
    }
  } catch {
    // Fall back gracefully
  }

  return signals;
}

// ─── Complexity Computation ─────────────────────────────────────────────────

function computeModifier(signals: ComplexitySignals): number {
  let complexityScore = 0;

  // Interaction count signal: more interactions = likely more complex
  if (signals.interactionCount >= 10) complexityScore += 3;
  else if (signals.interactionCount >= 5) complexityScore += 2;
  else if (signals.interactionCount >= 2) complexityScore += 1;

  // Fact count signal: more facts = more knowledge surface area
  if (signals.factCount >= 20) complexityScore += 3;
  else if (signals.factCount >= 10) complexityScore += 2;
  else if (signals.factCount >= 5) complexityScore += 1;

  // Decision density signal: more decisions = more complex trade-off space
  const decisionDensity = signals.factCount > 0
    ? signals.decisionFactCount / signals.factCount
    : 0;
  if (decisionDensity >= 0.3) complexityScore += 2;
  else if (decisionDensity >= 0.15) complexityScore += 1;

  // Low engagement quality with high interactions = developer struggles with it
  if (signals.avgEngagementQuality <= 2 && signals.interactionCount >= 3) {
    complexityScore += 1;
  }

  // Map score to modifier band
  if (complexityScore >= 7) return COMPLEXITY_DISTRIBUTED;
  if (complexityScore >= 5) return COMPLEXITY_COMPLEX;
  if (complexityScore >= 2) return COMPLEXITY_STANDARD;
  return COMPLEXITY_SIMPLE;
}

// ─── DuckDB Update ──────────────────────────────────────────────────────────

async function updateComplexityModifier(
  domain: string,
  projectId: string,
  modifier: number,
  analytics: DbLike,
): Promise<void> {
  try {
    await analytics.exec(
      `UPDATE domain_comprehension
       SET complexity_modifier = $1, updated_at = CURRENT_TIMESTAMP
       WHERE domain = $2 AND project_id = $3`,
      [modifier, domain, projectId],
    );
  } catch (err) {
    logger.debug("Failed to update complexity modifier", {
      domain,
      modifier,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
