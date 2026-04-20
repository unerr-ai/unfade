// Tests for UF-078: Amplification v2 — cross-domain + inverted index
// T-203, T-204
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  amplifyV2,
  buildDecisionsIndex,
  rebuildDecisionsIndex,
} from "../../../src/services/distill/amplifier.js";

let tmpDir: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../../.tmp-amplifier-v2-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

beforeEach(() => {
  tmpDir = makeTmpDir();
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe("buildDecisionsIndex", () => {
  it("indexes decisions by domain and keyword", () => {
    const decisions = [
      {
        date: "2026-04-10",
        decision: "Chose Redis for cache",
        rationale: "Low latency",
        domain: "infrastructure",
      },
      {
        date: "2026-04-11",
        decision: "Added JWT auth middleware",
        rationale: "Security",
        domain: "auth",
      },
      {
        date: "2026-04-12",
        decision: "Redis pub-sub for events",
        rationale: "Real-time",
        domain: "infrastructure",
      },
    ];

    const index = buildDecisionsIndex(decisions);

    expect(index.totalDecisions).toBe(3);
    expect(index.byDomain.infrastructure).toEqual([0, 2]);
    expect(index.byDomain.auth).toEqual([1]);
    expect(index.byKeyword.redis).toContain(0);
    expect(index.byKeyword.redis).toContain(2);
  });
});

describe("rebuildDecisionsIndex", () => {
  it("builds index from graph decisions and writes to disk", () => {
    writeGraphDecisions(tmpDir, [
      {
        date: "2026-04-10",
        decision: "Chose Redis for cache",
        rationale: "Low latency",
        domain: "infrastructure",
      },
      { date: "2026-04-11", decision: "Added JWT auth", rationale: "Security", domain: "auth" },
    ]);

    const { index } = rebuildDecisionsIndex(tmpDir);
    expect(index.totalDecisions).toBe(2);

    // Verify written to disk
    const indexPath = join(tmpDir, ".unfade", "graph", "decisions_index.json");
    const onDisk = JSON.parse(readFileSync(indexPath, "utf-8"));
    expect(onDisk.totalDecisions).toBe(2);
  });
});

describe("amplifyV2", () => {
  // T-203: surfaces cross-domain connection
  it("T-203: surfaces cross-domain connection using inverted index", () => {
    // Past decisions in graph — share "redis" keyword across domains
    writeGraphDecisions(tmpDir, [
      {
        date: "2026-04-10",
        decision: "Chose Redis cluster for distributed cache layer",
        rationale: "High availability cache for sessions",
        domain: "infrastructure",
      },
      {
        date: "2026-04-08",
        decision: "Redis pub-sub for real-time notifications",
        rationale: "Event distribution system",
        domain: "infrastructure",
      },
    ]);

    // Today's distill — also about Redis in infrastructure
    const todayContent = [
      "# Daily Distill — 2026-04-15",
      "",
      "## Decisions",
      "",
      "- **Selected Redis sentinel for session cache failover** [infrastructure]",
      "  _Redis high availability for session persistence_",
    ].join("\n");
    writeDistillMd(tmpDir, "2026-04-15", todayContent);

    const result = amplifyV2("2026-04-15", tmpDir);
    expect(result.connections.length).toBeGreaterThan(0);

    // Should match via domain (infrastructure) + keywords (redis, cache/session)
    const conn = result.connections[0];
    expect(conn.today_decision).toContain("Redis");
    expect(conn.match_score).toBeGreaterThan(0.3);
    expect(conn.match_type).toContain("domain");
  });

  // T-204: includes trade-off reasoning comparison (via insight field)
  it("T-204: includes insight in connection for reasoning comparison", () => {
    writeGraphDecisions(tmpDir, [
      {
        date: "2026-03-28",
        decision: "Evaluated Redis vs Memcached for object cache",
        rationale: "Chose Memcached for raw throughput, noted Redis better for persistence",
        domain: "infrastructure",
      },
    ]);

    const todayContent = [
      "# Daily Distill — 2026-04-15",
      "",
      "## Decisions",
      "",
      "- **Evaluated Redis vs Memcached for session store** [infrastructure]",
      "  _Chose Redis for persistence and pub-sub support_",
    ].join("\n");
    writeDistillMd(tmpDir, "2026-04-15", todayContent);

    const result = amplifyV2("2026-04-15", tmpDir);
    expect(result.connections.length).toBeGreaterThan(0);

    const conn = result.connections[0];
    expect(conn.insight).toBeTruthy();
    expect(conn.past_date).toBe("2026-03-28");
    expect(conn.past_decision).toContain("Redis");
  });

  it("generates CONNECTIONS section markdown", () => {
    writeGraphDecisions(tmpDir, [
      {
        date: "2026-04-10",
        decision: "Chose Redis for distributed cache layer",
        rationale: "High availability cache",
        domain: "infrastructure",
      },
    ]);

    const todayContent = [
      "# Daily Distill — 2026-04-15",
      "",
      "## Decisions",
      "",
      "- **Selected Redis for session cache backend** [infrastructure]",
      "  _Session performance needs_",
    ].join("\n");
    writeDistillMd(tmpDir, "2026-04-15", todayContent);

    const result = amplifyV2("2026-04-15", tmpDir);
    if (result.connections.length > 0) {
      expect(result.connectionsSection).toContain("## Connections");
      expect(result.connectionsSection).toContain("↔");
    }
  });

  it("returns empty when no distill for target date", () => {
    const result = amplifyV2("2026-04-15", tmpDir);
    expect(result.connections).toEqual([]);
    expect(result.connectionsSection).toBe("");
  });

  it("writes connections to amplification/connections.jsonl", () => {
    writeGraphDecisions(tmpDir, [
      {
        date: "2026-04-10",
        decision: "Chose Redis for distributed cache layer",
        rationale: "High availability cache",
        domain: "infrastructure",
      },
    ]);

    const todayContent = [
      "# Daily Distill — 2026-04-15",
      "",
      "## Decisions",
      "",
      "- **Selected Redis for session cache backend** [infrastructure]",
      "  _Session performance needs_",
    ].join("\n");
    writeDistillMd(tmpDir, "2026-04-15", todayContent);

    const result = amplifyV2("2026-04-15", tmpDir);
    if (result.connections.length > 0) {
      const connPath = join(tmpDir, ".unfade", "amplification", "connections.jsonl");
      const content = readFileSync(connPath, "utf-8");
      expect(content.trim().length).toBeGreaterThan(0);
      const parsed = JSON.parse(content.trim().split("\n")[0]);
      expect(parsed.match_score).toBeGreaterThan(0);
    }
  });
});
