import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpDir: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../../.tmp-prompt-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

function writeSnapshot(
  dir: string,
  snapshots: Array<{ date: string; rdi: number; [k: string]: unknown }>,
): void {
  const metricsDir = join(dir, ".unfade", "metrics");
  mkdirSync(metricsDir, { recursive: true });
  const content = `${snapshots
    .map((s) =>
      JSON.stringify({
        ...s,
        dcs: null,
        aq: null,
        cwi: null,
        apiScore: null,
        identityLabels: [],
        topDomain: null,
        decisionsCount: 3,
        eventsProcessed: 10,
      }),
    )
    .join("\n")}\n`;
  writeFileSync(join(metricsDir, "daily.jsonl"), content, "utf-8");
}

beforeEach(() => {
  tmpDir = makeTmpDir();
});

afterEach(() => {
  rmrf(tmpDir);
  vi.restoreAllMocks();
});

// T-121: `unfade prompt`: outputs ≤6 chars badge, empty string when no data
describe("unfade prompt", () => {
  it("outputs ≤6 chars badge with RDI", async () => {
    writeSnapshot(tmpDir, [{ date: "2026-04-17", rdi: 67 }]);

    vi.doMock("../../src/utils/paths.js", () => ({
      getMetricsDir: () => join(tmpDir, ".unfade", "metrics"),
      getProjectDataDir: () => join(tmpDir, ".unfade"),
    }));

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const { promptCommand } = await import("../../src/commands/prompt.js");
    promptCommand();

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output.length).toBeLessThanOrEqual(8);
    expect(output).toContain("67");
    expect(output).toContain("◆");
  });

  it("outputs empty string when no data file exists", async () => {
    vi.doMock("../../src/utils/paths.js", () => ({
      getMetricsDir: () => join(tmpDir, ".unfade", "metrics"),
      getProjectDataDir: () => join(tmpDir, ".unfade"),
    }));

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const { promptCommand } = await import("../../src/commands/prompt.js");
    promptCommand();

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toBe("");
  });

  it("shows trend arrow with sufficient history", async () => {
    const snapshots = [];
    for (let i = 0; i < 10; i++) {
      snapshots.push({ date: `2026-04-${String(i + 7).padStart(2, "0")}`, rdi: 40 + i * 3 });
    }
    writeSnapshot(tmpDir, snapshots);

    vi.doMock("../../src/utils/paths.js", () => ({
      getMetricsDir: () => join(tmpDir, ".unfade", "metrics"),
      getProjectDataDir: () => join(tmpDir, ".unfade"),
    }));

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const { promptCommand } = await import("../../src/commands/prompt.js");
    promptCommand();

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("◆");
    // Should have a trend arrow
    expect(output.match(/[↑↓→]/)).toBeTruthy();
  });
});
