// 12B.11/12B.12/12B.13: Integration tests for the Proactive Action Layer.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { UnfadeConfig } from "../../src/schemas/config.js";
import { autoRulesAction, detectRuleTarget } from "../../src/services/actions/auto-rules.js";
import {
  extractHighConfidencePatterns,
  formatRules,
} from "../../src/services/actions/rule-formatter.js";
import {
  ActionRunner,
  atomicWriteFile,
  replaceMarkerSection,
} from "../../src/services/actions/runner.js";
import { sessionContextAction } from "../../src/services/actions/session-context.js";
import { weeklyDigestAction } from "../../src/services/actions/weekly-digest.js";

let testDir: string;

function makeTestDir(): string {
  const dir = join(tmpdir(), `unfade-actions-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, ".unfade", "intelligence"), { recursive: true });
  mkdirSync(join(dir, ".unfade", "state"), { recursive: true });
  mkdirSync(join(dir, ".unfade", "logs"), { recursive: true });
  mkdirSync(join(dir, ".unfade", "cards"), { recursive: true });
  return dir;
}

function makeConfig(overrides: Partial<UnfadeConfig["actions"]> = {}): UnfadeConfig {
  return {
    version: 2,
    capture: {
      sources: { git: true, aiSession: true, terminal: false, browser: false },
      aiSessionPaths: [],
      ignore: [],
    },
    distill: { schedule: "", provider: "none", model: "" },
    mcp: { enabled: true, transport: "stdio", httpPort: 7654 },
    notification: { enabled: false, sound: false },
    site: { outputDir: "" },
    pricing: {},
    actions: {
      enabled: true,
      autoRules: false,
      ruleTarget: null,
      sessionContext: false,
      weeklyDigest: false,
      digestDay: "monday",
      ...overrides,
    },
    export: { requireConsent: true, redactionPolicy: "aggregates-only" },
  } as UnfadeConfig;
}

beforeEach(() => {
  testDir = makeTestDir();
});

afterEach(() => {
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {}
});

describe("12B.1: ActionRunner core", () => {
  it("respects config.actions.enabled gate — does nothing when disabled", async () => {
    const runner = new ActionRunner();
    let called = false;
    runner.register({
      trigger: "intelligence_update",
      name: "test_action",
      configGate: () => true,
      execute: async () => {
        called = true;
        return { action: "test", target: null, contentHash: null };
      },
    });

    const config = makeConfig();
    config.actions.enabled = false;

    await runner.fire("intelligence_update", {
      repoRoot: testDir,
      config,
      trigger: "intelligence_update",
    });
    expect(called).toBe(false);
  });

  it("logs every action to actions.jsonl", async () => {
    const runner = new ActionRunner();
    runner.register({
      trigger: "intelligence_update",
      name: "logged_action",
      configGate: () => true,
      execute: async () => ({
        action: "logged_action",
        target: "/test/path",
        contentHash: "abc123",
      }),
    });

    const config = makeConfig();
    await runner.fire("intelligence_update", {
      repoRoot: testDir,
      config,
      trigger: "intelligence_update",
    });

    const logFile = join(testDir, ".unfade", "logs", "actions.jsonl");
    expect(existsSync(logFile)).toBe(true);
    const entry = JSON.parse(readFileSync(logFile, "utf-8").trim());
    expect(entry.action).toBe("logged_action");
    expect(entry.target).toBe("/test/path");
    expect(entry.timestamp).toBeDefined();
  });
});

describe("12B.3: Rule formatter", () => {
  it("produces valid .mdc format for Cursor", () => {
    const rules = [{ pattern: "Use explicit error types", confidence: 0.9, occurrences: 5 }];
    const output = formatRules("cursor", rules, "2026-04-21");
    expect(output).toContain("---");
    expect(output).toContain("alwaysApply: true");
    expect(output).toContain("Use explicit error types");
    expect(output).toContain("90%");
  });

  it("produces valid markdown for CLAUDE.md", () => {
    const rules = [{ pattern: "Prefer parameterized queries", confidence: 0.85, occurrences: 4 }];
    const output = formatRules("claude", rules, "2026-04-21");
    expect(output).toContain("## Patterns observed by Unfade");
    expect(output).toContain("Prefer parameterized queries");
    expect(output).toContain("85%");
  });

  it("extracts high-confidence patterns from data", () => {
    const data = {
      patterns: [
        { pattern: "High confidence", confidence: 0.9, occurrences: 5 },
        { pattern: "Low confidence", confidence: 0.3, occurrences: 1 },
        { pattern: "High but rare", confidence: 0.8, occurrences: 1 },
      ],
    };
    const extracted = extractHighConfidencePatterns(data);
    expect(extracted).toHaveLength(1);
    expect(extracted[0].pattern).toBe("High confidence");
  });
});

describe("12B.4: Auto-rule action", () => {
  it("detects .cursor/ directory as target", () => {
    mkdirSync(join(testDir, ".cursor"), { recursive: true });
    const config = makeConfig({ autoRules: true });
    const detected = detectRuleTarget(testDir, config);
    expect(detected?.target).toBe("cursor");
    expect(detected?.path).toContain(".cursor/rules/unfade.mdc");
  });

  it("config.ruleTarget overrides detection", () => {
    const config = makeConfig({ autoRules: true, ruleTarget: "custom/rules.mdc" });
    const detected = detectRuleTarget(testDir, config);
    expect(detected?.target).toBe("cursor");
    expect(detected?.path).toContain("custom/rules.mdc");
  });

  it("skips when no high-confidence patterns", async () => {
    mkdirSync(join(testDir, ".cursor"), { recursive: true });
    writeFileSync(
      join(testDir, ".unfade", "intelligence", "prompt-patterns.json"),
      JSON.stringify({ patterns: [{ pattern: "weak", confidence: 0.2, occurrences: 1 }] }),
    );

    const config = makeConfig({ autoRules: true });
    const ctx = { repoRoot: testDir, config, trigger: "intelligence_update" as const };
    const outcome = await autoRulesAction.execute(ctx);
    expect(outcome.skipped).toBe(true);
    expect(outcome.reason).toBe("no_high_confidence");
  });
});

describe("12B.6: Session context", () => {
  it("replaces between markers (idempotent)", () => {
    const filePath = join(testDir, "test.md");
    writeFileSync(filePath, "# My Doc\n\nSome content\n");

    replaceMarkerSection(filePath, "TEST", "First write");
    const first = readFileSync(filePath, "utf-8");
    expect(first).toContain("<!-- BEGIN UNFADE TEST -->");
    expect(first).toContain("First write");
    expect(first).toContain("<!-- END UNFADE TEST -->");

    replaceMarkerSection(filePath, "TEST", "Second write");
    const second = readFileSync(filePath, "utf-8");
    expect(second).toContain("Second write");
    expect(second).not.toContain("First write");
    // User content preserved
    expect(second).toContain("# My Doc");
    expect(second).toContain("Some content");
  });

  it("does not modify content outside markers", () => {
    const filePath = join(testDir, "test2.md");
    const userContent =
      "# Important\n\nUser's manually written content here.\n\n## Other section\n\nMore stuff.";
    writeFileSync(filePath, userContent);

    replaceMarkerSection(filePath, "CONTEXT", "Auto-generated context");
    const result = readFileSync(filePath, "utf-8");

    // All original user content intact
    expect(result).toContain("# Important");
    expect(result).toContain("User's manually written content here.");
    expect(result).toContain("## Other section");
    expect(result).toContain("More stuff.");
  });
});

describe("12B.7/12B.8: Weekly digest", () => {
  it("generates digest JSON when stats available on correct day", async () => {
    // Write mock summary
    writeFileSync(
      join(testDir, ".unfade", "state", "summary.json"),
      JSON.stringify({
        directionDensity24h: 72,
        comprehensionScore: 85,
        eventCount24h: 15,
        topDomain: "auth",
        costPerDirectedDecision: 0.42,
      }),
    );

    const config = makeConfig({ weeklyDigest: true });
    const ctx = { repoRoot: testDir, config, trigger: "schedule_weekly" as const };

    // This will only generate if today matches the digest day
    const outcome = await weeklyDigestAction.execute(ctx);

    // Either it generated (today is Monday) or skipped (not Monday)
    expect(outcome.action).toBe("weekly_digest");
    if (!outcome.skipped) {
      expect(outcome.target).toContain("weekly-");
      expect(existsSync(outcome.target!)).toBe(true);
    }
  });
});

describe("12B: atomicWriteFile", () => {
  it("creates file atomically with correct content", () => {
    const filePath = join(testDir, "atomic-test.txt");
    atomicWriteFile(filePath, "hello world");
    expect(readFileSync(filePath, "utf-8")).toBe("hello world");
  });

  it("creates parent directories if needed", () => {
    const filePath = join(testDir, "deep", "nested", "file.txt");
    atomicWriteFile(filePath, "nested content");
    expect(readFileSync(filePath, "utf-8")).toBe("nested content");
  });
});
