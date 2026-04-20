// FILE: src/commands/card.ts
// UF-249: `unfade card [--v3]` — generate and display a Reasoning Card.
// v3 includes: direction, comprehension, velocity, domains, anti-vibe badge.
// Without --v3: existing Card format (backward compatible).

import { theme, writeBlank, writeLine } from "../cli/ui.js";
import { buildCardV3, loadCardIdentityData, writeCardV3 } from "../services/cards/identity.js";
import { readSummary } from "../services/intelligence/summary-writer.js";
import {
  computeReasoningVelocity,
  countJudgmentMoments,
  formatVelocity,
} from "../services/intelligence/velocity.js";
import { handleCliError } from "../utils/cli-error.js";

export async function cardCommand(opts: { v3?: boolean } = {}): Promise<void> {
  try {
    if (opts.v3) {
      return await generateCardV3();
    }
    return generateCardLegacy();
  } catch (err) {
    handleCliError(err, "card");
  }
}

async function generateCardV3(): Promise<void> {
  const summary = readSummary();
  const identity = loadCardIdentityData();
  const velocity = computeReasoningVelocity(30);
  const judgmentMoments = countJudgmentMoments(30);

  const directionDensity = summary?.directionDensity24h ?? 0;
  const comprehensionScore = summary?.comprehensionScore ?? null;

  let topAugmented: string | null = null;
  let topDependent: string | null = null;

  if (identity.topDomains.length > 0) {
    topAugmented = identity.topDomains[0].domain;
  }
  if (identity.topDomains.length > 1) {
    topDependent = identity.topDomains[identity.topDomains.length - 1].domain;
  }

  const costTrend =
    summary?.costQualityTrend != null
      ? `${summary.costQualityTrend}${summary.costPerDirectedDecision != null ? ` ($${summary.costPerDirectedDecision}/decision)` : ""}`
      : summary?.todaySpendProxy != null && summary.todaySpendProxy > 0
        ? `Spend ~$${summary.todaySpendProxy.toFixed(2)} today`
        : null;

  const card = buildCardV3({
    directionDensity,
    comprehensionScore,
    velocityTrend: formatVelocity(velocity),
    velocityPercent: velocity.percentChange,
    topAugmented,
    topDependent,
    costTrend,
    judgmentMoments,
    identityLabel: identity.identityLabel,
    rdi: identity.rdi,
    topDomains: identity.topDomains,
  });

  const cardPath = writeCardV3(card);

  writeBlank();
  writeLine(`  ${theme.brand("Reasoning Card v3")}`);
  writeBlank();

  writeLine(`  ${theme.bold.cyan(`${card.directionDensity}%`)} ${theme.muted("Human-Directed")}`);

  if (card.comprehensionScore !== null) {
    writeLine(`  ${theme.bold(`Comprehension: ${card.comprehensionScore}`)}`);
  }

  if (card.reasoningVelocityTrend) {
    writeLine(`  ${theme.muted("Velocity:")} ${theme.bold(card.reasoningVelocityTrend)}`);
  }

  if (card.topAugmentedDomain) {
    writeLine(`  ${theme.success("▲")} ${theme.muted("Augmented:")} ${card.topAugmentedDomain}`);
  }
  if (card.topDependentDomain) {
    writeLine(`  ${theme.warning("▼")} ${theme.muted("Dependent:")} ${card.topDependentDomain}`);
  }

  writeLine(
    `  ${theme.muted("Judgment moments (30d):")} ${theme.bold(String(card.judgmentMomentCount))}`,
  );

  if (card.identityLabel) {
    writeLine(`  ${theme.accent(card.identityLabel)}`);
  }

  writeBlank();

  const cert = card.antiVibeCertification;
  if (cert.certified) {
    writeLine(`  ${theme.success("✓")} ${theme.bold("Engineering with AI — Not Vibe Coding")}`);
    writeLine(`    ${theme.muted(`Score: ${cert.score} · Methodology: ${cert.methodologyHash}`)}`);
  } else {
    const failedGates: string[] = [];
    if (!cert.gates.directionGate) failedGates.push("direction < 50%");
    if (!cert.gates.comprehensionGate) failedGates.push("comprehension ≤ 40");
    if (!cert.gates.velocityGate) failedGates.push("velocity declining");
    writeLine(`  ${theme.warning("○")} ${theme.muted("Anti-vibe badge: not yet earned")}`);
    writeLine(`    ${theme.muted(`Needs: ${failedGates.join(", ")}`)}`);
  }

  writeBlank();
  writeLine(`  ${theme.muted(`Card saved: ${cardPath}`)}`);
  writeBlank();
}

function generateCardLegacy(): void {
  const identity = loadCardIdentityData();

  writeBlank();
  writeLine(`  ${theme.brand("Reasoning Card")}`);
  writeBlank();

  if (!identity.hasData) {
    writeLine(
      `  ${theme.muted("No data yet — run")} ${theme.cyan("unfade distill")} ${theme.muted("first.")}`,
    );
    writeBlank();
    return;
  }

  if (identity.rdi !== null) {
    writeLine(`  ${theme.bold(`RDI: ${identity.rdi}`)}`);
  }
  if (identity.identityLabel) {
    writeLine(`  ${theme.accent(identity.identityLabel)}`);
  }
  if (identity.topDomains.length > 0) {
    const domains = identity.topDomains.map((d) => `${d.domain} (${d.depth})`).join(", ");
    writeLine(`  ${theme.muted("Domains:")} ${domains}`);
  }
  if (identity.averageHDS !== null) {
    writeLine(`  ${theme.muted("Direction:")} ${Math.round(identity.averageHDS * 100)}%`);
  }

  writeBlank();
}
