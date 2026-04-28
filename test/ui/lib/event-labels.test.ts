import { describe, expect, it } from "vitest";
import { sourceLabel, typeLabel, sourceBadgeClass } from "../../../src/ui/lib/event-labels.js";

describe("event-labels", () => {
  describe("sourceLabel()", () => {
    it("maps known sources to labels", () => {
      expect(sourceLabel("git")).toBe("Git");
      expect(sourceLabel("ai-session")).toBe("AI Session");
      expect(sourceLabel("terminal")).toBe("Terminal");
      expect(sourceLabel("manual")).toBe("Manual");
    });

    it("returns raw string for unknown sources", () => {
      expect(sourceLabel("custom")).toBe("custom");
    });
  });

  describe("typeLabel()", () => {
    it("maps known types to labels", () => {
      expect(typeLabel("commit")).toBe("Commit");
      expect(typeLabel("ai-conversation")).toBe("AI Conversation");
      expect(typeLabel("ai-completion")).toBe("AI Completion");
      expect(typeLabel("ai-rejection")).toBe("AI Rejection");
      expect(typeLabel("branch-switch")).toBe("Branch Switch");
      expect(typeLabel("revert")).toBe("Revert");
    });

    it("returns raw string for unknown types", () => {
      expect(typeLabel("custom-type")).toBe("custom-type");
    });
  });

  describe("sourceBadgeClass()", () => {
    it("returns distinct classes for each source", () => {
      const git = sourceBadgeClass("git");
      const ai = sourceBadgeClass("ai-session");
      const term = sourceBadgeClass("terminal");

      expect(git).toContain("orange");
      expect(ai).toContain("violet");
      expect(term).toContain("emerald");
    });

    it("returns muted class for unknown sources", () => {
      expect(sourceBadgeClass("unknown")).toContain("muted");
    });
  });
});
