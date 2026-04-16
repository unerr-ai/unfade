// T-148: Web UI — GET /profile returns profile visualization HTML page
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpDir: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../../.tmp-profile-page-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

beforeEach(() => {
  tmpDir = makeTmpDir();
});

afterEach(() => {
  vi.restoreAllMocks();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe("Profile page (GET /profile)", () => {
  it("returns HTML page with profile metrics", async () => {
    const { createApp } = await import("../../../src/server/http.js");
    const app = createApp();
    const res = await app.request("/profile");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<html");
    expect(html).toContain("Reasoning Fingerprint");
    expect(html).toContain("stat-grid");
  });

  it("shows degraded message when no profile exists", async () => {
    const { createApp } = await import("../../../src/server/http.js");
    const app = createApp();
    const res = await app.request("/profile");
    const html = await res.text();
    expect(html).toContain("Not enough data");
  });

  it("shows domain distribution when profile exists", async () => {
    const profileDir = join(tmpDir, ".unfade", "profile");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(
      join(profileDir, "reasoning_model.json"),
      JSON.stringify({
        version: 1,
        updatedAt: "2026-04-16T00:00:00Z",
        distillCount: 5,
        avgAlternativesEvaluated: 2.5,
        aiAcceptanceRate: 0.7,
        aiModificationRate: 0.2,
        avgDecisionsPerDay: 3.0,
        avgDeadEndsPerDay: 1.0,
        domainDistribution: [
          { domain: "backend", frequency: 10, lastSeen: "2026-04-16" },
          { domain: "frontend", frequency: 5, lastSeen: "2026-04-15" },
        ],
        patterns: ["Explores 2+ alternatives before deciding"],
      }),
    );

    // Mock paths to point to tmp dir
    vi.doMock("../../../src/utils/paths.js", async (importOriginal) => {
      const original = (await importOriginal()) as Record<string, unknown>;
      return {
        ...original,
        getProfileDir: () => profileDir,
      };
    });

    vi.resetModules();
    const { createApp } = await import("../../../src/server/http.js");
    const app = createApp();
    const res = await app.request("/profile");
    const html = await res.text();
    expect(html).toContain("backend");
    expect(html).toContain("frontend");
    expect(html).toContain("Explores 2+ alternatives before deciding");
    expect(html).not.toContain("Not enough data");
  });

  it("includes AI acceptance and modification rates", async () => {
    const { createApp } = await import("../../../src/server/http.js");
    const app = createApp();
    const res = await app.request("/profile");
    const html = await res.text();
    expect(html).toContain("AI acceptance rate");
    expect(html).toContain("AI modification rate");
  });
});
