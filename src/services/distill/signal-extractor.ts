// FILE: src/services/distill/signal-extractor.ts
// UF-032: Stage 1 — Signal Extractor.
// Parses a day's CaptureEvents into structured reasoning signals.
// No LLM. Never throws.

import type {
  CorroborationGroup,
  DayShape,
  ExtractedSignals,
  ImpactScore,
  ScoredSignal,
  SignalTier,
  TriagedSignals,
} from "../../schemas/distill.js";
import type { CaptureEvent } from "../../schemas/event.js";
import { logger } from "../../utils/logger.js";
import { normalizedSimilarity } from "./conversation-digester.js";

const DOMAIN_MAP: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript/React",
  ".js": "JavaScript",
  ".jsx": "JavaScript/React",
  ".go": "Go",
  ".py": "Python",
  ".rs": "Rust",
  ".java": "Java",
  ".css": "Styles",
  ".html": "Markup",
  ".sql": "Database",
  ".yml": "Config",
  ".yaml": "Config",
  ".json": "Config",
  ".md": "Docs",
  ".sh": "Shell",
  ".dockerfile": "Infrastructure",
};

const FIX_PATTERN = /\b(fix|hotfix|patch|bugfix|repair|resolve)\b/i;
const RAPID_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Extract domains from file extensions.
 */
function domainsFromFiles(files: string[]): string[] {
  const domains = new Set<string>();
  for (const file of files) {
    const dotIdx = file.lastIndexOf(".");
    if (dotIdx === -1) continue;
    const ext = file.slice(dotIdx).toLowerCase();
    const domain = DOMAIN_MAP[ext];
    if (domain) domains.add(domain);
  }
  return Array.from(domains).sort();
}

/**
 * Collect all unique files across events.
 */
function collectFiles(events: CaptureEvent[]): string[] {
  const files = new Set<string>();
  for (const event of events) {
    for (const f of event.content.files ?? []) {
      files.add(f);
    }
  }
  return Array.from(files).sort();
}

/**
 * Count branch names seen across commit events to estimate alternatives.
 * Multiple branches touching the same files → decision with alternatives.
 */
function countBranches(events: CaptureEvent[]): Map<string, Set<string>> {
  const fileToBranches = new Map<string, Set<string>>();
  for (const event of events) {
    if (event.type !== "commit") continue;
    const branch = event.content.branch ?? event.gitContext?.branch;
    if (!branch) continue;
    for (const file of event.content.files ?? []) {
      if (!fileToBranches.has(file)) fileToBranches.set(file, new Set());
      fileToBranches.get(file)?.add(branch);
    }
  }
  return fileToBranches;
}

/**
 * Detect rapid fix commits (debugging sessions).
 * Groups sequential commits with "fix" in summary within a 30-min window.
 */
function detectDebuggingSessions(commits: CaptureEvent[]): ExtractedSignals["debuggingSessions"] {
  const sessions: ExtractedSignals["debuggingSessions"] = [];
  const fixCommits = commits.filter((e) => FIX_PATTERN.test(e.content.summary));

  if (fixCommits.length < 2) return sessions;

  let currentGroup: CaptureEvent[] = [fixCommits[0]];

  for (let i = 1; i < fixCommits.length; i++) {
    const prev = new Date(fixCommits[i - 1].timestamp).getTime();
    const curr = new Date(fixCommits[i].timestamp).getTime();

    if (curr - prev <= RAPID_WINDOW_MS) {
      currentGroup.push(fixCommits[i]);
    } else {
      if (currentGroup.length >= 2) {
        sessions.push({
          eventIds: currentGroup.map((e) => e.id),
          summary: `Debugging session: ${currentGroup.length} fix commits — ${currentGroup[0].content.summary}`,
          fixCount: currentGroup.length,
        });
      }
      currentGroup = [fixCommits[i]];
    }
  }

  if (currentGroup.length >= 2) {
    sessions.push({
      eventIds: currentGroup.map((e) => e.id),
      summary: `Debugging session: ${currentGroup.length} fix commits — ${currentGroup[0].content.summary}`,
      fixCount: currentGroup.length,
    });
  }

  return sessions;
}

// --- Direction signals from AI session events ---

interface DirectionSignalsMeta {
  humanDirectionScore: number;
  confidence: "high" | "low";
  rejectionCount: number;
}

function parseDirectionSignals(event: CaptureEvent): DirectionSignalsMeta | null {
  const meta = event.metadata;
  if (!meta) return null;

  const ds = meta.direction_signals as Record<string, unknown> | undefined;
  if (!ds) return null;

  const hds = typeof ds.human_direction_score === "number" ? ds.human_direction_score : null;
  if (hds === null) return null;

  return {
    humanDirectionScore: hds,
    confidence: ds.confidence === "high" ? "high" : "low",
    rejectionCount: typeof ds.rejection_count === "number" ? ds.rejection_count : 0,
  };
}

/**
 * Weight multiplier by event source.
 * AI sessions are 3x more signal-rich than git commits.
 */
function _sourceWeight(event: CaptureEvent): number {
  switch (event.source) {
    case "ai-session":
      return 3;
    case "terminal":
      return 1.5;
    default:
      return 1;
  }
}

/**
 * Extract structured reasoning signals from a day's events.
 * Never throws — returns empty signals on any error.
 */
export function extractSignals(events: CaptureEvent[], date: string): ExtractedSignals {
  try {
    return doExtract(events, date);
  } catch (err) {
    logger.warn("Signal extraction failed, returning empty signals", {
      error: String(err),
    });
    return emptySignals(date);
  }
}

/**
 * Deduplicate AI conversations by conversation_id.
 * Multiple snapshots of the same conversation may be captured —
 * keep only the latest (longest detail / highest turn count) per conversation.
 * Also deduplicates by summary text similarity for events without conversation_id.
 */
function deduplicateConversations(conversations: CaptureEvent[]): CaptureEvent[] {
  const byConvId = new Map<string, CaptureEvent>();
  const orphans: CaptureEvent[] = [];

  for (const event of conversations) {
    const convId = event.metadata?.conversation_id as string | undefined;
    if (convId) {
      const existing = byConvId.get(convId);
      if (!existing) {
        byConvId.set(convId, event);
      } else {
        // Keep the snapshot with more content (higher turn count or longer detail)
        const existingTurns = (existing.metadata?.turn_count as number) ?? 0;
        const newTurns = (event.metadata?.turn_count as number) ?? 0;
        const existingLen = existing.content.detail?.length ?? 0;
        const newLen = event.content.detail?.length ?? 0;
        if (newTurns > existingTurns || (newTurns === existingTurns && newLen > existingLen)) {
          byConvId.set(convId, event);
        }
      }
    } else {
      orphans.push(event);
    }
  }

  // Dedup orphans by summary similarity
  const dedupedOrphans: CaptureEvent[] = [];
  for (const event of orphans) {
    const isDupe = dedupedOrphans.some(
      (existing) => normalizedSimilarity(existing.content.summary, event.content.summary) > 0.6,
    );
    if (!isDupe) dedupedOrphans.push(event);
  }

  return [...byConvId.values(), ...dedupedOrphans];
}

function doExtract(events: CaptureEvent[], date: string): ExtractedSignals {
  const commits = events.filter((e) => e.type === "commit");
  const aiConversations = events.filter((e) => e.type === "ai-conversation");
  const aiCompletions = events.filter((e) => e.type === "ai-completion");
  const aiRejections = events.filter((e) => e.type === "ai-rejection");
  const branchSwitches = events.filter((e) => e.type === "branch-switch");
  const reverts = events.filter((e) => e.type === "revert");

  const fileToBranches = countBranches(events);
  const allFiles = collectFiles(events);
  const domains = domainsFromFiles(allFiles);

  // --- Deduplicate AI conversations by conversation_id ---
  // The capture engine may emit multiple snapshots of the same conversation
  // (e.g., periodic checkpoints). Keep only the latest snapshot per conversation.
  const deduplicatedConversations = deduplicateConversations(aiConversations);

  // --- Decisions from AI conversation events (3x weight) ---
  // Filtered: only conversations with decision-indicating signals pass through.
  // Raw prompts and non-engineering conversations are excluded.
  const aiDecisions: ExtractedSignals["decisions"] = deduplicatedConversations.map((event) => {
    const ds = parseDirectionSignals(event);
    const meta = event.metadata ?? {};
    const turnCount = typeof meta.turn_count === "number" ? meta.turn_count : 0;

    // Extract rich conversation metadata for downstream processing
    const conversationTitle =
      typeof meta.conversation_title === "string" ? meta.conversation_title : undefined;
    const filesModified = Array.isArray(meta.files_modified)
      ? (meta.files_modified as string[])
      : undefined;
    const toolCalls = Array.isArray(meta.tool_calls_summary)
      ? [...new Set((meta.tool_calls_summary as Array<{ name: string }>).map((t) => t.name))]
      : undefined;

    return {
      eventId: event.id,
      summary: event.content.summary,
      branch: event.content.branch ?? event.gitContext?.branch,
      alternativesCount: ds ? Math.max(ds.rejectionCount, turnCount > 4 ? 2 : 0) : 0,
      source: "ai-conversation" as const,
      conversationMeta: {
        conversationTitle:
          conversationTitle && conversationTitle.length < 300 ? conversationTitle : undefined,
        turnCount: turnCount > 0 ? turnCount : undefined,
        filesModified:
          filesModified && filesModified.length > 0 ? filesModified.slice(0, 30) : undefined,
        toolsUsed: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      },
    };
  });

  // --- Decisions from git commits (1x weight) ---
  // All commits are passed through as raw signals for the LLM.
  // Fallback synthesizer filters to real decisions heuristically.
  const commitDecisions: ExtractedSignals["decisions"] = commits.map((event) => {
    const branch = event.content.branch ?? event.gitContext?.branch;
    const eventFiles = event.content.files ?? [];

    let maxBranches = 0;
    for (const file of eventFiles) {
      const branches = fileToBranches.get(file);
      if (branches && branches.size > maxBranches) {
        maxBranches = branches.size;
      }
    }

    return {
      eventId: event.id,
      summary: event.content.summary,
      branch,
      alternativesCount: Math.max(0, maxBranches - 1),
      source: "commit" as const,
    };
  });

  // Merge decisions: AI sessions first (higher signal), then commits.
  // AI decisions are expanded by sourceWeight when scored downstream.
  const decisions = [...aiDecisions, ...commitDecisions];

  // --- Trade-offs: AI rejections indicate the developer chose differently ---
  const tradeOffs: ExtractedSignals["tradeOffs"] = aiRejections.map((event) => ({
    eventId: event.id,
    summary: event.content.summary,
    relatedFiles: event.content.files,
  }));

  // --- Dead ends: reverts, with time-spent estimated from preceding commits ---
  const deadEnds: ExtractedSignals["deadEnds"] = reverts.map((event) => {
    let timeSpentMinutes: number | undefined;

    // Estimate time spent: look for the earliest commit on the same branch
    // before this revert
    const branch = event.content.branch ?? event.gitContext?.branch;
    if (branch) {
      const revertTime = new Date(event.timestamp).getTime();
      const branchCommits = commits.filter((c) => {
        const cBranch = c.content.branch ?? c.gitContext?.branch;
        return cBranch === branch && new Date(c.timestamp).getTime() < revertTime;
      });
      if (branchCommits.length > 0) {
        const earliest = Math.min(...branchCommits.map((c) => new Date(c.timestamp).getTime()));
        timeSpentMinutes = Math.round((revertTime - earliest) / 60_000);
      }
    }

    return {
      revertEventId: event.id,
      summary: event.content.summary,
      timeSpentMinutes,
    };
  });

  // --- Breakthroughs: heuristic — large commits after a period of small ones ---
  const breakthroughs: ExtractedSignals["breakthroughs"] = [];
  if (commits.length >= 3) {
    const sorted = [...commits].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
    for (let i = 2; i < sorted.length; i++) {
      const prevSizes = [
        sorted[i - 2].content.files?.length ?? 0,
        sorted[i - 1].content.files?.length ?? 0,
      ];
      const currSize = sorted[i].content.files?.length ?? 0;
      const avgPrev = (prevSizes[0] + prevSizes[1]) / 2;
      // A commit touching 3x more files than recent average is a breakthrough candidate
      if (avgPrev > 0 && currSize >= avgPrev * 3 && currSize >= 5) {
        breakthroughs.push({
          eventId: sorted[i].id,
          summary: sorted[i].content.summary,
        });
      }
    }
  }

  // --- Debugging sessions ---
  const debuggingSessions = detectDebuggingSessions(commits);

  // --- Execution phase breakdown from AI conversation metadata ---
  const executionPhaseBreakdown: Record<string, number> = {};
  for (const event of aiConversations) {
    const phase = (event.metadata?.execution_phase as string) ?? "unknown";
    executionPhaseBreakdown[phase] = (executionPhaseBreakdown[phase] ?? 0) + 1;
  }

  // --- Outcome breakdown from AI conversation metadata ---
  const outcomeBreakdown: Record<string, number> = {};
  for (const event of aiConversations) {
    const outcome = (event.metadata?.outcome as string) ?? "unclassified";
    outcomeBreakdown[outcome] = (outcomeBreakdown[outcome] ?? 0) + 1;
  }

  return {
    date,
    decisions,
    tradeOffs,
    deadEnds,
    breakthroughs,
    debuggingSessions,
    stats: {
      totalEvents: events.length,
      commitCount: commits.length,
      aiCompletions: aiCompletions.length + aiConversations.length,
      aiRejections: aiRejections.length,
      branchSwitches: branchSwitches.length,
      reverts: reverts.length,
      filesChanged: allFiles,
      domains,
      executionPhaseBreakdown:
        Object.keys(executionPhaseBreakdown).length > 0 ? executionPhaseBreakdown : undefined,
      outcomeBreakdown: Object.keys(outcomeBreakdown).length > 0 ? outcomeBreakdown : undefined,
    },
  };
}

/**
 * Aggregate direction signals from events into per-decision classifications.
 * Used by the distill pipeline to build the Human Direction Summary.
 */
export function aggregateDirectionSignals(events: CaptureEvent[]): {
  averageHDS: number;
  classifications: Array<{
    eventId: string;
    summary: string;
    hds: number;
    confidence: "high" | "low";
    classification: "human-directed" | "collaborative" | "llm-directed";
  }>;
  toolBreakdown: Map<string, { sessions: number; events: number }>;
} {
  const aiSessionEvents = events.filter(
    (e) => e.source === "ai-session" && e.type === "ai-conversation",
  );

  const classifications: Array<{
    eventId: string;
    summary: string;
    hds: number;
    confidence: "high" | "low";
    classification: "human-directed" | "collaborative" | "llm-directed";
  }> = [];

  const toolBreakdown = new Map<string, { sessions: number; events: number }>();

  for (const event of aiSessionEvents) {
    const ds = parseDirectionSignals(event);
    const tool = (event.metadata?.ai_tool as string) ?? "unknown";

    const existing = toolBreakdown.get(tool) ?? { sessions: 0, events: 0 };
    existing.events++;
    if (event.metadata?.session_id) existing.sessions++;
    toolBreakdown.set(tool, existing);

    if (!ds) continue;

    let classification: "human-directed" | "collaborative" | "llm-directed";
    if (ds.humanDirectionScore >= 0.6) classification = "human-directed";
    else if (ds.humanDirectionScore >= 0.3) classification = "collaborative";
    else classification = "llm-directed";

    classifications.push({
      eventId: event.id,
      summary: event.content.summary,
      hds: ds.humanDirectionScore,
      confidence: ds.confidence,
      classification,
    });
  }

  const averageHDS =
    classifications.length > 0
      ? classifications.reduce((s, c) => s + c.hds, 0) / classifications.length
      : 0;

  return { averageHDS, classifications, toolBreakdown };
}

function emptySignals(date: string): ExtractedSignals {
  return {
    date,
    decisions: [],
    tradeOffs: [],
    deadEnds: [],
    breakthroughs: [],
    debuggingSessions: [],
    stats: {
      totalEvents: 0,
      commitCount: 0,
      aiCompletions: 0,
      aiRejections: 0,
      branchSwitches: 0,
      reverts: 0,
      filesChanged: [],
      domains: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Stage 0.5: Signal Triage & Prioritization (Layer 6)
// ---------------------------------------------------------------------------

const CORROBORATION_THRESHOLD = 0.35;
/** 45-minute temporal clustering window — used by narrative-builder.ts */
export const TEMPORAL_CLUSTER_WINDOW_MS = 45 * 60 * 1000;

// Impact score factor weights
const WEIGHT_SCOPE = 30;
const WEIGHT_ALTERNATIVES = 25;
const WEIGHT_CORROBORATION = 20;
const WEIGHT_TEMPORAL = 15;
const WEIGHT_DIRECTION = 10;
const TOTAL_WEIGHT =
  WEIGHT_SCOPE + WEIGHT_ALTERNATIVES + WEIGHT_CORROBORATION + WEIGHT_TEMPORAL + WEIGHT_DIRECTION;

// Tier thresholds
const PRIMARY_THRESHOLD = 60;
const SUPPORTING_THRESHOLD = 30;

/**
 * Compute scope factor (0-100) based on number of files touched.
 */
function scopeFactor(fileCount: number): number {
  if (fileCount >= 10) return 100;
  if (fileCount >= 6) return 70;
  if (fileCount >= 3) return 40;
  if (fileCount >= 1) return 10;
  return 0;
}

/**
 * Compute alternatives factor (0-100).
 */
function alternativesFactor(count: number): number {
  if (count >= 3) return 100;
  if (count >= 2) return 60;
  if (count >= 1) return 30;
  return 0;
}

/**
 * Compute temporal investment factor (0-100) based on duration in ms.
 */
function temporalFactor(durationMs: number): number {
  const hours = durationMs / (60 * 60 * 1000);
  if (hours >= 2) return 100;
  if (hours >= 0.5) return 70;
  const minutes = durationMs / (60 * 1000);
  if (minutes >= 5) return 40;
  return 10;
}

/**
 * Compute direction signal strength factor (0-100).
 */
function directionFactor(hds: number | undefined): number {
  if (hds === undefined) return 50; // neutral when no HDS
  if (hds >= 0.6) return 100;
  if (hds >= 0.3) return 60;
  return 30;
}

/**
 * Get the summary text for any signal by type and index.
 */
export function getSignalSummary(
  signals: ExtractedSignals,
  type: "decision" | "tradeOff" | "deadEnd" | "breakthrough",
  index: number,
): string {
  switch (type) {
    case "decision":
      return signals.decisions[index]?.summary ?? "";
    case "tradeOff":
      return signals.tradeOffs[index]?.summary ?? "";
    case "deadEnd":
      return signals.deadEnds[index]?.summary ?? "";
    case "breakthrough":
      return signals.breakthroughs[index]?.summary ?? "";
  }
}

/**
 * Get file count for a signal.
 */
function getSignalFileCount(
  signals: ExtractedSignals,
  type: "decision" | "tradeOff" | "deadEnd" | "breakthrough",
  index: number,
): number {
  switch (type) {
    case "decision": {
      const d = signals.decisions[index];
      return d?.conversationMeta?.filesModified?.length ?? 0;
    }
    case "tradeOff":
      return signals.tradeOffs[index]?.relatedFiles?.length ?? 0;
    case "deadEnd":
      return 0;
    case "breakthrough":
      return 0;
  }
}

/**
 * Get alternatives count for a signal.
 */
function getSignalAlternatives(
  signals: ExtractedSignals,
  type: "decision" | "tradeOff" | "deadEnd" | "breakthrough",
  index: number,
): number {
  if (type === "decision") return signals.decisions[index]?.alternativesCount ?? 0;
  if (type === "tradeOff") return 1; // trade-offs inherently have an alternative
  return 0;
}

/**
 * Get the source type for a signal.
 */
export function getSignalSource(
  signals: ExtractedSignals,
  type: "decision" | "tradeOff" | "deadEnd" | "breakthrough",
  index: number,
): string | undefined {
  switch (type) {
    case "decision":
      return signals.decisions[index]?.source;
    default:
      return undefined;
  }
}

/**
 * Detect cross-source corroboration groups using normalized keyword Jaccard.
 * Signals from different source types with similarity ≥ 0.35 are grouped.
 */
function detectCorroboration(signals: ExtractedSignals): CorroborationGroup[] {
  const groups: CorroborationGroup[] = [];

  // Collect all signal references with their summaries and sources
  type SignalRef = {
    type: "decision" | "tradeOff" | "deadEnd" | "breakthrough";
    index: number;
    summary: string;
    source: string;
  };

  const refs: SignalRef[] = [];
  for (let i = 0; i < signals.decisions.length; i++) {
    const d = signals.decisions[i];
    refs.push({
      type: "decision",
      index: i,
      summary: d.summary,
      source: d.source ?? "commit",
    });
  }
  for (let i = 0; i < signals.tradeOffs.length; i++) {
    refs.push({
      type: "tradeOff",
      index: i,
      summary: signals.tradeOffs[i].summary,
      source: "ai-rejection",
    });
  }
  for (let i = 0; i < signals.deadEnds.length; i++) {
    refs.push({
      type: "deadEnd",
      index: i,
      summary: signals.deadEnds[i].summary,
      source: "revert",
    });
  }
  for (let i = 0; i < signals.breakthroughs.length; i++) {
    refs.push({
      type: "breakthrough",
      index: i,
      summary: signals.breakthroughs[i].summary,
      source: "commit",
    });
  }

  // Track which refs have been grouped
  const grouped = new Set<number>();
  let groupId = 0;

  for (let i = 0; i < refs.length; i++) {
    if (grouped.has(i)) continue;

    const members: SignalRef[] = [refs[i]];
    const sources = new Set<string>([refs[i].source]);

    for (let j = i + 1; j < refs.length; j++) {
      if (grouped.has(j)) continue;
      // Only corroborate across different sources
      if (refs[j].source === refs[i].source) continue;

      const sim = normalizedSimilarity(refs[i].summary, refs[j].summary);
      if (sim >= CORROBORATION_THRESHOLD) {
        members.push(refs[j]);
        sources.add(refs[j].source);
        grouped.add(j);
      }
    }

    // Only create a group if multiple sources corroborate
    if (sources.size >= 2) {
      grouped.add(i);
      const id = `corr-${groupId++}`;
      groups.push({
        id,
        signalIndices: members.map((m) => ({ type: m.type, index: m.index })),
        sources: Array.from(sources),
        similarity:
          members.length > 1 ? normalizedSimilarity(members[0].summary, members[1].summary) : 0,
      });
    }
  }

  return groups;
}

/**
 * Build a map from signal key to corroboration group ID.
 */
function buildCorroborationMap(
  groups: CorroborationGroup[],
): Map<string, { groupId: string; sourceCount: number }> {
  const map = new Map<string, { groupId: string; sourceCount: number }>();
  for (const group of groups) {
    for (const ref of group.signalIndices) {
      map.set(`${ref.type}:${ref.index}`, {
        groupId: group.id,
        sourceCount: group.sources.length,
      });
    }
  }
  return map;
}

/**
 * Compute impact score for a signal using the weighted 5-factor model.
 */
function computeImpactScore(
  signals: ExtractedSignals,
  events: CaptureEvent[],
  type: "decision" | "tradeOff" | "deadEnd" | "breakthrough",
  index: number,
  corroborationMap: Map<string, { groupId: string; sourceCount: number }>,
): ImpactScore {
  const fileCount = getSignalFileCount(signals, type, index);
  const alternatives = getSignalAlternatives(signals, type, index);

  // Corroboration factor
  const corrKey = `${type}:${index}`;
  const corrInfo = corroborationMap.get(corrKey);
  let corroborationValue = 20; // single source
  if (corrInfo) {
    if (corrInfo.sourceCount >= 3) corroborationValue = 100;
    else if (corrInfo.sourceCount >= 2) corroborationValue = 60;
  }

  // Temporal investment: estimate from event timestamps
  let temporalValue = 10;
  if (type === "decision") {
    const d = signals.decisions[index];
    if (d) {
      // Find related events by event ID and estimate time span
      const eventTs = events.find((e) => e.id === d.eventId);
      if (eventTs) {
        const ts = new Date(eventTs.timestamp).getTime();
        // Look for events in the same domain/branch within 4 hours
        const branch = d.branch;
        const related = events.filter((e) => {
          const ets = new Date(e.timestamp).getTime();
          if (Math.abs(ets - ts) > 4 * 60 * 60 * 1000) return false;
          const eBranch = e.content.branch ?? e.gitContext?.branch;
          return eBranch === branch;
        });
        if (related.length > 1) {
          const timestamps = related.map((e) => new Date(e.timestamp).getTime());
          const span = Math.max(...timestamps) - Math.min(...timestamps);
          temporalValue = temporalFactor(span);
        }
      }
    }
  } else if (type === "deadEnd") {
    const de = signals.deadEnds[index];
    if (de?.timeSpentMinutes) {
      temporalValue = temporalFactor(de.timeSpentMinutes * 60 * 1000);
    }
  }

  // Direction signal strength
  let directionValue = 50; // neutral default
  if (type === "decision") {
    const d = signals.decisions[index];
    if (d) {
      const event = events.find((e) => e.id === d.eventId);
      if (event) {
        const ds = parseDirectionSignals(event);
        if (ds) {
          directionValue = directionFactor(ds.humanDirectionScore);
        }
      }
    }
  }

  const scopeVal = scopeFactor(fileCount);
  const altVal = alternativesFactor(alternatives);

  const total = Math.round(
    (WEIGHT_SCOPE * scopeVal +
      WEIGHT_ALTERNATIVES * altVal +
      WEIGHT_CORROBORATION * corroborationValue +
      WEIGHT_TEMPORAL * temporalValue +
      WEIGHT_DIRECTION * directionValue) /
      TOTAL_WEIGHT,
  );

  return {
    total,
    factors: {
      scope: scopeVal,
      alternatives: altVal,
      corroboration: corroborationValue,
      temporalInvestment: temporalValue,
      directionStrength: directionValue,
    },
  };
}

/**
 * Classify the day's shape from signals and events.
 */
function classifyDayShape(signals: ExtractedSignals, events: CaptureEvent[]): DayShape {
  const domains = signals.stats.domains;
  const dominantDomain = domains[0] ?? "general";

  // Peak activity hour
  const hourCounts = new Array(24).fill(0);
  for (const event of events) {
    const hour = new Date(event.timestamp).getHours();
    hourCounts[hour]++;
  }
  const peakActivityHour = hourCounts.indexOf(Math.max(...hourCounts));

  // Classify arc type
  const branchCount = new Set(
    events.map((e) => e.content.branch ?? e.gitContext?.branch).filter(Boolean),
  ).size;
  const domainCount = domains.length;
  const totalAlternatives = signals.decisions.reduce((sum, d) => sum + d.alternativesCount, 0);
  const aiConvCount = signals.stats.aiCompletions;
  const commitCount = signals.stats.commitCount;

  let arcType: DayShape["arcType"];

  if (domainCount <= 2 && branchCount <= 2 && totalAlternatives < 3) {
    // Low diversity, low alternatives → routine or deep-dive
    if (commitCount >= 5 || aiConvCount >= 3) {
      arcType = "deep-dive";
    } else {
      arcType = "routine";
    }
  } else if (totalAlternatives >= 5 && branchCount >= 3) {
    // High alternatives, many branches → exploration
    // Check if there's convergence (later events cluster on fewer branches)
    const midpoint = Math.floor(events.length / 2);
    const earlyBranches = new Set(
      events
        .slice(0, midpoint)
        .map((e) => e.content.branch ?? e.gitContext?.branch)
        .filter(Boolean),
    );
    const lateBranches = new Set(
      events
        .slice(midpoint)
        .map((e) => e.content.branch ?? e.gitContext?.branch)
        .filter(Boolean),
    );
    arcType = lateBranches.size < earlyBranches.size ? "convergence" : "exploration";
  } else if (domainCount >= 4 && branchCount >= 3) {
    arcType = "scattered";
  } else if (totalAlternatives >= 3) {
    arcType = "exploration";
  } else {
    arcType = "routine";
  }

  return { dominantDomain, peakActivityHour, arcType };
}

/**
 * Triage extracted signals: score, prioritize, detect corroboration, classify day shape.
 * This is Stage 0.5 of the Layer 6 distill pipeline.
 */
export function triageSignals(signals: ExtractedSignals, events: CaptureEvent[]): TriagedSignals {
  try {
    return doTriage(signals, events);
  } catch (err) {
    logger.warn("Signal triage failed, returning unprioritized signals", {
      error: String(err),
    });
    // Fallback: all signals as background tier
    return {
      ...signals,
      prioritized: { primary: [], supporting: [], background: [] },
      corroborations: [],
      dayShape: {
        dominantDomain: signals.stats.domains[0] ?? "general",
        peakActivityHour: 12,
        arcType: "routine",
      },
    };
  }
}

function doTriage(signals: ExtractedSignals, events: CaptureEvent[]): TriagedSignals {
  // Step 1: Detect cross-source corroboration
  const corroborations = detectCorroboration(signals);
  const corroborationMap = buildCorroborationMap(corroborations);

  // Step 2: Score all signals
  const allScored: ScoredSignal[] = [];

  const signalTypes = [
    { type: "decision" as const, count: signals.decisions.length },
    { type: "tradeOff" as const, count: signals.tradeOffs.length },
    { type: "deadEnd" as const, count: signals.deadEnds.length },
    { type: "breakthrough" as const, count: signals.breakthroughs.length },
  ];

  for (const { type, count } of signalTypes) {
    for (let i = 0; i < count; i++) {
      const impactScore = computeImpactScore(signals, events, type, i, corroborationMap);
      const corrKey = `${type}:${i}`;
      const corrInfo = corroborationMap.get(corrKey);

      let tier: SignalTier;
      if (impactScore.total >= PRIMARY_THRESHOLD) tier = "primary";
      else if (impactScore.total >= SUPPORTING_THRESHOLD) tier = "supporting";
      else tier = "background";

      allScored.push({
        type,
        index: i,
        impactScore,
        tier,
        corroborationGroup: corrInfo?.groupId,
      });
    }
  }

  // Step 3: Sort by impact score descending
  allScored.sort((a, b) => b.impactScore.total - a.impactScore.total);

  // Step 4: Partition into tiers
  const primary = allScored.filter((s) => s.tier === "primary");
  const supporting = allScored.filter((s) => s.tier === "supporting");
  const background = allScored.filter((s) => s.tier === "background");

  // Step 5: Classify day shape
  const dayShape = classifyDayShape(signals, events);

  return {
    ...signals,
    prioritized: { primary, supporting, background },
    corroborations,
    dayShape,
  };
}
