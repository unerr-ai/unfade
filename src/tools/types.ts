// FILE: src/tools/types.ts
// UnfadeTool — unified tool interface for CLI commands and MCP tools.
// Every capability (query, distill, profile, amplify) implements this interface.

import type { z } from "zod";

export interface UnfadeTool<TInput extends z.ZodType, TOutput extends z.ZodType> {
  name: string;
  description: string;
  inputSchema: TInput;
  outputSchema: TOutput;
  execute(input: z.infer<TInput>): Promise<z.infer<TOutput>>;
}

// Response envelope — every tool response includes _meta.
export { type ToolResponse, ToolResponseSchema } from "../schemas/tool-response.js";
