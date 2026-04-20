import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DailyDistill } from "../../../src/schemas/distill.js";
import { generateDecisionRecords } from "../../../src/services/distill/decision-records.js";

let tmpDir: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../../.tmp-dr-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

function rmrf(dir: string): void {
  try {
    const { rmSync } = require("node:fs") as typeof import("node:fs");
    rmSync(dir, { recursive: true, force: true });
  } catch {}
}

function makeDistill(overrides: Partial<DailyDistill> = {}): DailyDistill {
  return {
    date: "2026-04-17",
    summary: "Test distill",
    decisions: [],
    eventsProcessed: 10,
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = makeTmpDir();
});

afterEach(() => {
  rmrf(tmpDir);
});

// T-106: Decision records: generates DR markdown for decisions with HDS > 0.6 and 2+ alternatives
describe("generateDecisionRecords", () => {
  it("generates DR markdown for qualifying decisions", () => {
    const distill = makeDistill({
      decisions: [
        {
          decision: "Used DI over singletons",
          rationale: "Testability and isolation",
          domain: "architecture",
          alternativesConsidered: 3,
        },
        {
          decision: "Chose PostgreSQL",
          rationale: "Query complexity needs",
          domain: "database",
          alternativesConsidered: 2,
        },
      ],
      directionSummary: {
        averageHDS: 0.75,
        humanDirectedCount: 2,
        collaborativeCount: 0,
        llmDirectedCount: 0,
        topHumanDirectedDecisions: ["Used DI over singletons"],
      },
    });

    const count = generateDecisionRecords(distill, tmpDir);
    expect(count).toBe(2);

    const dr1 = join(tmpDir, ".unfade", "decisions", "DR-2026-04-17-01.md");
    expect(existsSync(dr1)).toBe(true);

    const content = readFileSync(dr1, "utf-8");
    expect(content).toContain("Used DI over singletons");
    expect(content).toContain("**Status:** Accepted");
    expect(content).toContain("**Alternatives Considered:** 3");
  });

  it("skips decisions with < 2 alternatives", () => {
    const distill = makeDistill({
      decisions: [
        {
          decision: "Quick fix",
          rationale: "Was broken",
          alternativesConsidered: 1,
        },
      ],
    });

    const count = generateDecisionRecords(distill, tmpDir);
    expect(count).toBe(0);
  });

  it("maintains index.json", () => {
    const distill = makeDistill({
      decisions: [
        {
          decision: "Chose caching strategy",
          rationale: "Performance",
          domain: "infrastructure",
          alternativesConsidered: 4,
        },
      ],
      directionSummary: {
        averageHDS: 0.8,
        humanDirectedCount: 1,
        collaborativeCount: 0,
        llmDirectedCount: 0,
        topHumanDirectedDecisions: [],
      },
    });

    generateDecisionRecords(distill, tmpDir);

    const indexPath = join(tmpDir, ".unfade", "decisions", "index.json");
    expect(existsSync(indexPath)).toBe(true);

    const index = JSON.parse(readFileSync(indexPath, "utf-8"));
    expect(index).toHaveLength(1);
    expect(index[0].id).toBe("DR-2026-04-17-01");
    expect(index[0].domain).toBe("infrastructure");
  });

  it("is idempotent — does not duplicate records", () => {
    const distill = makeDistill({
      decisions: [
        {
          decision: "Test decision",
          rationale: "R",
          alternativesConsidered: 2,
        },
      ],
    });

    generateDecisionRecords(distill, tmpDir);
    const count2 = generateDecisionRecords(distill, tmpDir);
    expect(count2).toBe(0);
  });
});
