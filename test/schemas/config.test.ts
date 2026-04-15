// T-009, T-010: UnfadeConfig schema tests
import { describe, expect, it } from "vitest";
import { UnfadeConfigSchema } from "../../src/schemas/config.js";

describe("UnfadeConfigSchema", () => {
  it("T-009: valid config with explicit values passes and fills all fields", () => {
    const config = {
      version: 1 as const,
      capture: {
        sources: { git: true, aiSession: true, terminal: false, browser: false },
        aiSessionPaths: ["~/.cursor/logs/"],
        ignore: ["node_modules"],
      },
      distill: {
        schedule: "0 18 * * *",
        provider: "ollama" as const,
        model: "llama3.2",
      },
      mcp: {
        enabled: true,
        transport: "stdio" as const,
        httpPort: 7654,
      },
      notification: {
        enabled: true,
        sound: false,
      },
    };

    const result = UnfadeConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe(1);
      expect(result.data.capture.sources.git).toBe(true);
      expect(result.data.distill.provider).toBe("ollama");
      expect(result.data.mcp.enabled).toBe(true);
      expect(result.data.notification.sound).toBe(false);
    }
  });

  it("T-010: empty object produces valid config with all defaults", () => {
    const result = UnfadeConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe(1);
      expect(result.data.capture.sources.git).toBe(true);
      expect(result.data.capture.sources.aiSession).toBe(true);
      expect(result.data.capture.sources.terminal).toBe(false);
      expect(result.data.capture.ignore).toContain("node_modules");
      expect(result.data.distill.provider).toBe("ollama");
      expect(result.data.distill.model).toBe("llama3.2");
      expect(result.data.distill.schedule).toBe("0 18 * * *");
      expect(result.data.mcp.enabled).toBe(true);
      expect(result.data.mcp.transport).toBe("stdio");
      expect(result.data.mcp.httpPort).toBe(7654);
      expect(result.data.notification.enabled).toBe(true);
      expect(result.data.notification.sound).toBe(false);
    }
  });
});
