// T-004, T-005, T-006: Path utility tests
import { describe, expect, it } from "vitest";
import { getEventsDir, getProjectDataDir, getUserConfigDir } from "../../src/utils/paths.js";

describe("Path utilities", () => {
  it("T-004: getUserConfigDir() returns path ending in .unfade", () => {
    const configDir = getUserConfigDir();
    expect(configDir).toMatch(/\.unfade$/);
  });

  it("T-005: getProjectDataDir() returns path containing .unfade", () => {
    const projectDir = getProjectDataDir();
    expect(projectDir).toMatch(/\.unfade$/);
  });

  it("T-006: getEventsDir() returns <projectDir>/events", () => {
    const eventsDir = getEventsDir();
    const projectDir = getProjectDataDir();
    expect(eventsDir).toBe(`${projectDir}/events`);
  });
});
