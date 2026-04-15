import { describe, expect, it } from "vitest";
import { USER_TERMS } from "../../src/constants/terminology.js";

describe("USER_TERMS", () => {
  it("maps daemon to capture engine", () => {
    expect(USER_TERMS.daemon).toBe("capture engine");
  });

  it("maps all daemon states to user-facing strings", () => {
    expect(USER_TERMS.daemonRunning).toBe("Capturing");
    expect(USER_TERMS.daemonStopped).toBe("Capture paused");
    expect(USER_TERMS.daemonCrashed).toBe("Capture engine stopped unexpectedly");
  });

  it("never contains the word daemon in any value", () => {
    for (const [key, value] of Object.entries(USER_TERMS)) {
      if (key === "daemon") continue;
      expect(value.toLowerCase()).not.toContain("daemon");
    }
  });

  it("exports all required keys", () => {
    const required = [
      "daemon",
      "daemonRunning",
      "daemonStopped",
      "daemonCrashed",
      "daemonStarting",
      "daemonStopping",
      "events",
      "distill",
      "distilling",
      "profile",
      "unfadeDir",
      "initCommand",
    ];
    for (const key of required) {
      expect(USER_TERMS).toHaveProperty(key);
    }
  });
});
