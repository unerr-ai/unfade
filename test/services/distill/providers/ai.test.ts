// T-043: LLM provider integration tests
import { describe, expect, it } from "vitest";
import { UnfadeConfigSchema } from "../../../../src/schemas/config.js";
import {
  checkOllamaReady,
  createLLMProvider,
} from "../../../../src/services/distill/providers/ai.js";

describe("createLLMProvider", () => {
  it("T-043a: returns null for provider 'none'", async () => {
    const config = UnfadeConfigSchema.parse({ distill: { provider: "none" } });
    const result = await createLLMProvider(config);
    expect(result).toBeNull();
  });

  it("T-043b: creates ollama provider from default config", async () => {
    const config = UnfadeConfigSchema.parse({});
    const result = await createLLMProvider(config);
    expect(result).not.toBeNull();
    expect(result?.provider).toBe("ollama");
    expect(result?.modelName).toBe("llama3.2");
    expect(result?.model).toBeDefined();
  });

  it("T-043c: creates openai provider", async () => {
    const config = UnfadeConfigSchema.parse({
      distill: { provider: "openai", model: "gpt-4o", apiKey: "test-key" },
    });
    const result = await createLLMProvider(config);
    expect(result?.provider).toBe("openai");
    expect(result?.modelName).toBe("gpt-4o");
  });

  it("T-043d: creates anthropic provider", async () => {
    const config = UnfadeConfigSchema.parse({
      distill: { provider: "anthropic", model: "claude-sonnet-4-6", apiKey: "test-key" },
    });
    const result = await createLLMProvider(config);
    expect(result?.provider).toBe("anthropic");
    expect(result?.modelName).toBe("claude-sonnet-4-6");
  });
});

describe("checkOllamaReady", () => {
  it("T-043e: returns not-ready when Ollama is not running", async () => {
    // Use a port that's almost certainly not running Ollama
    const result = await checkOllamaReady("http://localhost:19999");
    expect(result.ready).toBe(false);
    expect(result.reason).toBeDefined();
  });
});
