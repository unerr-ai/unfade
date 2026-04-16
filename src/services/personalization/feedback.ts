// FILE: src/services/personalization/feedback.ts
// UF-079: Pattern feedback mechanism — stores user feedback on amplification
// connections and adjusts matching thresholds. Also detects blind spots.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import type { DomainDistributionV2 } from "../../schemas/profile.js";
import { getAmplificationDir } from "../../utils/paths.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FeedbackEntry {
  connection_id: string;
  helpful: boolean;
  timestamp: string;
  domain?: string;
}

export interface BlindSpot {
  domain: string;
  decisionCount: number;
  avgAlternatives: number;
  severity: number;
  message: string;
}

// ---------------------------------------------------------------------------
// Feedback I/O
// ---------------------------------------------------------------------------

const FEEDBACK_FILE = "feedback.jsonl";
const DEFAULT_THRESHOLD = 0.3;
const UNHELPFUL_RATE_LIMIT = 0.3;

/**
 * Store a feedback entry by appending to feedback.jsonl.
 */
export function storeFeedback(entry: FeedbackEntry, cwd?: string): void {
  const dir = getAmplificationDir(cwd);
  mkdirSync(dir, { recursive: true });
  const filePath = `${dir}/${FEEDBACK_FILE}`;
  appendFileSync(filePath, `${JSON.stringify(entry)}\n`, "utf-8");
}

/**
 * Read all feedback entries from feedback.jsonl.
 */
export function readFeedback(cwd?: string): FeedbackEntry[] {
  const dir = getAmplificationDir(cwd);
  const filePath = `${dir}/${FEEDBACK_FILE}`;
  if (!existsSync(filePath)) return [];

  try {
    const content = readFileSync(filePath, "utf-8");
    const entries: FeedbackEntry[] = [];
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed) as FeedbackEntry);
      } catch {
        // skip malformed lines
      }
    }
    return entries;
  } catch {
    return [];
  }
}

/**
 * Calculate the adjusted matching threshold based on feedback.
 * If >30% of feedback for a domain is "unhelpful", raise the threshold.
 * Returns the threshold to use for connection scoring.
 */
export function getFeedbackThreshold(feedback: FeedbackEntry[], domain?: string): number {
  const relevant = domain ? feedback.filter((f) => f.domain === domain) : feedback;

  if (relevant.length === 0) return DEFAULT_THRESHOLD;

  const unhelpful = relevant.filter((f) => !f.helpful).length;
  const unhelpfulRate = unhelpful / relevant.length;

  if (unhelpfulRate > UNHELPFUL_RATE_LIMIT) {
    // Raise threshold proportionally: max bump of 0.3 (from 0.3 → 0.6)
    const bump = (unhelpfulRate - UNHELPFUL_RATE_LIMIT) * (0.3 / (1 - UNHELPFUL_RATE_LIMIT));
    return DEFAULT_THRESHOLD + bump;
  }

  return DEFAULT_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Blind Spot Detection
// ---------------------------------------------------------------------------

/**
 * Detect domains that are potential blind spots:
 * decision_count >= 5 AND avg_alternatives < 1.5.
 *
 * Severity = decision_count * (1 / avg_alternatives)
 */
export function detectBlindSpots(domains: DomainDistributionV2[]): BlindSpot[] {
  const blindSpots: BlindSpot[] = [];

  for (const d of domains) {
    if (d.frequency >= 5 && d.avgAlternativesInDomain < 1.5) {
      const avgAlts = Math.max(d.avgAlternativesInDomain, 0.1); // avoid division by zero
      const severity = d.frequency * (1 / avgAlts);

      blindSpots.push({
        domain: d.domain,
        decisionCount: d.frequency,
        avgAlternatives: d.avgAlternativesInDomain,
        severity,
        message:
          `Blind spot: You've made ${d.frequency} decisions in ${d.domain} but evaluated ` +
          `only ${d.avgAlternativesInDomain.toFixed(1)} alternatives on average. ` +
          `Consider whether you're defaulting to familiar patterns.`,
      });
    }
  }

  return blindSpots.sort((a, b) => b.severity - a.severity);
}
