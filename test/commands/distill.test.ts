// T-227: `unfade distill --json` output test
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpDir: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../../.tmp-distill-cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

describe("distillCommand", () => {
  // T-227: --json output for distill
  it("T-227: outputs JSON envelope to stdout with --json flag", async () => {
    const dataDir = join(tmpDir, ".unfade");
    const eventsDir = join(dataDir, "events");
    const distillsDir = join(dataDir, "distills");
    mkdirSync(eventsDir, { recursive: true });
    mkdirSync(distillsDir, { recursive: true });

    // Write an event so distill has something to process
    const today = "2026-04-16";
    writeFileSync(
      join(eventsDir, `${today}.jsonl`),
      `${JSON.stringify({
        id: "a0000000-0000-4000-8000-000000000001",
        timestamp: "2026-04-16T10:00:00Z",
        source: "git",
        type: "commit",
        content: { summary: "Add user auth", detail: "JWT-based authentication" },
      })}\n`,
    );

    // Mock the distiller to return a known result
    vi.doMock("../../src/services/distill/distiller.js", () => ({
      distill: vi.fn().mockResolvedValue({
        date: today,
        distill: {
          date: today,
          summary: "Implemented authentication",
          decisions: [{ what: "Use JWT", why: "Stateless auth", confidence: 0.9 }],
          tradeOffs: [],
          deadEnds: [],
          breakthroughs: [],
          patterns: ["authentication"],
          eventsProcessed: 1,
          themes: [],
          domains: [],
          synthesizedBy: "test",
        },
        path: join(distillsDir, `${today}.json`),
        skipped: false,
      }),
      backfill: vi.fn().mockResolvedValue([]),
    }));

    // Mock config loader
    vi.doMock("../../src/config/manager.js", () => ({
      loadConfig: () => ({
        version: 2,
        capture: { sources: { git: true, aiSession: true, terminal: false, browser: false } },
        distill: { schedule: "0 18 * * *", provider: "ollama", model: "llama3.2" },
        mcp: { enabled: true, transport: "stdio", httpPort: 7654 },
        notification: { enabled: true, sound: false },
        site: { outputDir: ".unfade/site" },
      }),
    }));

    vi.resetModules();
    const { distillCommand } = await import("../../src/commands/distill.js");

    // Capture stdout
    const chunks: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string) => {
      chunks.push(chunk);
      return true;
    }) as typeof process.stdout.write;

    await distillCommand({ date: today, json: true });

    process.stdout.write = originalWrite;

    const jsonOutput = chunks.join("");
    const parsed = JSON.parse(jsonOutput);

    // Verify envelope structure
    expect(parsed).toHaveProperty("data");
    expect(parsed).toHaveProperty("_meta");
    expect(parsed._meta.tool).toBe("distill");
    expect(typeof parsed._meta.durationMs).toBe("number");

    // Verify data contents
    expect(parsed.data.date).toBe(today);
    expect(parsed.data.distill.summary).toBe("Implemented authentication");
    expect(parsed.data.distill.decisions).toHaveLength(1);
    expect(parsed.data.skipped).toBe(false);
  });

  it("outputs null data with --json when no events found", async () => {
    // Mock the distiller to return null (no events)
    vi.doMock("../../src/services/distill/distiller.js", () => ({
      distill: vi.fn().mockResolvedValue(null),
      backfill: vi.fn().mockResolvedValue([]),
    }));

    vi.doMock("../../src/config/manager.js", () => ({
      loadConfig: () => ({
        version: 2,
        capture: { sources: { git: true, aiSession: true, terminal: false, browser: false } },
        distill: { schedule: "0 18 * * *", provider: "ollama", model: "llama3.2" },
        mcp: { enabled: true, transport: "stdio", httpPort: 7654 },
        notification: { enabled: true, sound: false },
        site: { outputDir: ".unfade/site" },
      }),
    }));

    vi.resetModules();
    const { distillCommand } = await import("../../src/commands/distill.js");

    const chunks: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string) => {
      chunks.push(chunk);
      return true;
    }) as typeof process.stdout.write;

    await distillCommand({ date: "2026-04-16", json: true });

    process.stdout.write = originalWrite;

    const parsed = JSON.parse(chunks.join(""));
    expect(parsed.data).toBeNull();
    expect(parsed._meta.tool).toBe("distill");
  });

  it("outputs empty array with --json for backfill with no results", async () => {
    vi.doMock("../../src/services/distill/distiller.js", () => ({
      distill: vi.fn().mockResolvedValue(null),
      backfill: vi.fn().mockResolvedValue([]),
    }));

    vi.doMock("../../src/config/manager.js", () => ({
      loadConfig: () => ({
        version: 2,
        capture: { sources: { git: true, aiSession: true, terminal: false, browser: false } },
        distill: { schedule: "0 18 * * *", provider: "ollama", model: "llama3.2" },
        mcp: { enabled: true, transport: "stdio", httpPort: 7654 },
        notification: { enabled: true, sound: false },
        site: { outputDir: ".unfade/site" },
      }),
    }));

    vi.resetModules();
    const { distillCommand } = await import("../../src/commands/distill.js");

    const chunks: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string) => {
      chunks.push(chunk);
      return true;
    }) as typeof process.stdout.write;

    await distillCommand({ backfill: "3", json: true });

    process.stdout.write = originalWrite;

    const parsed = JSON.parse(chunks.join(""));
    expect(parsed.data).toEqual([]);
    expect(parsed._meta.tool).toBe("distill");
  });
});
