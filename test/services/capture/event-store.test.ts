import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  countEvents,
  getEventsLastUpdated,
  listEventDates,
  readEventRange,
  readEvents,
} from "../../../src/services/capture/event-store.js";

function makeEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: randomUUID(),
    timestamp: "2026-04-15T10:00:00.000Z",
    source: "git",
    type: "commit",
    content: { summary: "test commit" },
    gitContext: { repo: "unfade-cli", branch: "main" },
    ...overrides,
  };
}

describe("event-store", () => {
  let projectRoot: string;
  let eventsDir: string;

  beforeEach(() => {
    projectRoot = join(tmpdir(), `unfade-test-${randomUUID()}`);
    eventsDir = join(projectRoot, ".unfade", "events");
    mkdirSync(eventsDir, { recursive: true });
    // Create a .git dir so findGitRoot resolves to projectRoot
    mkdirSync(join(projectRoot, ".git"), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  describe("readEvents", () => {
    it("returns empty array when file does not exist", () => {
      const events = readEvents("2026-04-15", projectRoot);
      expect(events).toEqual([]);
    });

    it("reads and validates events from JSONL file", () => {
      const event1 = makeEvent({ id: randomUUID() });
      const event2 = makeEvent({ id: randomUUID(), type: "branch-switch" });
      writeFileSync(
        join(eventsDir, "2026-04-15.jsonl"),
        `${JSON.stringify(event1)}\n${JSON.stringify(event2)}\n`,
      );

      const events = readEvents("2026-04-15", projectRoot);
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe("commit");
      expect(events[1].type).toBe("branch-switch");
    });

    it("tolerates partial last line (daemon mid-write)", () => {
      const event = makeEvent();
      const partial = '{"id":"incomplete","source":"git"'; // incomplete JSON
      writeFileSync(join(eventsDir, "2026-04-15.jsonl"), `${JSON.stringify(event)}\n${partial}`);

      const events = readEvents("2026-04-15", projectRoot);
      expect(events).toHaveLength(1); // only the valid event
    });

    it("skips lines with invalid schema", () => {
      const valid = makeEvent();
      const invalidSchema = { id: "not-a-uuid", source: "unknown_source" };
      writeFileSync(
        join(eventsDir, "2026-04-15.jsonl"),
        `${JSON.stringify(valid)}\n${JSON.stringify(invalidSchema)}\n`,
      );

      const events = readEvents("2026-04-15", projectRoot);
      expect(events).toHaveLength(1);
    });

    it("handles empty file gracefully", () => {
      writeFileSync(join(eventsDir, "2026-04-15.jsonl"), "");
      const events = readEvents("2026-04-15", projectRoot);
      expect(events).toEqual([]);
    });

    it("handles blank lines in file", () => {
      const event = makeEvent();
      writeFileSync(join(eventsDir, "2026-04-15.jsonl"), `\n${JSON.stringify(event)}\n\n`);
      const events = readEvents("2026-04-15", projectRoot);
      expect(events).toHaveLength(1);
    });
  });

  describe("countEvents", () => {
    it("returns 0 for nonexistent file", () => {
      expect(countEvents("2026-04-15", projectRoot)).toBe(0);
    });

    it("counts valid JSON lines", () => {
      const lines = [makeEvent(), makeEvent(), makeEvent()].map(JSON.stringify).join("\n");
      writeFileSync(join(eventsDir, "2026-04-15.jsonl"), `${lines}\n`);
      expect(countEvents("2026-04-15", projectRoot)).toBe(3);
    });

    it("excludes partial lines from count", () => {
      const event = makeEvent();
      writeFileSync(join(eventsDir, "2026-04-15.jsonl"), `${JSON.stringify(event)}\n{"partial":`);
      expect(countEvents("2026-04-15", projectRoot)).toBe(1);
    });
  });

  describe("readEventRange", () => {
    it("reads events across multiple days", () => {
      const event1 = makeEvent({ timestamp: "2026-04-14T10:00:00.000Z" });
      const event2 = makeEvent({ timestamp: "2026-04-15T10:00:00.000Z" });
      writeFileSync(join(eventsDir, "2026-04-14.jsonl"), `${JSON.stringify(event1)}\n`);
      writeFileSync(join(eventsDir, "2026-04-15.jsonl"), `${JSON.stringify(event2)}\n`);

      const events = readEventRange("2026-04-14", "2026-04-15", projectRoot);
      expect(events).toHaveLength(2);
    });

    it("returns empty for range with no events", () => {
      const events = readEventRange("2026-01-01", "2026-01-03", projectRoot);
      expect(events).toEqual([]);
    });
  });

  describe("getEventsLastUpdated", () => {
    it("returns null for nonexistent file", () => {
      expect(getEventsLastUpdated("2026-04-15", projectRoot)).toBeNull();
    });

    it("returns mtime for existing file", () => {
      writeFileSync(join(eventsDir, "2026-04-15.jsonl"), "");
      const mtime = getEventsLastUpdated("2026-04-15", projectRoot);
      expect(mtime).toBeInstanceOf(Date);
    });
  });

  describe("listEventDates", () => {
    it("returns empty array when no events directory", () => {
      rmSync(eventsDir, { recursive: true });
      expect(listEventDates(projectRoot)).toEqual([]);
    });

    it("lists dates from JSONL filenames, sorted", () => {
      writeFileSync(join(eventsDir, "2026-04-15.jsonl"), "");
      writeFileSync(join(eventsDir, "2026-04-13.jsonl"), "");
      writeFileSync(join(eventsDir, "2026-04-14.jsonl"), "");
      writeFileSync(join(eventsDir, "README.md"), ""); // non-event file

      const dates = listEventDates(projectRoot);
      expect(dates).toEqual(["2026-04-13", "2026-04-14", "2026-04-15"]);
    });
  });
});
