// FILE: src/tools/unfade-amplify.ts
// UF-067: MCP tool handler for unfade_amplify.
// Accepts { date }, calls amplifier, returns connections in _meta envelope.

import type { AmplifyOutput } from "../schemas/mcp.js";
import { amplify } from "../services/distill/amplifier.js";

/**
 * Amplify — detect cross-temporal connections for a given date.
 */
export function getAmplification(date: string, cwd?: string): AmplifyOutput {
  return amplify(date, cwd);
}
