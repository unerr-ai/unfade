// T-224: ClawHub skill package validation
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SKILLS_DIR = join(__dirname, "../../skills/unfade-memory");

describe("ClawHub skill package (UF-084)", () => {
  // T-224: SKILL.md contains required sections
  describe("SKILL.md", () => {
    const skillMd = readFileSync(join(SKILLS_DIR, "SKILL.md"), "utf-8");

    it("T-224a: contains one-liner description", () => {
      // Blockquote hook line
      expect(skillMd).toMatch(/^>/m);
      expect(skillMd).toMatch(/reasoning memory/i);
    });

    it("T-224b: contains 'What it does' section", () => {
      expect(skillMd).toContain("## What it does");
    });

    it("T-224c: contains 'Features' section with bullet list", () => {
      expect(skillMd).toContain("## Features");
      expect(skillMd).toMatch(/^- \*\*/m);
    });

    it("T-224d: contains 'Setup' section with npx unfade", () => {
      expect(skillMd).toContain("## Setup");
      expect(skillMd).toContain("npx unfade");
    });

    it("T-224e: lists all 7 MCP tools", () => {
      const tools = [
        "unfade_query",
        "unfade_context",
        "unfade_decisions",
        "unfade_profile",
        "unfade_distill",
        "unfade_similar",
        "unfade_amplify",
      ];
      for (const tool of tools) {
        expect(skillMd).toContain(tool);
      }
    });

    it("T-224f: contains MCP configuration examples", () => {
      expect(skillMd).toContain("## MCP Configuration");
      expect(skillMd).toContain("mcpServers");
    });

    it("T-224g: contains example usage scenarios", () => {
      expect(skillMd).toContain("## Example Usage");
    });

    it("T-224h: contains privacy section", () => {
      expect(skillMd).toContain("## Privacy");
      expect(skillMd).toMatch(/local/i);
    });
  });

  describe("manifest.json", () => {
    const manifest = JSON.parse(readFileSync(join(SKILLS_DIR, "manifest.json"), "utf-8"));

    it("T-224i: has correct name and author", () => {
      expect(manifest.name).toBe("unfade-memory");
      expect(manifest.author).toBe("unfade");
    });

    it("T-224j: has valid MCP transport config", () => {
      expect(manifest.mcp).toEqual({
        command: "npx",
        args: ["unfade", "mcp"],
        transport: "stdio",
      });
    });

    it("T-224k: lists all 7 tools", () => {
      expect(manifest.tools).toHaveLength(7);
      expect(manifest.tools).toContain("unfade_query");
      expect(manifest.tools).toContain("unfade_context");
      expect(manifest.tools).toContain("unfade_decisions");
      expect(manifest.tools).toContain("unfade_profile");
      expect(manifest.tools).toContain("unfade_distill");
      expect(manifest.tools).toContain("unfade_similar");
      expect(manifest.tools).toContain("unfade_amplify");
    });

    it("T-224l: has install command", () => {
      expect(manifest.install).toBe("npx unfade");
    });

    it("T-224m: has version", () => {
      expect(manifest.version).toBe("0.1.0");
    });
  });
});
