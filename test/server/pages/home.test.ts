// T-415 / T-416: Home inline activation + SSE wiring (Sprint 15D)
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/server/http.js";
import { invalidateSetupCache } from "../../../src/server/setup-state.js";

let tmpDir: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../../.tmp-home-page-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

describe("Home (GET /) Sprint 15D activation", () => {
  it("embeds inline activation section with subsystem rows and progress", async () => {
    const app = createApp();
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="home-activation"');
    expect(html).toContain("ha-dot-sse");
    expect(html).toContain("ha-bar");
    expect(html).toContain("Skip to dashboard");
  });

  it("wires activation persistence and SSE callback registration", async () => {
    const app = createApp();
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain("unfade-activation-seen");
    expect(html).toContain("__unfade.onSummary.push");
    expect(html).toContain("__unfade.onHealth.push");
  });

  it("includes dashboard KPI placeholders (direction strip)", async () => {
    const app = createApp();
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain("Direction");
  });
});
