import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DailyMetricSnapshot } from "../../schemas/metrics.js";
import type { ReasoningModelV2 } from "../../schemas/profile.js";
import { getCardsDir, getMetricsDir, getProfileDir } from "../../utils/paths.js";
import type { FirstRunReport } from "../intelligence/first-run-analyzer.js";

export interface CardIdentityData {
  hasData: boolean;
  rdi: number | null;
  identityLabel: string | null;
  directionSpectrum: {
    humanDirected: number;
    collaborative: number;
    llmDirected: number;
  } | null;
  topDomains: Array<{ domain: string; depth: string }>;
  averageHDS: number | null;
}

/**
 * Load card identity data from the profile and metric snapshots.
 * Gracefully degrades when no HDS/direction data exists — returns
 * `hasData: false` so the card can fall back to v1 layout.
 */
export function loadCardIdentityData(cwd?: string): CardIdentityData {
  const profile = loadProfile(cwd);
  const latestSnapshot = loadLatestSnapshot(cwd);

  if (!profile && !latestSnapshot) {
    return {
      hasData: false,
      rdi: null,
      identityLabel: null,
      directionSpectrum: null,
      topDomains: [],
      averageHDS: null,
    };
  }

  const rdi = latestSnapshot?.rdi ?? null;
  const identityLabel = latestSnapshot?.identityLabels?.[0] ?? deriveLabel(rdi);

  const directionSpectrum = profile?.directionPatterns
    ? {
        humanDirected: profile.directionPatterns.commonSignals.includes("strong-direction")
          ? 0.6
          : 0.3,
        collaborative: profile.directionPatterns.commonSignals.includes("collaborative-style")
          ? 0.5
          : 0.3,
        llmDirected: profile.directionPatterns.commonSignals.includes("ai-delegation") ? 0.4 : 0.1,
      }
    : null;

  const topDomains = (profile?.domainDistribution ?? [])
    .slice(0, 5)
    .map((d) => ({ domain: d.domain, depth: d.depth }));

  const averageHDS = profile?.directionPatterns?.runningAverageHDS ?? null;

  return {
    hasData: rdi !== null || identityLabel !== null,
    rdi,
    identityLabel,
    directionSpectrum,
    topDomains,
    averageHDS,
  };
}

function deriveLabel(rdi: number | null): string | null {
  if (rdi === null) return null;
  if (rdi >= 70) return "Architectural Thinker";
  if (rdi >= 50) return "Deliberate Builder";
  if (rdi >= 30) return "Pragmatic Mover";
  return "Reflex Mode";
}

function loadProfile(cwd?: string): ReasoningModelV2 | null {
  const path = join(getProfileDir(cwd), "reasoning_model.json");
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    return data.version === 2 ? (data as ReasoningModelV2) : null;
  } catch {
    return null;
  }
}

function loadLatestSnapshot(cwd?: string): DailyMetricSnapshot | null {
  const path = join(getMetricsDir(cwd), "daily.jsonl");
  if (!existsSync(path)) return null;
  try {
    const content = readFileSync(path, "utf-8").trim();
    if (!content) return null;
    const lines = content.split("\n");
    const last = lines[lines.length - 1].trim();
    return last ? JSON.parse(last) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Card v3 — Anti-Vibe Certificate (UF-246, UF-248)
// ---------------------------------------------------------------------------

export interface CardV3Data {
  type: "reasoning-card-v3";
  version: 3;
  generatedAt: string;

  directionDensity: number;
  comprehensionScore: number | null;
  reasoningVelocityTrend: string | null;
  topAugmentedDomain: string | null;
  topDependentDomain: string | null;
  costEfficiencyTrend: string | null;
  judgmentMomentCount: number;

  identityLabel: string | null;
  rdi: number | null;
  topDomains: Array<{ domain: string; depth: string }>;

  antiVibeCertification: {
    certified: boolean;
    score: number;
    methodologyHash: string;
    gates: {
      directionGate: boolean;
      comprehensionGate: boolean;
      velocityGate: boolean;
    };
  };
}

/**
 * Build Card v3 data from all available intelligence.
 */
export function buildCardV3(input: {
  directionDensity: number;
  comprehensionScore: number | null;
  velocityTrend: string | null;
  velocityPercent: number | null;
  topAugmented: string | null;
  topDependent: string | null;
  costTrend: string | null;
  judgmentMoments: number;
  identityLabel: string | null;
  rdi: number | null;
  topDomains: Array<{ domain: string; depth: string }>;
}): CardV3Data {
  const directionGate = input.directionDensity > 50;
  const comprehensionGate = (input.comprehensionScore ?? 0) > 40;
  const velocityGate = (input.velocityPercent ?? 0) >= 0;

  const certified = directionGate && comprehensionGate && velocityGate;

  const certScore = Math.round(
    input.directionDensity * 0.4 +
      (input.comprehensionScore ?? 0) * 0.35 +
      (Math.min(Math.max(input.velocityPercent ?? 0, -100), 100) * 0.25 + 25),
  );

  const methodologyHash = computeMethodologyHash();

  return {
    type: "reasoning-card-v3",
    version: 3,
    generatedAt: new Date().toISOString(),
    directionDensity: input.directionDensity,
    comprehensionScore: input.comprehensionScore,
    reasoningVelocityTrend: input.velocityTrend,
    topAugmentedDomain: input.topAugmented,
    topDependentDomain: input.topDependent,
    costEfficiencyTrend: input.costTrend,
    judgmentMomentCount: input.judgmentMoments,
    identityLabel: input.identityLabel,
    rdi: input.rdi,
    topDomains: input.topDomains,
    antiVibeCertification: {
      certified,
      score: Math.max(0, Math.min(100, certScore)),
      methodologyHash,
      gates: { directionGate, comprehensionGate, velocityGate },
    },
  };
}

function computeMethodologyHash(): string {
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  const scoringSource = "direction>50 AND comprehension>40 AND velocity>=0 v1.0";
  return createHash("sha256").update(scoringSource).digest("hex").slice(0, 16);
}

/**
 * Write Card v3 JSON to .unfade/cards/reasoning-card-v3.json.
 */
export function writeCardV3(card: CardV3Data, cwd?: string): string {
  const cardsDir = getCardsDir(cwd);
  mkdirSync(cardsDir, { recursive: true });
  const cardPath = join(cardsDir, "reasoning-card-v3.json");
  writeFileSync(cardPath, JSON.stringify(card, null, 2), "utf-8");
  return cardPath;
}

// ---------------------------------------------------------------------------
// First-Run Card (UF-209)
// ---------------------------------------------------------------------------

export interface FirstRunCardData {
  directionDensity: number;
  topDomains: Array<{ domain: string; directionDensity: number }>;
  highestAcceptVerbatim: { domain: string; acceptRate: number } | null;
  totalInteractions: number;
  daysAnalyzed: number;
  identityLabel: string;
}

/**
 * Build card data from a FirstRunReport.
 */
export function buildFirstRunCardData(report: FirstRunReport): FirstRunCardData {
  const label = deriveLabel(report.directionDensity) ?? "Emerging";

  return {
    directionDensity: report.directionDensity,
    topDomains: report.domains
      .slice(0, 3)
      .map((d) => ({ domain: d.domain, directionDensity: d.directionDensity })),
    highestAcceptVerbatim: report.highestAcceptVerbatim
      ? {
          domain: report.highestAcceptVerbatim.domain,
          acceptRate: report.highestAcceptVerbatim.acceptRate,
        }
      : null,
    totalInteractions: report.aiInteractions,
    daysAnalyzed: report.daysAnalyzed,
    identityLabel: label,
  };
}

/**
 * Generate the first-run Reasoning Card as a JSON summary file.
 * (PNG rendering deferred to the existing card pipeline when ready.)
 * Writes to .unfade/cards/first-run.json with the card data.
 */
export function writeFirstRunCard(report: FirstRunReport, cwd?: string): string {
  const cardsDir = getCardsDir(cwd);
  mkdirSync(cardsDir, { recursive: true });

  const cardData = buildFirstRunCardData(report);
  const cardPath = join(cardsDir, "first-run.json");

  const cardContent = {
    type: "first-run-revelation",
    version: 1,
    generatedAt: new Date().toISOString(),
    badge: "First Week with Unfade",
    ...cardData,
  };

  writeFileSync(cardPath, JSON.stringify(cardContent, null, 2), "utf-8");
  return cardPath;
}
