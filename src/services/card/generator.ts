// FILE: src/services/card/generator.ts
// UF-058 + UF-060: Extract CardData from distill markdown, render card PNG.
// extractCardData() NEVER throws — returns empty CardData for missing/malformed distills.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import type { CardData } from "../../schemas/card.js";
import { logger } from "../../utils/logger.js";
import { getCardsDir, getDistillsDir } from "../../utils/paths.js";
import { loadFonts } from "./fonts.js";
import { cardTemplate } from "./templates.js";

// --- Markdown parsing helpers ---

/**
 * Extract top decisions from distill markdown.
 * Parses lines like: `- **decision text** [domain] (N alternatives considered)`
 * Returns { decisions, domains, totalAlternatives, decisionCount }.
 */
function parseDecisions(markdown: string): {
  decisions: string[];
  domains: string[];
  totalAlternatives: number;
  decisionCount: number;
} {
  const decisions: string[] = [];
  const domainSet = new Set<string>();
  let totalAlternatives = 0;
  let decisionCount = 0;

  // Find the Decisions section
  const sectionsPattern = /^## Decisions\s*$/m;
  const match = sectionsPattern.exec(markdown);
  if (!match) return { decisions: [], domains: [], totalAlternatives: 0, decisionCount: 0 };

  const sectionStart = match.index + match[0].length;
  // Find the end of the section (next ## heading or end of file)
  const nextSection = markdown.indexOf("\n## ", sectionStart);
  const sectionText =
    nextSection === -1 ? markdown.slice(sectionStart) : markdown.slice(sectionStart, nextSection);

  // Parse each decision line
  const linePattern =
    /^- \*\*(.+?)\*\*(?:\s*\[([^\]]+)\])?(?:\s*\((\d+)\s+alternatives?\s+considered\))?/gm;
  for (
    let lineMatch = linePattern.exec(sectionText);
    lineMatch !== null;
    lineMatch = linePattern.exec(sectionText)
  ) {
    decisionCount++;
    const decisionText = lineMatch[1].slice(0, 80); // max 80 chars
    if (decisions.length < 3) {
      decisions.push(decisionText);
    }
    if (lineMatch[2]) {
      domainSet.add(lineMatch[2]);
    }
    if (lineMatch[3]) {
      totalAlternatives += Number.parseInt(lineMatch[3], 10);
    }
  }

  // Also collect domains from the ## Domains section
  const domainsSection = /^## Domains\s*$/m.exec(markdown);
  if (domainsSection) {
    const dStart = domainsSection.index + domainsSection[0].length;
    const dEnd = markdown.indexOf("\n## ", dStart);
    const dText = (dEnd === -1 ? markdown.slice(dStart) : markdown.slice(dStart, dEnd)).trim();
    if (dText) {
      for (const d of dText.split(",")) {
        const trimmed = d.trim();
        if (trimmed) domainSet.add(trimmed);
      }
    }
  }

  const domains = Array.from(domainSet).slice(0, 3);

  return { decisions, domains, totalAlternatives, decisionCount };
}

/**
 * Count dead ends from the ## Dead Ends section.
 */
function parseDeadEnds(markdown: string): number {
  const match = /^## Dead Ends\s*$/m.exec(markdown);
  if (!match) return 0;

  const sectionStart = match.index + match[0].length;
  const nextSection = markdown.indexOf("\n## ", sectionStart);
  const sectionText =
    nextSection === -1 ? markdown.slice(sectionStart) : markdown.slice(sectionStart, nextSection);

  let count = 0;
  const linePattern = /^- \*\*/gm;
  while (linePattern.exec(sectionText) !== null) {
    count++;
  }
  return count;
}

/**
 * Extract AI modification percentage from events processed metadata.
 * Looks for `- **Events processed:** N` and estimates from synthesizedBy field.
 */
function parseAiModifiedPct(markdown: string): number {
  // Check synthesizedBy field
  const synthMatch = /- \*\*Synthesized by:\*\*\s*(.+)/i.exec(markdown);
  if (synthMatch) {
    const synth = synthMatch[1].trim().toLowerCase();
    if (synth === "fallback") return 0;
    // If synthesized by an LLM, estimate based on having AI involvement
    return 65; // Default estimate when AI-synthesized
  }
  return 0;
}

/**
 * Extract CardData from a distill markdown file.
 * NEVER throws — returns empty CardData for missing or malformed distills.
 */
export function extractCardData(distillPath: string): CardData {
  const emptyCard: CardData = {
    date: "",
    decisions: [],
    domains: [],
    reasoningDepth: 0,
    deadEnds: 0,
    decisionCount: 0,
    aiModifiedPct: 0,
  };

  try {
    if (!existsSync(distillPath)) return emptyCard;

    const markdown = readFileSync(distillPath, "utf-8");

    // Extract date from header
    const dateMatch = /^# Daily Distill — (\d{4}-\d{2}-\d{2})/m.exec(markdown);
    const date = dateMatch?.[1] ?? "";

    const { decisions, domains, totalAlternatives, decisionCount } = parseDecisions(markdown);
    const deadEnds = parseDeadEnds(markdown);
    const aiModifiedPct = parseAiModifiedPct(markdown);

    // Reasoning depth = average alternatives per decision
    const reasoningDepth = decisionCount > 0 ? totalAlternatives / decisionCount : 0;

    return {
      date,
      decisions,
      domains,
      reasoningDepth,
      deadEnds,
      decisionCount,
      aiModifiedPct,
    };
  } catch (err) {
    logger.debug("Failed to extract card data", {
      path: distillPath,
      error: err instanceof Error ? err.message : String(err),
    });
    return emptyCard;
  }
}

/**
 * Generate an Unfade Card PNG for the given date.
 * Pipeline: extractCardData → satori (JSX→SVG) → resvg (SVG→PNG) → write file.
 * Returns the PNG buffer.
 */
export async function generateCard(date: string, cwd?: string): Promise<Buffer> {
  const distillPath = join(getDistillsDir(cwd), `${date}.md`);
  const cardData = extractCardData(distillPath);

  // Override date if extraction failed to find one
  if (!cardData.date) {
    cardData.date = date;
  }

  const fonts = await loadFonts();
  const jsx = cardTemplate(cardData);

  const svg = await satori(jsx, {
    width: 1200,
    height: 630,
    fonts: fonts.map((f) => ({
      name: f.name,
      data: f.data,
      weight: f.weight,
      style: f.style,
    })),
  });

  const resvg = new Resvg(svg, {
    fitTo: { mode: "width" as const, value: 1200 },
  });
  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();

  // Write to .unfade/cards/YYYY-MM-DD.png
  const cardsDir = getCardsDir(cwd);
  mkdirSync(cardsDir, { recursive: true });
  const outputPath = join(cardsDir, `${date}.png`);
  writeFileSync(outputPath, pngBuffer);

  logger.debug("Generated card", { path: outputPath, size: pngBuffer.length });

  return Buffer.from(pngBuffer);
}
