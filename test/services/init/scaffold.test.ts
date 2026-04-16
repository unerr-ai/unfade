// T-031: scaffold service tests

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scaffold } from "../../../src/services/init/scaffold.js";

describe("scaffold", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `unfade-test-scaffold-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tempDir, { recursive: true });
    // Initialize a git repo so addGitExclude works.
    execSync("git init", { cwd: tempDir, stdio: "pipe" });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("T-031a: creates .unfade/ directory tree on fresh repo", () => {
    const result = scaffold(tempDir);
    expect(result.created).toBe(true);
    expect(existsSync(result.projectDir)).toBe(true);

    const subdirs = ["events", "distills", "profile", "state", "graph", "cache", "logs", "bin"];
    for (const sub of subdirs) {
      expect(existsSync(join(result.projectDir, sub))).toBe(true);
    }
  });

  it("T-031b: writes default config.json with Zod defaults", () => {
    scaffold(tempDir);
    const configPath = join(tempDir, ".unfade", "config.json");
    expect(existsSync(configPath)).toBe(true);

    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(config.version).toBe(2);
    expect(config.capture.sources.git).toBe(true);
    expect(config.distill.provider).toBe("ollama");
  });

  it("T-031c: adds .unfade/ to .git/info/exclude", () => {
    scaffold(tempDir);
    const excludePath = join(tempDir, ".git", "info", "exclude");
    const content = readFileSync(excludePath, "utf-8");
    expect(content).toContain(".unfade/");
    expect(content).toContain("# unfade-hook");
  });

  it("T-031d: idempotent — second run does not overwrite config", () => {
    scaffold(tempDir);
    const configPath = join(tempDir, ".unfade", "config.json");
    const firstContent = readFileSync(configPath, "utf-8");

    const result2 = scaffold(tempDir);
    expect(result2.created).toBe(false);

    const secondContent = readFileSync(configPath, "utf-8");
    expect(secondContent).toBe(firstContent);
  });

  it("T-031e: idempotent — git exclude not duplicated", () => {
    scaffold(tempDir);
    scaffold(tempDir);

    const excludePath = join(tempDir, ".git", "info", "exclude");
    const content = readFileSync(excludePath, "utf-8");
    const matches = content.match(/# unfade-hook/g);
    expect(matches?.length).toBe(1);
  });
});
