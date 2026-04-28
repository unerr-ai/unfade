// FILE: src/services/distill/narrative-builder.ts
// Layer 6, Stage 1 — Narrative Spine Construction.
// Takes triaged signals and builds a temporal, causal narrative structure.
// No LLM. Never throws.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ArcType,
  ContinuityThread,
  EnrichedDistill,
  NarrativeAct,
  NarrativeSpine,
  ScoredSignal,
  TriagedSignals,
} from "../../schemas/distill.js";
import type { CaptureEvent } from "../../schemas/event.js";
import { logger } from "../../utils/logger.js";
import { getDistillsDir } from "../../utils/paths.js";
import { normalizedSimilarity } from "./conversation-digester.js";
import { getSignalSummary, TEMPORAL_CLUSTER_WINDOW_MS } from "./signal-extractor.js";

const CAUSAL_WINDOW_MS = 60 * 60 * 1000; // 60 minutes for dead end → decision
const AI_COMMIT_WINDOW_MS = 30 * 60 * 1000; // 30 minutes for AI conversation → commit
const CONTINUITY_SIMILARITY_THRESHOLD = 0.35;

// ---------------------------------------------------------------------------
// Temporal clustering
// ---------------------------------------------------------------------------

interface TemporalCluster {
  events: Array<{ eventId: string; timestamp: number; domain?: string; files: string[] }>;
  signals: ScoredSignal[];
  startMs: number;
  endMs: number;
  domains: Set<string>;
}

/**
 * Group scored signals into temporal clusters.
 * Events within 45 min that share domain or file overlap merge into the same cluster.
 */
function temporalCluster(triaged: TriagedSignals, events: CaptureEvent[]): TemporalCluster[] {
  const eventMap = new Map<string, CaptureEvent>();
  for (const e of events) eventMap.set(e.id, e);

  // Build signal → event mapping with timestamps
  const allSignals = [
    ...triaged.prioritized.primary,
    ...triaged.prioritized.supporting,
    ...triaged.prioritized.background,
  ];

  type SignalWithTime = {
    signal: ScoredSignal;
    eventId: string;
    timestamp: number;
    domain?: string;
    files: string[];
  };

  const signalsWithTime: SignalWithTime[] = [];
  for (const s of allSignals) {
    const eventId = getEventIdForSignal(triaged, s);
    if (!eventId) continue;
    const event = eventMap.get(eventId);
    if (!event) continue;

    const files = event.content.files ?? [];
    const domain = getDomainForSignal(triaged, s);
    signalsWithTime.push({
      signal: s,
      eventId,
      timestamp: new Date(event.timestamp).getTime(),
      domain,
      files,
    });
  }

  // Sort by timestamp
  signalsWithTime.sort((a, b) => a.timestamp - b.timestamp);

  if (signalsWithTime.length === 0) return [];

  // Clustering algorithm
  const clusters: TemporalCluster[] = [];
  let current: TemporalCluster = {
    events: [
      {
        eventId: signalsWithTime[0].eventId,
        timestamp: signalsWithTime[0].timestamp,
        domain: signalsWithTime[0].domain,
        files: signalsWithTime[0].files,
      },
    ],
    signals: [signalsWithTime[0].signal],
    startMs: signalsWithTime[0].timestamp,
    endMs: signalsWithTime[0].timestamp,
    domains: new Set(signalsWithTime[0].domain ? [signalsWithTime[0].domain] : []),
  };

  for (let i = 1; i < signalsWithTime.length; i++) {
    const s = signalsWithTime[i];
    const timeDiff = s.timestamp - current.endMs;
    const sameDomain = s.domain != null && current.domains.has(s.domain);
    const sharedFiles = s.files.some((f) => current.events.some((ce) => ce.files.includes(f)));

    if (timeDiff <= TEMPORAL_CLUSTER_WINDOW_MS && (sameDomain || sharedFiles)) {
      // Merge into current cluster
      current.events.push({
        eventId: s.eventId,
        timestamp: s.timestamp,
        domain: s.domain,
        files: s.files,
      });
      current.signals.push(s.signal);
      current.endMs = s.timestamp;
      if (s.domain) current.domains.add(s.domain);
    } else {
      clusters.push(current);
      current = {
        events: [
          {
            eventId: s.eventId,
            timestamp: s.timestamp,
            domain: s.domain,
            files: s.files,
          },
        ],
        signals: [s.signal],
        startMs: s.timestamp,
        endMs: s.timestamp,
        domains: new Set(s.domain ? [s.domain] : []),
      };
    }
  }
  clusters.push(current);

  return clusters;
}

// ---------------------------------------------------------------------------
// Causal chain detection
// ---------------------------------------------------------------------------

interface CausalLink {
  fromClusterIdx: number;
  toClusterIdx: number;
  reason: string;
}

/**
 * Detect causal relationships between clusters.
 */
function detectCausalChains(clusters: TemporalCluster[], triaged: TriagedSignals): CausalLink[] {
  const links: CausalLink[] = [];

  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const a = clusters[i];
      const b = clusters[j];
      const gap = b.startMs - a.endMs;

      // Dead end → Decision: revert in cluster A, decision in cluster B, same domain, within 60 min
      const aHasDeadEnd = a.signals.some((s) => s.type === "deadEnd");
      const bHasDecision = b.signals.some((s) => s.type === "decision");
      const sharedDomains = [...a.domains].some((d) => b.domains.has(d));

      if (aHasDeadEnd && bHasDecision && sharedDomains && gap <= CAUSAL_WINDOW_MS) {
        links.push({
          fromClusterIdx: i,
          toClusterIdx: j,
          reason: "Dead end led to decision pivot",
        });
        continue;
      }

      // Exploration → Convergence: multiple AI conversations in A, single commit decision in B
      const aAiCount = a.signals.filter(
        (s) => s.type === "decision" && getSourceForSignal(triaged, s) === "ai-conversation",
      ).length;
      const bCommitCount = b.signals.filter(
        (s) => s.type === "decision" && getSourceForSignal(triaged, s) === "commit",
      ).length;

      if (aAiCount >= 2 && bCommitCount >= 1 && sharedDomains && gap <= CAUSAL_WINDOW_MS) {
        links.push({
          fromClusterIdx: i,
          toClusterIdx: j,
          reason: "Exploration led to convergence",
        });
        continue;
      }

      // AI conversation → Commit: shared files within 30 min
      const aFiles = new Set(a.events.flatMap((e) => e.files));
      const bFiles = new Set(b.events.flatMap((e) => e.files));
      const fileOverlap = [...aFiles].some((f) => bFiles.has(f));

      if (fileOverlap && gap <= AI_COMMIT_WINDOW_MS && gap > 0) {
        links.push({
          fromClusterIdx: i,
          toClusterIdx: j,
          reason: "Related work on same files",
        });
      }
    }
  }

  return links;
}

// ---------------------------------------------------------------------------
// Act formation
// ---------------------------------------------------------------------------

/**
 * Form narrative acts from clusters that contain at least one primary-tier signal.
 * Smaller clusters without primary signals are merged into adjacent acts.
 */
function formActs(
  clusters: TemporalCluster[],
  causalLinks: CausalLink[],
  triaged: TriagedSignals,
): NarrativeAct[] {
  const acts: NarrativeAct[] = [];

  // Build causal link maps
  const causedByMap = new Map<number, number>(); // clusterIdx → causing clusterIdx
  const ledToMap = new Map<number, number>(); // clusterIdx → resulting clusterIdx
  for (const link of causalLinks) {
    causedByMap.set(link.toClusterIdx, link.fromClusterIdx);
    ledToMap.set(link.fromClusterIdx, link.toClusterIdx);
  }

  // Track which cluster index maps to which act index
  const clusterToActIdx = new Map<number, number>();

  for (let ci = 0; ci < clusters.length; ci++) {
    const cluster = clusters[ci];
    // Only form acts from clusters with primary signals or with 3+ signals
    const hasPrimary = cluster.signals.some((s) => s.tier === "primary");
    if (!hasPrimary && cluster.signals.length < 3) continue;

    // Collect decision/tradeOff/deadEnd indices from this cluster's signals
    const decisionIndices: number[] = [];
    const tradeOffIndices: number[] = [];
    const deadEndIndices: number[] = [];

    for (const s of cluster.signals) {
      if (s.type === "decision") decisionIndices.push(s.index);
      else if (s.type === "tradeOff") tradeOffIndices.push(s.index);
      else if (s.type === "deadEnd") deadEndIndices.push(s.index);
    }

    // Trigger: first signal's summary, or causal link reason
    const causingCluster = causedByMap.get(ci);
    let trigger: string;
    if (causingCluster !== undefined) {
      const causeSignal = clusters[causingCluster]?.signals[0];
      trigger = causeSignal
        ? getSignalSummary(triaged, causeSignal.type, causeSignal.index)
        : "Previous work";
    } else {
      const firstSignal = cluster.signals[0];
      trigger = firstSignal
        ? getSignalSummary(triaged, firstSignal.type, firstSignal.index)
        : "Continued work";
    }

    const actIdx = acts.length;
    clusterToActIdx.set(ci, actIdx);

    acts.push({
      timeWindow: {
        start: new Date(cluster.startMs).toISOString(),
        end: new Date(cluster.endMs).toISOString(),
      },
      trigger,
      decisionIndices,
      tradeOffIndices,
      deadEndIndices,
      causedBy: undefined,
      ledTo: undefined,
    });
  }

  // Wire causal links between acts
  for (const link of causalLinks) {
    const fromAct = clusterToActIdx.get(link.fromClusterIdx);
    const toAct = clusterToActIdx.get(link.toClusterIdx);
    if (fromAct !== undefined && toAct !== undefined) {
      acts[fromAct].ledTo = toAct;
      acts[toAct].causedBy = fromAct;
    }
  }

  return acts;
}

// ---------------------------------------------------------------------------
// Headline generation
// ---------------------------------------------------------------------------

function generateHeadline(arcType: ArcType, triaged: TriagedSignals): string {
  const primary = triaged.prioritized.primary;
  const topDecisions = primary
    .filter((s) => s.type === "decision")
    .slice(0, 3)
    .map((s) => getSignalSummary(triaged, s.type, s.index))
    .filter((s) => s.length > 0);

  const dominantDomain = triaged.dayShape.dominantDomain;

  switch (arcType) {
    case "exploration": {
      const domains = [
        ...new Set(primary.map((s) => getDomainForSignal(triaged, s)).filter(Boolean)),
      ];
      return `Investigated ${domains.length > 0 ? domains.join(", ") : dominantDomain}: ${topDecisions[0] ?? "multiple approaches explored"}`;
    }
    case "convergence": {
      const altCount = triaged.decisions.reduce((s, d) => s + d.alternativesCount, 0);
      return `Converged on ${topDecisions[0] ?? "a key decision"} after exploring ${altCount} options`;
    }
    case "deep-dive":
      return `Deep focus on ${dominantDomain}: ${topDecisions[0] ?? "sustained work"}`;
    case "scattered": {
      const domainCount = triaged.stats.domains.length;
      return `Parallel work across ${domainCount} areas: ${topDecisions.slice(0, 2).join("; ") || "multiple streams"}`;
    }
    case "routine":
      return `Steady progress: ${triaged.stats.commitCount} changes across ${dominantDomain}`;
  }
}

// ---------------------------------------------------------------------------
// Continuity thread detection
// ---------------------------------------------------------------------------

/**
 * Detect continuity threads: unresolved questions from today and links to yesterday.
 */
async function detectContinuityThreads(
  triaged: TriagedSignals,
  date: string,
): Promise<ContinuityThread[]> {
  const threads: ContinuityThread[] = [];

  // Load yesterday's enriched distill for continuity
  const yesterday = getPreviousDate(date);
  let previousThreads: ContinuityThread[] = [];
  try {
    const distillsDir = getDistillsDir();
    const yesterdayPath = join(distillsDir, `${yesterday}.json`);
    const raw = await readFile(yesterdayPath, "utf-8");
    const parsed = JSON.parse(raw) as EnrichedDistill;
    if (parsed.continuityThreads) {
      previousThreads = parsed.continuityThreads.filter((t) => !t.resolved);
    }
  } catch {
    // No previous distill — that's fine
  }

  // Check if today's signals address any previous threads
  const allSummaries = triaged.decisions.map((d) => d.summary);
  for (const prevThread of previousThreads) {
    const addressed = allSummaries.some(
      (summary) =>
        normalizedSimilarity(summary, prevThread.question) >= CONTINUITY_SIMILARITY_THRESHOLD,
    );

    threads.push({
      question: prevThread.question,
      evidenceEventIds: prevThread.evidenceEventIds,
      domain: prevThread.domain,
      continuedFrom: yesterday,
      resolved: addressed,
    });
  }

  // Today's unresolved: primary decisions without clear outcomes, dead ends without resolutions
  for (const scored of triaged.prioritized.primary) {
    if (scored.type === "deadEnd") {
      const de = triaged.deadEnds[scored.index];
      if (de) {
        threads.push({
          question: `Unresolved dead end: ${de.summary}`,
          evidenceEventIds: [de.revertEventId],
          domain: triaged.dayShape.dominantDomain,
          resolved: false,
        });
      }
    }
  }

  return threads;
}

function getPreviousDate(dateStr: string): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Helper: resolve signal → event ID
// ---------------------------------------------------------------------------

function getEventIdForSignal(triaged: TriagedSignals, signal: ScoredSignal): string | undefined {
  switch (signal.type) {
    case "decision":
      return triaged.decisions[signal.index]?.eventId;
    case "tradeOff":
      return triaged.tradeOffs[signal.index]?.eventId;
    case "deadEnd":
      return triaged.deadEnds[signal.index]?.revertEventId;
    case "breakthrough":
      return triaged.breakthroughs[signal.index]?.eventId;
  }
}

function getDomainForSignal(triaged: TriagedSignals, signal: ScoredSignal): string | undefined {
  // Decisions from AI conversations may carry domain from conversation digestion
  // For now, derive from the dominant domain
  if (signal.type === "decision") {
    const d = triaged.decisions[signal.index];
    if (d?.conversationMeta?.filesModified && d.conversationMeta.filesModified.length > 0) {
      // Derive domain from first file extension
      const file = d.conversationMeta.filesModified[0];
      const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
      const domainMap: Record<string, string> = {
        ".ts": "TypeScript",
        ".tsx": "TypeScript/React",
        ".go": "Go",
        ".py": "Python",
        ".rs": "Rust",
        ".sql": "Database",
        ".css": "Styles",
      };
      return domainMap[ext];
    }
  }
  return undefined;
}

function getSourceForSignal(triaged: TriagedSignals, signal: ScoredSignal): string | undefined {
  if (signal.type === "decision") return triaged.decisions[signal.index]?.source;
  return undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a narrative spine from triaged signals.
 * This is Stage 1 of the Layer 6 distill pipeline.
 */
export async function buildNarrativeSpine(
  triaged: TriagedSignals,
  events: CaptureEvent[],
): Promise<NarrativeSpine> {
  try {
    return await doBuildSpine(triaged, events);
  } catch (err) {
    logger.warn("Narrative spine construction failed, returning minimal spine", {
      error: String(err),
    });
    return emptySpine(triaged);
  }
}

async function doBuildSpine(
  triaged: TriagedSignals,
  events: CaptureEvent[],
): Promise<NarrativeSpine> {
  // Step 1: Temporal clustering
  const clusters = temporalCluster(triaged, events);

  // Step 2: Causal chain detection
  const causalLinks = detectCausalChains(clusters, triaged);

  // Step 3: Act formation
  const acts = formActs(clusters, causalLinks, triaged);

  // Step 4: Spine assembly
  const arcType = triaged.dayShape.arcType;
  const headline = generateHeadline(arcType, triaged);

  // Opening context from first act's trigger
  const openingContext =
    acts.length > 0
      ? acts[0].trigger
      : `Work across ${triaged.stats.domains.join(", ") || "the project"}`;

  // Closing state from last act
  const lastAct = acts[acts.length - 1];
  const closingState = lastAct
    ? `Completed work on ${[...new Set(lastAct.decisionIndices.map((i) => triaged.decisions[i]?.summary).filter(Boolean))].join("; ") || "the day's tasks"}`
    : `Processed ${triaged.stats.totalEvents} events`;

  // Continuity threads
  const continuityThreads = await detectContinuityThreads(triaged, triaged.date);

  return {
    arc: {
      type: arcType,
      headline,
      openingContext,
      closingState,
    },
    acts,
    continuityThreads,
  };
}

function emptySpine(triaged: TriagedSignals): NarrativeSpine {
  return {
    arc: {
      type: triaged.dayShape.arcType,
      headline: `Activity on ${triaged.date}: ${triaged.stats.totalEvents} events`,
      openingContext: "Start of day",
      closingState: "End of day",
    },
    acts: [],
    continuityThreads: [],
  };
}
