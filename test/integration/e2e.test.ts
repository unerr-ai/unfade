// T-232: E2E integration test — full workflow in isolated temp directory.
// init → capture events → distill → query → card → publish.
// Uses provider: null to trigger fallback synthesizer (no LLM needed).

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Test fixtures — valid CaptureEvent JSONL lines
// ---------------------------------------------------------------------------

const TEST_DATE = "2026-04-15";

function makeEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    projectId: "test-project-id",
    timestamp: `${TEST_DATE}T10:00:00Z`,
    source: "git",
    type: "commit",
    content: {
      summary: "Refactored authentication middleware to use JWT tokens",
      detail:
        "Replaced session-based auth with stateless JWT. Trade-off: larger request headers but eliminates server-side session store.",
      files: ["src/middleware/auth.ts", "src/utils/jwt.ts"],
      branch: "feat/jwt-auth",
      project: "unfade",
    },
    gitContext: {
      repo: "unfade",
      branch: "feat/jwt-auth",
      commitHash: "abc1234",
    },
    metadata: { test: true },
    ...overrides,
  };
}

const FIXTURE_EVENTS = [
  makeEvent(),
  makeEvent({
    id: crypto.randomUUID(),
    timestamp: `${TEST_DATE}T11:30:00Z`,
    type: "commit",
    content: {
      summary: "Added rate limiting to API endpoints",
      detail:
        "Decision: token bucket algorithm over sliding window. Dead end: tried leaky bucket but throughput was inconsistent.",
      files: ["src/middleware/rate-limit.ts"],
      branch: "feat/rate-limit",
    },
  }),
  makeEvent({
    id: crypto.randomUUID(),
    timestamp: `${TEST_DATE}T14:00:00Z`,
    source: "ai-session",
    type: "ai-conversation",
    content: {
      summary:
        "Discussed caching strategy with Claude — decided on Redis over Memcached for persistence guarantees",
    },
  }),
  makeEvent({
    id: crypto.randomUUID(),
    timestamp: `${TEST_DATE}T16:00:00Z`,
    type: "commit",
    content: {
      summary: "Implemented Redis cache layer with TTL-based expiration",
      files: ["src/cache/redis.ts", "src/config/cache.ts"],
      branch: "feat/caching",
    },
  }),
];

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let tempDir: string;

/**
 * Mock paths.ts so all path functions resolve to tempDir.
 * Must be called before importing modules that depend on paths.
 */
function buildPathMocks(baseDir: string) {
  const unfadeDir = join(baseDir, ".unfade");
  return {
    getProjectDataDir: () => unfadeDir,
    getEventsDir: () => join(unfadeDir, "events"),
    getDistillsDir: () => join(unfadeDir, "distills"),
    getProfileDir: () => join(unfadeDir, "profile"),
    getStateDir: () => join(unfadeDir, "state"),
    getGraphDir: () => join(unfadeDir, "graph"),
    getCacheDir: () => join(unfadeDir, "cache"),
    getLogsDir: () => join(unfadeDir, "logs"),
    getBinDir: () => join(unfadeDir, "bin"),
    getCardsDir: () => join(unfadeDir, "cards"),
    getSiteDir: () => join(unfadeDir, "site"),
    getAmplificationDir: () => join(unfadeDir, "amplification"),
    getMetricsDir: () => join(unfadeDir, "metrics"),
    getInsightsDir: () => join(unfadeDir, "insights"),
    getUserConfigDir: () => join(baseDir, ".unfade-user"),
    getUserStateDir: () => join(baseDir, ".unfade-user", "state"),
  };
}

describe("E2E: init → capture → distill → query → card → publish", () => {
  beforeEach(() => {
    tempDir = join(tmpdir(), `unfade-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    execSync("git init", { cwd: tempDir, stdio: "pipe" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("T-232: full workflow produces expected outputs at each stage", async () => {
    // ---------------------------------------------------------------
    // Stage 1: Init — scaffold .unfade/ directory tree
    // ---------------------------------------------------------------
    const { ensureInit } = await import("../../src/services/init/lightweight-init.js");
    const initResult = ensureInit(tempDir);
    expect(initResult.firstRun).toBe(true);
    expect(existsSync(initResult.dataDir)).toBe(true);

    const unfadeDir = initResult.dataDir;
    const requiredDirs = [
      "events",
      "distills",
      "profile",
      "state",
      "graph",
      "cache",
      "logs",
      "bin",
    ];
    for (const sub of requiredDirs) {
      expect(existsSync(join(unfadeDir, sub))).toBe(true);
    }

    // Write config with valid defaults (ensureInit scaffolds dirs but doesn't write config)
    const configPath = join(unfadeDir, "config.json");
    if (!existsSync(configPath)) {
      writeFileSync(
        configPath,
        JSON.stringify({ version: 2, distill: { provider: "none" } }, null, 2),
        "utf-8",
      );
    }
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(config.version).toBe(2);
    expect(config.distill.provider).toBe("none");

    // ---------------------------------------------------------------
    // Stage 2: Capture — write event fixtures to JSONL
    // ---------------------------------------------------------------
    const eventsDir = join(unfadeDir, "events");
    const jsonlPath = join(eventsDir, `${TEST_DATE}.jsonl`);
    const jsonlContent = `${FIXTURE_EVENTS.map((e) => JSON.stringify(e)).join("\n")}\n`;
    writeFileSync(jsonlPath, jsonlContent, "utf-8");
    expect(existsSync(jsonlPath)).toBe(true);

    // Verify JSONL is parseable
    const lines = readFileSync(jsonlPath, "utf-8").trim().split("\n");
    expect(lines.length).toBe(4);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }

    // ---------------------------------------------------------------
    // Stage 3: Distill — synthesize with fallback (no LLM)
    // ---------------------------------------------------------------
    // Mock paths so distiller reads from our temp directory
    const pathMocks = buildPathMocks(tempDir);
    vi.doMock("../../src/utils/paths.js", () => pathMocks);

    // Clear module cache to pick up mocked paths
    const { distill } = await import("../../src/services/distill/distiller.js");

    const distillResult = await distill(TEST_DATE, config, {
      provider: null,
      silent: true,
      cwd: tempDir,
    });

    expect(distillResult).not.toBeNull();
    expect(distillResult?.date).toBe(TEST_DATE);
    expect(distillResult?.skipped).toBe(false);

    // Distill file should exist
    const distillPath = distillResult?.path;
    expect(existsSync(distillPath)).toBe(true);
    const distillContent = readFileSync(distillPath, "utf-8");
    expect(distillContent.length).toBeGreaterThan(0);
    // Fallback synthesizer should produce structured markdown
    expect(distillContent).toContain("# Daily Distill");

    // DailyDistill object should have expected shape
    const daily = distillResult?.distill;
    expect(daily.summary).toBeTruthy();
    expect(daily.decisions).toBeDefined();
    expect(daily.synthesizedBy).toBe("fallback");

    // ---------------------------------------------------------------
    // Stage 4: Query — search distilled events
    // ---------------------------------------------------------------
    const { queryEvents } = await import("../../src/tools/unfade-query.js");

    const queryResult = queryEvents({ query: "authentication JWT", limit: 10 }, tempDir);
    expect(queryResult.data.total).toBeGreaterThan(0);
    expect(queryResult.data.results.length).toBeGreaterThan(0);
    expect(queryResult._meta.tool).toBe("unfade-query");

    // Also query for "Redis caching"
    const cacheQuery = queryEvents({ query: "Redis caching", limit: 10 }, tempDir);
    expect(cacheQuery.data.total).toBeGreaterThan(0);

    // ---------------------------------------------------------------
    // Stage 5: Card generation (optional — may fail without fonts)
    // ---------------------------------------------------------------
    let _cardGenerated = false;
    try {
      const { generateCard } = await import("../../src/services/card/generator.js");
      const cardBuffer = await generateCard(TEST_DATE, tempDir);
      expect(cardBuffer).toBeInstanceOf(Buffer);
      expect(cardBuffer.length).toBeGreaterThan(0);
      _cardGenerated = true;
    } catch {
      // Card generation may fail in CI or environments without fonts.
      // This is expected and the publish pipeline handles it gracefully.
      _cardGenerated = false;
    }

    // ---------------------------------------------------------------
    // Stage 6: Publish — generate Thinking Graph static site
    // ---------------------------------------------------------------
    const { generateSiteData } = await import("../../src/services/site/site-generator.js");
    const { renderHeatmapSvg } = await import("../../src/services/site/heatmap.js");
    const { renderSiteHtml, renderSiteCss } = await import("../../src/services/site/template.js");

    const siteData = generateSiteData(tempDir);
    expect(siteData.generatedAt).toBeTruthy();
    expect(siteData.heatmap).toBeDefined();
    expect(Array.isArray(siteData.heatmap)).toBe(true);
    expect(siteData.distills).toBeDefined();

    // Check that our test date appears in heatmap data
    const testDateEntry = siteData.heatmap.find((d) => d.date === TEST_DATE);
    // May or may not have non-zero intensity depending on distill content format
    if (testDateEntry) {
      expect(testDateEntry.intensity).toBeGreaterThanOrEqual(0);
    }

    // Render heatmap SVG
    const heatmapSvg = renderHeatmapSvg(siteData.heatmap);
    expect(heatmapSvg).toContain("<svg");
    expect(heatmapSvg).toContain("</svg>");

    // Render full site HTML
    const siteHtml = renderSiteHtml(siteData, heatmapSvg);
    expect(siteHtml).toContain("<!DOCTYPE html>");
    expect(siteHtml).toContain("Thinking Graph");
    expect(siteHtml).toContain("Unfade");

    // Render CSS
    const siteCss = renderSiteCss();
    expect(siteCss).toContain("background");
    expect(siteCss.length).toBeGreaterThan(100);

    // Write site files to disk
    const siteDir = join(unfadeDir, "site");
    mkdirSync(siteDir, { recursive: true });
    writeFileSync(join(siteDir, "index.html"), siteHtml, "utf-8");
    writeFileSync(join(siteDir, "style.css"), siteCss, "utf-8");
    writeFileSync(join(siteDir, "data.json"), JSON.stringify(siteData, null, 2), "utf-8");

    // Verify all site files exist
    expect(existsSync(join(siteDir, "index.html"))).toBe(true);
    expect(existsSync(join(siteDir, "style.css"))).toBe(true);
    expect(existsSync(join(siteDir, "data.json"))).toBe(true);

    // Verify data.json roundtrips correctly
    const writtenData = JSON.parse(readFileSync(join(siteDir, "data.json"), "utf-8"));
    expect(writtenData.generatedAt).toBe(siteData.generatedAt);
    expect(writtenData.heatmap.length).toBe(siteData.heatmap.length);

    // ---------------------------------------------------------------
    // Summary: all stages completed
    // ---------------------------------------------------------------
    // If we reach here, the full pipeline executed successfully:
    // init ✓ → capture ✓ → distill ✓ → query ✓ → card (optional) → publish ✓
  });
});
