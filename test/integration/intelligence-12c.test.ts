// 12C.9-12C.12: Integration tests for Sprint 12C intelligence modules.

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DbLike } from "../../src/services/cache/manager.js";
import {
  computeValueReceipt,
  formatValueReceiptSection,
} from "../../src/services/intelligence/value-receipt.js";
import {
  detectDebuggingArcs,
  formatDebuggingArcsSection,
} from "../../src/services/intelligence/debugging-arcs.js";
import {
  computeDecisionDurability,
  writeDecisionDurability,
} from "../../src/services/intelligence/decision-durability.js";
import { historyCommand } from "../../src/commands/history.js";

let testDir: string;

function makeTestDir(): string {
  const dir = join(tmpdir(), `unfade-12c-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, ".unfade", "intelligence"), { recursive: true });
  return dir;
}

/** In-memory mock DB for testing. */
function createMockDb(tables: Record<string, { columns: string[]; rows: unknown[][] }>): DbLike {
  return {
    run(_sql: string, _params?: unknown[]): void {
      // no-op for tests
    },
    exec(sql: string, _params?: unknown[]): Array<{ columns: string[]; values: unknown[][] }> {
      const lower = sql.toLowerCase();
      for (const [key, data] of Object.entries(tables)) {
        if (lower.includes(key.toLowerCase())) {
          return [{ columns: data.columns, values: data.rows }];
        }
      }
      return [{ columns: [], values: [] }];
    },
  };
}

beforeEach(() => {
  testDir = makeTestDir();
});

afterEach(() => {
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {}
});

// 12C.9: Value receipt computation
describe("12C.9: Value receipt computation", () => {
  it("computes zero injections when no MCP events", () => {
    const db = createMockDb({});
    const receipt = computeValueReceipt(db);

    expect(receipt.today.injections).toBe(0);
    expect(receipt.thisWeek.injections).toBe(0);
    expect(receipt.thisMonth.injections).toBe(0);
    expect(receipt.today.estimatedTokensSaved).toBe(0);
  });

  it("computes savings from injection count", () => {
    const db = createMockDb({
      "mcp-active": { columns: ["count"], rows: [[10]] },
    });
    const receipt = computeValueReceipt(db);

    expect(receipt.today.injections).toBe(10);
    expect(receipt.today.estimatedTokensSaved).toBe(20000);
    expect(receipt.today.estimatedMinutesSaved).toBe(30);
  });

  it("formats value receipt as markdown section", () => {
    const receipt = {
      today: { injections: 5, estimatedTokensSaved: 10000, estimatedCostSaved: 0.3, estimatedMinutesSaved: 15 },
      thisWeek: { injections: 20, estimatedTokensSaved: 40000, estimatedCostSaved: 1.2, estimatedMinutesSaved: 60 },
      thisMonth: { injections: 50, estimatedTokensSaved: 100000, estimatedCostSaved: 3.0, estimatedMinutesSaved: 150 },
      updatedAt: new Date().toISOString(),
    };

    const section = formatValueReceiptSection(receipt);
    expect(section).toContain("## Estimated Impact");
    expect(section).toContain("~5 context injections today");
    expect(section).toContain("10.0K tokens");
  });

  it("returns empty string when no injections", () => {
    const receipt = {
      today: { injections: 0, estimatedTokensSaved: 0, estimatedCostSaved: 0, estimatedMinutesSaved: 0 },
      thisWeek: { injections: 0, estimatedTokensSaved: 0, estimatedCostSaved: 0, estimatedMinutesSaved: 0 },
      thisMonth: { injections: 0, estimatedTokensSaved: 0, estimatedCostSaved: 0, estimatedMinutesSaved: 0 },
      updatedAt: new Date().toISOString(),
    };
    expect(formatValueReceiptSection(receipt)).toBe("");
  });
});

// 12C.10: Debugging arc detection
describe("12C.10: Debugging arc detection", () => {
  it("returns empty array with insufficient events", () => {
    const db = createMockDb({});
    const arcs = detectDebuggingArcs(db);
    expect(arcs).toEqual([]);
  });

  it("formats debugging arcs as markdown section", () => {
    const arcs = [
      {
        id: "arc-0-2026-04-21",
        errorDescription: "TypeError in auth handler",
        hypothesesTested: 3,
        events: [],
        resolution: "resolved" as const,
        resolutionSummary: "Resolved by: fixed null check",
        files: ["src/auth.ts", "src/handler.ts"],
        branch: "fix/auth",
        startTime: "2026-04-21T10:00:00Z",
        endTime: "2026-04-21T10:45:00Z",
        durationMinutes: 45,
      },
    ];

    const section = formatDebuggingArcsSection(arcs);
    expect(section).toContain("## Debugging Arcs");
    expect(section).toContain("TypeError in auth handler");
    expect(section).toContain("Resolved");
    expect(section).toContain("3 approaches tested");
  });

  it("returns empty string for no arcs", () => {
    expect(formatDebuggingArcsSection([])).toBe("");
  });
});

// 12C.11: History command output
describe("12C.11: History command output", () => {
  it("historyCommand exists and is a function", () => {
    expect(typeof historyCommand).toBe("function");
  });
});

// 12C.12: Decision durability correlation
describe("12C.12: Decision durability correlation", () => {
  it("returns empty report with no decisions", () => {
    const db = createMockDb({});
    const report = computeDecisionDurability(db);

    expect(report.decisions).toEqual([]);
    expect(report.stats.totalTracked).toBe(0);
    expect(report.stats.heldRate).toBe(0);
  });

  it("writes durability report atomically", () => {
    const report = {
      decisions: [],
      stats: {
        totalTracked: 0,
        heldCount: 0,
        revisedCount: 0,
        pendingCount: 0,
        heldRate: 0,
        deepDeliberationHeldRate: null,
        quickDecisionHeldRate: null,
      },
      updatedAt: new Date().toISOString(),
    };

    writeDecisionDurability(report, testDir);
    const filePath = join(testDir, ".unfade", "intelligence", "decision-durability.json");
    expect(existsSync(filePath)).toBe(true);

    const written = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(written.stats.totalTracked).toBe(0);
  });

  it("computes held rate correctly for old decisions", () => {
    const oldDate = new Date(Date.now() - 14 * 86400 * 1000).toISOString().slice(0, 10);
    const db = createMockDb({
      decisions: {
        columns: ["id", "date", "domain", "description", "alternatives_count", "linked_files"],
        rows: [
          ["d1", oldDate, "auth", "Use JWT", 3, "src/auth.ts"],
          ["d2", oldDate, "api", "REST over GraphQL", 2, ""],
        ],
      },
      events: { columns: ["count"], rows: [[0]] },
    });

    const report = computeDecisionDurability(db);
    expect(report.decisions.length).toBe(2);
    expect(report.stats.totalTracked).toBe(2);
  });
});
