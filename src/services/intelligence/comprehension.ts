// FILE: src/services/intelligence/comprehension.ts
// Layer 2.5: Comprehension data access layer.
// Reads from comprehension_assessment (DuckDB) and domain_comprehension tables
// populated by the knowledge extraction pipeline.
// Replaces the old heuristic proxy (mod_depth/specificity/rejection).

export interface ModuleComprehension {
  module: string;
  score: number;
  eventCount: number;
}

export interface ComprehensionOverview {
  overallScore: number | null;
  assessmentCount: number;
  domainScores: Array<{
    domain: string;
    currentScore: number;
    stability: number;
    interactionCount: number;
    lastTouch: string | null;
  }>;
}

type DbLike = {
  exec(
    sql: string,
    params?: unknown[],
  ):
    | Array<{ columns: string[]; values: unknown[][] }>
    | Promise<Array<{ columns: string[]; values: unknown[][] }>>;
};

/**
 * Read comprehension overview from the knowledge extraction tables.
 * Returns domain-level scores from domain_comprehension and the latest
 * overall assessment score.
 */
export async function readComprehensionOverview(
  analyticsDb: DbLike,
  projectId?: string,
): Promise<ComprehensionOverview> {
  try {
    // Get latest overall score from comprehension_assessment
    const overallResult = await analyticsDb.exec(
      `SELECT overall_score, COUNT(*) as cnt
       FROM comprehension_assessment
       ${projectId ? "WHERE project_id = ?" : ""}
       GROUP BY 1 ORDER BY timestamp DESC LIMIT 1`,
      projectId ? [projectId] : undefined,
    );

    const overallScore =
      overallResult[0]?.values.length ? (overallResult[0].values[0][0] as number) : null;
    const assessmentCount =
      overallResult[0]?.values.length ? (overallResult[0].values[0][1] as number) : 0;

    // Get domain-level scores from domain_comprehension
    const domainResult = await analyticsDb.exec(
      `SELECT domain, current_score, stability, interaction_count, last_touch
       FROM domain_comprehension
       ${projectId ? "WHERE project_id = ?" : ""}
       ORDER BY interaction_count DESC`,
      projectId ? [projectId] : undefined,
    );

    const domainScores = (domainResult[0]?.values ?? []).map((row) => ({
      domain: row[0] as string,
      currentScore: row[1] as number,
      stability: row[2] as number,
      interactionCount: row[3] as number,
      lastTouch: row[4] as string | null,
    }));

    return { overallScore, assessmentCount, domainScores };
  } catch {
    return { overallScore: null, assessmentCount: 0, domainScores: [] };
  }
}

/**
 * Read per-module comprehension from domain_comprehension table.
 * Maps domain→module for backward compat with callers expecting ModuleComprehension[].
 */
export async function readModuleComprehension(db: DbLike): Promise<ModuleComprehension[]> {
  try {
    const result = await db.exec(
      "SELECT domain, current_score, interaction_count FROM domain_comprehension ORDER BY interaction_count DESC",
    );
    if (!result[0]?.values.length) return [];

    return result[0].values.map((row) => ({
      module: row[0] as string,
      score: Math.round(row[1] as number),
      eventCount: row[2] as number,
    }));
  } catch {
    return [];
  }
}
