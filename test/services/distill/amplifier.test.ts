// Tests for UF-066: Amplifier v1 — cross-temporal connection detection
// T-180, T-181, T-182
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { amplify, findSimilar } from "../../../src/services/distill/amplifier.js";

let tmpDir: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../../.tmp-amplifier-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

function writeDistillMd(dir: string, date: string, content: string): void {
  const distillsDir = join(dir, ".unfade", "distills");
  mkdirSync(distillsDir, { recursive: true });
  writeFileSync(join(distillsDir, `${date}.md`), content, "utf-8");
}

function writeGraphDecisions(dir: string, decisions: Record<string, unknown>[]): void {
  const graphDir = join(dir, ".unfade", "graph");
  mkdirSync(graphDir, { recursive: true });
  const content = decisions.map((d) => JSON.stringify(d)).join("\n");
  writeFileSync(join(graphDir, "decisions.jsonl"), `${content}\n`, "utf-8");
}

const todayDistill = [
  "# Daily Distill — 2026-04-15",
  "",
  "## Decisions",
  "",
  "- **Chose Redis for session cache** [infrastructure]",
  "  _Low latency requirement for session storage_",
  "",
  "- **Implemented JWT token refresh** [auth]",
  "  _Token expiry handling_",
].join("\n");

const pastDistillSimilar = [
  "# Daily Distill — 2026-04-10",
  "",
  "## Decisions",
  "",
  "- **Chose Redis for API response cache** [infrastructure]",
  "  _Needed fast cache for API responses_",
  "",
  "- **Added Redis pub-sub for events** [infrastructure]",
  "  _Real-time event distribution_",
].join("\n");

const pastDistillUnrelated = [
  "# Daily Distill — 2026-04-08",
  "",
  "## Decisions",
  "",
  "- **Migrated database from MySQL to PostgreSQL** [database]",
  "  _Better JSON support needed_",
  "",
  "- **Added integration test suite** [testing]",
  "  _CI pipeline reliability_",
].join("\n");

beforeEach(() => {
  tmpDir = makeTmpDir();
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe("amplify", () => {
  // T-180: detects similar past decision by keyword overlap
  it("T-180: detects similar past decision by keyword overlap", () => {
    writeDistillMd(tmpDir, "2026-04-15", todayDistill);
    writeDistillMd(tmpDir, "2026-04-10", pastDistillSimilar);

    const result = amplify("2026-04-15", tmpDir);
    expect(result.data.connections.length).toBeGreaterThan(0);
    expect(result._meta.tool).toBe("unfade-amplify");
    expect(result._meta.degraded).toBe(false);

    // Should find connection between Redis/cache decisions
    const cacheConnection = result.data.connections.find(
      (c) => c.today.includes("Redis") || c.today.includes("cache"),
    );
    expect(cacheConnection).toBeDefined();
    expect(cacheConnection!.relevance).toBeGreaterThanOrEqual(0.7);
  });

  // T-181: surfaces connection with date and context
  it("T-181: surfaces connection with date and context", () => {
    writeDistillMd(tmpDir, "2026-04-15", todayDistill);
    writeDistillMd(tmpDir, "2026-04-10", pastDistillSimilar);

    const result = amplify("2026-04-15", tmpDir);
    expect(result.data.date).toBe("2026-04-15");

    for (const conn of result.data.connections) {
      expect(conn.today).toBeTruthy();
      expect(conn.past.date).toBeTruthy();
      expect(conn.past.decision).toBeTruthy();
      expect(conn.relevance).toBeGreaterThanOrEqual(0.7);
      expect(conn.relevance).toBeLessThanOrEqual(1);
    }
  });

  // T-182: no false positives on unrelated decisions
  it("T-182: no false positives on unrelated decisions", () => {
    writeDistillMd(tmpDir, "2026-04-15", todayDistill);
    writeDistillMd(tmpDir, "2026-04-08", pastDistillUnrelated);

    const result = amplify("2026-04-15", tmpDir);

    // Should NOT find connections to database migration or test suite decisions
    const dbConnection = result.data.connections.find(
      (c) => c.past.decision.includes("MySQL") || c.past.decision.includes("PostgreSQL"),
    );
    expect(dbConnection).toBeUndefined();

    const testConnection = result.data.connections.find((c) =>
      c.past.decision.includes("integration test"),
    );
    expect(testConnection).toBeUndefined();
  });

  it("returns empty connections when no distill exists for target date", () => {
    const result = amplify("2026-04-15", tmpDir);
    expect(result.data.connections).toEqual([]);
    expect(result.data.date).toBe("2026-04-15");
  });

  it("returns empty connections when no past distills exist", () => {
    writeDistillMd(tmpDir, "2026-04-15", todayDistill);

    const result = amplify("2026-04-15", tmpDir);
    expect(result.data.connections).toEqual([]);
  });

  it("reads from graph/decisions.jsonl for past decisions", () => {
    writeDistillMd(tmpDir, "2026-04-15", todayDistill);
    writeGraphDecisions(tmpDir, [
      {
        date: "2026-04-10",
        decision: "Chose Redis for API cache layer",
        rationale: "Fast key-value lookups",
        domain: "infrastructure",
      },
    ]);

    const result = amplify("2026-04-15", tmpDir);
    const conn = result.data.connections.find((c) => c.past.date === "2026-04-10");
    expect(conn).toBeDefined();
  });

  it("sorts connections by relevance descending", () => {
    writeDistillMd(tmpDir, "2026-04-15", todayDistill);
    writeDistillMd(tmpDir, "2026-04-10", pastDistillSimilar);
    writeGraphDecisions(tmpDir, [
      {
        date: "2026-04-09",
        decision: "Chose Redis for session cache storage backend",
        rationale: "Session performance",
        domain: "infrastructure",
      },
    ]);

    const result = amplify("2026-04-15", tmpDir);
    for (let i = 1; i < result.data.connections.length; i++) {
      expect(result.data.connections[i - 1].relevance).toBeGreaterThanOrEqual(
        result.data.connections[i].relevance,
      );
    }
  });
});

describe("findSimilar", () => {
  it("finds similar decisions by keyword overlap", () => {
    writeDistillMd(tmpDir, "2026-04-15", todayDistill);
    writeDistillMd(tmpDir, "2026-04-10", pastDistillSimilar);

    const result = findSimilar("choosing a cache backend", 10, tmpDir);
    expect(result.data.results.length).toBeGreaterThan(0);
    expect(result._meta.tool).toBe("unfade-similar");

    // Should find cache-related decisions
    const cacheResult = result.data.results.find(
      (r) => r.decision.includes("cache") || r.decision.includes("Cache"),
    );
    expect(cacheResult).toBeDefined();
  });

  it("returns empty for completely unrelated problem", () => {
    writeDistillMd(tmpDir, "2026-04-15", todayDistill);

    const result = findSimilar("quantum computing optimization algorithms", 10, tmpDir);
    // All results should have very low relevance (or none at all)
    const relevant = result.data.results.filter((r) => r.relevance > 0.5);
    expect(relevant.length).toBe(0);
  });

  it("respects limit parameter", () => {
    writeDistillMd(tmpDir, "2026-04-15", todayDistill);
    writeDistillMd(tmpDir, "2026-04-10", pastDistillSimilar);

    const result = findSimilar("cache", 1, tmpDir);
    expect(result.data.results.length).toBeLessThanOrEqual(1);
    expect(result.data.total).toBeGreaterThanOrEqual(result.data.results.length);
  });

  it("searches both graph and distill sources", () => {
    writeGraphDecisions(tmpDir, [
      {
        date: "2026-04-12",
        decision: "Selected Redis cluster for distributed caching",
        rationale: "High availability cache",
        domain: "infrastructure",
      },
    ]);
    writeDistillMd(tmpDir, "2026-04-10", pastDistillSimilar);

    const result = findSimilar("Redis cache selection", 10, tmpDir);
    const dates = result.data.results.map((r) => r.date);
    expect(dates).toContain("2026-04-12"); // from graph
  });

  it("sorts results by relevance descending", () => {
    writeDistillMd(tmpDir, "2026-04-15", todayDistill);
    writeDistillMd(tmpDir, "2026-04-10", pastDistillSimilar);

    const result = findSimilar("cache backend selection", 10, tmpDir);
    for (let i = 1; i < result.data.results.length; i++) {
      expect(result.data.results[i - 1].relevance).toBeGreaterThanOrEqual(
        result.data.results[i].relevance,
      );
    }
  });
});
