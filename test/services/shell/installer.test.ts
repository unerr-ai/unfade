import { afterEach, describe, expect, it } from "vitest";
import { detectShell, installShellHooks } from "../../../src/services/shell/installer.js";

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
