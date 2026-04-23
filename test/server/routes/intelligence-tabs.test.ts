// T-412: Intelligence Hub htmx tab partials (Sprint 15C)
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/server/http.js";
import { invalidateSetupCache } from "../../../src/server/setup-state.js";

let tmpDir: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../../.tmp-intel-tabs-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

describe("Intelligence tab partials", () => {
  it("GET /intelligence/tab/cost returns cost shell with estimate affordance", async () => {
    const app = createApp();
    const res = await app.request("/intelligence/tab/cost");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("cost-total");
    expect(html).toContain("≈ estimate");
    expect(html).toContain("/api/intelligence/costs");
  });

  it("GET /intelligence/tab/autonomy returns autonomy shell with independence index (Sprint 15F)", async () => {
    const app = createApp();
    const res = await app.request("/intelligence/tab/autonomy");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("autonomy-gauge");
    expect(html).toContain("autonomy-heatmap");
    expect(html).toContain("/api/intelligence/autonomy");
  });

  it("GET /intelligence/tab/maturity returns maturity shell (Sprint 15G UF-451)", async () => {
    const app = createApp();
    const res = await app.request("/intelligence/tab/maturity");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("maturity-phase");
    expect(html).toContain("maturity-radar");
    expect(html).toContain("/api/intelligence/maturity-assessment");
  });

  it("GET /intelligence/tab/git-expertise returns git shell (Sprint 15G UF-452)", async () => {
    const app = createApp();
    const res = await app.request("/intelligence/tab/git-expertise");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("gitex-ownership");
    expect(html).toContain("gitex-churn");
    expect(html).toContain("/api/intelligence/expertise-map");
  });

  it("GET /intelligence/tab/narratives returns narratives shell (Sprint 15G UF-453)", async () => {
    const app = createApp();
    const res = await app.request("/intelligence/tab/narratives");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("narr-diagnostics");
    expect(html).toContain("narr-prescriptions");
    expect(html).toContain("/api/intelligence/narratives");
  });
});
