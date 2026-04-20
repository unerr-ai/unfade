import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("registry v1 migration smoke", () => {
  let home: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    prevHome = process.env.HOME;
    home = mkdtempSync(join(tmpdir(), "unfade-reg-home-"));
    process.env.HOME = home;
    vi.resetModules();
  });

  afterEach(() => {
    process.env.HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
    vi.resetModules();
  });

  it("migrates legacy repos.json to registry with canonical git roots", async () => {
    const state = join(home, ".unfade", "state");
    mkdirSync(state, { recursive: true });
    const repoPath = join(home, "myrepo", ".unfade");
    writeFileSync(
      join(state, "repos.json"),
      JSON.stringify([{ path: repoPath, addedAt: "2020-01-01T00:00:00.000Z" }]),
    );

    const { loadRegistry } = await import("../../../src/services/registry/registry.js");
    const reg = loadRegistry();
    expect(reg.schemaVersion).toBe(1);
    expect(reg.repos).toHaveLength(1);
    expect(reg.repos[0]?.root).toBe(join(home, "myrepo"));
    expect(reg.repos[0]?.paths.data).toBe(join(home, "myrepo", ".unfade"));

    const written = readFileSync(join(state, "registry.v1.json"), "utf-8");
    expect(written).toContain('"schemaVersion": 1');
  });
});
