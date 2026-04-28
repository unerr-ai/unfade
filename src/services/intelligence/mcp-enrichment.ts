// FILE: src/services/intelligence/mcp-enrichment.ts
// Enriches MCP _meta envelopes with real-time intelligence context:
// identity labels, patterns, diagnostics, session intelligence, and
// prompt strategy hints. Cached for low-latency MCP responses.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { McpMeta } from "../../schemas/mcp.js";
import type { ReasoningModelV2 } from "../../schemas/profile.js";
import { getIntelligenceDir, getProfileDir } from "../../utils/paths.js";
import { diagnosticStream } from "./diagnostic-stream.js";

let cachedProfile: ReasoningModelV2 | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 30_000;

export interface EnrichedMcpMeta extends McpMeta {
  identityLabels?: string[];
  topPatterns?: string[];
  domainContext?: string[];
  currentPhase?: string;
  activeSession?: {
    loopRisk: number;
    directionTrend: string;
    turnCount: number;
    suggestedAction?: string;
  };
  activeDiagnostics?: Array<{
    type: string;
    message: string;
    confidence: number;
    actionable: boolean;
    action?: string;
  }>;
  relevantPatterns?: Array<{ pattern: string; confidence: number }>;
  graphContext?: {
    currentFeature?: {
      name: string;
      comprehension: number;
      loopRate: number;
      decisionCount: number;
    };
    relatedDecisions?: Array<{ id: string; description: string; domain: string }>;
    activePatterns?: Array<{ name: string; occurrences: number; severity: string }>;
    capabilities?: Array<{ name: string; level: string; evidenceCount: number }>;
    similarSessions?: Array<{ id: string; similarity: number }>;
    featureKnowledgeMap?: Record<string, { comprehension: number; durability: number }>;
    suggestedApproach?: string | null;
    connectedDecisions?: Array<{
      id: string;
      description: string;
      ageDays: number;
      durability: number;
    }>;
  };
}

/**
 * Enrich an MCP _meta envelope with identity + real-time intelligence context.
 * Reads from 30-second profile cache + live DiagnosticStream + session intelligence.
 */
export async function enrichMcpMeta(meta: McpMeta, _cwd?: string): Promise<EnrichedMcpMeta> {
  const enriched: EnrichedMcpMeta = { ...meta };

  const profile = getCachedProfile(_cwd);
  if (profile) {
    if (profile.identityLabels?.length) {
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
  }

  const activeDiags = diagnosticStream.getActive();
  if (activeDiags.length > 0) {
    enriched.activeDiagnostics = activeDiags.slice(0, 5).map((d) => ({
      type: d.type,
      message: d.message,
      confidence: d.confidence,
      actionable: d.actionable,
      action: d.action,
    }));
  }

  const sessionState = loadSessionIntelligence();
  if (sessionState) {
    const mostRecent = sessionState.activeSessions?.[0];
    if (mostRecent) {
      enriched.currentPhase = mostRecent.currentPhase;
      enriched.activeSession = {
        loopRisk: mostRecent.loopRisk,
        directionTrend: mostRecent.directionTrend,
        turnCount: mostRecent.turnCount,
        suggestedAction: mostRecent.suggestedAction ?? undefined,
      };
    }
  }

  const promptPatterns = loadPromptPatterns();
  if (promptPatterns?.effectivePatterns?.length) {
    enriched.relevantPatterns = promptPatterns.effectivePatterns
      .slice(0, 3)
      .map((p: { pattern: string; acceptanceRate: number }) => ({
        pattern: p.pattern,
        confidence: p.acceptanceRate,
      }));
  }

  const graphCtx = (await loadLiveGraphContext()) ?? loadGraphContextFromFile();
  if (graphCtx) {
    enriched.graphContext = graphCtx;
  }

  return enriched;
}

// ---------------------------------------------------------------------------
// Data loaders (cached / file-based)
// ---------------------------------------------------------------------------

function getCachedProfile(cwd?: string): ReasoningModelV2 | null {
  const now = Date.now();
  if (cachedProfile && now - cacheTimestamp < CACHE_TTL_MS) return cachedProfile;

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
    // non-fatal
  }

  cachedProfile = null;
  cacheTimestamp = now;
  return null;
}

interface SessionIntelligenceFile {
  activeSessions?: Array<{
    sessionId: string;
    currentPhase: string;
    loopRisk: number;
    directionTrend: string;
    turnCount: number;
    suggestedAction: string | null;
  }>;
}

function loadSessionIntelligence(): SessionIntelligenceFile | null {
  try {
    const path = join(getIntelligenceDir(), "session-intelligence.json");
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8")) as SessionIntelligenceFile;
  } catch {
    return null;
  }
}

interface PromptPatternsFile {
  effectivePatterns?: Array<{ pattern: string; acceptanceRate: number }>;
}

function loadPromptPatterns(): PromptPatternsFile | null {
  try {
    const path = join(getIntelligenceDir(), "prompt-patterns.json");
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8")) as PromptPatternsFile;
  } catch {
    return null;
  }
}

interface GraphContextFile {
  currentFeature?: { name: string; comprehension: number; loopRate: number; decisionCount: number };
  relatedDecisions?: Array<{ id: string; description: string; domain: string }>;
  activePatterns?: Array<{ name: string; occurrences: number; severity: string }>;
  capabilities?: Array<{ name: string; level: string; evidenceCount: number }>;
  similarSessions?: Array<{ id: string; similarity: number }>;
  featureKnowledgeMap?: Record<string, { comprehension: number; durability: number }>;
  suggestedApproach?: string | null;
  connectedDecisions?: Array<{
    id: string;
    description: string;
    ageDays: number;
    durability: number;
  }>;
}

let cachedLiveContext: GraphContextFile | null = null;
let liveCacheTimestamp = 0;

async function loadLiveGraphContext(): Promise<GraphContextFile | null> {
  const now = Date.now();
  if (cachedLiveContext && now - liveCacheTimestamp < CACHE_TTL_MS) return cachedLiveContext;

  try {
    const { CozoManager } = await import("../substrate/cozo-manager.js");
    const { SubstrateEngine } = await import("../substrate/substrate-engine.js");
    const { getGraphContextForSession } = await import("../substrate/graph-queries.js");

    const db = await CozoManager.getInstance();
    const healthy = await CozoManager.healthCheck(db);
    if (!healthy) return null;

    const engine = new SubstrateEngine(db);
    const ctx = await getGraphContextForSession(engine, "", 5);

    if (ctx) {
      const extended: GraphContextFile = { ...ctx };

      try {
        const knowledgeResult = await engine.query(`
          ?[feat_name, comprehension, durability] :=
            *entity{id: feat_id, type: 'feature', state: fs, lifecycle: lc},
            lc != 'archived',
            feat_name = get(fs, 'name', ''),
            comprehension = get(fs, 'comprehension', 0),
            durability = get(fs, 'durability', 0.5)
          :limit 20
        `);
        if (knowledgeResult.rows.length > 0) {
          const map: Record<string, { comprehension: number; durability: number }> = {};
          for (const row of knowledgeResult.rows) {
            const name = row[0] as string;
            if (name)
              map[name] = {
                comprehension: Number(row[1] ?? 0),
                durability: Number(row[2] ?? 0.5),
              };
          }
          extended.featureKnowledgeMap = map;
        }
      } catch {
        // non-fatal
      }

      try {
        const patternResult = await engine.query(`
          ?[name, occurrences] :=
            *entity{id: pat_id, type: 'pattern', state: ps, lifecycle: lc},
            lc != 'archived',
            name = get(ps, 'name', ''),
            occurrences = get(ps, 'occurrences', 0)
          :order -occurrences
          :limit 1
        `);
        if (patternResult.rows.length > 0) {
          extended.suggestedApproach = (patternResult.rows[0][0] as string) ?? null;
        }
      } catch {
        // non-fatal
      }

      cachedLiveContext = extended;
      liveCacheTimestamp = now;
      return extended;
    }
  } catch {
    // CozoDB unavailable — fall through to file cache
  }

  return null;
}

let cachedGraphFile: GraphContextFile | null = null;
let graphFileCacheTimestamp = 0;

function loadGraphContextFromFile(): GraphContextFile | null {
  const now = Date.now();
  if (cachedGraphFile && now - graphFileCacheTimestamp < CACHE_TTL_MS) return cachedGraphFile;

  try {
    const path = join(getIntelligenceDir(), "graph-context.json");
    if (!existsSync(path)) {
      cachedGraphFile = null;
      graphFileCacheTimestamp = now;
      return null;
    }
    cachedGraphFile = JSON.parse(readFileSync(path, "utf-8")) as GraphContextFile;
    graphFileCacheTimestamp = now;
    return cachedGraphFile;
  } catch {
    cachedGraphFile = null;
    graphFileCacheTimestamp = now;
    return null;
  }
}
