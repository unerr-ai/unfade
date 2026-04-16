// T-225: MCP Registry server.json validation
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const serverJson = JSON.parse(readFileSync(join(__dirname, "../../server.json"), "utf-8"));

describe("MCP Registry server.json (UF-085)", () => {
  // T-225a: Basic metadata
  it("T-225a: has correct name and version", () => {
    expect(serverJson.name).toBe("unfade");
    expect(serverJson.version).toBe("0.1.0");
    expect(serverJson.description).toBeTruthy();
  });

  // T-225b: Transport config
  it("T-225b: has stdio transport config", () => {
    expect(serverJson.transport).toEqual({
      type: "stdio",
      command: "npx",
      args: ["unfade", "mcp"],
    });
  });

  // T-225c: Capabilities
  it("T-225c: declares tools, resources, and prompts capabilities", () => {
    expect(serverJson.capabilities).toEqual({
      tools: true,
      resources: true,
      prompts: true,
    });
  });

  // T-225d: Tool catalog lists all 7 tools
  it("T-225d: lists all 7 MCP tools", () => {
    expect(serverJson.tools).toHaveLength(7);
    const expectedTools = [
      "unfade_query",
      "unfade_context",
      "unfade_decisions",
      "unfade_profile",
      "unfade_distill",
      "unfade_similar",
      "unfade_amplify",
    ];
    for (const tool of expectedTools) {
      expect(serverJson.tools).toContain(tool);
    }
  });

  // T-225e: Resources listed
  it("T-225e: lists MCP resources", () => {
    expect(Array.isArray(serverJson.resources)).toBe(true);
    expect(serverJson.resources.length).toBeGreaterThan(0);
    expect(serverJson.resources).toContain("unfade://context/recent");
    expect(serverJson.resources).toContain("unfade://profile");
  });

  // T-225f: Prompts listed
  it("T-225f: lists MCP prompts", () => {
    expect(Array.isArray(serverJson.prompts)).toBe(true);
    expect(serverJson.prompts.length).toBeGreaterThan(0);
  });

  // T-225g: Installation config
  it("T-225g: has installation config", () => {
    expect(serverJson.installation).toEqual({
      command: "npx",
      args: ["unfade", "mcp"],
    });
  });

  // T-225h: License
  it("T-225h: specifies MIT license", () => {
    expect(serverJson.license).toBe("MIT");
  });
});
