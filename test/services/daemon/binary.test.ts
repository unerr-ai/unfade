// T-038: daemon binary management tests
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isDaemonRunning,
  registerRepo,
  unregisterRepo,
} from "../../../src/services/daemon/binary.js";

describe("isDaemonRunning", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `unfade-test-binary-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(join(tempDir, ".unfade", "state"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("T-038a: returns false when no PID file exists", () => {
    expect(isDaemonRunning(tempDir)).toBe(false);
  });

  it("T-038b: returns false when PID file contains invalid value", () => {
    writeFileSync(join(tempDir, ".unfade", "state", "daemon.pid"), "not-a-number", "utf-8");
    expect(isDaemonRunning(tempDir)).toBe(false);
  });

  it("T-038c: returns false when PID file points to dead process", () => {
    // Use a very high PID that almost certainly doesn't exist.
    writeFileSync(join(tempDir, ".unfade", "state", "daemon.pid"), "999999999", "utf-8");
    expect(isDaemonRunning(tempDir)).toBe(false);
  });

  it("T-038d: returns true for current process PID", () => {
    writeFileSync(join(tempDir, ".unfade", "state", "daemon.pid"), String(process.pid), "utf-8");
    expect(isDaemonRunning(tempDir)).toBe(true);
  });
});

describe("registerRepo", () => {
  let tempHome: string;
  const originalHome = process.env.HOME;

  beforeEach(() => {
    tempHome = join(
      tmpdir(),
      `unfade-test-register-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tempHome, { recursive: true });
    process.env.HOME = tempHome;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    rmSync(tempHome, { recursive: true, force: true });
  });

  it("T-038e: creates repos.json with project entry", () => {
    registerRepo("/fake/project/.unfade");

    const reposFile = join(tempHome, ".unfade", "state", "repos.json");
    expect(existsSync(reposFile)).toBe(true);

    const repos = JSON.parse(require("node:fs").readFileSync(reposFile, "utf-8"));
    expect(repos.length).toBe(1);
    expect(repos[0].path).toBe("/fake/project/.unfade");
    expect(repos[0].addedAt).toBeTruthy();
  });

  it("T-038f: does not duplicate entries", () => {
    registerRepo("/fake/project/.unfade");
    registerRepo("/fake/project/.unfade");

    const reposFile = join(tempHome, ".unfade", "state", "repos.json");
    const repos = JSON.parse(require("node:fs").readFileSync(reposFile, "utf-8"));
    expect(repos.length).toBe(1);
  });

  it("unregisterRepo removes matching path", () => {
    registerRepo("/fake/project/.unfade");
    registerRepo("/other/.unfade");
    unregisterRepo("/fake/project/.unfade");

    const reposFile = join(tempHome, ".unfade", "state", "repos.json");
    const repos = JSON.parse(require("node:fs").readFileSync(reposFile, "utf-8"));
    expect(repos.length).toBe(1);
    expect(repos[0].path).toBe("/other/.unfade");
  });
});
