import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeFirstRun } from "../../../src/services/intelligence/first-run-analyzer.js";

describe("first-run analyzer (UF-205)", () => {
  let root: string;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("produces a report from local JSONL events", () => {
    root = mkdtempSync(join(tmpdir(), "unfade-fr-"));
    execSync("git init", { cwd: root, stdio: "ignore" });

    const eventsDir = join(root, ".unfade", "events");
    mkdirSync(eventsDir, { recursive: true });

    const day = new Date().toISOString().slice(0, 10);
    const line = {
      id: "550e8400-e29b-41d4-a716-446655440001",
      timestamp: new Date().toISOString(),
      source: "ai-session",
      type: "ai-conversation",
      content: {
        summary: "API route handler in src/services/auth/login.ts",
        detail: "Discuss REST endpoint for src/services/auth/login.ts",
      },
      metadata: {
        model: "claude-sonnet",
        ai_tool: "claude-code",
        direction_signals: { human_direction_score: 0.75, prompt_specificity: 0.6 },
      },
    };

    writeFileSync(join(eventsDir, `${day}.jsonl`), `${JSON.stringify(line)}\n`);

    const report = analyzeFirstRun(root);
    expect(report.firstRunComplete).toBe(true);
    expect(report.aiInteractions).toBeGreaterThanOrEqual(1);
    expect(report.directionDensity).toBeGreaterThan(0);
  });
});
