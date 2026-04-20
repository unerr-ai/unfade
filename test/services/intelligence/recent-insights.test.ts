import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendRecentInsight } from "../../../src/services/intelligence/recent-insights.js";

describe("recent-insights (UF-228 writer)", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("appends insight lines and caps ring buffer", () => {
    dir = mkdtempSync(join(tmpdir(), "unfade-insights-"));

    for (let i = 0; i < 105; i++) {
      appendRecentInsight(dir, { claim: `tick-${i}`, insightType: "test" });
    }

    const path = join(dir, ".unfade", "insights", "recent.jsonl");
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBeLessThanOrEqual(100);
    const last = lines[lines.length - 1];
    expect(last).toBeDefined();
    expect(JSON.parse(last as string).claim).toBe("tick-104");
  });
});
