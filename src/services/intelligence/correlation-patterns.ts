// Layer 4 IP-5.2: Six initial cross-analyzer correlation patterns.
//
// Each pattern is a pure function: reads typed analyzer outputs → Correlation | null.
// Patterns detect meaningful cross-analyzer signals that individual analyzers can't see.

import type { Correlation } from "../../schemas/intelligence-presentation.js";
import type { CorrelationPattern } from "./correlation-engine.js";

// ─── Type-Safe Output Extraction ────────────────────────────────────────────

interface EfficiencyOutput {
  aes: number;
  trend: "improving" | "stable" | "declining" | null;
  subMetrics: Record<string, { value: number; evidenceEventIds?: string[] }>;
  diagnostics?: Array<{ evidenceEventIds?: string[] }>;
}

interface ComprehensionOutput {
  overall: number;
  byModule: Record<string, { score: number; evidenceEventIds?: string[] }>;
  byDomain: Record<string, number>;
  blindSpots: string[];
}

interface CostOutput {
  wasteRatio: number | null;
  totalEstimatedCost: number;
  byDomain: Array<{ key: string; eventCount: number; evidenceEventIds?: string[] }>;
}

interface LoopOutput {
  stuckLoops: Array<{ domain: string; occurrences: number; evidenceEventIds?: string[] }>;
}

interface VelocityOutput {
  byDomain: Record<string, {
    trend: "accelerating" | "stable" | "decelerating";
    velocityChange: number;
    evidenceEventIds?: string[];
  }>;
  overallTrend: "accelerating" | "stable" | "decelerating";
}

interface PatternsOutput {
  effectivePatterns: Array<{
    domain: string;
    pattern: string;
    acceptanceRate: number;
    exampleSessionIds?: string[];
  }>;
}

interface AlertsOutput {
  alerts: Array<{
    domain: string;
    severity: string;
    evidenceEventIds?: string[];
  }>;
}

function get<T>(outputs: Map<string, unknown>, name: string): T | null {
  const val = outputs.get(name);
  return val ? (val as T) : null;
}

function now(): string {
  return new Date().toISOString();
}

function collectEventIds(...sources: Array<string[] | undefined>): string[] {
  const seen = new Set<string>();
  for (const source of sources) {
    if (!source) continue;
    for (const id of source) seen.add(id);
  }
  return Array.from(seen);
}

// ─── Pattern 1: Efficiency-Blind-Spot ───────────────────────────────────────
// Efficiency declining in a domain where comprehension is low → warning/critical

const efficiencyBlindSpot: CorrelationPattern = {
  id: "efficiency-blind-spot",
  name: "Efficiency declining in blind spot domain",
  analyzers: ["efficiency", "comprehension-radar"],
  detect(outputs) {
    const eff = get<EfficiencyOutput>(outputs, "efficiency");
    const comp = get<ComprehensionOutput>(outputs, "comprehension-radar");
    if (!eff || !comp) return null;

    if (eff.trend !== "declining") return null;
    if (comp.blindSpots.length === 0) return null;

    const affectedDomains: string[] = [];
    const eventIds: string[] = [];

    for (const blindSpot of comp.blindSpots) {
      const moduleData = comp.byModule[blindSpot];
      if (moduleData?.evidenceEventIds) {
        eventIds.push(...moduleData.evidenceEventIds.slice(0, 5));
      }
      affectedDomains.push(blindSpot);
    }

    for (const sub of Object.values(eff.subMetrics)) {
      if (sub.evidenceEventIds) eventIds.push(...sub.evidenceEventIds.slice(0, 3));
    }

    const severity = comp.blindSpots.length >= 2 || eff.aes < 40 ? "critical" : "warning";

    return {
      id: `corr-eff-blind-${now().slice(0, 10)}`,
      type: "efficiency-blind-spot",
      severity,
      title: "Efficiency declining in blind spot domains",
      explanation: `Your AES is ${eff.trend} (${eff.aes}/100) and ${affectedDomains.join(", ")} ${affectedDomains.length === 1 ? "is" : "are"} comprehension blind ${affectedDomains.length === 1 ? "spot" : "spots"}. Low comprehension in active domains directly drags efficiency — you're spending more turns on topics you don't deeply understand.`,
      analyzers: ["efficiency", "comprehension-radar"],
      domain: affectedDomains[0],
      evidenceEventIds: collectEventIds(eventIds),
      actionable: `Deep-dive into ${affectedDomains[0]} — review recent AI output critically instead of accepting. Consider manual code review or pair programming in this area.`,
      detectedAt: now(),
    } satisfies Correlation;
  },
};

// ─── Pattern 2: Cost-Loop ───────────────────────────────────────────────────
// High waste ratio + stuck loops in same domain → warning

const costLoop: CorrelationPattern = {
  id: "cost-loop",
  name: "Cost waste amplified by stuck loops",
  analyzers: ["cost-attribution", "loop-detector"],
  detect(outputs) {
    const cost = get<CostOutput>(outputs, "cost-attribution");
    const loops = get<LoopOutput>(outputs, "loop-detector");
    if (!cost || !loops) return null;

    if (cost.wasteRatio === null || cost.wasteRatio < 0.2) return null;
    if (loops.stuckLoops.length === 0) return null;

    const loopDomains = loops.stuckLoops.map((l) => l.domain);
    const totalOccurrences = loops.stuckLoops.reduce((s, l) => s + l.occurrences, 0);

    const eventIds = collectEventIds(
      ...loops.stuckLoops.map((l) => l.evidenceEventIds),
      ...cost.byDomain.map((d) => d.evidenceEventIds),
    );

    return {
      id: `corr-cost-loop-${now().slice(0, 10)}`,
      type: "cost-loop",
      severity: cost.wasteRatio > 0.4 ? "critical" : "warning",
      title: "Cost waste amplified by stuck loops",
      explanation: `Waste ratio is ${Math.round(cost.wasteRatio * 100)}% and there ${loops.stuckLoops.length === 1 ? "is" : "are"} ${loops.stuckLoops.length} stuck loop${loops.stuckLoops.length === 1 ? "" : "s"} (${totalOccurrences} total repeats) in ${loopDomains.join(", ")}. You're burning tokens circling the same topics without making progress.`,
      analyzers: ["cost-attribution", "loop-detector"],
      domain: loopDomains[0],
      evidenceEventIds: eventIds,
      actionable: `Break the loop in "${loopDomains[0]}" — try a fundamentally different approach, consult documentation directly, or step away from AI assistance for this specific problem.`,
      detectedAt: now(),
    } satisfies Correlation;
  },
};

// ─── Pattern 3: Velocity-Comprehension ──────────────────────────────────────
// Velocity decelerating in low-comprehension domain → info

const velocityComprehension: CorrelationPattern = {
  id: "velocity-comprehension",
  name: "Velocity dropping in low-comprehension domain",
  analyzers: ["velocity-tracker", "comprehension-radar"],
  detect(outputs) {
    const vel = get<VelocityOutput>(outputs, "velocity-tracker");
    const comp = get<ComprehensionOutput>(outputs, "comprehension-radar");
    if (!vel || !comp) return null;

    const overlapping: Array<{ domain: string; velChange: number; compScore: number }> = [];

    for (const [domain, velData] of Object.entries(vel.byDomain)) {
      if (velData.trend !== "decelerating") continue;

      const compScore = comp.byDomain[domain];
      if (compScore === undefined) continue;
      if (compScore >= 50) continue;

      overlapping.push({ domain, velChange: velData.velocityChange, compScore });
    }

    if (overlapping.length === 0) return null;

    const worst = overlapping.sort((a, b) => a.compScore - b.compScore)[0];

    const eventIds = collectEventIds(
      vel.byDomain[worst.domain]?.evidenceEventIds,
      comp.byModule[worst.domain]?.evidenceEventIds,
    );

    return {
      id: `corr-vel-comp-${now().slice(0, 10)}`,
      type: "velocity-comprehension",
      severity: worst.compScore < 30 ? "warning" : "info",
      title: `Velocity dropping in "${worst.domain}" where comprehension is low`,
      explanation: `Turns-to-acceptance in "${worst.domain}" increased ${worst.velChange}% while comprehension is only ${worst.compScore}/100. You're taking longer on a topic you don't deeply understand — this is expected but worth addressing.`,
      analyzers: ["velocity-tracker", "comprehension-radar"],
      domain: worst.domain,
      evidenceEventIds: eventIds,
      actionable: `Invest time understanding "${worst.domain}" fundamentals. Your velocity should naturally improve once comprehension recovers.`,
      detectedAt: now(),
    } satisfies Correlation;
  },
};

// ─── Pattern 4: Pattern-Efficiency ──────────────────────────────────────────
// Effective prompt pattern correlating with efficiency improvement → info (positive)

const patternEfficiency: CorrelationPattern = {
  id: "pattern-efficiency",
  name: "Effective prompting correlated with high efficiency",
  analyzers: ["prompt-patterns", "efficiency"],
  detect(outputs) {
    const patterns = get<PatternsOutput>(outputs, "prompt-patterns");
    const eff = get<EfficiencyOutput>(outputs, "efficiency");
    if (!patterns || !eff) return null;

    if (patterns.effectivePatterns.length === 0) return null;
    if (eff.aes < 60) return null;

    const bestPattern = patterns.effectivePatterns[0];

    const eventIds = collectEventIds(
      bestPattern.exampleSessionIds?.slice(0, 5),
      ...Object.values(eff.subMetrics).map((s) => s.evidenceEventIds),
    );

    return {
      id: `corr-pat-eff-${now().slice(0, 10)}`,
      type: "pattern-efficiency",
      severity: "info",
      title: "Your prompting patterns are driving efficiency",
      explanation: `Your AES is strong at ${eff.aes}/100 and your effective patterns — like "${bestPattern.pattern.slice(0, 80)}" in ${bestPattern.domain} — are contributing. High-direction prompting correlates directly with AI efficiency.`,
      analyzers: ["prompt-patterns", "efficiency"],
      domain: bestPattern.domain,
      evidenceEventIds: eventIds,
      actionable: `Keep applying "${bestPattern.domain}" patterns to other domains. Document this approach for consistency.`,
      detectedAt: now(),
    } satisfies Correlation;
  },
};

// ─── Pattern 5: Expertise-Cost ──────────────────────────────────────────────
// High cost in deep-expertise domain → warning (potential over-reliance)

const expertiseCost: CorrelationPattern = {
  id: "expertise-cost",
  name: "High AI cost in deep-expertise domain",
  analyzers: ["cost-attribution", "comprehension-radar"],
  detect(outputs) {
    const cost = get<CostOutput>(outputs, "cost-attribution");
    const comp = get<ComprehensionOutput>(outputs, "comprehension-radar");
    if (!cost || !comp) return null;

    if (cost.totalEstimatedCost === 0) return null;

    const highCompDomains = Object.entries(comp.byDomain)
      .filter(([, score]) => score >= 70)
      .map(([domain]) => domain);

    if (highCompDomains.length === 0) return null;

    const expensiveExpertDomains = cost.byDomain
      .filter((d) => highCompDomains.some((hc) =>
        d.key.toLowerCase().includes(hc.toLowerCase()) ||
        hc.toLowerCase().includes(d.key.toLowerCase()),
      ))
      .filter((d) => d.percentage >= 30);

    if (expensiveExpertDomains.length === 0) return null;

    const top = expensiveExpertDomains[0];

    const eventIds = collectEventIds(
      top.evidenceEventIds,
      comp.byModule[highCompDomains[0]]?.evidenceEventIds,
    );

    return {
      id: `corr-expert-cost-${now().slice(0, 10)}`,
      type: "expertise-cost",
      severity: "warning",
      title: `High AI spend in "${top.key}" where you already have deep expertise`,
      explanation: `"${top.key}" accounts for ${top.percentage}% of your AI usage but your comprehension is ${comp.byDomain[highCompDomains[0]] ?? 70}+/100 in this area. You may be over-relying on AI for work you could do faster independently.`,
      analyzers: ["cost-attribution", "comprehension-radar"],
      domain: top.key,
      evidenceEventIds: eventIds,
      actionable: `Try working without AI in "${top.key}" for a session — you likely don't need it for areas you deeply understand. Reserve AI for unfamiliar domains.`,
      detectedAt: now(),
    } satisfies Correlation;
  },
};

// ─── Pattern 6: Blind-Spot-Acceptance ───────────────────────────────────────
// Active blind spot alerts + high acceptance in that domain → critical

const blindSpotAcceptance: CorrelationPattern = {
  id: "blind-spot-acceptance",
  name: "Uncritical AI acceptance in blind spot domain",
  analyzers: ["blind-spot-detector", "comprehension-radar"],
  detect(outputs) {
    const alerts = get<AlertsOutput>(outputs, "blind-spot-detector");
    const comp = get<ComprehensionOutput>(outputs, "comprehension-radar");
    if (!alerts || !comp) return null;

    const activeAlerts = alerts.alerts.filter((a) => a.severity !== "info");
    if (activeAlerts.length === 0) return null;

    const confirmedBlindSpots = activeAlerts.filter((a) =>
      comp.blindSpots.includes(a.domain) ||
      (comp.byDomain[a.domain] !== undefined && comp.byDomain[a.domain] < 40),
    );

    if (confirmedBlindSpots.length === 0) return null;

    const eventIds = collectEventIds(
      ...confirmedBlindSpots.map((a) => a.evidenceEventIds),
      ...confirmedBlindSpots
        .map((a) => comp.byModule[a.domain]?.evidenceEventIds)
        .filter(Boolean) as string[][],
    );

    const domains = confirmedBlindSpots.map((a) => a.domain);

    return {
      id: `corr-blind-accept-${now().slice(0, 10)}`,
      type: "blind-spot-acceptance",
      severity: "critical",
      title: `Dangerous uncritical acceptance in ${domains.length} blind spot domain${domains.length === 1 ? "" : "s"}`,
      explanation: `You have active blind spot alerts in ${domains.join(", ")} with comprehension below 40/100 — yet you continue accepting AI output in ${domains.length === 1 ? "this area" : "these areas"} without deep engagement. This is the highest-risk pattern: low understanding + high trust = accumulating hidden technical debt.`,
      analyzers: ["blind-spot-detector", "comprehension-radar"],
      domain: domains[0],
      evidenceEventIds: eventIds,
      actionable: `STOP accepting AI output in "${domains[0]}" without verification. Review each suggestion against documentation. Consider pairing with someone who knows this area well.`,
      detectedAt: now(),
    } satisfies Correlation;
  },
};

// ─── Export All Patterns ────────────────────────────────────────────────────

export const ALL_CORRELATION_PATTERNS: CorrelationPattern[] = [
  efficiencyBlindSpot,
  costLoop,
  velocityComprehension,
  patternEfficiency,
  expertiseCost,
  blindSpotAcceptance,
];
