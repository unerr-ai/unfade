// FILE: src/tools/unfade-similar.ts
// UF-068: MCP tool handler for unfade_similar.
// Accepts { problem, limit? }, calls findSimilar(), wraps in _meta envelope.

import type { SimilarOutput } from "../schemas/mcp.js";
import { findSimilar } from "../services/distill/amplifier.js";

/**
 * Find similar past decisions matching a problem description.
 */
export function getSimilar(problem: string, limit: number, cwd?: string): SimilarOutput {
  return findSimilar(problem, limit, cwd);
}
