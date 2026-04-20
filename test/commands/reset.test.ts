import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCommand } from "../../src/commands/reset.js";
import {
  removeAutostartEntirely,
  removeAutostartIfOwnedByProject,
} from "../../src/services/init/autostart.js";
import { loadRegistry, registerRepo } from "../../src/services/registry/registry.js";
import { getProjectDataDir, getUserConfigDir } from "../../src/utils/paths.js";

vi.mock("../../src/utils/ipc.js", () => ({
  stopDaemon: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("../../src/services/init/autostart.js", () => ({
  removeAutostartIfOwnedByProject: vi.fn().mockReturnValue(false),
  removeAutostartEntirely: vi.fn().mockReturnValue(false),
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

  it("refuses to run without --yes", async () => {
    process.exitCode = undefined;
    await resetCommand({ yes: false });
    expect(process.exitCode).toBe(1);
    expect(existsSync(join(tmp, ".unfade"))).toBe(true);
  });

  it("removes .unfade and prunes registry when --yes", async () => {
    const { resolve } = require("node:path");
    const resolvedRoot = resolve(tmp);
    registerRepo(resolvedRoot);
    const registry = loadRegistry();
    expect(registry.repos.length).toBe(1);

    await resetCommand({ yes: true, keepHooks: true });

    expect(existsSync(join(tmp, ".unfade"))).toBe(false);
    const afterRegistry = loadRegistry();
    expect(afterRegistry.repos.length).toBe(0);
    expect(removeAutostartIfOwnedByProject).toHaveBeenCalled();
    expect(removeAutostartEntirely).not.toHaveBeenCalled();
  });

  it("with --global removes ~/.unfade and calls removeAutostartEntirely", async () => {
    const home = process.env.HOME;
    expect(home).toBeDefined();
    const globalRoot = join(home as string, ".unfade");
    mkdirSync(join(globalRoot, "state"), { recursive: true });
    writeFileSync(join(globalRoot, "state", "marker.txt"), "x", "utf-8");

    await resetCommand({ yes: true, keepHooks: true, global: true });

    expect(existsSync(globalRoot)).toBe(false);
    expect(removeAutostartEntirely).toHaveBeenCalled();
    expect(removeAutostartIfOwnedByProject).not.toHaveBeenCalled();
    const dataDir = getProjectDataDir();
    expect(existsSync(dataDir)).toBe(false);
    expect(existsSync(getUserConfigDir())).toBe(false);
  });
});
