// Tests for UF-051: GET /unfade/profile route
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/server/http.js";

let tmpDir: string;
let originalCwd: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../../.tmp-prof-route-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

beforeAll(() => {
  originalCwd = process.cwd();
});

afterAll(() => {
  process.chdir(originalCwd);
});

beforeEach(() => {
  tmpDir = makeTmpDir();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe("GET /unfade/profile", () => {
  it("returns reasoning profile", async () => {
    const profileDir = join(tmpDir, ".unfade", "profile");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(
      join(profileDir, "reasoning_model.json"),
      JSON.stringify({
        version: 1,
        updatedAt: "2026-04-15T10:00:00Z",
        distillCount: 5,
        avgAlternativesEvaluated: 2.5,
        aiAcceptanceRate: 0.8,
        aiModificationRate: 0.1,
        avgDecisionsPerDay: 3,
        avgDeadEndsPerDay: 0.5,
        domainDistribution: [{ domain: "TypeScript", frequency: 10, lastSeen: "2026-04-15" }],
        patterns: ["Polyglot"],
      }),
      "utf-8",
    );

    const app = createApp();
    const res = await app.request("/unfade/profile");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.distillCount).toBe(5);
    expect(body.data.patterns).toContain("Polyglot");
    expect(body._meta.tool).toBe("unfade-profile");
    expect(body._meta.degraded).toBe(false);
  });

  it("returns degraded profile when no file exists", async () => {
    const app = createApp();
    const res = await app.request("/unfade/profile");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body._meta.degraded).toBe(true);
    expect(body.data.distillCount).toBe(0);
  });
});
