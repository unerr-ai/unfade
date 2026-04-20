// Tests for UF-068: Similar MCP tool — unfade_similar
// T-183, T-184
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getSimilar } from "../../src/tools/unfade-similar.js";

let tmpDir: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../.tmp-similar-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

const distillWithCacheDecision = [
  "# Daily Distill — 2026-04-12",
  "",
  "## Decisions",
  "",
  "- **Chose Redis for distributed cache backend** [infrastructure]",
  "  _Low latency key-value storage needed for API response caching_",
  "",
  "- **Implemented write-through cache strategy** [infrastructure]",
  "  _Consistency over eventual consistency_",
].join("\n");

beforeEach(() => {
  tmpDir = makeTmpDir();
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe("getSimilar (MCP tool handler)", () => {
  // T-183: finds analogous decision from history
  it("T-183: finds analogous decision from history", () => {
    writeDistillMd(tmpDir, "2026-04-12", distillWithCacheDecision);
    writeGraphDecisions(tmpDir, [
      {
        date: "2026-04-10",
        decision: "Evaluated Redis vs Memcached for cache",
        rationale: "Need distributed cache",
        domain: "infrastructure",
        alternativesConsidered: 2,
      },
    ]);

    const result = getSimilar("selecting a cache backend for API", 10, tmpDir);
    expect(result.data.results.length).toBeGreaterThan(0);
    expect(result._meta.tool).toBe("unfade-similar");
    expect(result._meta.degraded).toBe(false);

    // Should find cache-related decisions
    const cacheResult = result.data.results.find(
      (r) =>
        r.decision.toLowerCase().includes("cache") || r.decision.toLowerCase().includes("redis"),
    );
    expect(cacheResult).toBeDefined();
    expect(cacheResult?.date).toBeTruthy();
    expect(cacheResult?.relevance).toBeGreaterThan(0);
  });

  // T-184: returns empty for novel decisions
  it("T-184: returns empty for novel decisions", () => {
    writeDistillMd(tmpDir, "2026-04-12", distillWithCacheDecision);

    const result = getSimilar("quantum entanglement optimization protocol", 10, tmpDir);
    // No meaningful matches expected
    const relevant = result.data.results.filter((r) => r.relevance > 0.3);
    expect(relevant.length).toBe(0);
    expect(result._meta.tool).toBe("unfade-similar");
  });

  it("returns empty results when no data exists", () => {
    const result = getSimilar("anything", 10, tmpDir);
    expect(result.data.results).toEqual([]);
    expect(result.data.total).toBe(0);
  });

  it("includes _meta envelope with timing", () => {
    const result = getSimilar("test query", 10, tmpDir);
    expect(result._meta).toBeDefined();
    expect(result._meta.tool).toBe("unfade-similar");
    expect(typeof result._meta.durationMs).toBe("number");
    expect(result._meta.degraded).toBe(false);
  });
});
