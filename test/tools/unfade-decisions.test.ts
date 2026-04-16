// Tests for UF-054: Decisions reader
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDecisions } from "../../src/tools/unfade-decisions.js";

let tmpDir: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../.tmp-decisions-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

const distillWithDecisions = [
  "# Daily Distill — 2026-04-15",
  "",
  "> Built auth and caching",
  "",
  "## Decisions",
  "",
  "- **Added auth module** [backend]",
  "  _Security requirement_",
  "",
  "- **Chose Redis for caching** [infrastructure]",
  "  _Low latency needed_",
  "",
  "## Trade-offs",
  "",
  "- **SQL vs NoSQL**",
].join("\n");

beforeEach(() => {
  tmpDir = makeTmpDir();
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe("getDecisions", () => {
  it("returns empty with degraded: true when no data exists", () => {
    const result = getDecisions({ limit: 10 }, tmpDir);
    expect(result.data.decisions).toEqual([]);
    expect(result.data.total).toBe(0);
    expect(result._meta.tool).toBe("unfade-decisions");
    expect(result._meta.degraded).toBe(true);
    expect(result._meta.degradedReason).toBeDefined();
  });

  it("extracts decisions from distill markdown", () => {
    writeDistillMd(tmpDir, "2026-04-15", distillWithDecisions);

    const result = getDecisions({ limit: 10 }, tmpDir);
    expect(result.data.decisions.length).toBe(2);
    expect(result.data.decisions[0].decision).toBe("Added auth module");
    expect(result.data.decisions[0].domain).toBe("backend");
    expect(result.data.decisions[0].rationale).toBe("Security requirement");
    expect(result.data.decisions[0].date).toBe("2026-04-15");
  });

  it("filters by domain", () => {
    writeDistillMd(tmpDir, "2026-04-15", distillWithDecisions);

    const result = getDecisions({ limit: 10, domain: "backend" }, tmpDir);
    expect(result.data.decisions.length).toBe(1);
    expect(result.data.decisions[0].decision).toBe("Added auth module");
  });

  it("respects limit", () => {
    writeDistillMd(tmpDir, "2026-04-15", distillWithDecisions);

    const result = getDecisions({ limit: 1 }, tmpDir);
    expect(result.data.decisions.length).toBe(1);
    expect(result.data.total).toBe(2);
  });

  it("reads from graph/decisions.jsonl when available", () => {
    writeGraphDecisions(tmpDir, [
      { date: "2026-04-15", decision: "GraphDB choice", rationale: "Performance", domain: "data" },
      { date: "2026-04-14", decision: "API gateway", rationale: "Routing", domain: "infra" },
    ]);

    const result = getDecisions({ limit: 10 }, tmpDir);
    expect(result.data.decisions.length).toBe(2);
    expect(result.data.decisions[0].decision).toBe("GraphDB choice");
    expect(result._meta.degraded).toBe(false);
  });

  it("prefers graph file over distills when both exist", () => {
    writeDistillMd(tmpDir, "2026-04-15", distillWithDecisions);
    writeGraphDecisions(tmpDir, [
      { date: "2026-04-15", decision: "From graph", rationale: "test" },
    ]);

    const result = getDecisions({ limit: 10 }, tmpDir);
    expect(result.data.decisions[0].decision).toBe("From graph");
  });

  it("reads decisions from multiple distill files in reverse date order", () => {
    writeDistillMd(tmpDir, "2026-04-15", distillWithDecisions);
    writeDistillMd(
      tmpDir,
      "2026-04-14",
      [
        "# Daily Distill — 2026-04-14",
        "",
        "> Earlier work",
        "",
        "## Decisions",
        "",
        "- **Set up CI pipeline** [devops]",
        "  _Automation first_",
      ].join("\n"),
    );

    const result = getDecisions({ limit: 10 }, tmpDir);
    // Most recent first
    expect(result.data.decisions[0].date).toBe("2026-04-15");
    expect(result.data.decisions.length).toBe(3);
  });

  it("includes lastUpdated from file mtimes", () => {
    writeDistillMd(tmpDir, "2026-04-15", distillWithDecisions);
    const result = getDecisions({ limit: 10 }, tmpDir);
    expect(result._meta.lastUpdated).not.toBeNull();
  });

  it("handles malformed graph lines gracefully", () => {
    const graphDir = join(tmpDir, ".unfade", "graph");
    mkdirSync(graphDir, { recursive: true });
    writeFileSync(
      join(graphDir, "decisions.jsonl"),
      '{"decision":"Good","rationale":"r","date":"2026-04-15"}\nBAD LINE\n',
      "utf-8",
    );

    const result = getDecisions({ limit: 10 }, tmpDir);
    expect(result.data.decisions.length).toBe(1);
  });
});
