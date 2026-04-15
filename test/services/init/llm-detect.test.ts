// T-035: LLM detection tests
import { describe, expect, it } from "vitest";
import { detectLlm } from "../../../src/services/init/llm-detect.js";

describe("detectLlm", () => {
  it("T-035a: returns a valid LlmDetectResult", () => {
    const result = detectLlm();

    // Should return either "ollama" or "none" — depends on CI env.
    expect(["ollama", "none"]).toContain(result.provider);

    if (result.provider === "ollama") {
      expect(result.model).toBeTruthy();
      expect(result.ollamaModels.length).toBeGreaterThan(0);
    } else {
      expect(result.model).toBeNull();
      expect(result.ollamaModels).toEqual([]);
    }
  });
});
