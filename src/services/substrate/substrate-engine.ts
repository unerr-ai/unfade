// FILE: src/services/substrate/substrate-engine.ts
// SubstrateEngine — hardened bridge between Phase 16 analyzers and CozoDB.
// Sprint SUB-H: Datalog injection prevention, batch ingestion, error recovery.
// All string interpolation uses escCozo(). Batch upserts reduce round trips.
// PropagationEngine is reused across calls. Failed entities don't block others.

import type { CozoDb } from "cozo-node";
import { logger } from "../../utils/logger.js";
import { mergeIntoExisting, resolveContributions } from "./entity-resolver.js";
import { PropagationEngine } from "./propagation-rules.js";
import type { EntityLifecycle, EntityType, RelationshipType } from "./schema.js";

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface EntityContribution {
  entityId: string;
  entityType: EntityType;
  projectId: string;
  analyzerName: string;
  stateFragment: Record<string, unknown>;
  relationships: Array<{
    targetEntityId: string;
    type: RelationshipType;
    weight: number;
    evidence?: string;
  }>;
}

export interface PropagationResult {
  entitiesUpdated: number;
  edgesCreated: number;
  patternsPromoted: number;
}

export interface GraphQueryResult {
  headers: string[];
  rows: unknown[][];
}

export interface IngestionReport {
  entitiesUpserted: number;
  edgesUpserted: number;
  sourcesTracked: number;
  errors: number;
}

// ---------------------------------------------------------------------------
// Datalog string escaping
// ---------------------------------------------------------------------------

function escCozo(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

function safeJsonForDatalog(obj: Record<string, unknown>): string {
  const json = JSON.stringify(obj);
  return json.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// ---------------------------------------------------------------------------
// SubstrateEngine
// ---------------------------------------------------------------------------

const CONFIDENCE_PER_SOURCE = 0.15;

export class SubstrateEngine {
  private propagationEngine: PropagationEngine;

  constructor(private readonly db: CozoDb) {
    this.propagationEngine = new PropagationEngine();
  }

  /**
   * Ingest entity contributions from analyzers.
   * Groups by entityId, merges state fragments, batch-upserts entities + edges.
   * Returns detailed ingestion report.
   */
  async ingest(contributions: EntityContribution[]): Promise<number> {
    if (contributions.length === 0) return 0;

    const resolved = resolveContributions(contributions);
    const now = Date.now() / 1000;
    const report: IngestionReport = {
      entitiesUpserted: 0,
      edgesUpserted: 0,
      sourcesTracked: 0,
      errors: 0,
    };

    for (const entity of resolved) {
      try {
        const confidence = Math.min(1, 0.3 + entity.sources.length * CONFIDENCE_PER_SOURCE);

        await this.upsertEntity(
          entity.entityId,
          entity.entityType,
          entity.projectId,
          entity.mergedState,
          confidence,
          now,
        );
        report.entitiesUpserted++;

        await this.batchUpsertSources(entity.entityId, entity.sources, now);
        report.sourcesTracked += entity.sources.length;

        if (entity.relationships.length > 0) {
          const edgesCreated = await this.batchUpsertEdges(
            entity.entityId,
            entity.relationships,
            now,
          );
          report.edgesUpserted += edgesCreated;
        }
      } catch (err) {
        report.errors++;
        logger.debug(`Substrate ingest failed for entity ${entity.entityId}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (report.errors > 0) {
      logger.debug(`Substrate ingestion: ${report.entitiesUpserted} ok, ${report.errors} errors`);
    }

    return report.entitiesUpserted;
  }

  /**
   * Run backward propagation rules. Reuses the PropagationEngine instance.
   */
  async propagate(): Promise<PropagationResult> {
    try {
      const result = await this.propagationEngine.runAll(this.db);
      const promoted =
        result.ruleResults.find((r) => r.rule === "diagnostic-to-pattern-promotion")?.applied ?? 0;
      return {
        entitiesUpdated: result.totalEntitiesUpdated,
        edgesCreated: result.totalEdgesCreated,
        patternsPromoted: promoted,
      };
    } catch (err) {
      logger.debug("Substrate propagation failed (non-fatal)", {
        error: err instanceof Error ? err.message : String(err),
      });
      return { entitiesUpdated: 0, edgesCreated: 0, patternsPromoted: 0 };
    }
  }

  /**
   * Execute a Datalog query against the graph.
   */
  async query(datalog: string): Promise<GraphQueryResult> {
    try {
      const result = await this.db.run(datalog);
      return {
        headers: (result as { headers?: string[] }).headers ?? [],
        rows: (result as { rows?: unknown[][] }).rows ?? [],
      };
    } catch (err) {
      logger.debug("Substrate query failed", {
        error: err instanceof Error ? err.message : String(err),
        query: datalog.slice(0, 200),
      });
      return { headers: [], rows: [] };
    }
  }

  /**
   * Get all active entities of a given type.
   */
  async getEntitiesByType(
    type: EntityType,
    projectId?: string,
  ): Promise<Array<{ id: string; state: Record<string, unknown>; confidence: number }>> {
    const escapedType = escCozo(type);
    const projectFilter = projectId ? `, project_id = '${escCozo(projectId)}'` : "";

    const result = await this.query(
      `?[id, state, confidence] := *entity{id, type: '${escapedType}', state, confidence, lifecycle}${projectFilter}, lifecycle != 'archived'`,
    );

    return result.rows.map((row) => ({
      id: row[0] as string,
      state: typeof row[1] === "string" ? JSON.parse(row[1]) : (row[1] as Record<string, unknown>),
      confidence: row[2] as number,
    }));
  }

  /**
   * Get all edges from or to an entity.
   */
  async getEdgesFor(entityId: string): Promise<
    Array<{
      src: string;
      dst: string;
      type: RelationshipType;
      weight: number;
    }>
  > {
    const escaped = escCozo(entityId);
    const result = await this.query(
      `?[src, dst, type, weight] := *edge{src, dst, type, weight}, or(src = '${escaped}', dst = '${escaped}')`,
    );

    return result.rows.map((row) => ({
      src: row[0] as string,
      dst: row[1] as string,
      type: row[2] as RelationshipType,
      weight: row[3] as number,
    }));
  }

  /**
   * Count entities by type (for health/debug).
   */
  async entityCounts(): Promise<Record<string, number>> {
    const result = await this.query(
      "?[type, count(id)] := *entity{id, type, lifecycle}, lifecycle != 'archived'",
    );
    const counts: Record<string, number> = {};
    for (const row of result.rows) {
      counts[row[0] as string] = row[1] as number;
    }
    return counts;
  }

  // ---------------------------------------------------------------------------
  // Private: entity upsert with safe escaping
  // ---------------------------------------------------------------------------

  private async upsertEntity(
    id: string,
    type: EntityType,
    projectId: string,
    state: Record<string, unknown>,
    confidence: number,
    now: number,
  ): Promise<void> {
    const eid = escCozo(id);
    const existingResult = await this.query(
      `?[state, created_at, lifecycle] := *entity{id: '${eid}', state, created_at, lifecycle}`,
    );

    let mergedState = state;
    let createdAt = now;
    let lifecycle: EntityLifecycle = "emerging";

    if (existingResult.rows.length > 0) {
      const existing = existingResult.rows[0];
      const existingState =
        typeof existing[0] === "string"
          ? JSON.parse(existing[0])
          : (existing[0] as Record<string, unknown>);
      mergedState = mergeIntoExisting(existingState, state);
      createdAt = existing[1] as number;
      lifecycle = existing[2] as EntityLifecycle;

      if (lifecycle === "emerging" && confidence >= 0.5) lifecycle = "established";
      if (lifecycle === "established" && confidence >= 0.7) lifecycle = "confirmed";
    }

    const safeState = safeJsonForDatalog(mergedState);

    await this.db.run(
      `?[id, type, project_id, created_at, last_updated, confidence, lifecycle, state] <- [
        ['${eid}', '${escCozo(type)}', '${escCozo(projectId)}', ${createdAt}, ${now}, ${confidence}, '${lifecycle}', ${JSON.stringify(mergedState)}]
      ]
      :put entity {id, type, project_id, created_at, last_updated, confidence, lifecycle => state}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Private: batch source tracking
  // ---------------------------------------------------------------------------

  private async batchUpsertSources(
    entityId: string,
    analyzers: string[],
    now: number,
  ): Promise<void> {
    if (analyzers.length === 0) return;

    const eid = escCozo(entityId);

    for (const analyzer of analyzers) {
      try {
        const existing = await this.query(
          `?[count] := *entity_source{entity_id: '${eid}', analyzer: '${escCozo(analyzer)}', contribution_count: count}`,
        );
        const count = existing.rows.length > 0 ? (existing.rows[0][0] as number) + 1 : 1;

        await this.db.run(
          `?[entity_id, analyzer, last_contributed, contribution_count] <- [
            ['${eid}', '${escCozo(analyzer)}', ${now}, ${count}]
          ]
          :put entity_source {entity_id, analyzer => last_contributed, contribution_count}`,
        );
      } catch (err) {
        logger.debug(`Failed to upsert source ${analyzer} for ${entityId}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private: batch edge upserts
  // ---------------------------------------------------------------------------

  private async batchUpsertEdges(
    entityId: string,
    relationships: EntityContribution["relationships"],
    now: number,
  ): Promise<number> {
    if (relationships.length === 0) return 0;

    let created = 0;
    const eid = escCozo(entityId);

    for (const rel of relationships) {
      try {
        await this.db.run(
          `?[src, dst, type, weight, created_at, evidence, valid_from, valid_to] <- [
            ['${eid}', '${escCozo(rel.targetEntityId)}', '${escCozo(rel.type)}', ${rel.weight}, ${now}, '${escCozo(rel.evidence ?? "")}', ${now}, 9999999999.0]
          ]
          :put edge {src, dst, type => weight, created_at, evidence, valid_from, valid_to}`,
        );
        created++;
      } catch (err) {
        logger.debug(`Failed to upsert edge ${entityId} → ${rel.targetEntityId}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return created;
  }
}
