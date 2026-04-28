// FILE: src/services/knowledge/heuristic-extractor.ts
// Layer 2.5 KE-8.2: Heuristic fallback extractor.
// When no LLM is configured, computes proxy comprehension scores from Layer 1
// signals (turn patterns, metadata) without any AI call. Produces a
// ComprehensionAssessment with assessmentMethod: "heuristic-proxy".
//
// This is NOT a replacement for LLM extraction — it keeps basic comprehension
// metrics flowing for Layer 3 analyzers when LLM is unavailable. No entities,
// no facts, no metacognition are extracted.
//
// Proxy formulas from §6 of LAYER_2.5_TEMPORAL_KNOWLEDGE_EXTRACTION.md:
//   steering     = HDS from metadata, or directive-language ratio
//   understanding = modification-after-accept signal
//   metacognition = regex-based metacognitive pattern detection
//   independence  = 10 - (userTurns / totalTurns * 10)
//   engagement    = min(10, totalTurns / 5)

import type { CaptureEvent } from "../../schemas/event.js";
import type { ComprehensionAssessment } from "../../schemas/knowledge.js";
import { computeOverallScore } from "../../schemas/knowledge.js";
import type { Turn } from "./turn-parser.js";

// ─── Metacognitive Signal Patterns ──────────────────────────────────────────
// Lightweight regex-based detection for the heuristic path.
// The LLM path (KE-8.1) does this with far higher accuracy.

const COURSE_CORRECTION_PATTERNS = [
  /\blet\s+me\s+rethink\b/i,
  /\bactually,?\s+let'?s?\b/i,
  /\bwait,?\s+(?:no|that'?s?\s+wrong)\b/i,
  /\bscrap\s+(?:that|this)\b/i,
  /\bgo\s+back\s+to\b/i,
  /\bstart\s+over\b/i,
  /\binstead,?\s+let'?s?\b/i,
];

const ALTERNATIVE_EVALUATION_PATTERNS = [
  /\bwhat\s+about\b/i,
  /\binstead\s+of\b/i,
  /\balternative\b/i,
  /\bcompare\s+(?:to|with)\b/i,
  /\bwhat\s+if\s+we\b/i,
  /\bcould\s+we\s+(?:use|try)\b/i,
  /\bor\s+should\s+we\b/i,
  /\bvs\.?\s/i,
];

const MODIFICATION_PATTERNS = [
  /\bchange\s+(?:this|that|it)\b/i,
  /\bmodif(?:y|ied)\b/i,
  /\binstead\b/i,
  /\bactually\s+(?:I|we)\b/i,
  /\bno,?\s+(?:I|we)\s+(?:want|need)\b/i,
  /\bbut\s+(?:I|we)\b/i,
];

const REJECTION_PATTERNS = [
  /\bno,?\s+(?:that'?s?\s+(?:not|wrong)|don'?t)\b/i,
  /\bthat\s+won'?t\s+work\b/i,
  /\bI\s+disagree\b/i,
  /\bwrong\s+(?:approach|way)\b/i,
];

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Compute a heuristic-proxy ComprehensionAssessment from event metadata and turns.
 *
 * Returns null for non-conversation events (git commits, terminal commands) since
 * there's no dialogue to assess. For AI conversations, produces proxy scores from
 * structural signals without calling an LLM.
 */
export function extractHeuristicComprehension(
  event: CaptureEvent,
  turns: Turn[],
): ComprehensionAssessment | null {
  if (event.source !== "ai-session") return null;
  if (turns.length === 0) return null;

  const userTurns = turns.filter((t) => t.role === "user");
  const assistantTurns = turns.filter((t) => t.role === "assistant");

  if (userTurns.length === 0) return null;

  const steering = computeSteeringProxy(event, userTurns, turns);
  const understanding = computeUnderstandingProxy(userTurns, assistantTurns);
  const metacognition = computeMetacognitionProxy(userTurns);
  const independence = computeIndependenceProxy(userTurns.length, turns.length);
  const engagement = computeEngagementProxy(turns.length);

  const dimensions = { steering, understanding, metacognition, independence, engagement };

  return {
    episodeId: event.id,
    timestamp: event.timestamp,
    dimensions,
    overallScore: computeOverallScore(dimensions),
    evidence: buildHeuristicEvidence(userTurns, { steering, understanding, metacognition }),
    rubberStampCount: countRubberStamps(userTurns, assistantTurns),
    pushbackCount: countPushbacks(userTurns),
    domainTags: extractDomainHints(event),
    assessmentMethod: "heuristic-proxy",
  };
}

// ─── Proxy Score Computations ───────────────────────────────────────────────

/**
 * Steering proxy: developer agency (0–10).
 * Uses HDS from metadata if available; otherwise estimates from the ratio of
 * user turns containing directive language (questions, commands, specifications).
 */
function computeSteeringProxy(
  event: CaptureEvent,
  userTurns: Turn[],
  allTurns: Turn[],
): number {
  const hds = asNumber(event.metadata?.human_direction_score);
  if (hds !== null && hds >= 0 && hds <= 10) return hds;

  if (userTurns.length === 0) return 0;

  const directiveCount = userTurns.filter((t) =>
    /\?/.test(t.content) ||
    /\b(?:please|can you|should we|let'?s|need to|want to|make|add|fix|change|update|create|implement)\b/i.test(t.content),
  ).length;

  return clamp(Math.round((directiveCount / userTurns.length) * 10), 0, 10);
}

/**
 * Understanding proxy: demonstrated comprehension (0–10).
 * Checks if user turns following assistant turns show modification signals
 * (indicating the developer read and adjusted the output).
 */
function computeUnderstandingProxy(
  userTurns: Turn[],
  assistantTurns: Turn[],
): number {
  if (assistantTurns.length === 0) return 5;

  const hasModification = userTurns.some((t) =>
    MODIFICATION_PATTERNS.some((p) => p.test(t.content)),
  );

  const hasRejection = userTurns.some((t) =>
    REJECTION_PATTERNS.some((p) => p.test(t.content)),
  );

  if (hasModification) return 6;
  if (hasRejection) return 5;
  return 2;
}

/**
 * Metacognition proxy: reflective thinking (0–10).
 * Detects course correction and alternative evaluation patterns in user turns.
 * Capped at 7 — heuristic can't confidently score deep metacognition.
 */
function computeMetacognitionProxy(userTurns: Turn[]): number {
  const hasCourseCorrection = userTurns.some((t) =>
    COURSE_CORRECTION_PATTERNS.some((p) => p.test(t.content)),
  );

  const hasAlternativeEval = userTurns.some((t) =>
    ALTERNATIVE_EVALUATION_PATTERNS.some((p) => p.test(t.content)),
  );

  let score = 0;
  if (hasCourseCorrection) score += 3;
  if (hasAlternativeEval) score += 4;

  return clamp(score, 0, 7);
}

/**
 * Independence proxy: capability without AI (0–10).
 * Lower ratio of user prompts to total turns suggests more AI dependency.
 */
function computeIndependenceProxy(
  userTurnCount: number,
  totalTurnCount: number,
): number {
  if (totalTurnCount === 0) return 5;
  const ratio = userTurnCount / totalTurnCount;
  return clamp(Math.round(10 - ratio * 10), 0, 10);
}

/**
 * Engagement proxy: interaction depth (0–10).
 * Longer conversations indicate deeper exploration.
 */
function computeEngagementProxy(totalTurnCount: number): number {
  return clamp(Math.round(Math.min(10, totalTurnCount / 5)), 0, 10);
}

// ─── Evidence & Signal Counting ─────────────────────────────────────────────

function buildHeuristicEvidence(
  userTurns: Turn[],
  scores: { steering: number; understanding: number; metacognition: number },
): string[] {
  const evidence: string[] = [];

  if (scores.steering >= 7) {
    evidence.push("High directive language ratio in developer prompts");
  } else if (scores.steering <= 3) {
    evidence.push("Minimal directive language — mostly passive interaction");
  }

  if (scores.understanding >= 6) {
    evidence.push("Developer modified or adjusted AI output (modification pattern detected)");
  } else if (scores.understanding <= 2) {
    evidence.push("No evidence of developer engaging with AI output beyond acceptance");
  }

  if (scores.metacognition >= 4) {
    const signals: string[] = [];
    if (scores.metacognition >= 3) signals.push("course correction");
    if (scores.metacognition >= 4) signals.push("alternative evaluation");
    evidence.push(`Metacognitive signals detected: ${signals.join(", ")}`);
  }

  if (evidence.length === 0) {
    evidence.push("Heuristic proxy — limited signal extraction without LLM");
  }

  return evidence;
}

/**
 * Count user turns that simply accept AI output without modification.
 * A "rubber stamp" is a very short user turn (< 30 chars) following an assistant turn,
 * or a turn that's purely affirmative ("yes", "ok", "looks good", "go ahead").
 */
function countRubberStamps(userTurns: Turn[], assistantTurns: Turn[]): number {
  if (assistantTurns.length === 0) return 0;

  return userTurns.filter((t) => {
    const content = t.content.trim().toLowerCase();
    if (content.length < 30 && /^(?:yes|ok|okay|sure|go\s*ahead|looks?\s*good|perfect|great|thanks?|ty|lgtm|do\s*it|proceed|correct|right|agreed|fine|nice|cool)\b/.test(content)) {
      return true;
    }
    return false;
  }).length;
}

function countPushbacks(userTurns: Turn[]): number {
  return userTurns.filter((t) =>
    REJECTION_PATTERNS.some((p) => p.test(t.content)) ||
    MODIFICATION_PATTERNS.some((p) => p.test(t.content)),
  ).length;
}

/**
 * Extract domain hints from event metadata and content.
 * Very rough — just uses file extensions and common technology keywords.
 */
function extractDomainHints(event: CaptureEvent): string[] {
  const domains = new Set<string>();

  const allText = [
    event.content.summary,
    event.content.detail ?? "",
    ...(event.content.files ?? []),
  ].join(" ").toLowerCase();

  const domainPatterns: Array<[RegExp, string]> = [
    [/\.tsx?|react|next\.?js|vue|angular|svelte/, "frontend"],
    [/\.go|\.rs|\.py|\.java|\.rb/, "backend"],
    [/\.sql|postgres|mysql|sqlite|duckdb|mongo|redis/, "database"],
    [/docker|k8s|kubernetes|ci\/cd|deploy|nginx/, "infrastructure"],
    [/test|spec|jest|vitest|cypress|playwright/, "testing"],
    [/auth|jwt|oauth|session|login|password/, "authentication"],
    [/css|tailwind|styled|theme|layout|responsive/, "styling"],
    [/api|endpoint|route|handler|middleware|graphql/, "api"],
  ];

  for (const [pattern, domain] of domainPatterns) {
    if (pattern.test(allText)) {
      domains.add(domain);
    }
  }

  return Array.from(domains);
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}
