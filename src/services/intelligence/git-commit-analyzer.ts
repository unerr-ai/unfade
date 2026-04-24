// FILE: src/services/intelligence/git-commit-analyzer.ts
// Analyzes git commit patterns: commit frequency, size distribution, timing,
// branch patterns, and commit message quality. Feeds into the maturity model
// as an indicator of implementation discipline.

import type { AnalyzerContext } from "./analyzers/index.js";
import type { IncrementalAnalyzer, IncrementalState, UpdateResult } from "./incremental-state.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommitStats {
  totalCommits: number;
  avgFilesPerCommit: number;
  commitsByHour: Record<number, number>;
  commitsByDayOfWeek: Record<number, number>;
  branchDistribution: Record<string, number>;
  avgTimeBetweenCommitsMin: number | null;
  largeCommitCount: number;
  smallCommitCount: number;
  commitMessageQuality: {
    avgLength: number;
    withConventionalPrefix: number;
    withTicketRef: number;
    oneLiners: number;
  };
  recentVelocity: number;
  updatedAt: string;
}

interface CommitAnalyzerState {
  output: CommitStats;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LARGE_COMMIT_THRESHOLD = 10;
const SMALL_COMMIT_THRESHOLD = 2;
const CONVENTIONAL_PREFIX =
  /^(?:feat|fix|chore|docs|style|refactor|test|perf|ci|build|revert)[\s(:]/i;
const TICKET_REF = /(?:[A-Z]+-\d+|#\d+|\bGH-\d+)/;

// ---------------------------------------------------------------------------
// IncrementalAnalyzer
// ---------------------------------------------------------------------------

export const commitAnalyzer: IncrementalAnalyzer<CommitAnalyzerState, CommitStats> = {
  name: "commit-analyzer",
  outputFile: "commit-analysis.json",
  eventFilter: { sources: ["git"], types: ["commit"] },
  minDataPoints: 3,

  async initialize(ctx): Promise<IncrementalState<CommitAnalyzerState>> {
    const output = await computeCommitStats(ctx);
    return {
      value: { output },
      watermark: "",
      eventCount: 0,
      updatedAt: new Date().toISOString(),
    };
  },

  async update(state, batch, ctx): Promise<UpdateResult<CommitAnalyzerState>> {
    if (batch.events.length === 0) return { state, changed: false };

    const output = await computeCommitStats(ctx);
    const prevTotal = state.value.output.totalCommits;
    const changed = output.totalCommits !== prevTotal;

    return {
      state: {
        value: { output },
        watermark: batch.events[batch.events.length - 1].ts,
        eventCount: state.eventCount + batch.events.length,
        updatedAt: new Date().toISOString(),
      },
      changed,
      changeMagnitude: changed
        ? Math.abs(output.totalCommits - prevTotal) / Math.max(prevTotal, 1)
        : 0,
    };
  },

  derive(state): CommitStats {
    return state.value.output;
  },

  contributeEntities(_state, batch) {
    const contributions: import("../substrate/substrate-engine.js").EntityContribution[] = [];

    for (const evt of batch.events) {
      if (evt.source !== "git" || evt.type !== "commit") continue;

      const files = evt.filesModified.length > 0 ? evt.filesModified : evt.filesReferenced;
      const relationships: import("../substrate/substrate-engine.js").EntityContribution["relationships"] =
        [];

      for (const file of files.slice(0, 5)) {
        const parts = file.split("/");
        const module =
          parts.length >= 3 ? parts.slice(0, 3).join("/") : parts.slice(0, 2).join("/");
        relationships.push({
          targetEntityId: `feat-${module.replace(/\//g, "-")}`,
          type: "targets",
          weight: 0.8,
          evidence: "commit-file-link",
        });
      }

      contributions.push({
        entityId: `commit-${evt.id}`,
        entityType: "commit",
        projectId: evt.projectId,
        analyzerName: "commit-analyzer",
        stateFragment: {
          summary: evt.contentSummary ?? "",
          branch: evt.contentBranch ?? "",
          fileCount: files.length,
          timestamp: evt.ts,
        },
        relationships,
      });
    }

    return contributions;
  },
};

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

async function computeCommitStats(ctx: AnalyzerContext): Promise<CommitStats> {
  const now = new Date().toISOString();

  try {
    const result = await ctx.analytics.exec(`
      SELECT
        content_summary,
        content_files,
        git_branch,
        ts,
        git_commit_hash
      FROM events
      WHERE source = 'git' AND type = 'commit'
        AND ts >= now() - INTERVAL '30 days'
      ORDER BY ts ASC
      LIMIT 1000
    `);

    if (!result[0]?.values.length) {
      return emptyStats(now);
    }

    const rows = result[0].values;
    const totalCommits = rows.length;

    const commitsByHour: Record<number, number> = {};
    const commitsByDayOfWeek: Record<number, number> = {};
    const branchDistribution: Record<string, number> = {};
    const timestamps: number[] = [];
    let totalFiles = 0;
    let largeCommits = 0;
    let smallCommits = 0;
    let totalMsgLen = 0;
    let conventionalCount = 0;
    let ticketRefCount = 0;
    let oneLinerCount = 0;

    for (const row of rows) {
      const summary = (row[0] as string) ?? "";
      const files = Array.isArray(row[1]) ? (row[1] as string[]) : [];
      const branch = (row[2] as string) ?? "unknown";
      const ts = new Date((row[3] as string) ?? "");
      const fileCount = files.length;

      totalFiles += fileCount;
      if (fileCount >= LARGE_COMMIT_THRESHOLD) largeCommits++;
      if (fileCount <= SMALL_COMMIT_THRESHOLD && fileCount > 0) smallCommits++;

      const hour = ts.getHours();
      const day = ts.getDay();
      commitsByHour[hour] = (commitsByHour[hour] ?? 0) + 1;
      commitsByDayOfWeek[day] = (commitsByDayOfWeek[day] ?? 0) + 1;

      const branchKey = branch.replace(/^refs\/heads\//, "").split("/")[0] ?? "unknown";
      branchDistribution[branchKey] = (branchDistribution[branchKey] ?? 0) + 1;

      timestamps.push(ts.getTime());

      totalMsgLen += summary.length;
      if (CONVENTIONAL_PREFIX.test(summary)) conventionalCount++;
      if (TICKET_REF.test(summary)) ticketRefCount++;
      if (!summary.includes("\n") && summary.length < 72) oneLinerCount++;
    }

    let avgTimeBetween: number | null = null;
    if (timestamps.length >= 2) {
      let totalGap = 0;
      for (let i = 1; i < timestamps.length; i++) {
        totalGap += timestamps[i] - timestamps[i - 1];
      }
      avgTimeBetween = Math.round(totalGap / (timestamps.length - 1) / 60000);
    }

    const sevenDaysAgo = Date.now() - 7 * 86400 * 1000;
    const recentCommits = timestamps.filter((t) => t >= sevenDaysAgo).length;

    return {
      totalCommits,
      avgFilesPerCommit: Math.round((totalFiles / totalCommits) * 10) / 10,
      commitsByHour,
      commitsByDayOfWeek,
      branchDistribution,
      avgTimeBetweenCommitsMin: avgTimeBetween,
      largeCommitCount: largeCommits,
      smallCommitCount: smallCommits,
      commitMessageQuality: {
        avgLength: Math.round(totalMsgLen / totalCommits),
        withConventionalPrefix: conventionalCount,
        withTicketRef: ticketRefCount,
        oneLiners: oneLinerCount,
      },
      recentVelocity: recentCommits,
      updatedAt: now,
    };
  } catch {
    return emptyStats(now);
  }
}

function emptyStats(now: string): CommitStats {
  return {
    totalCommits: 0,
    avgFilesPerCommit: 0,
    commitsByHour: {},
    commitsByDayOfWeek: {},
    branchDistribution: {},
    avgTimeBetweenCommitsMin: null,
    largeCommitCount: 0,
    smallCommitCount: 0,
    commitMessageQuality: {
      avgLength: 0,
      withConventionalPrefix: 0,
      withTicketRef: 0,
      oneLiners: 0,
    },
    recentVelocity: 0,
    updatedAt: now,
  };
}
