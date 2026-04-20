import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { McpMeta } from "../../schemas/mcp.js";
import type { ReasoningModelV2 } from "../../schemas/profile.js";
import { getProfileDir } from "../../utils/paths.js";

let cachedProfile: ReasoningModelV2 | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 30_000;

/**
 * Enrich an MCP _meta envelope with identity labels, top patterns,
 * and domain context from the reasoning profile.
 *
 * Reads from a 30-second in-memory cache to stay under the 10ms latency budget.
 * Returns the original meta unchanged if no profile data is available.
 */
export function enrichMcpMeta(
  meta: McpMeta,
  _cwd?: string,
): McpMeta & {
  identityLabels?: string[];
  topPatterns?: string[];
  domainContext?: string[];
} {
  const profile = getCachedProfile(_cwd);
  if (!profile) return meta;

  const enriched: McpMeta & {
    identityLabels?: string[];
    topPatterns?: string[];
    domainContext?: string[];
  } = { ...meta };

  if (profile.identityLabels && profile.identityLabels.length > 0) {
    enriched.identityLabels = profile.identityLabels.map((l) => l.label);
  }

  if (profile.patterns.length > 0) {
    enriched.topPatterns = profile.patterns
      .filter((p) => p.confidence >= 0.7)
      .slice(0, 5)
      .map((p) => p.pattern);
  }

  if (profile.domainDistribution.length > 0) {
    enriched.domainContext = profile.domainDistribution
      .slice(0, 5)
      .map((d) => `${d.domain} (${d.depth})`);
  }

  if (profile.uifMetrics?.rdi != null) {
    enriched.personalizationLevel = `RDI:${profile.uifMetrics.rdi}`;
  }

  return enriched;
}

function getCachedProfile(cwd?: string): ReasoningModelV2 | null {
  const now = Date.now();
  if (cachedProfile && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedProfile;
  }

  const profilePath = join(getProfileDir(cwd), "reasoning_model.json");
  if (!existsSync(profilePath)) {
    cachedProfile = null;
    cacheTimestamp = now;
    return null;
  }

  try {
    const data = JSON.parse(readFileSync(profilePath, "utf-8"));
    if (data.version === 2) {
      cachedProfile = data as ReasoningModelV2;
      cacheTimestamp = now;
      return cachedProfile;
    }
  } catch {
    // Non-fatal
  }

  cachedProfile = null;
  cacheTimestamp = now;
  return null;
}
