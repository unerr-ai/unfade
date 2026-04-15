// T-033: fingerprint service tests
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fingerprint } from "../../../src/services/init/fingerprint.js";

describe("fingerprint", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `unfade-test-fp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    execSync("git init", { cwd: tempDir, stdio: "pipe" });
    execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: "pipe" });
    execSync('git config user.name "Test"', { cwd: tempDir, stdio: "pipe" });

    // Create .unfade/profile/ directory.
    mkdirSync(join(tempDir, ".unfade", "profile"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("T-033a: returns valid fingerprint on repo with commits", () => {
    // Create a TS file and commit it.
    writeFileSync(join(tempDir, "index.ts"), "export const x = 1;");
    execSync("git add . && git commit -m 'init'", { cwd: tempDir, stdio: "pipe" });

    const fp = fingerprint(tempDir);
    expect(fp.generatedAt).toBeTruthy();
    expect(fp.commitCount30d).toBeGreaterThanOrEqual(1);
    expect(fp.branchCount).toBeGreaterThanOrEqual(1);
    expect(fp.domains.length).toBeGreaterThanOrEqual(1);
    expect(fp.primaryDomain).toBe("typescript");
  });

  it("T-033b: writes reasoning_model.json", () => {
    writeFileSync(join(tempDir, "main.go"), "package main");
    execSync("git add . && git commit -m 'go project'", { cwd: tempDir, stdio: "pipe" });

    fingerprint(tempDir);

    const modelPath = join(tempDir, ".unfade", "profile", "reasoning_model.json");
    expect(existsSync(modelPath)).toBe(true);

    const model = JSON.parse(readFileSync(modelPath, "utf-8"));
    expect(model.primaryDomain).toBe("go");
  });

  it("T-033c: idempotent — does not overwrite existing model file", () => {
    writeFileSync(join(tempDir, "app.py"), "print('hello')");
    execSync("git add . && git commit -m 'py'", { cwd: tempDir, stdio: "pipe" });

    fingerprint(tempDir);
    const modelPath = join(tempDir, ".unfade", "profile", "reasoning_model.json");
    const firstContent = readFileSync(modelPath, "utf-8");

    // Wait a tick so timestamp would differ if overwritten.
    fingerprint(tempDir);
    const secondContent = readFileSync(modelPath, "utf-8");
    expect(secondContent).toBe(firstContent);
  });

  it("T-033d: handles empty repo with no commits", () => {
    const fp = fingerprint(tempDir);
    expect(fp.commitCount30d).toBe(0);
    expect(fp.domains).toEqual([]);
    expect(fp.primaryDomain).toBeNull();
  });

  it("T-033e: infers decision style from commit/branch counts", () => {
    writeFileSync(join(tempDir, "a.ts"), "const a = 1;");
    execSync("git add . && git commit -m 'a'", { cwd: tempDir, stdio: "pipe" });

    const fp = fingerprint(tempDir);
    // With 1 commit and 1 branch, should be "mixed".
    expect(fp.reasoningModelSeed.decisionStyle).toBe("mixed");
  });
});
