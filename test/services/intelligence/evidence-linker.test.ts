import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildEvidenceChains,
  mergeEvidenceChains,
  writeEvidenceFile,
  loadEvidenceFile,
  buildAndPersistAllEvidence,
  type AnalyzerOutputWithEvidence,
  type EvidenceLinkerConfig,
} from "../../../src/services/intelligence/evidence-linker.js";
import type { EvidenceChain } from "../../../src/schemas/intelligence-presentation.js";
import type { DbLike } from "../../../src/services/cache/manager.js";

// ─── Mock Analytics ─────────────────────────────────────────────────────────

function createMockAnalytics(events: Array<{ id: string; ts: string; source: string; type: string; summary: string }>): DbLike {
  return {
    run() {},
    exec(sql: string, params?: unknown[]) {
      if (sql.includes("FROM events")) {
        const ids = new Set(params as string[]);
        const matched = events.filter((e) => ids.has(e.id));
        return [{
          columns: ["id", "ts", "source", "type", "content_summary"],
          values: matched.map((e) => [e.id, e.ts, e.source, e.type, e.summary]),
        }];
      }
      return [{ columns: [], values: [] }];
    },
  };
}

const mockEvents = [
  { id: "evt-1", ts: "2026-04-28T10:00:00Z", source: "ai-session", type: "ai-conversation", summary: "Discussed Redis caching" },
  { id: "evt-2", ts: "2026-04-28T11:00:00Z", source: "ai-session", type: "ai-conversation", summary: "Implemented auth module" },
  { id: "evt-3", ts: "2026-04-28T12:00:00Z", source: "git", type: "commit", summary: "feat: add Redis caching layer" },
  { id: "evt-4", ts: "2026-04-28T13:00:00Z", source: "ai-session", type: "ai-conversation", summary: "Debugged database connection" },
];

let tempDir: string;

function makeConfig(analytics?: DbLike): EvidenceLinkerConfig {
  tempDir = mkdtempSync(join(tmpdir(), "unfade-ip1-"));
  return {
    intelligenceDir: tempDir,
    analytics: analytics ?? createMockAnalytics(mockEvents),
  };
}

// ─── buildEvidenceChains Tests ──────────────────────────────────────────────

describe("evidence-linker (IP-1)", () => {
  describe("buildEvidenceChains", () => {
    it("builds chains from sub-metric breakdown", async () => {
      const output: AnalyzerOutputWithEvidence = {
        metrics: [
          { name: "direction-density", scope: "backend", value: 0.72, sourceEventIds: ["evt-1", "evt-2"] },
          { name: "direction-density", scope: "frontend", value: 0.45, sourceEventIds: ["evt-3"] },
        ],
        confidence: 0.8,
      };

      const config = makeConfig();
      const chains = await buildEvidenceChains("efficiency", output, config);

      expect(chains).toHaveLength(2);
      expect(chains[0].metric).toBe("direction-density");
      expect(chains[0].scope).toBe("backend");
      expect(chains[0].events).toHaveLength(2);
      expect(chains[0].analyzers).toEqual(["efficiency"]);
      expect(chains[0].confidence).toBe(0.8);
    });

    it("builds single chain from global sourceEventIds", async () => {
      const output: AnalyzerOutputWithEvidence = {
        sourceEventIds: ["evt-1", "evt-2", "evt-3"],
        confidence: 0.7,
      };

      const config = makeConfig();
      const chains = await buildEvidenceChains("loop-detector", output, config);

      expect(chains).toHaveLength(1);
      expect(chains[0].metric).toBe("loop-detector");
      expect(chains[0].events).toHaveLength(3);
    });

    it("assigns contribution scores and roles", async () => {
      const output: AnalyzerOutputWithEvidence = {
        sourceEventIds: ["evt-1", "evt-2", "evt-3", "evt-4"],
        confidence: 0.9,
      };

      const config = makeConfig();
      const chains = await buildEvidenceChains("efficiency", output, config);

      const events = chains[0].events;
      expect(events[0].role).toBe("primary");
      expect(events[1].role).toBe("corroborating");
      expect(events[2].role).toBe("corroborating");
      expect(events[3].role).toBe("context");
      expect(events[0].contribution).toBeGreaterThan(events[3].contribution);
    });

    it("enriches events with DuckDB metadata", async () => {
      const output: AnalyzerOutputWithEvidence = {
        sourceEventIds: ["evt-1"],
        confidence: 0.8,
      };

      const config = makeConfig();
      const chains = await buildEvidenceChains("test", output, config);

      expect(chains[0].events[0].summary).toBe("Discussed Redis caching");
      expect(chains[0].events[0].source).toBe("ai-session");
      expect(chains[0].events[0].type).toBe("ai-conversation");
    });

    it("returns empty chain for empty sourceEventIds", async () => {
      const output: AnalyzerOutputWithEvidence = { sourceEventIds: [] };
      const config = makeConfig();
      const chains = await buildEvidenceChains("test", output, config);
      expect(chains).toHaveLength(0);
    });

    it("gracefully handles events not found in DuckDB", async () => {
      const output: AnalyzerOutputWithEvidence = {
        sourceEventIds: ["evt-missing-1", "evt-missing-2"],
        confidence: 0.5,
      };

      const analytics = createMockAnalytics([]);
      const config = makeConfig(analytics);
      const chains = await buildEvidenceChains("test", output, config);

      expect(chains).toHaveLength(1);
      expect(chains[0].events).toHaveLength(0);
    });
  });

  // ── mergeEvidenceChains ─────────────────────────────────────────────

  describe("mergeEvidenceChains", () => {
    it("deduplicates shared events and preserves highest contribution", () => {
      const chain1: EvidenceChain = {
        metric: "efficiency",
        events: [
          { eventId: "evt-1", timestamp: "", source: "", type: "", summary: "A", contribution: 0.8, role: "primary" },
          { eventId: "evt-2", timestamp: "", source: "", type: "", summary: "B", contribution: 0.3, role: "context" },
        ],
        analyzers: ["efficiency"],
        confidence: 0.8,
      };

      const chain2: EvidenceChain = {
        metric: "comprehension",
        events: [
          { eventId: "evt-1", timestamp: "", source: "", type: "", summary: "A", contribution: 0.5, role: "corroborating" },
          { eventId: "evt-3", timestamp: "", source: "", type: "", summary: "C", contribution: 0.6, role: "primary" },
        ],
        analyzers: ["comprehension-radar"],
        confidence: 0.7,
      };

      const merged = mergeEvidenceChains([chain1, chain2], "blind-spot-correlation");

      expect(merged.metric).toBe("blind-spot-correlation");
      expect(merged.events).toHaveLength(3);
      expect(merged.analyzers).toContain("efficiency");
      expect(merged.analyzers).toContain("comprehension-radar");

      const evt1 = merged.events.find((e) => e.eventId === "evt-1")!;
      expect(evt1.contribution).toBe(0.8);

      expect(merged.confidence).toBeCloseTo(0.75, 1);
    });

    it("sorts merged events by contribution descending", () => {
      const chain: EvidenceChain = {
        metric: "test",
        events: [
          { eventId: "a", timestamp: "", source: "", type: "", summary: "", contribution: 0.3, role: "context" },
          { eventId: "b", timestamp: "", source: "", type: "", summary: "", contribution: 0.9, role: "primary" },
        ],
        analyzers: ["test"],
        confidence: 0.5,
      };

      const merged = mergeEvidenceChains([chain], "test-merge");
      expect(merged.events[0].eventId).toBe("b");
    });
  });

  // ── Persistence (write + load) ────────────────────────────────────

  describe("writeEvidenceFile / loadEvidenceFile", () => {
    it("round-trips evidence chains correctly", async () => {
      const dir = mkdtempSync(join(tmpdir(), "unfade-evidence-"));

      const chains: EvidenceChain[] = [
        {
          metric: "aes",
          events: [
            { eventId: "evt-1", timestamp: "2026-04-28T10:00:00Z", source: "ai-session", type: "ai-conversation", summary: "Test", contribution: 0.9, role: "primary" },
          ],
          analyzers: ["efficiency"],
          confidence: 0.85,
        },
      ];

      await writeEvidenceFile("efficiency", chains, dir);

      const loaded = await loadEvidenceFile("efficiency", dir);
      expect(loaded).toHaveLength(1);
      expect(loaded[0].metric).toBe("aes");
      expect(loaded[0].events[0].eventId).toBe("evt-1");
      expect(loaded[0].confidence).toBe(0.85);

      rmSync(dir, { recursive: true, force: true });
    });

    it("creates evidence directory if missing", async () => {
      const dir = mkdtempSync(join(tmpdir(), "unfade-evidence-"));
      const evidencePath = join(dir, "evidence");
      expect(existsSync(evidencePath)).toBe(false);

      await writeEvidenceFile("test", [{ metric: "test", events: [], analyzers: ["test"], confidence: 0.5 }], dir);

      expect(existsSync(evidencePath)).toBe(true);

      rmSync(dir, { recursive: true, force: true });
    });

    it("returns empty array for missing file", async () => {
      const dir = mkdtempSync(join(tmpdir(), "unfade-evidence-"));
      const loaded = await loadEvidenceFile("nonexistent", dir);
      expect(loaded).toEqual([]);
      rmSync(dir, { recursive: true, force: true });
    });
  });

  // ── buildAndPersistAllEvidence ─────────────────────────────────────

  describe("buildAndPersistAllEvidence", () => {
    it("processes multiple analyzers in one pass", async () => {
      const outputs = new Map<string, AnalyzerOutputWithEvidence>([
        ["efficiency", { sourceEventIds: ["evt-1", "evt-2"], confidence: 0.8 }],
        ["comprehension-radar", { sourceEventIds: ["evt-3"], confidence: 0.7 }],
        ["loop-detector", { sourceEventIds: [], confidence: 0.5 }],
      ]);

      const config = makeConfig();
      const result = await buildAndPersistAllEvidence(outputs, config);

      expect(result.analyzersProcessed).toBe(3);
      expect(result.chainsBuilt).toBe(2);

      const effEvidence = await loadEvidenceFile("efficiency", config.intelligenceDir);
      expect(effEvidence).toHaveLength(1);

      rmSync(config.intelligenceDir, { recursive: true, force: true });
    });
  });
});
