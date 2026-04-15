// T-011: ToolResponseSchema validates envelope with _meta
import { describe, expect, it } from "vitest";
import { ToolResponseSchema } from "../../src/schemas/tool-response.js";

describe("ToolResponseSchema", () => {
  it("T-011: validates envelope with _meta", () => {
    const response = {
      data: { results: ["item1", "item2"] },
      _meta: {
        tool: "unfade-query",
        durationMs: 142,
        degraded: false,
        personalizationLevel: "basic" as const,
      },
    };

    const result = ToolResponseSchema.safeParse(response);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data._meta.tool).toBe("unfade-query");
      expect(result.data._meta.durationMs).toBe(142);
      expect(result.data._meta.degraded).toBe(false);
      expect(result.data._meta.personalizationLevel).toBe("basic");
    }
  });
});
