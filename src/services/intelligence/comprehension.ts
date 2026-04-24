// FILE: src/services/intelligence/comprehension.ts
// UF-217: Comprehension proxy scorer — measures how deeply a developer engaged
// with AI-generated output before shipping it.
// composite = mod_depth * 0.4 + specificity * 0.3 + rejection * 0.3
// Signals derived from Phase 5.5 §5.2 heuristic metadata on CaptureEvents.

interface DirectionSignals {
  human_direction_score?: number;
  rejection_count?: number;
  prompt_specificity?: number;
  modification_after_accept?: boolean;
  domain_injection?: boolean;
  alternative_evaluation?: boolean;
  course_correction?: boolean;
}

interface ComprehensionInput {
  eventId: string;
  source: string;
  metadata: Record<string, unknown> | undefined;
}

export interface ComprehensionScore {
  eventId: string;
  projectId?: string;
  modDepth: number;
  specificity: number;
  rejection: number;
  score: number;
}

/**
 * Compute comprehension proxy for a single AI-session event.
 * Returns null for non-AI events (no comprehension signal applicable).
 */
export function computeComprehension(input: ComprehensionInput): ComprehensionScore | null {
  if (input.source !== "ai-session" && input.source !== "mcp-active") return null;

  const signals = (input.metadata?.direction_signals ?? {}) as DirectionSignals;

  const modDepth = computeModDepth(signals);
  const specificity = signals.prompt_specificity ?? 0;
  const rejection = computeRejectionSignal(signals);

  const score = modDepth * 0.4 + specificity * 0.3 + rejection * 0.3;

  return {
    eventId: input.eventId,
    modDepth: round3(modDepth),
    specificity: round3(specificity),
    rejection: round3(rejection),
    score: round3(score),
  };
}

/**
 * Batch-compute comprehension for multiple events.
 * Filters to AI-session events only; returns scored entries.
 */
export function computeComprehensionBatch(events: ComprehensionInput[]): ComprehensionScore[] {
  const results: ComprehensionScore[] = [];
  for (const e of events) {
    const score = computeComprehension(e);
    if (score) results.push(score);
  }
  return results;
}

/**
 * Insert comprehension scores into the SQLite cache.
 */
export function upsertComprehensionScores(
  db: { run(sql: string, params?: unknown[]): void },
  scores: ComprehensionScore[],
): void {
  for (const s of scores) {
    db.run(
      `INSERT OR REPLACE INTO comprehension_proxy (event_id, project_id, mod_depth, specificity, rejection, score)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [s.eventId, s.projectId ?? "", s.modDepth, s.specificity, s.rejection, s.score],
    );
  }
}

function computeModDepth(signals: DirectionSignals): number {
  let depth = 0;

  if (signals.modification_after_accept) depth += 0.4;
  if (signals.course_correction) depth += 0.3;
  if (signals.domain_injection) depth += 0.2;
  if (signals.alternative_evaluation) depth += 0.1;

  return Math.min(depth, 1.0);
}

function computeRejectionSignal(signals: DirectionSignals): number {
  const rejections = signals.rejection_count ?? 0;

  if (rejections >= 3) return 1.0;
  if (rejections >= 2) return 0.7;
  if (rejections >= 1) return 0.4;
  return 0;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// UF-233: Per-module comprehension aggregation
// ---------------------------------------------------------------------------

export interface ModuleComprehension {
  module: string;
  score: number;
  eventCount: number;
}

/**
 * Aggregate comprehension scores by module (top-2 directory levels).
 * Queries the events + comprehension_proxy tables joined.
 */
export async function aggregateComprehensionByModule(db: {
  run(sql: string, params?: unknown[]): void;
  exec(
    sql: string,
  ):
    | Array<{ columns: string[]; values: unknown[][] }>
    | Promise<Array<{ columns: string[]; values: unknown[][] }>>;
}): Promise<ModuleComprehension[]> {
  const now = new Date().toISOString();

  try {
    const result = await db.exec(`
      SELECT
        e.content_detail,
        e.content_summary,
        cp.score,
        e.metadata
      FROM comprehension_proxy cp
      INNER JOIN events e ON cp.event_id = e.id
      WHERE e.source IN ('ai-session', 'mcp-active')
    `);

    if (!result[0]?.values.length) return [];

    const moduleScores = new Map<string, { total: number; count: number }>();

    for (const row of result[0].values) {
      const detail = (row[0] as string) ?? "";
      const summary = (row[1] as string) ?? "";
      const score = row[2] as number;
      const metadataStr = (row[3] as string) ?? "{}";

      // Try text-based module extraction first
      let module = extractModule(`${summary} ${detail}`);

      // Fallback: use files_referenced / files_modified from metadata
      if (module === "general") {
        try {
          const meta = typeof metadataStr === "string" ? JSON.parse(metadataStr) : metadataStr;
          const files: string[] = [
            ...((meta.files_referenced as string[]) ?? []),
            ...((meta.files_modified as string[]) ?? []),
          ];
          if (files.length > 0) {
            module = extractModule(files.join(" "));
          }
        } catch {
          // metadata parse failed — stay with "general"
        }
      }

      const entry = moduleScores.get(module) ?? { total: 0, count: 0 };
      entry.total += score;
      entry.count++;
      moduleScores.set(module, entry);
    }

    const modules: ModuleComprehension[] = [];
    for (const [module, data] of moduleScores) {
      const avgScore = Math.round((data.total / data.count) * 100);
      modules.push({ module, score: avgScore, eventCount: data.count });

      db.run(
        `INSERT OR REPLACE INTO comprehension_by_module (module, project_id, score, event_count, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        [module, "", avgScore, data.count, now],
      );
    }

    return modules.sort((a, b) => b.eventCount - a.eventCount);
  } catch {
    return [];
  }
}

/**
 * Read per-module comprehension from DB (fast path for API/MCP).
 */
export async function readModuleComprehension(db: {
  exec(
    sql: string,
  ):
    | Array<{ columns: string[]; values: unknown[][] }>
    | Promise<Array<{ columns: string[]; values: unknown[][] }>>;
}): Promise<ModuleComprehension[]> {
  try {
    const result = await db.exec(
      "SELECT module, score, event_count FROM comprehension_by_module ORDER BY event_count DESC",
    );
    if (!result[0]?.values.length) return [];

    return result[0].values.map((row) => ({
      module: row[0] as string,
      score: row[1] as number,
      eventCount: row[2] as number,
    }));
  } catch {
    return [];
  }
}

/**
 * Extract a module path from text content (top-2 directory levels).
 * e.g., "src/services/auth/login.ts" → "src/services/auth"
 */
function extractModule(text: string): string {
  const filePattern = /(?:^|\s|['"`(])([a-zA-Z0-9_./-]+\/[a-zA-Z0-9_./-]+\.[a-zA-Z]{1,5})/g;
  const modules = new Map<string, number>();

  for (const match of text.matchAll(filePattern)) {
    const filePath = match[1];
    const parts = filePath.split("/");
    const module =
      parts.length >= 3 ? parts.slice(0, 3).join("/") : parts.slice(0, -1).join("/") || "root";
    modules.set(module, (modules.get(module) ?? 0) + 1);
  }

  if (modules.size === 0) return "general";

  let best = "general";
  let bestCount = 0;
  for (const [mod, count] of modules) {
    if (count > bestCount) {
      best = mod;
      bestCount = count;
    }
  }
  return best;
}
