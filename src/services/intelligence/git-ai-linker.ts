// FILE: src/services/intelligence/git-ai-linker.ts
// Temporal correlation between AI sessions and git commits.
// Detects "AI conversation → commit" patterns by finding commits
// within a time window after AI events that touch the same files.
// Answers: "Which AI sessions led to actual code changes?"

import type { AnalyzerContext } from "./analyzers/index.js";
import type { IncrementalAnalyzer, IncrementalState, UpdateResult } from "./incremental-state.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AIGitLink {
  aiEventId: string;
  commitEventId: string;
  aiTimestamp: string;
  commitTimestamp: string;
  lagMinutes: number;
  sharedFiles: string[];
  linkStrength: number;
  promptType: string | null;
  /** KGI-12.1: Entities discussed in AI session that match commit file paths. */
  linkedEntities?: string[];
}

export interface AIGitLinkerOutput {
  links: AIGitLink[];
  totalLinksFound: number;
  avgLagMinutes: number | null;
  aiToCommitRate: number;
  updatedAt: string;
}

interface AIGitLinkerState {
  output: AIGitLinkerOutput;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_LAG_MINUTES = 30;
const LOOKBACK_HOURS = 24;

// ---------------------------------------------------------------------------
// IncrementalAnalyzer
// ---------------------------------------------------------------------------

export const aiGitLinkerAnalyzer: IncrementalAnalyzer<AIGitLinkerState, AIGitLinkerOutput> = {
  name: "ai-git-linker",
  outputFile: "ai-git-links.json",
  eventFilter: { sources: ["git", "ai-session", "mcp-active"] },
  minDataPoints: 5,

  async initialize(ctx): Promise<IncrementalState<AIGitLinkerState>> {
    const output = await computeLinks(ctx);
    return {
      value: { output },
      watermark: "",
      eventCount: 0,
      updatedAt: new Date().toISOString(),
    };
  },

  async update(state, batch, ctx): Promise<UpdateResult<AIGitLinkerState>> {
    if (batch.events.length === 0) return { state, changed: false };

    const output = await computeLinks(ctx);
    await enrichLinksWithEntities(output, ctx);
    const prevCount = state.value.output.totalLinksFound;
    const changed = output.totalLinksFound !== prevCount;

    return {
      state: {
        value: { output },
        watermark: batch.events[batch.events.length - 1].ts,
        eventCount: state.eventCount + batch.events.length,
        updatedAt: new Date().toISOString(),
      },
      changed,
      changeMagnitude: changed
        ? Math.abs(output.totalLinksFound - prevCount) / Math.max(prevCount, 1)
        : 0,
    };
  },

  derive(state): AIGitLinkerOutput {
    return state.value.output;
  },

  contributeEntities(state, _batch) {
    const contributions: import("../substrate/substrate-engine.js").EntityContribution[] = [];
    const links = state.value.output.links ?? [];

    for (const link of links.slice(0, 30)) {
      if (link.linkStrength < 0.2) continue;

      contributions.push({
        entityId: `wu-${link.aiEventId}`,
        entityType: "work-unit",
        projectId: "",
        analyzerName: "ai-git-linker",
        stateFragment: {
          hasGitLink: true,
          gitLinkLagMinutes: link.lagMinutes,
          gitLinkStrength: link.linkStrength,
        },
        relationships: [
          {
            targetEntityId: `commit-${link.commitEventId}`,
            type: "co-occurred-with",
            weight: link.linkStrength,
            evidence: `lag:${link.lagMinutes}min,shared:${link.sharedFiles.length}files`,
          },
        ],
      });
    }

    return contributions;
  },
};

// ---------------------------------------------------------------------------
// KGI-12.1: Entity-level linking enrichment
// ---------------------------------------------------------------------------

async function enrichLinksWithEntities(output: AIGitLinkerOutput, ctx: AnalyzerContext): Promise<void> {
  if (!ctx.knowledge) return;
  try {
    const hasData = await ctx.knowledge.hasKnowledgeData();
    if (!hasData) return;
    const entities = await ctx.knowledge.getEntityEngagement({});
    if (entities.length === 0) return;
    const entityNames = entities.map((e) => e.name.toLowerCase());
    for (const link of output.links) {
      const matched: string[] = [];
      for (const file of link.sharedFiles) {
        const fileLower = file.toLowerCase();
        for (const name of entityNames) {
          if (name.length >= 3 && fileLower.includes(name)) {
            matched.push(name);
          }
        }
      }
      if (matched.length > 0) {
        link.linkedEntities = [...new Set(matched)].slice(0, 10);
      }
    }
  } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

async function computeLinks(ctx: AnalyzerContext): Promise<AIGitLinkerOutput> {
  const now = new Date().toISOString();

  try {
    const aiResult = await ctx.analytics.exec(`
      SELECT id, ts, files_modified, files_referenced, prompt_type
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND ts >= now() - INTERVAL '${LOOKBACK_HOURS} hours'
        AND (files_modified IS NOT NULL OR files_referenced IS NOT NULL)
      ORDER BY ts DESC
      LIMIT 200
    `);

    const commitResult = await ctx.analytics.exec(`
      SELECT id, ts, content_files, git_commit_hash
      FROM events
      WHERE source = 'git' AND type = 'commit'
        AND ts >= now() - INTERVAL '${LOOKBACK_HOURS} hours'
        AND content_files IS NOT NULL
      ORDER BY ts DESC
      LIMIT 200
    `);

    if (!aiResult[0]?.values.length || !commitResult[0]?.values.length) {
      return emptyOutput(now);
    }

    const aiEvents = aiResult[0].values.map((row) => ({
      id: row[0] as string,
      ts: new Date((row[1] as string) ?? "").getTime(),
      files: [
        ...(Array.isArray(row[2]) ? (row[2] as string[]) : []),
        ...(Array.isArray(row[3]) ? (row[3] as string[]) : []),
      ],
      promptType: (row[4] as string) ?? null,
    }));

    const commits = commitResult[0].values.map((row) => ({
      id: row[0] as string,
      ts: new Date((row[1] as string) ?? "").getTime(),
      files: Array.isArray(row[2]) ? (row[2] as string[]) : [],
    }));

    const links: AIGitLink[] = [];

    for (const ai of aiEvents) {
      if (ai.files.length === 0) continue;

      for (const commit of commits) {
        if (commit.files.length === 0) continue;

        const lagMs = commit.ts - ai.ts;
        if (lagMs < 0 || lagMs > MAX_LAG_MINUTES * 60 * 1000) continue;

        const aiFileSet = new Set(ai.files.map(normalizePath));
        const shared = commit.files.filter((f) => aiFileSet.has(normalizePath(f)));

        if (shared.length === 0) continue;

        const overlap = shared.length / Math.min(ai.files.length, commit.files.length);
        const timeFactor = 1 - lagMs / (MAX_LAG_MINUTES * 60 * 1000);
        const linkStrength = Math.round(overlap * timeFactor * 1000) / 1000;

        if (linkStrength > 0.1) {
          links.push({
            aiEventId: ai.id,
            commitEventId: commit.id,
            aiTimestamp: new Date(ai.ts).toISOString(),
            commitTimestamp: new Date(commit.ts).toISOString(),
            lagMinutes: Math.round(lagMs / 60000),
            sharedFiles: shared.slice(0, 10),
            linkStrength,
            promptType: ai.promptType,
          });
        }
      }
    }

    links.sort((a, b) => b.linkStrength - a.linkStrength);
    const topLinks = links.slice(0, 50);

    const avgLag =
      topLinks.length > 0
        ? Math.round(topLinks.reduce((s, l) => s + l.lagMinutes, 0) / topLinks.length)
        : null;

    const uniqueAI = new Set(topLinks.map((l) => l.aiEventId)).size;
    const totalAI = aiEvents.length;
    const rate = totalAI > 0 ? Math.round((uniqueAI / totalAI) * 1000) / 1000 : 0;

    return {
      links: topLinks,
      totalLinksFound: topLinks.length,
      avgLagMinutes: avgLag,
      aiToCommitRate: rate,
      updatedAt: now,
    };
  } catch {
    return emptyOutput(now);
  }
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

function emptyOutput(now: string): AIGitLinkerOutput {
  return { links: [], totalLinksFound: 0, avgLagMinutes: null, aiToCommitRate: 0, updatedAt: now };
}
