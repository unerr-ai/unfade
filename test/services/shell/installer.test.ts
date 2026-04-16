import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectShell,
  generateHookCode,
  installShellHooks,
  isHookInstalled,
} from "../../../src/services/shell/installer.js";

describe("detectShell", () => {
  const originalShell = process.env.SHELL;

  afterEach(() => {
    if (originalShell !== undefined) {
      process.env.SHELL = originalShell;
    } else {
      delete process.env.SHELL;
    }
  });

  it("T-034a: detects zsh", () => {
    process.env.SHELL = "/bin/zsh";
    expect(detectShell()).toBe("zsh");
  });

  it("T-034b: detects bash", () => {
    process.env.SHELL = "/usr/bin/bash";
    expect(detectShell()).toBe("bash");
  });

  it("T-034c: detects fish", () => {
    process.env.SHELL = "/usr/local/bin/fish";
    expect(detectShell()).toBe("fish");
  });

  it("T-034d: returns unknown for unrecognized shell", () => {
    process.env.SHELL = "/usr/bin/nushell";
    expect(detectShell()).toBe("unknown");
  });

  it("T-034e: returns unknown when SHELL is unset", () => {
    delete process.env.SHELL;
    expect(detectShell()).toBe("unknown");
  });
});

describe("installShellHooks", () => {
  // These tests mock homedir to use a temp directory, but the installer reads
  // process.env.SHELL for detection. We test hook content generation indirectly
  // by checking what gets written to the RC file.

  it("T-034f: skips install on unknown shell", () => {
    const oldShell = process.env.SHELL;
    process.env.SHELL = "/usr/bin/nushell";

    const result = installShellHooks("/fake/unfade-send");
    expect(result.installed).toBe(false);
    expect(result.alreadyPresent).toBe(false);
    expect(result.shell).toBe("unknown");

    process.env.SHELL = oldShell;
  });
});

describe("generateHookCode", () => {
  it("T-175: generates zsh hook with preexec/precmd and add-zsh-hook", () => {
    const code = generateHookCode("zsh", "/path/to/unfade-send");
    expect(code).toContain("unfade_preexec");
    expect(code).toContain("unfade_precmd");
    expect(code).toContain("add-zsh-hook preexec unfade_preexec");
    expect(code).toContain("add-zsh-hook precmd unfade_precmd");
    expect(code).toContain("/path/to/unfade-send");
    expect(code).toContain("2>/dev/null");
  });

  it("T-176: generates bash hook with DEBUG trap and PROMPT_COMMAND", () => {
    const code = generateHookCode("bash", "/path/to/unfade-send");
    expect(code).toContain("_unfade_preexec");
    expect(code).toContain("_unfade_precmd");
    expect(code).toContain("trap '_unfade_preexec' DEBUG");
    expect(code).toContain("PROMPT_COMMAND");
    expect(code).toContain("/path/to/unfade-send");
    expect(code).toContain("2>/dev/null");
  });

  it("T-177: generates fish hook with fish events", () => {
    const code = generateHookCode("fish", "/path/to/unfade-send");
    expect(code).toContain("--on-event fish_preexec");
    expect(code).toContain("--on-event fish_postexec");
    expect(code).toContain("/path/to/unfade-send");
    expect(code).toContain("2>/dev/null");
  });

  it("hook code sends JSON with cmd, exit, duration, cwd", () => {
    const code = generateHookCode("zsh", "/bin/unfade-send");
    expect(code).toContain('"cmd"');
    expect(code).toContain('"exit"');
    expect(code).toContain('"duration"');
    expect(code).toContain('"cwd"');
  });

  it("hook send is backgrounded with &", () => {
    for (const shell of ["zsh", "bash", "fish"] as const) {
      const code = generateHookCode(shell, "/bin/unfade-send");
      expect(code).toContain("&");
    }
  });
});

describe("isHookInstalled", () => {
  let tmpDir: string;
  const originalHome = process.env.HOME;

  beforeEach(() => {
    tmpDir = join(
      import.meta.dirname ?? ".",
      `../../../.tmp-hook-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tmpDir, { recursive: true });
    process.env.HOME = tmpDir;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("returns false when rc file does not exist", () => {
    expect(isHookInstalled("zsh")).toBe(false);
  });

  it("returns false when rc file exists but has no marker", () => {
    writeFileSync(join(tmpDir, ".zshrc"), "# some config\n");
    expect(isHookInstalled("zsh")).toBe(false);
  });

  it("returns true when rc file contains hook marker", () => {
    writeFileSync(join(tmpDir, ".zshrc"), "# some config\n# unfade-hook\nstuff\n# /unfade-hook\n");
    expect(isHookInstalled("zsh")).toBe(true);
  });
});
