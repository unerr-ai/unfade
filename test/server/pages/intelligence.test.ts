// T-411: Intelligence Hub — tab shell and stable tab ids (Sprint 15C)
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/server/http.js";
import { invalidateSetupCache } from "../../../src/server/setup-state.js";

let tmpDir: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../../.tmp-intel-page-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

beforeEach(() => {
  tmpDir = makeTmpDir();
  process.env.UNFADE_HOME = join(tmpDir, ".unfade");
  mkdirSync(join(tmpDir, ".unfade", "state"), { recursive: true });
  writeFileSync(
    join(tmpDir, ".unfade", "state", "setup-status.json"),
    '{"setupCompleted":true}',
    "utf-8",
  );
  invalidateSetupCache();
});

afterEach(() => {
  delete process.env.UNFADE_HOME;
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe("Intelligence Hub (GET /intelligence)", () => {
  it("renders five tab anchors/buttons with stable ids", async () => {
    const app = createApp();
    const res = await app.request("/intelligence");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Intelligence Hub");
    expect(html).toContain('id="tab-overview"');
    expect(html).toContain('id="tab-comprehension"');
    expect(html).toContain('id="tab-velocity"');
    expect(html).toContain('id="tab-cost"');
    expect(html).toContain('id="tab-patterns"');
  });
});
