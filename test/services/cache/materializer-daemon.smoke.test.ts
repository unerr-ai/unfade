import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MaterializerDaemon } from "../../../src/services/cache/materializer-daemon.js";

describe("MaterializerDaemon (UF-211)", () => {
  let root: string;

  afterEach(async () => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("materializes JSONL events into SQLite", async () => {
    root = mkdtempSync(join(tmpdir(), "unfade-mat-"));
    execSync("git init", { cwd: root, stdio: "ignore" });

    const eventsDir = join(root, ".unfade", "events");
    mkdirSync(eventsDir, { recursive: true });

    const day = new Date().toISOString().slice(0, 10);
    const line = {
      id: "550e8400-e29b-41d4-a716-446655440002",
      timestamp: new Date().toISOString(),
      source: "ai-session",
      type: "ai-conversation",
      content: { summary: "test", detail: "src/foo/bar.ts change" },
      metadata: {
        model: "gpt-4",
        ai_tool: "cursor",
        direction_signals: { human_direction_score: 0.55 },
      },
    };
    writeFileSync(join(eventsDir, `${day}.jsonl`), `${JSON.stringify(line)}\n`);

    const daemon = new MaterializerDaemon({
      cwd: root,
      intervalMs: 999_999,
    });

    await daemon.start();

    const db = await daemon.getCache().getDb();
    expect(db).not.toBeNull();
    if (!db) throw new Error("expected db");
    const count = db.exec("SELECT COUNT(*) FROM events");
    expect((count[0]?.values[0]?.[0] as number) ?? 0).toBeGreaterThanOrEqual(1);

    await daemon.close();
  });
});
