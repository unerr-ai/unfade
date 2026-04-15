import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateFirstDistill } from "../../../src/services/distill/first-distill.js";

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: globalThis.crypto.randomUUID(),
    type: "commit",
    source: "git",
    timestamp: "2026-04-15T10:00:00Z",
    gitContext: { repo: "test", branch: "main", commitHash: "abc123def456" },
    content: {
      summary: "Added user auth module",
      files: ["src/auth.ts", "src/auth.test.ts"],
      branch: "main",
    },
    ...overrides,
  };
}

describe("generateFirstDistill", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `unfade-test-distill-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(join(tempDir, ".unfade", "events"), { recursive: true });
    mkdirSync(join(tempDir, ".unfade", "distills"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("T-037a: returns null when no events exist", () => {
    const result = generateFirstDistill(tempDir);
    expect(result).toBeNull();
  });

  it("T-037b: generates distill from commit events", () => {
    const date = "2026-04-15";
    const eventsFile = join(tempDir, ".unfade", "events", `${date}.jsonl`);
    writeFileSync(eventsFile, `${JSON.stringify(makeEvent())}\n`, "utf-8");

    const result = generateFirstDistill(tempDir);
    expect(result).not.toBeNull();
    expect(result?.date).toBe(date);
    expect(result?.eventsProcessed).toBe(1);
    expect(result?.decisions).toBeGreaterThanOrEqual(1);
    expect(result?.domains).toContain("TypeScript");
  });

  it("T-037c: does not overwrite existing distill for date", () => {
    const date = "2026-04-15";
    const eventsFile = join(tempDir, ".unfade", "events", `${date}.jsonl`);
    writeFileSync(
      eventsFile,
      `${JSON.stringify(makeEvent({ content: { summary: "test", files: [] } }))}\n`,
      "utf-8",
    );

    // Pre-write a distill.
    const distillPath = join(tempDir, ".unfade", "distills", `${date}.md`);
    writeFileSync(distillPath, "# Existing distill\n", "utf-8");

    generateFirstDistill(tempDir);

    const content = readFileSync(distillPath, "utf-8");
    expect(content).toBe("# Existing distill\n");
  });
});
