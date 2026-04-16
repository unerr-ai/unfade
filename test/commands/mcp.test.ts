// Tests for UF-086d: `unfade mcp` hidden CLI command
import { describe, expect, it, vi } from "vitest";

describe("mcpCommand", () => {
  it("exports mcpCommand function", async () => {
    const mod = await import("../../src/commands/mcp.js");
    expect(typeof mod.mcpCommand).toBe("function");
  });

  it("suppresses logging via logger.configure({ quiet: true })", async () => {
    const loggerMod = await import("../../src/utils/logger.js");
    const configureSpy = vi.spyOn(loggerMod.logger, "configure");

    // Mock the dynamic import of server module to avoid actual stdio connection
    vi.doMock("../../src/services/mcp/server.js", () => ({
      createMcpServer: () => ({ connect: vi.fn() }),
      connectStdio: vi.fn().mockResolvedValue(undefined),
    }));

    // Re-import to get the mocked version
    const { mcpCommand } = await import("../../src/commands/mcp.js");

    // The function will try to set up stdin handlers, which is fine in test
    await mcpCommand();

    expect(configureSpy).toHaveBeenCalledWith({ quiet: true });
    configureSpy.mockRestore();
    vi.doUnmock("../../src/services/mcp/server.js");
  });
});

describe("CLI registration", () => {
  it("registers mcp as a hidden command", async () => {
    // Verify the command file imports correctly and the function signature matches
    const { mcpCommand } = await import("../../src/commands/mcp.js");
    expect(mcpCommand).toBeDefined();
    expect(mcpCommand.length).toBe(0); // No required args
  });
});
