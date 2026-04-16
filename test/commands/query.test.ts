// T-151, T-152, T-153: `unfade query` command tests
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpDir: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../../.tmp-query-cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

beforeEach(() => {
  tmpDir = makeTmpDir();
});

afterEach(() => {
  vi.restoreAllMocks();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe("queryCommand", () => {
  it("returns formatted results from direct file read", async () => {
    // Set up events in tmpDir
    const eventsDir = join(tmpDir, ".unfade", "events");
    mkdirSync(eventsDir, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    writeFileSync(
      join(eventsDir, `${today}.jsonl`),
      `${JSON.stringify({
        id: "a0000000-0000-4000-8000-000000000001",
        timestamp: new Date().toISOString(),
        source: "git",
        type: "commit",
        content: { summary: "Implement caching layer for API", detail: "Added Redis caching" },
      })}\n`,
    );

    // Mock paths to point to tmpDir
    vi.doMock("../../src/utils/paths.js", async (importOriginal) => {
      const original = (await importOriginal()) as Record<string, unknown>;
      return {
        ...original,
        getStateDir: () => join(tmpDir, ".unfade", "state"),
        getEventsDir: () => eventsDir,
        getDistillsDir: () => join(tmpDir, ".unfade", "distills"),
      };
    });

    vi.resetModules();
    const { queryCommand } = await import("../../src/commands/query.js");
    const loggerMod = await import("../../src/utils/logger.js");
    const infoSpy = vi.spyOn(loggerMod.logger, "info");

    await queryCommand("caching", {});

    const output = infoSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("caching");
    infoSpy.mockRestore();
  });

  it("outputs JSON to stdout with --json flag", async () => {
    // Mock paths with no data
    vi.doMock("../../src/utils/paths.js", async (importOriginal) => {
      const original = (await importOriginal()) as Record<string, unknown>;
      return {
        ...original,
        getStateDir: () => join(tmpDir, ".unfade", "state"),
        getEventsDir: () => join(tmpDir, ".unfade", "events"),
        getDistillsDir: () => join(tmpDir, ".unfade", "distills"),
      };
    });

    vi.resetModules();
    const { queryCommand } = await import("../../src/commands/query.js");

    // Capture stdout
    const chunks: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string) => {
      chunks.push(chunk);
      return true;
    }) as typeof process.stdout.write;

    await queryCommand("test", { json: true });

    process.stdout.write = originalWrite;

    const jsonOutput = chunks.join("");
    const parsed = JSON.parse(jsonOutput);
    expect(parsed).toHaveProperty("data");
    expect(parsed).toHaveProperty("_meta");
    expect(parsed._meta.tool).toBe("unfade-query");
  });

  it("falls back to direct file read when server unavailable", async () => {
    // Create a fake server.json pointing to a dead port
    const stateDir = join(tmpDir, ".unfade", "state");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, "server.json"),
      JSON.stringify({
        port: 19999,
        pid: 999999,
        startedAt: new Date().toISOString(),
        version: "0.1.0",
        transport: {
          http: "http://127.0.0.1:19999",
          mcp: "http://127.0.0.1:19999/mcp",
        },
      }),
    );

    vi.doMock("../../src/utils/paths.js", async (importOriginal) => {
      const original = (await importOriginal()) as Record<string, unknown>;
      return {
        ...original,
        getStateDir: () => stateDir,
        getEventsDir: () => join(tmpDir, ".unfade", "events"),
        getDistillsDir: () => join(tmpDir, ".unfade", "distills"),
      };
    });

    vi.resetModules();
    const { queryCommand } = await import("../../src/commands/query.js");

    // Capture stdout for --json output
    const chunks: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string) => {
      chunks.push(chunk);
      return true;
    }) as typeof process.stdout.write;

    await queryCommand("anything", { json: true });

    process.stdout.write = originalWrite;

    const jsonOutput = chunks.join("");
    const parsed = JSON.parse(jsonOutput);
    // Should still return valid response via fallback, not an error
    expect(parsed).toHaveProperty("data");
    expect(parsed).toHaveProperty("_meta");
    expect(parsed._meta.degraded).toBe(false);
  });
});
