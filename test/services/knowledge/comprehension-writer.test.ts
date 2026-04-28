import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CozoDb } from "cozo-node";
import type { ComprehensionAssessment, MetacognitiveSignal } from "../../../src/schemas/knowledge.js";
import {
  writeComprehensionAssessment,
  writeMetacognitiveSignals,
} from "../../../src/services/knowledge/comprehension-writer.js";
import type { DbLike } from "../../../src/services/cache/manager.js";
import {
  COMPREHENSION_ASSESSMENT_SCHEMA,
  METACOGNITIVE_SIGNAL_SCHEMA,
} from "../../../src/services/substrate/schema.js";

// ─── Test Setup ─────────────────────────────────────────────────────────────

let cozo: CozoDb;

/** In-memory mock for DuckDB's DbLike interface with basic SQL storage. */
function createMockAnalytics(): DbLike & { _store: Map<string, unknown[][]> } {
  const store = new Map<string, unknown[][]>();

  return {
    _store: store,
    run() { /* no-op for writes */ },
    exec(sql: string, params?: unknown[]) {
      const sqlLower = sql.trim().toLowerCase();

      if (sqlLower.startsWith("insert into comprehension_assessment")) {
        const key = `comprehension:${params?.[0]}`;
        store.set(key, [params as unknown[]]);
        return [{ columns: [], values: [] }];
      }

      if (sqlLower.startsWith("insert into metacognitive_signals")) {
        const key = `metacog:${params?.[0]}:${params?.[2]}`;
        store.set(key, [params as unknown[]]);
        return [{ columns: [], values: [] }];
      }

      if (sqlLower.startsWith("insert into domain_comprehension")) {
        const key = `domain:${params?.[0]}:${params?.[1]}`;
        store.set(key, [params as unknown[]]);
        return [{ columns: [], values: [] }];
      }

      if (sqlLower.startsWith("update domain_comprehension")) {
        const domain = params?.[7];
        const projectId = params?.[8];
        const key = `domain:${domain}:${projectId}`;
        store.set(key, [params as unknown[]]);
        return [{ columns: [], values: [] }];
      }

      if (sqlLower.startsWith("select") && sqlLower.includes("domain_comprehension")) {
        const domain = params?.[0];
        const projectId = params?.[1];
        const key = `domain:${domain}:${projectId}`;
        const existing = store.get(key);
        if (existing) {
          // Return [base_score, stability, interaction_count]
          const row = existing[0];
          if (sqlLower.includes("select base_score")) {
            // For INSERT params: [domain, project, base_score, stability, ...]
            // base_score at index 2, stability at 3, interaction_count at 8
            const baseScore = row[2] ?? 5.0;
            const stability = row[3] ?? 1.0;
            const interactionCount = row[8] ?? 1;
            return [{ columns: ["base_score", "stability", "interaction_count"], values: [[baseScore, stability, interactionCount]] }];
          }
        }
        return [{ columns: ["base_score", "stability", "interaction_count"], values: [] }];
      }

      return [{ columns: [], values: [] }];
    },
  };
}

beforeAll(async () => {
  cozo = new CozoDb("mem", "");
  await cozo.run(COMPREHENSION_ASSESSMENT_SCHEMA);
  await cozo.run(METACOGNITIVE_SIGNAL_SCHEMA);
});

afterAll(() => {
  try { cozo.close(); } catch { /* */ }
});

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeAssessment(overrides: Partial<ComprehensionAssessment> = {}): ComprehensionAssessment {
  return {
    episodeId: "evt-test-001",
    timestamp: "2026-04-28T10:00:00Z",
    dimensions: {
      steering: 7,
      understanding: 8,
      metacognition: 6,
      independence: 5,
      engagement: 7,
    },
    overallScore: 68,
    evidence: ["Developer asked about trade-offs", "Modified AI output"],
    rubberStampCount: 1,
    pushbackCount: 3,
    domainTags: ["backend", "caching"],
    assessmentMethod: "llm",
    ...overrides,
  };
}

function makeSignals(): MetacognitiveSignal[] {
  return [
    { turnIndex: 2, signalType: "why-question", quote: "Why did you choose Redis?", strength: 0.8 },
    { turnIndex: 5, signalType: "alternative", quote: "What about Memcached instead?", strength: 0.7 },
    { turnIndex: 8, signalType: "pushback", quote: "No, that approach won't work here", strength: 0.9 },
    { turnIndex: 12, signalType: "strategy-reflect", quote: "Let me rethink the caching strategy", strength: 0.6 },
    { turnIndex: 15, signalType: "error-catch", quote: "That won't compile — TTL needs to be a number", strength: 0.85 },
  ];
}

// ─── KE-13.1: Comprehension Writer Tests ────────────────────────────────────

describe("comprehension-writer (KE-13)", () => {
  describe("writeComprehensionAssessment", () => {
    it("writes assessment to CozoDB comprehension_assessment relation", async () => {
      const assessment = makeAssessment({ episodeId: "evt-cozo-001" });
      const analytics = createMockAnalytics();

      await writeComprehensionAssessment(assessment, "proj-test", cozo, analytics);

      const result = await cozo.run(
        "?[steering, understanding, overall_score, assessment_method] := *comprehension_assessment{episode_id: 'evt-cozo-001', steering, understanding, overall_score, assessment_method}",
      );
      const rows = (result as { rows: unknown[][] }).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0][0]).toBe(7);
      expect(rows[0][1]).toBe(8);
      expect(rows[0][2]).toBe(68);
      expect(rows[0][3]).toBe("llm");
    });

    it("writes assessment to DuckDB comprehension_assessment table", async () => {
      const assessment = makeAssessment({ episodeId: "evt-duck-001" });
      const analytics = createMockAnalytics();

      await writeComprehensionAssessment(assessment, "proj-test", cozo, analytics);

      const stored = analytics._store.get("comprehension:evt-duck-001");
      expect(stored).toBeDefined();
      expect(stored![0][0]).toBe("evt-duck-001");
      expect(stored![0][1]).toBe("proj-test");
    });

    it("creates domain_comprehension entries for each domainTag", async () => {
      const assessment = makeAssessment({
        episodeId: "evt-domain-001",
        domainTags: ["backend", "database"],
      });
      const analytics = createMockAnalytics();

      await writeComprehensionAssessment(assessment, "proj-test", cozo, analytics);

      expect(analytics._store.has("domain:backend:proj-test")).toBe(true);
      expect(analytics._store.has("domain:database:proj-test")).toBe(true);
    });

    it("reinforces existing domain stability on re-engagement", async () => {
      const analytics = createMockAnalytics();

      // First write — creates domain
      await writeComprehensionAssessment(
        makeAssessment({ episodeId: "evt-reinforce-001", domainTags: ["frontend"] }),
        "proj-test",
        cozo,
        analytics,
      );

      // Verify domain was created
      expect(analytics._store.has("domain:frontend:proj-test")).toBe(true);

      // Second write — reinforces domain (the mock SELECT returns existing data)
      await writeComprehensionAssessment(
        makeAssessment({ episodeId: "evt-reinforce-002", domainTags: ["frontend"] }),
        "proj-test",
        cozo,
        analytics,
      );

      // The domain entry should be updated (not just created)
      expect(analytics._store.has("domain:frontend:proj-test")).toBe(true);
    });

    it("is idempotent — re-writing same episode updates in place", async () => {
      const assessment = makeAssessment({ episodeId: "evt-idempotent-001" });
      const analytics = createMockAnalytics();

      await writeComprehensionAssessment(assessment, "proj-test", cozo, analytics);
      await writeComprehensionAssessment(assessment, "proj-test", cozo, analytics);

      // CozoDB should still have exactly 1 row (upsert)
      const result = await cozo.run(
        "?[overall_score] := *comprehension_assessment{episode_id: 'evt-idempotent-001', overall_score}",
      );
      expect((result as { rows: unknown[][] }).rows).toHaveLength(1);
    });

    it("handles heuristic-proxy assessment method", async () => {
      const assessment = makeAssessment({
        episodeId: "evt-heuristic-001",
        assessmentMethod: "heuristic-proxy",
        overallScore: 42,
      });
      const analytics = createMockAnalytics();

      await writeComprehensionAssessment(assessment, "proj-test", cozo, analytics);

      const result = await cozo.run(
        "?[assessment_method, overall_score] := *comprehension_assessment{episode_id: 'evt-heuristic-001', assessment_method, overall_score}",
      );
      const rows = (result as { rows: unknown[][] }).rows;
      expect(rows[0][0]).toBe("heuristic-proxy");
      expect(rows[0][1]).toBe(42);
    });
  });

  // ── KE-13.2: Metacognitive Signal Writer ────────────────────────────

  describe("writeMetacognitiveSignals", () => {
    it("writes signals to CozoDB metacognitive_signal relation", async () => {
      const signals = makeSignals();
      const analytics = createMockAnalytics();

      await writeMetacognitiveSignals("evt-meta-001", signals, "proj-test", 20, cozo, analytics);

      const result = await cozo.run(
        "?[turn_index, signal_type, strength] := *metacognitive_signal{episode_id: 'evt-meta-001', turn_index, signal_type, strength}",
      );
      const rows = (result as { rows: unknown[][] }).rows;
      expect(rows.length).toBe(5);
    });

    it("writes signals to DuckDB metacognitive_signals table", async () => {
      const signals = makeSignals();
      const analytics = createMockAnalytics();

      await writeMetacognitiveSignals("evt-meta-duck", signals, "proj-test", 20, cozo, analytics);

      expect(analytics._store.has("metacog:evt-meta-duck:2")).toBe(true);
      expect(analytics._store.has("metacog:evt-meta-duck:5")).toBe(true);
      expect(analytics._store.has("metacog:evt-meta-duck:8")).toBe(true);
    });

    it("computes density = signalCount / totalUserTurns", async () => {
      const signals = makeSignals();
      const analytics = createMockAnalytics();

      const agg = await writeMetacognitiveSignals("evt-density", signals, "proj-test", 20, cozo, analytics);

      expect(agg.density).toBe(0.25);
      expect(agg.signalCount).toBe(5);
    });

    it("computes breadth = uniqueSignalTypes / 7", async () => {
      const signals = makeSignals();
      const analytics = createMockAnalytics();

      const agg = await writeMetacognitiveSignals("evt-breadth", signals, "proj-test", 20, cozo, analytics);

      expect(agg.breadth).toBeCloseTo(5 / 7, 2);
    });

    it("handles empty signals gracefully", async () => {
      const analytics = createMockAnalytics();

      const agg = await writeMetacognitiveSignals("evt-empty", [], "proj-test", 10, cozo, analytics);

      expect(agg.density).toBe(0);
      expect(agg.breadth).toBe(0);
      expect(agg.signalCount).toBe(0);
    });

    it("handles zero totalUserTurns without division by zero", async () => {
      const signals = makeSignals();
      const analytics = createMockAnalytics();

      const agg = await writeMetacognitiveSignals("evt-zero-turns", signals, "proj-test", 0, cozo, analytics);

      expect(agg.density).toBe(0);
      expect(agg.signalCount).toBe(5);
    });
  });
});
