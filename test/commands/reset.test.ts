import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCommand } from "../../src/commands/reset.js";
import { loadRegistry, registerRepo } from "../../src/services/registry/registry.js";
import { getProjectDataDir, getUserConfigDir } from "../../src/utils/paths.js";

vi.mock("../../src/utils/ipc.js", () => ({
  stopDaemon: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("../../src/services/shell/installer.js", () => ({
  removeShellHooks: vi.fn().mockReturnValue(true),
}));

describe("resetCommand", () => {
  let tmp: string;
  let prevHome: string | undefined;
  let prevCwd: string;

  beforeEach(() => {
    prevCwd = process.cwd();
    tmp = join(tmpdir(), `uf-reset-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(tmp, ".git"), { recursive: true });
    mkdirSync(join(tmp, ".unfade", "state"), { recursive: true });
    writeFileSync(join(tmp, ".unfade", "config.json"), "{}\n", "utf-8");
    prevHome = process.env.HOME;
    const fakeHome = join(tmp, "home");
    mkdirSync(fakeHome, { recursive: true });
    process.env.HOME = fakeHome;
    process.chdir(tmp);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    process.env.HOME = prevHome;
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      // tmp may be removed by reset
    }
    vi.clearAllMocks();
  });

  it("removes project .unfade, global ~/.unfade, and prunes registry data on disk", async () => {
    const resolvedRoot = resolve(tmp);
    registerRepo(resolvedRoot);
    const registry = loadRegistry();
    expect(registry.repos.length).toBe(1);

    const home = process.env.HOME;
    expect(home).toBeDefined();
    const globalRoot = join(home as string, ".unfade");
    mkdirSync(join(globalRoot, "state"), { recursive: true });
    writeFileSync(join(globalRoot, "state", "marker.txt"), "x", "utf-8");

    await resetCommand();

    expect(existsSync(join(tmp, ".unfade"))).toBe(false);
    expect(existsSync(globalRoot)).toBe(false);
    expect(existsSync(getProjectDataDir())).toBe(false);
    expect(existsSync(getUserConfigDir())).toBe(false);

    const afterRegistry = loadRegistry();
    expect(afterRegistry.repos.length).toBe(0);
  });
});
