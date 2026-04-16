// FILE: src/services/personalization/context-shaper.ts
// UF-047: Context shaper — personalization-aware context delivery.
// Reorders events based on reasoning profile. NEVER removes events.
// Missing profile → passthrough (no shaping).

import type { CaptureEvent } from "../../schemas/event.js";
import type { ReasoningProfile } from "./profile-builder.js";

export interface ShapedEvent {
  event: CaptureEvent;
  emphasis: "high" | "normal" | "low";
  reason?: string;
}

export interface ShapedContext {
  events: ShapedEvent[];
  shapingApplied: boolean;
}

/**
 * Get the developer's top domains from their profile.
 */
function getTopDomains(profile: ReasoningProfile, limit = 3): Set<string> {
  return new Set(
    [...profile.domainDistribution]
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, limit)
      .map((d) => d.domain.toLowerCase()),
  );
}

/**
 * Check if an event is related to a decision (heuristic: mentions "decide", "chose", etc.).
 */
function isDecisionRelated(ev: CaptureEvent): boolean {
  const text = `${ev.content.summary} ${ev.content.detail ?? ""}`.toLowerCase();
  return /\b(decid\w*|chose|picked|selected|switch\w*\s+to|migrat\w*|replac\w*|adopt\w*)\b/.test(
    text,
  );
}

/**
 * Determine emphasis for an event based on the profile.
 */
function determineEmphasis(
  ev: CaptureEvent,
  topDomains: Set<string>,
  profile: ReasoningProfile,
): ShapedEvent {
  // Domain expert: emphasize events in their specialty domains
  const eventDomains = (ev.content.detail ?? "").toLowerCase();
  const eventProject = ev.content.project?.toLowerCase() ?? "";
  const matchesDomain = [...topDomains].some(
    (d) => eventDomains.includes(d) || eventProject.includes(d),
  );

  if (matchesDomain) {
    return { event: ev, emphasis: "high", reason: "domain_expertise" };
  }

  // High exploration profile: emphasize decision-related events
  if (profile.avgAlternativesEvaluated > 1.5 && isDecisionRelated(ev)) {
    return { event: ev, emphasis: "high", reason: "exploration_depth" };
  }

  // Dead-end patterns: emphasize errors/retries for developers who hit dead ends
  if (
    profile.avgDeadEndsPerDay > 0.5 &&
    (ev.type === "error" || ev.type === "retry" || ev.type === "revert")
  ) {
    return { event: ev, emphasis: "high", reason: "dead_end_awareness" };
  }

  return { event: ev, emphasis: "normal" };
}

/**
 * Shape context for the developer's information processing style.
 * - Domain expert → emphasize events in specialty areas
 * - High exploration → emphasize decisions and alternatives
 * - Dead-end prone → emphasize errors and retries
 *
 * NEVER removes events — only reorders and adds emphasis metadata.
 * Missing profile → no shaping applied (passthrough).
 */
export function shapeContext(
  events: CaptureEvent[],
  profile: ReasoningProfile | null,
): ShapedContext {
  // Missing or empty profile → passthrough
  if (!profile || profile.distillCount === 0) {
    return {
      events: events.map((event) => ({ event, emphasis: "normal" as const })),
      shapingApplied: false,
    };
  }

  const topDomains = getTopDomains(profile);
  const shaped = events.map((ev) => determineEmphasis(ev, topDomains, profile));

  // Sort: high emphasis first, then normal, then low — preserving relative order within groups
  const high = shaped.filter((s) => s.emphasis === "high");
  const normal = shaped.filter((s) => s.emphasis === "normal");
  const low = shaped.filter((s) => s.emphasis === "low");

  return {
    events: [...high, ...normal, ...low],
    shapingApplied: true,
  };
}
