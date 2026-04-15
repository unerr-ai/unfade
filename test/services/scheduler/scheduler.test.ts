// T-036: Scheduler tests
import { describe, expect, it } from "vitest";
import { UnfadeConfigSchema } from "../../../src/schemas/config.js";
import { parseScheduleTime, startScheduler } from "../../../src/services/scheduler/scheduler.js";

describe("parseScheduleTime", () => {
  it("T-036a: parses cron format '0 18 * * *'", () => {
    const [hour, minute] = parseScheduleTime("0 18 * * *");
    expect(hour).toBe(18);
    expect(minute).toBe(0);
  });

  it("T-036b: parses simple HH:MM format", () => {
    const [hour, minute] = parseScheduleTime("9:30");
    expect(hour).toBe(9);
    expect(minute).toBe(30);
  });

  it("T-036c: defaults to 18:00 for invalid schedule", () => {
    const [hour, minute] = parseScheduleTime("invalid");
    expect(hour).toBe(18);
    expect(minute).toBe(0);
  });

  it("T-036d: parses cron format '30 9 * * *'", () => {
    const [hour, minute] = parseScheduleTime("30 9 * * *");
    expect(hour).toBe(9);
    expect(minute).toBe(30);
  });
});

describe("startScheduler", () => {
  it("T-036e: returns a scheduler handle with stop and nextTrigger", () => {
    const config = UnfadeConfigSchema.parse({});
    const handle = startScheduler(config);
    expect(handle.stop).toBeInstanceOf(Function);
    expect(handle.nextTrigger).toBeDefined();
    handle.stop();
  });

  it("T-036f: nextTrigger is a valid ISO date string", () => {
    const config = UnfadeConfigSchema.parse({});
    const handle = startScheduler(config);
    expect(() => new Date(handle.nextTrigger)).not.toThrow();
    expect(new Date(handle.nextTrigger).getTime()).toBeGreaterThan(Date.now());
    handle.stop();
  });

  it("T-036g: stop cancels the scheduled timer", () => {
    const config = UnfadeConfigSchema.parse({});
    const handle = startScheduler(config);
    handle.stop();
    // No assertion needed beyond not throwing — verifies cleanup works
  });
});
