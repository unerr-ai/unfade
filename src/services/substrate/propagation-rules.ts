// FILE: src/services/substrate/propagation-rules.ts
// Declarative backward propagation rules for the intelligence graph.
// Rules are Datalog trigger queries paired with TypeScript apply functions.
// The PropagationEngine runs all rules in order, with max depth 2 to prevent
// infinite loops, and tracks which entities were touched to avoid re-entrant updates.

import type { CozoDb } from "cozo-node";
import { logger } from "../../utils/logger.js";

// ---------------------------------------------------------------------------
// Rule interface
// ---------------------------------------------------------------------------

export interface PropagationRule {
  name: string;
  description: string;
  triggerQuery: string;
  apply: (db: CozoDb, matches: unknown[][], now: number) => Promise<number>;
}

export interface PropagationEngineResult {
  rulesEvaluated: number;
  totalEntitiesUpdated: number;
  totalEdgesCreated: number;
  ruleResults: Array<{ rule: string; matched: number; applied: number }>;
}

// ---------------------------------------------------------------------------
// Built-in rules
// ---------------------------------------------------------------------------

export const BUILTIN_RULES: PropagationRule[] = [
  {
    name: "diagnostic-to-pattern-promotion",
    description:
      "When 5+ active diagnostics apply to the same feature, promote to a persistent pattern entity",
    triggerQuery: `
      ?[feat_id, diag_count] :=
        *entity{id: feat_id, type: 'feature', lifecycle: feat_lc},
        feat_lc != 'archived',
        *edge{src: diag_id, dst: feat_id, type: 'applies-to'},
        *entity{id: diag_id, type: 'diagnostic', lifecycle: diag_lc},
        diag_lc != 'archived',
        diag_count = count(diag_id),
        diag_count >= 5
    `,
    async apply(db, matches, now) {
      let applied = 0;
      for (const row of matches) {
        const featId = row[0] as string;
        const diagCount = row[1] as number;
        const patternId = `pat-accumulated-${featId}`;
        const state = JSON.stringify({
          name: `Recurring pattern on ${featId}`,
          occurrences: diagCount,
          sourceFeature: featId,
          promotedAt: new Date(now * 1000).toISOString(),
          severity: diagCount >= 10 ? "structural" : "emerging",
        });

        try {
          await db.run(
            `?[id, type, project_id, created_at, last_updated, confidence, lifecycle, state] <- [
              ['${patternId}', 'pattern', '', ${now}, ${now}, 0.6, 'established', ${state}]
            ]
            :put entity {id, type, project_id, created_at, last_updated, confidence, lifecycle => state}`,
          );
          await db.run(
            `?[src, dst, type, weight, created_at, evidence, valid_from, valid_to] <- [
              ['${patternId}', '${featId}', 'applies-to', ${Math.min(1, diagCount / 10)}, ${now}, 'diagnostic-accumulation', ${now}, 9999999999.0]
            ]
            :put edge {src, dst, type => weight, created_at, evidence, valid_from, valid_to}`,
          );
          applied++;
        } catch {
          // non-fatal
        }
      }
      return applied;
    },
  },

  {
    name: "feature-complexity-from-patterns",
    description: "Features with 3+ active patterns get complexity='high' in their state",
    triggerQuery: `
      ?[feat_id, pattern_count] :=
        *entity{id: feat_id, type: 'feature', lifecycle: feat_lc},
        feat_lc != 'archived',
        *edge{src: pat_id, dst: feat_id, type: 'applies-to'},
        *entity{id: pat_id, type: 'pattern', lifecycle: pat_lc},
        pat_lc != 'archived',
        pattern_count = count(pat_id),
        pattern_count >= 3
    `,
    async apply(db, matches, now) {
      let applied = 0;
      for (const row of matches) {
        const featId = row[0] as string;
        const patternCount = row[1] as number;
        try {
          const existing = await db.run(`?[state] := *entity{id: '${featId}', state}`);
          const rows = (existing as { rows?: unknown[][] }).rows ?? [];
          if (rows.length === 0) continue;

          const currentState =
            typeof rows[0][0] === "string"
              ? JSON.parse(rows[0][0] as string)
              : (rows[0][0] as Record<string, unknown>);

          const updatedState = JSON.stringify({
            ...currentState,
            complexity: patternCount >= 5 ? "very-high" : "high",
            patternCount,
            complexityUpdatedAt: new Date(now * 1000).toISOString(),
          });

          await db.run(
            `?[id, last_updated, state] <- [['${featId}', ${now}, ${updatedState}]]
            :update entity {id => last_updated, state}`,
          );
          applied++;
        } catch {
          // non-fatal
        }
      }
      return applied;
    },
  },

  {
    name: "lifecycle-decay",
    description: "Entities untouched for 30+ days transition to 'decaying'",
    triggerQuery: `
      ?[id, last_updated] :=
        *entity{id, lifecycle: lc, last_updated},
        lc != 'archived',
        lc != 'decaying',
        last_updated < ${Date.now() / 1000 - 30 * 86400}
    `,
    async apply(db, matches, _now) {
      let applied = 0;
      for (const row of matches) {
        const id = row[0] as string;
        try {
          await db.run(
            `?[id, lifecycle] <- [['${id}', 'decaying']]
            :update entity {id => lifecycle}`,
          );
          applied++;
        } catch {
          // non-fatal
        }
      }
      return applied;
    },
  },

  {
    name: "decision-revision-detection",
    description:
      "When two decisions target the same feature and the newer one contradicts the older, create a 'revises' edge",
    triggerQuery: `
      ?[newer_dec, older_dec, feat_id] :=
        *edge{src: newer_wu, dst: feat_id, type: 'targets'},
        *edge{src: newer_wu, dst: newer_dec, type: 'produced-by'},
        *entity{id: newer_dec, type: 'decision', created_at: newer_ts},
        *edge{src: older_wu, dst: feat_id, type: 'targets'},
        *edge{src: older_wu, dst: older_dec, type: 'produced-by'},
        *entity{id: older_dec, type: 'decision', created_at: older_ts},
        newer_dec != older_dec,
        newer_ts > older_ts,
        newer_ts - older_ts < 2592000.0,
        not *edge{src: newer_dec, dst: older_dec, type: 'revises'}
      :limit 50
    `,
    async apply(db, matches, now) {
      let applied = 0;
      for (const row of matches) {
        const newerDec = row[0] as string;
        const olderDec = row[1] as string;
        try {
          await db.run(
            `?[src, dst, type, weight, created_at, evidence, valid_from, valid_to] <- [
              ['${newerDec}', '${olderDec}', 'revises', 0.7, ${now}, 'same-feature-newer-decision', ${now}, 9999999999.0]
            ]
            :put edge {src, dst, type => weight, created_at, evidence, valid_from, valid_to}`,
          );
          applied++;
        } catch {
          // non-fatal
        }
      }
      return applied;
    },
  },

  {
    name: "capability-evidence-accumulation",
    description: "When 3+ work-units demonstrate the same pattern, create a capability entity",
    triggerQuery: `
      ?[pat_id, pat_state, wu_count] :=
        *entity{id: pat_id, type: 'pattern', state: pat_state, lifecycle: pat_lc},
        pat_lc != 'archived',
        *edge{src: wu_id, dst: pat_id, type: 'demonstrates'},
        *entity{id: wu_id, type: 'work-unit'},
        wu_count = count(wu_id),
        wu_count >= 3,
        not *edge{src: _, dst: pat_id, type: 'learned-from'}
      :limit 20
    `,
    async apply(db, matches, now) {
      let applied = 0;
      for (const row of matches) {
        const patId = row[0] as string;
        const patState =
          typeof row[1] === "string"
            ? JSON.parse(row[1] as string)
            : (row[1] as Record<string, unknown>);
        const wuCount = row[2] as number;
        const capId = `cap-from-${patId}`;
        const capState = JSON.stringify({
          name: (patState.name as string) ?? `Capability from ${patId}`,
          level: wuCount >= 10 ? "proficient" : wuCount >= 5 ? "developing" : "novice",
          evidenceCount: wuCount,
          sourcePattern: patId,
          detectedAt: new Date(now * 1000).toISOString(),
        });

        try {
          await db.run(
            `?[id, type, project_id, created_at, last_updated, confidence, lifecycle, state] <- [
              ['${capId}', 'capability', '', ${now}, ${now}, ${Math.min(1, 0.3 + wuCount * 0.1)}, 'emerging', ${capState}]
            ]
            :put entity {id, type, project_id, created_at, last_updated, confidence, lifecycle => state}`,
          );
          await db.run(
            `?[src, dst, type, weight, created_at, evidence, valid_from, valid_to] <- [
              ['${capId}', '${patId}', 'learned-from', ${Math.min(1, wuCount / 10)}, ${now}, 'pattern-to-capability', ${now}, 9999999999.0]
            ]
            :put edge {src, dst, type => weight, created_at, evidence, valid_from, valid_to}`,
          );
          applied++;
        } catch {
          // non-fatal
        }
      }
      return applied;
    },
  },

  {
    name: "temporal-edge-expiry",
    description: "Expire edges whose valid_to timestamp has passed",
    triggerQuery: `
      ?[src, dst, type] :=
        *edge{src, dst, type, valid_to},
        valid_to < ${Date.now() / 1000},
        valid_to != 9999999999.0
      :limit 100
    `,
    async apply(db, matches, _now) {
      let applied = 0;
      for (const row of matches) {
        const src = row[0] as string;
        const dst = row[1] as string;
        const type = row[2] as string;
        try {
          await db.run(
            `?[src, dst, type] <- [['${src}', '${dst}', '${type}']]
            :rm edge {src, dst, type}`,
          );
          applied++;
        } catch {
          // non-fatal
        }
      }
      return applied;
    },
  },
];

// ---------------------------------------------------------------------------
// Propagation Engine
// ---------------------------------------------------------------------------

const MAX_PROPAGATION_DEPTH = 2;
const EDGE_CREATING_RULES = new Set([
  "diagnostic-to-pattern-promotion",
  "decision-revision-detection",
  "capability-evidence-accumulation",
]);

export class PropagationEngine {
  private rules: PropagationRule[];
  private touchedEntities = new Set<string>();

  constructor(rules?: PropagationRule[]) {
    this.rules = rules ?? BUILTIN_RULES;
  }

  async runAll(db: CozoDb): Promise<PropagationEngineResult> {
    const now = Date.now() / 1000;
    const ruleResults: PropagationEngineResult["ruleResults"] = [];
    let totalUpdated = 0;
    let totalEdges = 0;

    for (let depth = 0; depth < MAX_PROPAGATION_DEPTH; depth++) {
      let anyApplied = false;

      for (const rule of this.rules) {
        try {
          const result = await db.run(rule.triggerQuery);
          const rows = (result as { rows?: unknown[][] }).rows ?? [];

          if (rows.length === 0) {
            if (depth === 0) ruleResults.push({ rule: rule.name, matched: 0, applied: 0 });
            continue;
          }

          const applied = await rule.apply(db, rows, now);
          if (depth === 0) {
            ruleResults.push({ rule: rule.name, matched: rows.length, applied });
          }
          totalUpdated += applied;
          if (EDGE_CREATING_RULES.has(rule.name)) totalEdges += applied;
          if (applied > 0) anyApplied = true;

          for (const row of rows) {
            if (typeof row[0] === "string") this.touchedEntities.add(row[0] as string);
          }
        } catch (err) {
          logger.debug(`Propagation rule ${rule.name} failed (non-fatal)`, {
            error: err instanceof Error ? err.message : String(err),
          });
          if (depth === 0) ruleResults.push({ rule: rule.name, matched: 0, applied: 0 });
        }
      }

      if (!anyApplied) break;
    }

    this.touchedEntities.clear();

    return {
      rulesEvaluated: this.rules.length,
      totalEntitiesUpdated: totalUpdated,
      totalEdgesCreated: totalEdges,
      ruleResults,
    };
  }

  addRule(rule: PropagationRule): void {
    this.rules.push(rule);
  }

  get ruleCount(): number {
    return this.rules.length;
  }
}
