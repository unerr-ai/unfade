// T-178, T-179: `unfade export` command tests
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpDir: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../../.tmp-export-cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

describe("exportCommand", () => {
  it("T-178: creates tar.gz with manifest containing date range and counts", async () => {
    // Set up .unfade/ with events and distills.
    const dataDir = join(tmpDir, ".unfade");
    const eventsDir = join(dataDir, "events");
    const distillsDir = join(dataDir, "distills");
    mkdirSync(eventsDir, { recursive: true });
    mkdirSync(distillsDir, { recursive: true });

    writeFileSync(
      join(eventsDir, "2026-04-14.jsonl"),
      '{"id":"1","source":"git","type":"commit"}\n',
    );
    writeFileSync(
      join(eventsDir, "2026-04-15.jsonl"),
      '{"id":"2","source":"terminal","type":"command"}\n',
    );
    writeFileSync(join(distillsDir, "2026-04-15.json"), '{"date":"2026-04-15","summary":"test"}\n');

    // Mock paths to point to tmpDir.
    vi.doMock("../../src/utils/paths.js", async (importOriginal) => {
      const original = (await importOriginal()) as Record<string, unknown>;
      return {
        ...original,
        getProjectDataDir: () => dataDir,
        getEventsDir: () => eventsDir,
        getDistillsDir: () => distillsDir,
      };
    });

    vi.resetModules();

    const outputPath = join(tmpDir, "test-export.tar.gz");
    const { exportCommand } = await import("../../src/commands/export.js");
    await exportCommand({ output: outputPath });

    // Verify archive exists.
    expect(existsSync(outputPath)).toBe(true);

    // Extract and verify manifest.
    const extractDir = join(tmpDir, "extracted");
    mkdirSync(extractDir, { recursive: true });
    execSync(`tar -xzf ${JSON.stringify(outputPath)} -C ${JSON.stringify(extractDir)}`);

    const manifestPath = join(extractDir, ".unfade", "manifest.json");
    expect(existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifest.eventCount).toBe(2);
    expect(manifest.distillCount).toBe(1);
    expect(manifest.dateRange.from).toBe("2026-04-14");
    expect(manifest.dateRange.to).toBe("2026-04-15");
    expect(manifest.exportDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Verify events are included.
    expect(existsSync(join(extractDir, ".unfade", "events", "2026-04-14.jsonl"))).toBe(true);
    expect(existsSync(join(extractDir, ".unfade", "events", "2026-04-15.jsonl"))).toBe(true);
  });

  it("T-179: excludes ephemeral state files and bin directory", async () => {
    // Set up .unfade/ with state files and bin.
    const dataDir = join(tmpDir, ".unfade");
    const eventsDir = join(dataDir, "events");
    const stateDir = join(dataDir, "state");
    const binDir = join(dataDir, "bin");
    mkdirSync(eventsDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });

    writeFileSync(join(eventsDir, "2026-04-15.jsonl"), '{"id":"1"}\n');
    writeFileSync(join(stateDir, "health.json"), '{"ok":true}');
    writeFileSync(join(stateDir, "daemon.pid"), "12345");
    writeFileSync(join(stateDir, "server.json"), "{}");
    writeFileSync(join(binDir, "unfaded"), "binary");
    writeFileSync(join(dataDir, "config.json"), '{"version":1}');

    vi.doMock("../../src/utils/paths.js", async (importOriginal) => {
      const original = (await importOriginal()) as Record<string, unknown>;
      return {
        ...original,
        getProjectDataDir: () => dataDir,
        getEventsDir: () => eventsDir,
        getDistillsDir: () => join(dataDir, "distills"),
      };
    });

    vi.resetModules();

    const outputPath = join(tmpDir, "test-export-exclude.tar.gz");
    const { exportCommand } = await import("../../src/commands/export.js");
    await exportCommand({ output: outputPath });

    // List archive contents.
    const contents = execSync(`tar -tzf ${JSON.stringify(outputPath)}`).toString();

    // Should include events and config.
    expect(contents).toContain("events/2026-04-15.jsonl");
    expect(contents).toContain("config.json");

    // Should NOT include state files or bin.
    expect(contents).not.toContain("health.json");
    expect(contents).not.toContain("daemon.pid");
    expect(contents).not.toContain("server.json");
    expect(contents).not.toContain("bin/");
    expect(contents).not.toContain("unfaded");
  });

  // T-228: --json output for export
  it("T-228: outputs JSON to stdout with --json flag", async () => {
    const dataDir = join(tmpDir, ".unfade");
    const eventsDir = join(dataDir, "events");
    mkdirSync(eventsDir, { recursive: true });

    writeFileSync(
      join(eventsDir, "2026-04-15.jsonl"),
      '{"id":"1","source":"git","type":"commit"}\n',
    );

    vi.doMock("../../src/utils/paths.js", async (importOriginal) => {
      const original = (await importOriginal()) as Record<string, unknown>;
      return {
        ...original,
        getProjectDataDir: () => dataDir,
        getEventsDir: () => eventsDir,
        getDistillsDir: () => join(dataDir, "distills"),
      };
    });

    vi.resetModules();

    const outputPath = join(tmpDir, "test-export-json.tar.gz");
    const { exportCommand } = await import("../../src/commands/export.js");

    // Capture stdout
    const chunks: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string) => {
      chunks.push(chunk);
      return true;
    }) as typeof process.stdout.write;

    await exportCommand({ output: outputPath, json: true });

    process.stdout.write = originalWrite;

    const jsonOutput = chunks.join("");
    const parsed = JSON.parse(jsonOutput);
    expect(parsed).toHaveProperty("data");
    expect(parsed).toHaveProperty("_meta");
    expect(parsed._meta.tool).toBe("export");
    expect(typeof parsed._meta.durationMs).toBe("number");
    expect(parsed.data.outputPath).toBe(outputPath);
    expect(parsed.data.manifest).toHaveProperty("eventCount");
    expect(parsed.data.manifest.eventCount).toBe(1);

    // Archive should still have been created
    expect(existsSync(outputPath)).toBe(true);
  });

  it("exits with error when .unfade/ does not exist", async () => {
    vi.doMock("../../src/utils/paths.js", async (importOriginal) => {
      const original = (await importOriginal()) as Record<string, unknown>;
      return {
        ...original,
        getProjectDataDir: () => join(tmpDir, "nonexistent", ".unfade"),
      };
    });

    vi.resetModules();
    const { exportCommand } = await import("../../src/commands/export.js");

    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await exportCommand();

    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
    stderrWrite.mockRestore();
  });
});
