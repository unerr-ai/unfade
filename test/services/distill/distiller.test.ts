// T-035: Distiller orchestrator tests
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UnfadeConfigSchema } from "../../../src/schemas/config.js";
import type { CaptureEvent } from "../../../src/schemas/event.js";
import { distill } from "../../../src/services/distill/distiller.js";

let tmpDir: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../../.tmp-distiller-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

function rmrf(dir: string): void {
  try {
    const { rmSync } = require("node:fs");
    rmSync(dir, { recursive: true, force: true });
  } catch {}
}

function makeEvent(overrides: Partial<CaptureEvent> = {}): CaptureEvent {
  return {
    id: globalThis.crypto.randomUUID(),
    type: "commit",
    source: "git",
    timestamp: "2026-04-15T10:00:00Z",
    content: {
      summary: "Added user auth module",
      files: ["src/auth.ts", "src/auth.test.ts"],
      branch: "main",
    },
    gitContext: { repo: "test", branch: "main", commitHash: "abc123def456" },
    ...overrides,
  };
}

function writeEvents(dir: string, date: string, events: CaptureEvent[]): void {
  const eventsDir = join(dir, ".unfade", "events");
  mkdirSync(eventsDir, { recursive: true });
  const lines = events.map((e) => JSON.stringify(e)).join("\n");
  writeFileSync(join(eventsDir, `${date}.jsonl`), `${lines}\n`, "utf-8");
}

beforeEach(() => {
  tmpDir = makeTmpDir();
});

afterEach(() => {
  rmrf(tmpDir);
});

describe("distill", () => {
  const config = UnfadeConfigSchema.parse({ distill: { provider: "none" } });

  it("T-035a: returns null for zero-event days", async () => {
    const result = await distill("2026-04-15", config, { cwd: tmpDir, silent: true });
    expect(result).toBeNull();
  });

  it("T-035b: distills a single day with events", async () => {
    writeEvents(tmpDir, "2026-04-15", [makeEvent()]);
    const result = await distill("2026-04-15", config, { cwd: tmpDir, silent: true });
    expect(result).not.toBeNull();
    expect(result?.date).toBe("2026-04-15");
    expect(result?.distill.decisions.length).toBeGreaterThan(0);
    expect(result?.distill.synthesizedBy).toBe("fallback");
  });

  it("T-035c: writes distill markdown file", async () => {
    writeEvents(tmpDir, "2026-04-15", [makeEvent()]);
    const result = await distill("2026-04-15", config, { cwd: tmpDir, silent: true });
    expect(result).not.toBeNull();
    expect(existsSync(result?.path)).toBe(true);
  });

  it("T-035d: creates graph/decisions.jsonl", async () => {
    writeEvents(tmpDir, "2026-04-15", [makeEvent()]);
    await distill("2026-04-15", config, { cwd: tmpDir, silent: true });
    const graphPath = join(tmpDir, ".unfade", "graph", "decisions.jsonl");
    expect(existsSync(graphPath)).toBe(true);
  });

  it("T-035e: updates reasoning profile", async () => {
    writeEvents(tmpDir, "2026-04-15", [makeEvent()]);
    await distill("2026-04-15", config, { cwd: tmpDir, silent: true });
    const profilePath = join(tmpDir, ".unfade", "profile", "reasoning_model.json");
    expect(existsSync(profilePath)).toBe(true);
  });

  it("T-035f: is idempotent — second run overwrites", async () => {
    writeEvents(tmpDir, "2026-04-15", [makeEvent()]);
    const r1 = await distill("2026-04-15", config, { cwd: tmpDir, silent: true });
    const r2 = await distill("2026-04-15", config, { cwd: tmpDir, silent: true });
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    expect(r1?.path).toBe(r2?.path);
  });

  it("T-035g: handles multiple events", async () => {
    writeEvents(tmpDir, "2026-04-15", [
      makeEvent({ timestamp: "2026-04-15T09:00:00Z" }),
      makeEvent({
        id: globalThis.crypto.randomUUID(),
        timestamp: "2026-04-15T10:00:00Z",
        content: { summary: "Added tests", files: ["src/auth.test.ts"], branch: "main" },
      }),
      makeEvent({
        id: globalThis.crypto.randomUUID(),
        type: "ai-rejection",
        source: "ai-session",
        timestamp: "2026-04-15T11:00:00Z",
        content: { summary: "Rejected AI suggestion", files: ["src/auth.ts"] },
      }),
    ]);

    const result = await distill("2026-04-15", config, { cwd: tmpDir, silent: true });
    expect(result).not.toBeNull();
    expect(result?.distill.eventsProcessed).toBe(3);
  });
});
