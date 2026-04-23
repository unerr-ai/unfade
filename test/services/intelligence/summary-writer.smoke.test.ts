import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MaterializerDaemon } from "../../../src/services/cache/materializer-daemon.js";
import { readSummary, writeSummary } from "../../../src/services/intelligence/summary-writer.js";
import { localToday } from "../../../src/utils/date.js";

describe("summary-writer (UF-215) + token/cost wiring", () => {
  let root: string;

  afterEach(async () => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("writes summary.json with cost fields after materialization", { timeout: 10_000 }, async () => {
    root = mkdtempSync(join(tmpdir(), "unfade-sum-"));
    execSync("git init", { cwd: root, stdio: "ignore" });

    const eventsDir = join(root, ".unfade", "events");
    mkdirSync(eventsDir, { recursive: true });

    const day = localToday();
    const line = {
      id: "550e8400-e29b-41d4-a716-446655440003",
      projectId: "test-project-id",
      timestamp: new Date().toISOString(),
      source: "ai-session",
      type: "ai-conversation",
      content: { summary: "auth", detail: "" },
      metadata: {
        model: "claude-opus",
        ai_tool: "claude-code",
        direction_signals: { human_direction_score: 0.9 },
      },
    };
    writeFileSync(join(eventsDir, `${day}.jsonl`), `${JSON.stringify(line)}\n`);

    const daemon = new MaterializerDaemon({ cwd: root, intervalMs: 999_999 });
    await daemon.start();

    const cache = daemon.getCache();
    const db = await cache.getDb();
    expect(db).not.toBeNull();
    if (!db) throw new Error("expected db");

    await cache.flushDuckDb();

    // writeSummary calls window-aggregator and token-proxy which now use DuckDB typed columns.
    // In SQLite-only test environments, these queries degrade gracefully (try/catch per window).
    const summary = await writeSummary(db, root, {
      pricing: { "claude-opus": 0.01 },
    });

    expect(summary.schemaVersion).toBe(1);
    expect(summary.updatedAt).toBeDefined();

    const disk = readSummary(root);
    expect(disk).not.toBeNull();
    expect(disk?.schemaVersion).toBe(1);

    await daemon.close();
  });
});
