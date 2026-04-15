// T-032: init progress persistence tests
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createInitProgress } from "../../../src/schemas/init-progress.js";
import {
  isStepCompleted,
  loadProgress,
  markInitCompleted,
  markStepCompleted,
  markStepFailed,
  saveProgress,
} from "../../../src/services/init/progress.js";

describe("init progress", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `unfade-test-progress-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    // Create .unfade/state/ so progress can be saved.
    mkdirSync(join(tempDir, ".unfade", "state"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("T-032a: loadProgress returns fresh progress when no file exists", () => {
    const { progress, resumed } = loadProgress(tempDir);
    expect(resumed).toBe(false);
    expect(progress.version).toBe(1);
    expect(progress.steps.scaffold.completed).toBe(false);
  });

  it("T-032b: saveProgress + loadProgress round-trips", () => {
    const progress = createInitProgress();
    progress.steps.scaffold = { completed: true, completedAt: new Date().toISOString() };
    saveProgress(tempDir, progress);

    const { progress: loaded, resumed } = loadProgress(tempDir);
    expect(resumed).toBe(true);
    expect(loaded.steps.scaffold.completed).toBe(true);
  });

  it("T-032c: markStepCompleted sets completed + persists", () => {
    const progress = createInitProgress();
    markStepCompleted(tempDir, progress, "fingerprint");

    expect(progress.steps.fingerprint.completed).toBe(true);
    expect(progress.steps.fingerprint.completedAt).toBeTruthy();

    // Verify persisted.
    const { progress: loaded } = loadProgress(tempDir);
    expect(loaded.steps.fingerprint.completed).toBe(true);
  });

  it("T-032d: markStepFailed records error + persists", () => {
    const progress = createInitProgress();
    markStepFailed(tempDir, progress, "binary", "go not installed");

    expect(progress.steps.binary.completed).toBe(false);
    expect(progress.steps.binary.error).toBe("go not installed");

    const { progress: loaded } = loadProgress(tempDir);
    expect(loaded.steps.binary.error).toBe("go not installed");
  });

  it("T-032e: isStepCompleted reflects state", () => {
    const progress = createInitProgress();
    expect(isStepCompleted(progress, "scaffold")).toBe(false);
    markStepCompleted(tempDir, progress, "scaffold");
    expect(isStepCompleted(progress, "scaffold")).toBe(true);
  });

  it("T-032f: markInitCompleted sets completedAt", () => {
    const progress = createInitProgress();
    expect(progress.completedAt).toBeUndefined();
    markInitCompleted(tempDir, progress);
    expect(progress.completedAt).toBeTruthy();
  });

  it("T-032g: corrupt progress file falls back to fresh", () => {
    const progressFile = join(tempDir, ".unfade", "state", "init_progress.json");
    mkdirSync(join(tempDir, ".unfade", "state"), { recursive: true });
    const { writeFileSync } = require("node:fs");
    writeFileSync(progressFile, "{{not json}}", "utf-8");

    const { progress, resumed } = loadProgress(tempDir);
    expect(resumed).toBe(false);
    expect(progress.version).toBe(1);
  });
});
