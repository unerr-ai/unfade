// FILE: src/services/substrate/entity-mapper.ts
// Maps analyzer state into graph EntityContributions.
// Runs after the DAG scheduler completes, reading from DuckDB to produce
// work-unit and feature entities + edges for the SubstrateEngine.

import type { DbLike } from "../cache/manager.js";
import type { EntityContribution } from "./substrate-engine.js";

/**
 * Produce work-unit entities from recently materialized sessions.
 * Reads the DuckDB sessions table for sessions updated in the last hour.
 */
export async function mapSessionsToWorkUnits(
  db: DbLike,
  projectId: string,
): Promise<EntityContribution[]> {
  const contributions: EntityContribution[] = [];

  try {
    const result = await db.exec(`
      SELECT id, start_ts, end_ts, event_count, turn_count, outcome,
             estimated_cost, execution_phases, branch, domain, feature_id, avg_hds
      FROM sessions
      WHERE updated_at >= now() - INTERVAL '1 hour'
      LIMIT 100
    `);

    if (!result[0]?.values.length) return [];

    for (const row of result[0].values) {
      const sessionId = row[0] as string;
      if (!sessionId) continue;

      const featureId = (row[10] as string) ?? null;
      const relationships: EntityContribution["relationships"] = [];

      if (featureId) {
        relationships.push({
          targetEntityId: `feat-${featureId}`,
          type: "targets",
          weight: 1.0,
          evidence: "session-feature-link",
        });
      }

      const phases = ((row[7] as string) ?? "").split(",").filter(Boolean);
      const dominantPhase = phases[0] ?? "unknown";

      contributions.push({
        entityId: `wu-${sessionId}`,
        entityType: "work-unit",
        projectId,
        analyzerName: "session-materializer",
        stateFragment: {
          sessionId,
          startTs: (row[1] as string) ?? "",
          endTs: (row[2] as string) ?? "",
          eventCount: (row[3] as number) ?? 0,
          turnCount: (row[4] as number) ?? 0,
          outcome: (row[5] as string) ?? null,
          estimatedCost: (row[6] as number) ?? 0,
          phase: dominantPhase,
          branch: (row[8] as string) ?? null,
          domain: (row[9] as string) ?? null,
          avgHds: (row[11] as number) ?? null,
        },
        relationships,
      });
    }
  } catch {
    // non-fatal
  }

  return contributions;
}

/**
 * Produce feature entities from the DuckDB feature_registry table.
 */
export async function mapFeaturesToEntities(
  db: DbLike,
  projectId: string,
): Promise<EntityContribution[]> {
  const contributions: EntityContribution[] = [];

  try {
    const result = await db.exec(
      `
      SELECT id, name, module_path, source, event_count, parent_id
      FROM feature_registry
      WHERE project_id = $1 OR project_id = ''
      LIMIT 200`,
      [projectId],
    );

    if (!result[0]?.values.length) return [];

    for (const row of result[0].values) {
      const featId = row[0] as string;
      const parentId = (row[5] as string) ?? null;
      const relationships: EntityContribution["relationships"] = [];

      if (parentId) {
        relationships.push({
          targetEntityId: `feat-${parentId}`,
          type: "depends-on",
          weight: 0.5,
          evidence: "parent-feature",
        });
      }

      contributions.push({
        entityId: `feat-${featId}`,
        entityType: "feature",
        projectId,
        analyzerName: "feature-registry",
        stateFragment: {
          name: (row[1] as string) ?? "",
          modulePath: (row[2] as string) ?? "",
          source: (row[3] as string) ?? "",
          eventCount: (row[4] as number) ?? 0,
        },
        relationships,
      });
    }
  } catch {
    // non-fatal
  }

  return contributions;
}

/**
 * Produce decision entities from the DuckDB decisions table.
 */
export async function mapDecisionsToEntities(
  db: DbLike,
  projectId: string,
): Promise<EntityContribution[]> {
  const contributions: EntityContribution[] = [];

  try {
    const result = await db.exec(
      `
      SELECT id, date, domain, description, rationale, alternatives_count, hds, direction_class
      FROM decisions
      WHERE project_id = $1 OR project_id = ''
      ORDER BY date DESC
      LIMIT 50`,
      [projectId],
    );

    if (!result[0]?.values.length) return [];

    for (const row of result[0].values) {
      const decId = row[0] as string;

      contributions.push({
        entityId: `dec-${decId}`,
        entityType: "decision",
        projectId,
        analyzerName: "decision-durability",
        stateFragment: {
          date: (row[1] as string) ?? "",
          domain: (row[2] as string) ?? "general",
          description: (row[3] as string) ?? "",
          rationale: (row[4] as string) ?? "",
          alternativesCount: (row[5] as number) ?? 0,
          hds: (row[6] as number) ?? 0,
          directionClass: (row[7] as string) ?? "",
        },
        relationships: [],
      });
    }
  } catch {
    // non-fatal
  }

  return contributions;
}

/**
 * Build all entity contributions for a full ingestion cycle.
 * Called by the substrate integration point in repo-manager.ts.
 */
export async function buildAllContributions(
  analyticsDb: DbLike,
  projectId: string,
): Promise<EntityContribution[]> {
  const [sessions, features, decisions] = await Promise.all([
    mapSessionsToWorkUnits(analyticsDb, projectId),
    mapFeaturesToEntities(analyticsDb, projectId),
    mapDecisionsToEntities(analyticsDb, projectId),
  ]);

  return [...sessions, ...features, ...decisions];
}
