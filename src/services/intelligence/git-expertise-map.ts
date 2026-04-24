// FILE: src/services/intelligence/git-expertise-map.ts
// File-level expertise scoring combining git commit activity with AI
// session file references. Answers: "Which parts of the codebase do
// you understand deeply vs. rely on AI blindly?"

import type { AnalyzerContext } from "./analyzers/index.js";
import type { IncrementalAnalyzer, IncrementalState, UpdateResult } from "./incremental-state.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileExpertise {
  path: string;
  module: string;
  gitCommitCount: number;
  aiReferenceCount: number;
  aiModifyCount: number;
  expertiseScore: number;
  expertiseLevel: "deep" | "familiar" | "surface" | "ai-dependent";
  lastActivity: string;
}

export interface ExpertiseMapOutput {
  files: FileExpertise[];
  byModule: Array<{
    module: string;
    avgExpertise: number;
    fileCount: number;
    deepCount: number;
    aiDependentCount: number;
  }>;
  overallExpertise: number;
  aiDependencyRate: number;
  updatedAt: string;
}

interface ExpertiseMapState {
  output: ExpertiseMapOutput;
}

// ---------------------------------------------------------------------------
// IncrementalAnalyzer
// ---------------------------------------------------------------------------

export const expertiseMapAnalyzer: IncrementalAnalyzer<ExpertiseMapState, ExpertiseMapOutput> = {
  name: "expertise-map",
  outputFile: "expertise-map.json",
  eventFilter: { sources: ["git", "ai-session", "mcp-active"] },
  minDataPoints: 10,

  async initialize(ctx): Promise<IncrementalState<ExpertiseMapState>> {
    const output = await computeExpertise(ctx);
    return {
      value: { output },
      watermark: "",
      eventCount: 0,
      updatedAt: new Date().toISOString(),
    };
  },

  async update(state, batch, ctx): Promise<UpdateResult<ExpertiseMapState>> {
    if (batch.events.length === 0) return { state, changed: false };

    const output = await computeExpertise(ctx);
    const prevOverall = state.value.output.overallExpertise;
    const changed = Math.abs(output.overallExpertise - prevOverall) > 0.02;

    return {
      state: {
        value: { output },
        watermark: batch.events[batch.events.length - 1].ts,
        eventCount: state.eventCount + batch.events.length,
        updatedAt: new Date().toISOString(),
      },
      changed,
      changeMagnitude: Math.abs(output.overallExpertise - prevOverall),
    };
  },

  derive(state): ExpertiseMapOutput {
    return state.value.output;
  },
};

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

async function computeExpertise(ctx: AnalyzerContext): Promise<ExpertiseMapOutput> {
  const now = new Date().toISOString();

  try {
    const gitResult = await ctx.analytics.exec(`
      SELECT content_files, ts
      FROM events
      WHERE source = 'git' AND type = 'commit'
        AND ts >= now() - INTERVAL '30 days'
        AND content_files IS NOT NULL
      LIMIT 1000
    `);

    const aiResult = await ctx.analytics.exec(`
      SELECT files_referenced, files_modified, ts
      FROM events
      WHERE source IN ('ai-session', 'mcp-active')
        AND ts >= now() - INTERVAL '30 days'
        AND (files_referenced IS NOT NULL OR files_modified IS NOT NULL)
      LIMIT 1000
    `);

    const fileData = new Map<
      string,
      {
        gitCount: number;
        aiRefCount: number;
        aiModCount: number;
        lastTs: string;
      }
    >();

    if (gitResult[0]?.values) {
      for (const row of gitResult[0].values) {
        const files = Array.isArray(row[0]) ? (row[0] as string[]) : [];
        const ts = (row[1] as string) ?? "";
        for (const file of files) {
          const norm = normalizePath(file);
          const existing = fileData.get(norm) ?? {
            gitCount: 0,
            aiRefCount: 0,
            aiModCount: 0,
            lastTs: "",
          };
          existing.gitCount++;
          if (ts > existing.lastTs) existing.lastTs = ts;
          fileData.set(norm, existing);
        }
      }
    }

    if (aiResult[0]?.values) {
      for (const row of aiResult[0].values) {
        const refs = Array.isArray(row[0]) ? (row[0] as string[]) : [];
        const mods = Array.isArray(row[1]) ? (row[1] as string[]) : [];
        const ts = (row[2] as string) ?? "";

        for (const file of refs) {
          const norm = normalizePath(file);
          const existing = fileData.get(norm) ?? {
            gitCount: 0,
            aiRefCount: 0,
            aiModCount: 0,
            lastTs: "",
          };
          existing.aiRefCount++;
          if (ts > existing.lastTs) existing.lastTs = ts;
          fileData.set(norm, existing);
        }
        for (const file of mods) {
          const norm = normalizePath(file);
          const existing = fileData.get(norm) ?? {
            gitCount: 0,
            aiRefCount: 0,
            aiModCount: 0,
            lastTs: "",
          };
          existing.aiModCount++;
          if (ts > existing.lastTs) existing.lastTs = ts;
          fileData.set(norm, existing);
        }
      }
    }

    if (fileData.size === 0) {
      return emptyOutput(now);
    }

    const files: FileExpertise[] = [];
    for (const [path, data] of fileData) {
      const totalActivity = data.gitCount + data.aiRefCount + data.aiModCount;
      if (totalActivity < 2) continue;

      const gitRatio = totalActivity > 0 ? data.gitCount / totalActivity : 0;
      const _aiRatio = totalActivity > 0 ? (data.aiRefCount + data.aiModCount) / totalActivity : 0;

      const expertiseScore = Math.min(
        1,
        gitRatio * 0.6 + Math.min(1, data.gitCount / 10) * 0.3 + (data.aiModCount > 0 ? 0.1 : 0),
      );

      let level: FileExpertise["expertiseLevel"];
      if (expertiseScore > 0.7) level = "deep";
      else if (expertiseScore > 0.4) level = "familiar";
      else if (data.gitCount === 0 && data.aiRefCount + data.aiModCount > 0) level = "ai-dependent";
      else level = "surface";

      files.push({
        path,
        module: extractModule(path),
        gitCommitCount: data.gitCount,
        aiReferenceCount: data.aiRefCount,
        aiModifyCount: data.aiModCount,
        expertiseScore: Math.round(expertiseScore * 1000) / 1000,
        expertiseLevel: level,
        lastActivity: data.lastTs,
      });
    }

    files.sort((a, b) => b.expertiseScore - a.expertiseScore);

    const moduleMap = new Map<string, FileExpertise[]>();
    for (const f of files) {
      const arr = moduleMap.get(f.module) ?? [];
      arr.push(f);
      moduleMap.set(f.module, arr);
    }

    const byModule = [...moduleMap.entries()]
      .map(([module, moduleFiles]) => {
        const avgExpertise =
          moduleFiles.reduce((s, f) => s + f.expertiseScore, 0) / moduleFiles.length;
        return {
          module,
          avgExpertise: Math.round(avgExpertise * 1000) / 1000,
          fileCount: moduleFiles.length,
          deepCount: moduleFiles.filter((f) => f.expertiseLevel === "deep").length,
          aiDependentCount: moduleFiles.filter((f) => f.expertiseLevel === "ai-dependent").length,
        };
      })
      .sort((a, b) => b.avgExpertise - a.avgExpertise);

    const overallExpertise =
      files.length > 0
        ? Math.round((files.reduce((s, f) => s + f.expertiseScore, 0) / files.length) * 1000) / 1000
        : 0;

    const aiDependentFiles = files.filter((f) => f.expertiseLevel === "ai-dependent").length;
    const aiDependencyRate =
      files.length > 0 ? Math.round((aiDependentFiles / files.length) * 1000) / 1000 : 0;

    return {
      files: files.slice(0, 100),
      byModule: byModule.slice(0, 30),
      overallExpertise,
      aiDependencyRate,
      updatedAt: now,
    };
  } catch {
    return emptyOutput(now);
  }
}

function extractModule(path: string): string {
  const parts = path.split("/");
  if (parts.length >= 3) return parts.slice(0, 3).join("/");
  if (parts.length >= 2) return parts.slice(0, 2).join("/");
  return parts[0] ?? "root";
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

function emptyOutput(now: string): ExpertiseMapOutput {
  return { files: [], byModule: [], overallExpertise: 0, aiDependencyRate: 0, updatedAt: now };
}
