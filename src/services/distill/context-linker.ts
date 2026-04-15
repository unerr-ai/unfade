// FILE: src/services/distill/context-linker.ts
// UF-033: Stage 2 — Context Linker.
// Cross-references extracted signals to git context, finds AI conversations
// about the same files, and builds temporal chains. No LLM.

import type { ExtractedSignals, LinkedSignals } from "../../schemas/distill.js";
import type { CaptureEvent } from "../../schemas/event.js";

/**
 * Build an index from file path → event IDs that touched that file.
 */
function buildFileIndex(events: CaptureEvent[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const event of events) {
    for (const file of event.content.files ?? []) {
      if (!index.has(file)) index.set(file, []);
      index.get(file)?.push(event.id);
    }
  }
  return index;
}

/**
 * Find AI conversation event IDs that reference any of the given files.
 */
function findRelatedAiConversations(files: string[], aiConversations: CaptureEvent[]): string[] {
  const related: string[] = [];
  for (const conv of aiConversations) {
    const convFiles = conv.content.files ?? [];
    const convDetail = conv.content.detail ?? "";
    const convSummary = conv.content.summary;

    for (const file of files) {
      const basename = file.split("/").pop() ?? file;
      if (
        convFiles.includes(file) ||
        convDetail.includes(file) ||
        convDetail.includes(basename) ||
        convSummary.includes(file) ||
        convSummary.includes(basename)
      ) {
        related.push(conv.id);
        break;
      }
    }
  }
  return related;
}

/**
 * Build temporal chains — groups of sequential commits touching the same module.
 * A "module" is a top-level directory (e.g., "src/auth" from "src/auth/login.ts").
 */
function buildTemporalChains(events: CaptureEvent[]): LinkedSignals["temporalChains"] {
  const commits = events
    .filter((e) => e.type === "commit")
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Group commits by module (first two path segments)
  const moduleCommits = new Map<string, CaptureEvent[]>();
  for (const commit of commits) {
    const modules = new Set<string>();
    for (const file of commit.content.files ?? []) {
      const parts = file.split("/");
      const mod = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
      modules.add(mod);
    }
    for (const mod of modules) {
      if (!moduleCommits.has(mod)) moduleCommits.set(mod, []);
      moduleCommits.get(mod)?.push(commit);
    }
  }

  // Only emit chains with 2+ commits
  const chains: LinkedSignals["temporalChains"] = [];
  for (const [mod, modCommits] of moduleCommits) {
    if (modCommits.length < 2) continue;
    chains.push({
      module: mod,
      eventIds: modCommits.map((c) => c.id),
      summary: `${modCommits.length} commits on ${mod}: ${modCommits.map((c) => c.content.summary).join(" → ")}`,
    });
  }

  return chains;
}

/**
 * Link extracted signals with git context, AI conversations, and temporal chains.
 */
export function linkContext(signals: ExtractedSignals, events: CaptureEvent[]): LinkedSignals {
  const eventMap = new Map<string, CaptureEvent>();
  for (const event of events) {
    eventMap.set(event.id, event);
  }

  const aiConversations = events.filter(
    (e) => e.type === "ai-conversation" || e.source === "ai-session",
  );
  const fileIndex = buildFileIndex(events);

  // --- Link decisions ---
  const decisions: LinkedSignals["decisions"] = signals.decisions.map((d) => {
    const event = eventMap.get(d.eventId);
    const files = event?.content.files;
    const repo = event?.gitContext?.repo;
    const relatedAi = files ? findRelatedAiConversations(files, aiConversations) : [];

    return {
      eventId: d.eventId,
      summary: d.summary,
      branch: d.branch,
      alternativesCount: d.alternativesCount,
      files,
      repo,
      relatedAiConversations: relatedAi.length > 0 ? relatedAi : undefined,
    };
  });

  // --- Link trade-offs with related commits ---
  const tradeOffs: LinkedSignals["tradeOffs"] = signals.tradeOffs.map((t) => {
    const files = t.relatedFiles ?? [];
    const relatedCommits = new Set<string>();
    for (const file of files) {
      const commitIds = fileIndex.get(file) ?? [];
      for (const id of commitIds) {
        if (id !== t.eventId) relatedCommits.add(id);
      }
    }

    return {
      eventId: t.eventId,
      summary: t.summary,
      relatedFiles: t.relatedFiles,
      relatedCommits: relatedCommits.size > 0 ? Array.from(relatedCommits) : undefined,
    };
  });

  // --- Link dead ends with reverted files ---
  const deadEnds: LinkedSignals["deadEnds"] = signals.deadEnds.map((d) => {
    const event = eventMap.get(d.revertEventId);
    return {
      revertEventId: d.revertEventId,
      summary: d.summary,
      timeSpentMinutes: d.timeSpentMinutes,
      revertedFiles: event?.content.files,
    };
  });

  // --- Link breakthroughs with trigger context ---
  const breakthroughs: LinkedSignals["breakthroughs"] = signals.breakthroughs.map((b) => {
    const event = eventMap.get(b.eventId);
    // Look for an AI conversation shortly before the breakthrough
    let triggeredBy: string | undefined;
    if (event) {
      const bTime = new Date(event.timestamp).getTime();
      const recentAi = aiConversations.find((ai) => {
        const aiTime = new Date(ai.timestamp).getTime();
        return bTime - aiTime > 0 && bTime - aiTime < 60 * 60 * 1000; // within 1hr before
      });
      if (recentAi) {
        triggeredBy = `AI conversation: ${recentAi.content.summary}`;
      }
    }

    return {
      eventId: b.eventId,
      summary: b.summary,
      triggeredBy,
    };
  });

  // --- Temporal chains ---
  const temporalChains = buildTemporalChains(events);

  // --- Compute AI acceptance rate ---
  const { aiCompletions, aiRejections } = signals.stats;
  const totalAi = aiCompletions + aiRejections;
  const aiAcceptanceRate = totalAi > 0 ? aiCompletions / totalAi : undefined;

  return {
    date: signals.date,
    decisions,
    tradeOffs,
    deadEnds,
    breakthroughs,
    temporalChains,
    stats: {
      ...signals.stats,
      aiAcceptanceRate,
    },
  };
}
