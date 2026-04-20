import type { DailyDistill } from "../../schemas/distill.js";
import type { ReasoningModelV2 } from "../../schemas/profile.js";

const W_ALTERNATIVES = 0.3;
const W_TRADEOFFS = 0.25;
const W_DEAD_END_RECOVERY = 0.25;
const W_DOMAIN_CROSSING = 0.2;

/**
 * Compute the Reasoning Depth Index (RDI) from a daily distill and profile.
 * Formula: w1*alternativesExplored + w2*tradeOffsArticulated + w3*deadEndRecovery + w4*domainCrossing
 * Normalized to 0-100.
 */
export function computeRDI(distill: DailyDistill, _profile: ReasoningModelV2 | null): number {
  if (distill.decisions.length === 0) return 0;

  const alternativesExplored = computeAlternativesSignal(distill);
  const tradeOffsArticulated = computeTradeOffsSignal(distill);
  const deadEndRecovery = computeDeadEndRecoverySignal(distill);
  const domainCrossing = computeDomainCrossingSignal(distill);

  const raw =
    W_ALTERNATIVES * alternativesExplored +
    W_TRADEOFFS * tradeOffsArticulated +
    W_DEAD_END_RECOVERY * deadEndRecovery +
    W_DOMAIN_CROSSING * domainCrossing;

  return clamp(Math.round(raw * 100), 0, 100);
}

/**
 * Gravity-weighted RDI — weights each decision by its impact before computing.
 * gravity = fileCount*0.3 + domainSpan*0.3 + alternativesConsidered*0.2 + hasTradeOff*0.2
 */
export function computeGravityRDI(distill: DailyDistill, filesChanged: string[]): number {
  if (distill.decisions.length === 0) return 0;

  const uniqueDomains = new Set(distill.domains ?? []);
  const tradeOffDecisions = new Set((distill.tradeOffs ?? []).map((t) => t.tradeOff.toLowerCase()));

  let weightedAltSum = 0;
  let totalGravity = 0;

  for (const dec of distill.decisions) {
    const fileCount = filesChanged.length;
    const domainSpan = uniqueDomains.size;
    const alts = dec.alternativesConsidered ?? 0;
    const hasTradeOff = tradeOffDecisions.size > 0 ? 1 : 0;

    const gravity =
      normalize(fileCount, 0, 20) * 0.3 +
      normalize(domainSpan, 0, 5) * 0.3 +
      normalize(alts, 0, 5) * 0.2 +
      hasTradeOff * 0.2;

    weightedAltSum += gravity * normalize(alts, 0, 5);
    totalGravity += gravity;
  }

  if (totalGravity === 0) return computeRDI(distill, null);

  const gravityAlternatives = weightedAltSum / totalGravity;

  const tradeOffsArticulated = computeTradeOffsSignal(distill);
  const deadEndRecovery = computeDeadEndRecoverySignal(distill);
  const domainCrossing = computeDomainCrossingSignal(distill);

  const raw =
    W_ALTERNATIVES * gravityAlternatives +
    W_TRADEOFFS * tradeOffsArticulated +
    W_DEAD_END_RECOVERY * deadEndRecovery +
    W_DOMAIN_CROSSING * domainCrossing;

  return clamp(Math.round(raw * 100), 0, 100);
}

// --- Signal computation ---

function computeAlternativesSignal(distill: DailyDistill): number {
  const decisions = distill.decisions;
  if (decisions.length === 0) return 0;

  const totalAlts = decisions.reduce((sum, d) => sum + (d.alternativesConsidered ?? 0), 0);
  const avg = totalAlts / decisions.length;
  return normalize(avg, 0, 5);
}

function computeTradeOffsSignal(distill: DailyDistill): number {
  if (distill.decisions.length === 0) return 0;
  const tradeOffCount = distill.tradeOffs?.length ?? 0;
  const ratio = tradeOffCount / distill.decisions.length;
  return clamp(ratio, 0, 1);
}

function computeDeadEndRecoverySignal(distill: DailyDistill): number {
  const deadEnds = distill.deadEnds ?? [];
  if (deadEnds.length === 0) return 0.5;

  const recovered = deadEnds.filter((de) => de.resolution != null && de.resolution !== "").length;
  return recovered / deadEnds.length;
}

function computeDomainCrossingSignal(distill: DailyDistill): number {
  const decisions = distill.decisions;
  if (decisions.length === 0) return 0;

  const domains = new Set<string>();
  for (const d of decisions) {
    if (d.domain) domains.add(d.domain);
  }

  const crossDomainDecisions = decisions.filter((d) => {
    if (!d.domain) return false;
    return domains.size >= 2;
  }).length;

  if (decisions.length === 0) return 0;
  return clamp(crossDomainDecisions / decisions.length, 0, 1);
}

function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return clamp((value - min) / (max - min), 0, 1);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
