// T-030: InitProgress schema tests
import { describe, expect, it } from "vitest";
import {
  createInitProgress,
  INIT_STEPS,
  InitProgressSchema,
} from "../../src/schemas/init-progress.js";

describe("InitProgressSchema", () => {
  it("T-030a: INIT_STEPS has all 8 steps in order", () => {
    expect(INIT_STEPS).toEqual([
      "scaffold",
      "fingerprint",
      "binary",
      "shell-hooks",
      "autostart",
      "llm-detect",
      "start-daemon",
      "backfill",
    ]);
    expect(INIT_STEPS.length).toBe(8);
  });

  it("T-030b: createInitProgress returns valid progress with all steps incomplete", () => {
    const progress = createInitProgress();
    expect(progress.version).toBe(1);
    expect(progress.startedAt).toBeTruthy();
    expect(progress.completedAt).toBeUndefined();

    for (const step of INIT_STEPS) {
      expect(progress.steps[step].completed).toBe(false);
    }
  });

  it("T-030c: schema parses a fully completed progress object", () => {
    const now = new Date().toISOString();
    const input = {
      version: 1 as const,
      startedAt: now,
      completedAt: now,
      steps: {
        scaffold: { completed: true, completedAt: now },
        fingerprint: { completed: true, completedAt: now },
        binary: { completed: true, completedAt: now },
        "shell-hooks": { completed: true, completedAt: now },
        autostart: { completed: true, completedAt: now },
        "llm-detect": { completed: true, completedAt: now },
        "start-daemon": { completed: true, completedAt: now },
        backfill: { completed: true, completedAt: now },
      },
    };

    const result = InitProgressSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("T-030d: schema fills defaults for missing steps", () => {
    const result = InitProgressSchema.safeParse({
      startedAt: new Date().toISOString(),
      steps: {},
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe(1);
      for (const step of INIT_STEPS) {
        expect(result.data.steps[step].completed).toBe(false);
      }
    }
  });

  it("T-030e: step with error field parses correctly", () => {
    const result = InitProgressSchema.safeParse({
      startedAt: new Date().toISOString(),
      steps: {
        binary: { completed: false, error: "go not found" },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.steps.binary.completed).toBe(false);
      expect(result.data.steps.binary.error).toBe("go not found");
    }
  });
});
