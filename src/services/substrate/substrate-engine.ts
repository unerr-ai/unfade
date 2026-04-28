// SubstrateEngine — CozoDB semantic substrate with evidence-linked entity exploration.
//
// IP-7.1: SubstrateQueries interface — entitiesByDomain, findPath, hubEntities, crossValidatedEntities
// IP-7.2: evidenceEventIds in EntityContribution flow
// Sprint SUB-H: Datalog injection prevention, batch ingestion, error recovery.

import type { CozoDb } from "cozo-node";
import { logger } from "../../utils/logger.js";
import { mergeIntoExisting, resolveContributions } from "./entity-resolver.js";
import { PropagationEngine } from "./propagation-rules.js";
import type { EntityLifecycle, EntityType, RelationshipType } from "./schema.js";

// ─── Public Interfaces ──────────────────────────────────────────────────────

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
  evidenceEventIds?: string[];
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

// ─── IP-7.1: Entity With Evidence ───────────────────────────────────────────

export interface EntityWithEvidence {
  id: string;
  name: string;
  type: string;
  domain: string;
  evidenceEventIds: string[];
  engagement: number;
}

export interface GraphPath {
  nodes: string[];
  edges: Array<{ src: string; dst: string; type: string; weight: number }>;
  length: number;
}

export interface SubstrateQueries {
  entitiesByDomain(domain: string, limit?: number): Promise<EntityWithEvidence[]>;
  findPath(fromEntity: string, toEntity: string): Promise<GraphPath | null>;
  hubEntities(limit?: number): Promise<EntityWithEvidence[]>;
  crossValidatedEntities(limit?: number): Promise<EntityWithEvidence[]>;
}

// ─── Datalog String Escaping ────────────────────────────────────────────────

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

// ─── SubstrateEngine ────────────────────────────────────────────────────────

const CONFIDENCE_PER_SOURCE = 0.15;

export class SubstrateEngine implements SubstrateQueries {
  private propagationEngine: PropagationEngine;

  constructor(private readonly db: CozoDb) {
    this.propagationEngine = new PropagationEngine();
  }

  // ─── IP-7.1: SubstrateQueries Implementation ─────────────────────────────

  async entitiesByDomain(domain: string, limit = 20): Promise<EntityWithEvidence[]> {
    const escaped = escCozo(domain);

    const result = await this.query(`
      ?[id, type, state, confidence] :=
        *entity{id, type, state, confidence, lifecycle},
        lifecycle != 'archived',
        is_in(state, name_key),
        name_key = 'name'
      :limit ${limit}
    `);

    if (result.rows.length === 0) {
      const fallback = await this.query(`
        ?[id, type, state, confidence] :=
          *entity{id, type, state, confidence, lifecycle},
          lifecycle != 'archived'
        :limit ${limit * 2}
      `);
      return this.rowsToEntitiesWithEvidence(fallback.rows, domain);
    }

    return this.rowsToEntitiesWithEvidence(result.rows, domain);
  }

  async findPath(fromEntity: string, toEntity: string): Promise<GraphPath | null> {
    const from = escCozo(fromEntity);
    const to = escCozo(toEntity);

    const result = await this.query(`
      path[node, dist, prev] :=
        node = '${from}', dist = 0, prev = ''
      path[node, dist, prev] :=
        path[mid, d, _], d < 10,
        *edge{src: mid, dst: node},
        dist = d + 1, prev = mid,
        not path[node, _, _]

      ?[node, dist, prev] := path[node, dist, prev], node = '${to}'
      :limit 1
    `);

    if (result.rows.length === 0) return null;

    const pathResult = await this.query(`
      path[node, dist] :=
        node = '${from}', dist = 0
      path[node, dist] :=
        path[mid, d], d < 10,
        *edge{src: mid, dst: node},
        dist = d + 1,
        not path[node, _]

      ?[src, dst, type, weight] :=
        path[src, d1], path[dst, d2], d2 = d1 + 1,
        *edge{src, dst, type, weight}
      :order d1
      :limit 20
    `);

    const nodes = new Set<string>();
    const edges: GraphPath["edges"] = [];

    for (const row of pathResult.rows) {
      const src = row[0] as string;
      const dst = row[1] as string;
      nodes.add(src);
      nodes.add(dst);
      edges.push({
        src,
        dst,
        type: row[2] as string,
        weight: row[3] as number,
      });
    }

    if (edges.length === 0) return null;

    return {
      nodes: Array.from(nodes),
      edges,
      length: edges.length,
    };
  }

  async hubEntities(limit = 10): Promise<EntityWithEvidence[]> {
    const result = await this.query(`
      degree[id, cnt] := *edge{src: id}, cnt = count(id)
      degree[id, cnt] := *edge{dst: id}, cnt = count(id)

      ?[id, type, state, confidence, deg] :=
        degree[id, deg],
        *entity{id, type, state, confidence, lifecycle},
        lifecycle != 'archived'
      :order -deg
      :limit ${limit}
    `);

    return result.rows.map((row) => {
      const state = this.parseState(row[2]);
      return {
        id: row[0] as string,
        name: (state.name as string) ?? (row[0] as string),
        type: row[1] as string,
        domain: (state.domain as string) ?? "general",
        evidenceEventIds: this.extractEvidenceFromState(state),
        engagement: row[4] as number,
      };
    });
  }

  async crossValidatedEntities(limit = 10): Promise<EntityWithEvidence[]> {
    const result = await this.query(`
      multi_source[eid, cnt] :=
        *entity_source{entity_id: eid, analyzer},
        cnt = count(analyzer)

      ?[id, type, state, confidence, source_count] :=
        multi_source[id, source_count],
        source_count >= 2,
        *entity{id, type, state, confidence, lifecycle},
        lifecycle != 'archived'
      :order -source_count
      :limit ${limit}
    `);

    return result.rows.map((row) => {
      const state = this.parseState(row[2]);
      return {
        id: row[0] as string,
        name: (state.name as string) ?? (row[0] as string),
        type: row[1] as string,
        domain: (state.domain as string) ?? "general",
        evidenceEventIds: this.extractEvidenceFromState(state),
        engagement: row[4] as number,
      };
    });
  }

  // ─── Evidence Extraction Helpers ──────────────────────────────────────────

  private async rowsToEntitiesWithEvidence(
    rows: unknown[][],
    domainFilter: string,
  ): Promise<EntityWithEvidence[]> {
    const results: EntityWithEvidence[] = [];
    const lowerDomain = domainFilter.toLowerCase();

    for (const row of rows) {
      const id = row[0] as string;
      const state = this.parseState(row[2]);
      const name = (state.name as string) ?? id;
      const domain = (state.domain as string) ?? "general";

      const matches =
        id.toLowerCase().includes(lowerDomain) ||
        name.toLowerCase().includes(lowerDomain) ||
        domain.toLowerCase().includes(lowerDomain);

      if (!matches) continue;

      const evidenceEventIds = await this.collectEntityEvidence(id);

      results.push({
        id,
        name,
        type: row[1] as string,
        domain,
        evidenceEventIds,
        engagement: (state.mentionCount as number) ?? (state.evidenceCount as number) ?? 1,
      });
    }

    results.sort((a, b) => b.engagement - a.engagement);
    return results;
  }

  private async collectEntityEvidence(entityId: string): Promise<string[]> {
    const eventIds = new Set<string>();

    try {
      const factResult = await this.query(
        `?[episode] := *fact{subject_id: '${escCozo(entityId)}', source_episode: episode}, episode != ''`,
      );
      for (const row of factResult.rows) {
        eventIds.add(row[0] as string);
      }
    } catch { /* fact relation may be empty */ }

    try {
      const objFactResult = await this.query(
        `?[episode] := *fact{object_id: '${escCozo(entityId)}', source_episode: episode}, episode != ''`,
      );
      for (const row of objFactResult.rows) {
        eventIds.add(row[0] as string);
      }
    } catch { /* non-fatal */ }

    return Array.from(eventIds);
  }

  private parseState(raw: unknown): Record<string, unknown> {
    if (typeof raw === "string") {
      try { return JSON.parse(raw); } catch { return {}; }
    }
    return (raw as Record<string, unknown>) ?? {};
  }

  private extractEvidenceFromState(state: Record<string, unknown>): string[] {
    const ids: string[] = [];
    if (Array.isArray(state.evidenceEventIds)) {
      for (const id of state.evidenceEventIds) {
        if (typeof id === "string") ids.push(id);
      }
    }
    return ids;
  }

  // ─── Core: Ingest + Propagate ─────────────────────────────────────────────

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
        const mergedState = { ...entity.mergedState };

        const allEvidenceIds = new Set<string>();
        for (const contrib of contributions) {
          if (contrib.entityId === entity.entityId && contrib.evidenceEventIds) {
            for (const id of contrib.evidenceEventIds) allEvidenceIds.add(id);
          }
        }
        if (allEvidenceIds.size > 0) {
          mergedState.evidenceEventIds = Array.from(allEvidenceIds);
        }

        const confidence = Math.min(1, 0.3 + entity.sources.length * CONFIDENCE_PER_SOURCE);

        await this.upsertEntity(
          entity.entityId,
          entity.entityType,
          entity.projectId,
          mergedState,
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

  // ─── Core: Query ──────────────────────────────────────────────────────────

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
      state: this.parseState(row[1]),
      confidence: row[2] as number,
    }));
  }

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

  // ─── Private: Entity Upsert ───────────────────────────────────────────────

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
      const existingState = this.parseState(existing[0]);
      mergedState = mergeIntoExisting(existingState, state);
      createdAt = existing[1] as number;
      lifecycle = existing[2] as EntityLifecycle;

      if (lifecycle === "emerging" && confidence >= 0.5) lifecycle = "established";
      if (lifecycle === "established" && confidence >= 0.7) lifecycle = "confirmed";
    }

    const _safeState = safeJsonForDatalog(mergedState);

    await this.db.run(
      `?[id, type, project_id, created_at, last_updated, confidence, lifecycle, state] <- [
        ['${eid}', '${escCozo(type)}', '${escCozo(projectId)}', ${createdAt}, ${now}, ${confidence}, '${lifecycle}', ${JSON.stringify(mergedState)}]
      ]
      :put entity {id, type, project_id, created_at, last_updated, confidence, lifecycle => state}`,
    );
  }

  // ─── Private: Source Tracking ─────────────────────────────────────────────

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

  // ─── Private: Edge Upserts ────────────────────────────────────────────────

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
