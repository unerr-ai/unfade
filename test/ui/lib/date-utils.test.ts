import { describe, expect, it } from "vitest";
import { relativeDate, relativeTimestamp, formatStaleness } from "../../../src/ui/lib/date-utils.js";

describe("date-utils", () => {
  describe("relativeDate()", () => {
    it("returns 'Today' for today's date", () => {
      const today = new Date().toISOString().slice(0, 10);
      expect(relativeDate(today)).toBe("Today");
    });

    it("returns 'Yesterday' for yesterday", () => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      expect(relativeDate(d.toISOString().slice(0, 10))).toBe("Yesterday");
    });

    it("returns 'N days ago' for recent dates", () => {
      const d = new Date();
      d.setDate(d.getDate() - 3);
      expect(relativeDate(d.toISOString().slice(0, 10))).toBe("3 days ago");
    });

    it("returns weeks for 7-29 days", () => {
      const d = new Date();
      d.setDate(d.getDate() - 14);
      expect(relativeDate(d.toISOString().slice(0, 10))).toBe("2 weeks ago");
    });

    it("returns months for 30+ days", () => {
      const d = new Date();
      d.setDate(d.getDate() - 60);
      expect(relativeDate(d.toISOString().slice(0, 10))).toBe("2 months ago");
    });
  });

  describe("relativeTimestamp()", () => {
    it("returns seconds for very recent", () => {
      const ts = new Date(Date.now() - 30_000).toISOString();
      expect(relativeTimestamp(ts)).toMatch(/30s ago/);
    });

    it("returns minutes for minute-scale times", () => {
      const ts = new Date(Date.now() - 5 * 60_000).toISOString();
      expect(relativeTimestamp(ts)).toBe("5m ago");
    });

    it("returns hours for hour-scale times", () => {
      const ts = new Date(Date.now() - 3 * 3_600_000).toISOString();
      expect(relativeTimestamp(ts)).toBe("3h ago");
    });

    it("returns 'yesterday' for 1 day ago", () => {
      const ts = new Date(Date.now() - 86_400_000).toISOString();
      expect(relativeTimestamp(ts)).toBe("yesterday");
    });

    it("returns 'just now' for future timestamps", () => {
      const ts = new Date(Date.now() + 10_000).toISOString();
      expect(relativeTimestamp(ts)).toBe("just now");
    });
  });

  describe("formatStaleness()", () => {
    it("formats seconds", () => {
      expect(formatStaleness(5000)).toBe("5s");
    });

    it("formats minutes", () => {
      expect(formatStaleness(180_000)).toBe("3m");
    });

    it("formats hours", () => {
      expect(formatStaleness(7_200_000)).toBe("2h");
    });

    it("formats days", () => {
      expect(formatStaleness(172_800_000)).toBe("2d");
    });
  });
});
