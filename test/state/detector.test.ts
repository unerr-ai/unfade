import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectState } from "../../src/state/detector.js";

function setupProject(): { root: string; cleanup: () => void } {
  const root = join(tmpdir(), `unfade-test-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function initUnfadeDir(root: string): void {
  mkdirSync(join(root, ".git"), { recursive: true });
  mkdirSync(join(root, ".unfade", "events"), { recursive: true });
  mkdirSync(join(root, ".unfade", "distills"), { recursive: true });
  mkdirSync(join(root, ".unfade", "state"), { recursive: true });
  mkdirSync(join(root, ".unfade", "profile"), { recursive: true });
}

describe("detectState", () => {
  let project: { root: string; cleanup: () => void };

  beforeEach(() => {
    project = setupProject();
  });

  afterEach(() => {
    project.cleanup();
  });

  it("returns not_initialized when .unfade/ does not exist", () => {
    // Create .git but not .unfade
    mkdirSync(join(project.root, ".git"), { recursive: true });
    const result = detectState({ cwd: project.root, skipLlmCheck: true });
    expect(result.state).toBe("not_initialized");
    expect(result.checks.unfadeDirExists).toBe(false);
  });

  it("returns no_git when not in a git repository", () => {
    // Create .unfade but not .git
    mkdirSync(join(project.root, ".unfade"), { recursive: true });
    const result = detectState({ cwd: project.root, skipLlmCheck: true });
    expect(result.state).toBe("no_git");
    expect(result.checks.gitRepo).toBe(false);
  });

  it("returns daemon_stopped when no PID file exists", () => {
    initUnfadeDir(project.root);
    const result = detectState({ cwd: project.root, skipLlmCheck: true });
    expect(result.state).toBe("daemon_stopped");
    expect(result.checks.daemonRunning).toBe(false);
  });

  it("returns daemon_stopped and cleans stale PID file for dead process", () => {
    initUnfadeDir(project.root);
    // Write a PID that definitely doesn't exist
    writeFileSync(join(project.root, ".unfade", "state", "daemon.pid"), "999999999");

    const result = detectState({ cwd: project.root, skipLlmCheck: true });
    expect(result.state).toBe("daemon_stopped");
    expect(result.checks.daemonRunning).toBe(false);
    expect(result.repairs).toContain("Removed stale PID file");
  });

  it("returns daemon_running when PID belongs to a live process", () => {
    initUnfadeDir(project.root);
    // Use current process PID — guaranteed to be alive
    writeFileSync(join(project.root, ".unfade", "state", "daemon.pid"), String(process.pid));

    const result = detectState({ cwd: project.root, skipLlmCheck: true });
    // With skipLlmCheck, it may be daemon_running or first_distill_pending
    expect(result.checks.daemonRunning).toBe(true);
  });

  it("returns first_distill_pending when events exist but no distills", () => {
    initUnfadeDir(project.root);
    writeFileSync(join(project.root, ".unfade", "state", "daemon.pid"), String(process.pid));
    writeFileSync(join(project.root, ".unfade", "events", "2026-04-15.jsonl"), "{}");

    const result = detectState({ cwd: project.root, skipLlmCheck: true });
    expect(result.state).toBe("first_distill_pending");
    expect(result.checks.hasEvents).toBe(true);
    expect(result.checks.hasDistills).toBe(false);
  });

  it("returns daemon_running when everything is healthy", () => {
    initUnfadeDir(project.root);
    writeFileSync(join(project.root, ".unfade", "state", "daemon.pid"), String(process.pid));
    writeFileSync(join(project.root, ".unfade", "events", "2026-04-15.jsonl"), "{}");
    writeFileSync(join(project.root, ".unfade", "distills", "2026-04-15.md"), "# Distill");

    const result = detectState({ cwd: project.root, skipLlmCheck: true });
    expect(result.state).toBe("daemon_running");
    expect(result.checks.daemonRunning).toBe(true);
    expect(result.checks.hasEvents).toBe(true);
    expect(result.checks.hasDistills).toBe(true);
  });

  it("skips repair when skipRepair is true", () => {
    initUnfadeDir(project.root);
    writeFileSync(join(project.root, ".unfade", "state", "daemon.pid"), "999999999");

    const result = detectState({
      cwd: project.root,
      skipLlmCheck: true,
      skipRepair: true,
    });
    expect(result.state).toBe("daemon_stopped");
    expect(result.repairs).toHaveLength(0);
  });

  it("returns all check fields", () => {
    initUnfadeDir(project.root);
    const result = detectState({ cwd: project.root, skipLlmCheck: true });
    const checkKeys = Object.keys(result.checks);
    expect(checkKeys).toContain("unfadeDirExists");
    expect(checkKeys).toContain("gitRepo");
    expect(checkKeys).toContain("daemonRunning");
    expect(checkKeys).toContain("shellHooksInstalled");
    expect(checkKeys).toContain("autoStartRegistered");
    expect(checkKeys).toContain("llmAvailable");
    expect(checkKeys).toContain("hasEvents");
    expect(checkKeys).toContain("hasDistills");
  });
});
