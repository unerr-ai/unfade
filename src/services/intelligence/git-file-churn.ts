// FILE: src/services/intelligence/git-file-churn.ts
// Identifies hot files — files that change frequently. High churn often
// correlates with architectural instability or active feature development.
// Feeds into blind-spot detection and feature-boundary classification.

import type { AnalyzerContext } from "./analyzers/index.js";
import type {
  IncrementalAnalyzer,
  IncrementalState,
  NewEventBatch,
  UpdateResult,
} from "./incremental-state.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileChurnEntry {
  path: string;
  changeCount: number;
  lastChanged: string;
  churnRate: number;
  isHotFile: boolean;
  relatedBranches: string[];
}

export interface FileChurnOutput {
  hotFiles: FileChurnEntry[];
  totalFilesTracked: number;
  avgChurnRate: number;
  hotFileThreshold: number;
  updatedAt: string;
}

interface FileChurnState {
  output: FileChurnOutput;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HOT_FILE_PERCENTILE = 90;
const MIN_CHANGES_FOR_HOT = 3;
const LOOKBACK_DAYS = 30;

// ---------------------------------------------------------------------------
// IncrementalAnalyzer
// ---------------------------------------------------------------------------

export const fileChurnAnalyzer: IncrementalAnalyzer<FileChurnState, FileChurnOutput> = {
  name: "file-churn",
  outputFile: "file-churn.json",
  eventFilter: { sources: ["git"], types: ["commit"] },
  minDataPoints: 5,

  async initialize(ctx): Promise<IncrementalState<FileChurnState>> {
    const output = await computeChurn(ctx);
    return {
      value: { output },
      watermark: "",
      eventCount: 0,
      updatedAt: new Date().toISOString(),
    };
  },

  async update(state, batch, ctx): Promise<UpdateResult<FileChurnState>> {
    if (batch.events.length === 0) return { state, changed: false };

    const output = await computeChurn(ctx);
    const prevHotCount = state.value.output.hotFiles.length;
    const changed =
      output.hotFiles.length !== prevHotCount ||
      output.totalFilesTracked !== state.value.output.totalFilesTracked;

    return {
      state: {
        value: { output },
        watermark: batch.events[batch.events.length - 1].ts,
        eventCount: state.eventCount + batch.events.length,
        updatedAt: new Date().toISOString(),
      },
      changed,
      changeMagnitude: changed ? 0.1 : 0,
    };
  },

  derive(state): FileChurnOutput {
    return state.value.output;
  },

  contributeEntities(state, _batch) {
    const contributions: import("../substrate/substrate-engine.js").EntityContribution[] = [];
    const hotFiles = state.value.output.hotFiles ?? [];

    for (const file of hotFiles.slice(0, 20)) {
      if (!file.isHotFile) continue;
      const parts = file.path.split("/");
      const module = parts.length >= 3 ? parts.slice(0, 3).join("/") : parts.slice(0, 2).join("/");

      contributions.push({
        entityId: `hotspot-${file.path.replace(/\//g, "-").replace(/\./g, "_")}`,
        entityType: "hotspot",
        projectId: "",
        analyzerName: "file-churn",
        stateFragment: {
          path: file.path,
          changeCount: file.changeCount,
          churnRate: file.churnRate,
        },
        relationships: [
          {
            targetEntityId: `feat-${module.replace(/\//g, "-")}`,
            type: "applies-to",
            weight: Math.min(1, file.churnRate * 5),
            evidence: "hot-file-detection",
          },
        ],
      });
    }

    return contributions;
  },
};

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

async function computeChurn(ctx: AnalyzerContext): Promise<FileChurnOutput> {
  const now = new Date().toISOString();

  try {
    const result = await ctx.analytics.exec(`
      SELECT content_files, ts, git_branch
      FROM events
      WHERE source = 'git' AND type = 'commit'
        AND ts >= now() - INTERVAL '${LOOKBACK_DAYS} days'
        AND content_files IS NOT NULL
      ORDER BY ts DESC
      LIMIT 1000
    `);

    if (!result[0]?.values.length) {
      return {
        hotFiles: [],
        totalFilesTracked: 0,
        avgChurnRate: 0,
        hotFileThreshold: MIN_CHANGES_FOR_HOT,
        updatedAt: now,
      };
    }

    const fileMap = new Map<string, { count: number; lastTs: string; branches: Set<string> }>();
    const daySpan = LOOKBACK_DAYS;

    for (const row of result[0].values) {
      const files = Array.isArray(row[0]) ? (row[0] as string[]) : [];
      const ts = (row[1] as string) ?? "";
      const branch = (row[2] as string) ?? "";

      for (const file of files) {
        const existing = fileMap.get(file);
        if (existing) {
          existing.count++;
          if (ts > existing.lastTs) existing.lastTs = ts;
          if (branch) existing.branches.add(branch);
        } else {
          fileMap.set(file, { count: 1, lastTs: ts, branches: new Set(branch ? [branch] : []) });
        }
      }
    }

    const allCounts = [...fileMap.values()].map((f) => f.count);
    if (allCounts.length === 0) {
      return {
        hotFiles: [],
        totalFilesTracked: 0,
        avgChurnRate: 0,
        hotFileThreshold: MIN_CHANGES_FOR_HOT,
        updatedAt: now,
      };
    }

    const sorted = [...allCounts].sort((a, b) => a - b);
    const p90Idx = Math.floor(sorted.length * (HOT_FILE_PERCENTILE / 100));
    const hotThreshold = Math.max(MIN_CHANGES_FOR_HOT, sorted[p90Idx] ?? MIN_CHANGES_FOR_HOT);

    const avgChurn = allCounts.reduce((s, v) => s + v, 0) / allCounts.length / daySpan;

    const hotFiles: FileChurnEntry[] = [];
    for (const [path, data] of fileMap) {
      const churnRate = Math.round((data.count / daySpan) * 1000) / 1000;
      const isHot = data.count >= hotThreshold;

      if (isHot) {
        hotFiles.push({
          path,
          changeCount: data.count,
          lastChanged: data.lastTs,
          churnRate,
          isHotFile: true,
          relatedBranches: [...data.branches].slice(0, 5),
        });
      }
    }

    hotFiles.sort((a, b) => b.changeCount - a.changeCount);

    return {
      hotFiles: hotFiles.slice(0, 50),
      totalFilesTracked: fileMap.size,
      avgChurnRate: Math.round(avgChurn * 1000) / 1000,
      hotFileThreshold: hotThreshold,
      updatedAt: now,
    };
  } catch {
    return {
      hotFiles: [],
      totalFilesTracked: 0,
      avgChurnRate: 0,
      hotFileThreshold: MIN_CHANGES_FOR_HOT,
      updatedAt: now,
    };
  }
}
