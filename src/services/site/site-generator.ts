// FILE: src/services/site/site-generator.ts
// UF-080: Thinking Graph site generator — reads .unfade/ data, computes
// heatmap counts, extracts domains, compiles recent distills, writes data.json.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReasoningModelV2 } from "../../schemas/profile.js";
import { getDistillsDir, getProfileDir, getSiteDir } from "../../utils/paths.js";

// ---------------------------------------------------------------------------
// Public types — consumed by heatmap.ts and template.ts
// ---------------------------------------------------------------------------

export interface DayCount {
  date: string; // YYYY-MM-DD
  decisions: number;
  tradeOffs: number;
  deadEnds: number;
  intensity: number; // decisions + tradeOffs*1.5 + deadEnds*2
}

export interface DomainSummary {
  domain: string;
  frequency: number;
  percentage: number; // 0–1
  depth: string;
}

export interface ProfileSummary {
  avgAlternatives: number;
  aiAcceptanceRate: number;
  aiModificationRate: number;
  avgDecisionsPerDay: number;
  topPattern: string;
  dataPoints: number;
}

export interface DistillExcerpt {
  date: string;
  summary: string;
  decisionCount: number;
  domains: string[];
}

export interface SiteData {
  generatedAt: string;
  heatmap: DayCount[];
  domains: DomainSummary[];
  profile: ProfileSummary | null;
  distills: DistillExcerpt[];
}

// ---------------------------------------------------------------------------
// Distill markdown parsing helpers
// ---------------------------------------------------------------------------

function countSection(markdown: string, sectionName: string): number {
  const pattern = new RegExp(`^## ${sectionName}\\s*$`, "m");
  const match = pattern.exec(markdown);
  if (!match) return 0;

  const sectionStart = match.index + match[0].length;
  const nextSection = markdown.indexOf("\n## ", sectionStart);
  const sectionText =
    nextSection === -1 ? markdown.slice(sectionStart) : markdown.slice(sectionStart, nextSection);

  let count = 0;
  const linePattern = /^- \*\*/gm;
  while (linePattern.exec(sectionText) !== null) count++;
  return count;
}

function extractSummary(markdown: string): string {
  // First non-empty line after the header that isn't a section heading
  const lines = markdown.split("\n");
  let pastHeader = false;
  for (const line of lines) {
    if (line.startsWith("# ")) {
      pastHeader = true;
      continue;
    }
    if (!pastHeader) continue;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("## ") || trimmed.startsWith("- **")) continue;
    if (trimmed.startsWith("> ")) return trimmed.slice(2).trim();
    if (trimmed.length > 0) return trimmed;
  }
  return "";
}

function extractDomains(markdown: string): string[] {
  const domainsSection = /^## Domains\s*$/m.exec(markdown);
  if (!domainsSection) {
    // Fallback: extract [domain] tags from decision lines
    const domains = new Set<string>();
    const tagPattern = /\[([^\]]+)\]/g;
    for (let m = tagPattern.exec(markdown); m !== null; m = tagPattern.exec(markdown)) {
      domains.add(m[1]);
    }
    return Array.from(domains).slice(0, 5);
  }
  const start = domainsSection.index + domainsSection[0].length;
  const end = markdown.indexOf("\n## ", start);
  const text = (end === -1 ? markdown.slice(start) : markdown.slice(start, end)).trim();
  if (!text) return [];
  return text
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean)
    .slice(0, 5);
}

// ---------------------------------------------------------------------------
// Core: compute heatmap data from distill files
// ---------------------------------------------------------------------------

function computeHeatmapData(distillsDir: string, days: number): DayCount[] {
  const result: DayCount[] = [];

  if (!existsSync(distillsDir)) return result;

  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const files = readdirSync(distillsDir)
    .filter((f) => f.endsWith(".md"))
    .sort();

  for (const file of files) {
    const date = file.replace(/\.md$/, "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (date < cutoffStr) continue;

    try {
      const markdown = readFileSync(join(distillsDir, file), "utf-8");
      const decisions = countSection(markdown, "Decisions");
      const tradeOffs = countSection(markdown, "Trade-offs") + countSection(markdown, "Trade-Offs");
      const deadEnds = countSection(markdown, "Dead Ends");
      const intensity = decisions + tradeOffs * 1.5 + deadEnds * 2;

      result.push({ date, decisions, tradeOffs, deadEnds, intensity });
    } catch {
      // Skip malformed files
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Core: extract domain distribution from reasoning model
// ---------------------------------------------------------------------------

function extractDomainDistribution(profileDir: string): DomainSummary[] {
  const modelPath = join(profileDir, "reasoning_model.json");
  if (!existsSync(modelPath)) return [];

  try {
    const raw = JSON.parse(readFileSync(modelPath, "utf-8"));
    if (raw.version !== 2) return [];
    const model = raw as ReasoningModelV2;

    return model.domainDistribution.map((d) => ({
      domain: d.domain,
      frequency: d.frequency,
      percentage: d.percentageOfTotal,
      depth: d.depth,
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Core: extract profile summary from reasoning model
// ---------------------------------------------------------------------------

function extractProfileSummary(profileDir: string): ProfileSummary | null {
  const modelPath = join(profileDir, "reasoning_model.json");
  if (!existsSync(modelPath)) return null;

  try {
    const raw = JSON.parse(readFileSync(modelPath, "utf-8"));
    if (raw.version !== 2) return null;
    const model = raw as ReasoningModelV2;

    const highConfPatterns = model.patterns.filter((p) => p.confidence >= 0.7);
    const topPattern =
      highConfPatterns.length > 0
        ? highConfPatterns.sort((a, b) => b.confidence - a.confidence)[0].pattern
        : "";

    return {
      avgAlternatives: model.decisionStyle.avgAlternativesEvaluated,
      aiAcceptanceRate: model.decisionStyle.aiAcceptanceRate,
      aiModificationRate: model.decisionStyle.aiModificationRate,
      avgDecisionsPerDay: model.temporalPatterns.avgDecisionsPerDay,
      topPattern,
      dataPoints: model.dataPoints,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Core: compile recent distills
// ---------------------------------------------------------------------------

function compileRecentDistills(distillsDir: string, count: number): DistillExcerpt[] {
  if (!existsSync(distillsDir)) return [];

  const files = readdirSync(distillsDir)
    .filter((f) => f.endsWith(".md") && /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort()
    .reverse()
    .slice(0, count);

  const excerpts: DistillExcerpt[] = [];

  for (const file of files) {
    try {
      const date = file.replace(/\.md$/, "");
      const markdown = readFileSync(join(distillsDir, file), "utf-8");
      const summary = extractSummary(markdown);
      const decisionCount = countSection(markdown, "Decisions");
      const domains = extractDomains(markdown);

      excerpts.push({ date, summary, decisionCount, domains });
    } catch {
      // Skip malformed
    }
  }

  return excerpts;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Generate site data from .unfade/ directory. Returns the SiteData object. */
export function generateSiteData(cwd?: string): SiteData {
  const distillsDir = getDistillsDir(cwd);
  const profileDir = getProfileDir(cwd);

  return {
    generatedAt: new Date().toISOString(),
    heatmap: computeHeatmapData(distillsDir, 90),
    domains: extractDomainDistribution(profileDir),
    profile: extractProfileSummary(profileDir),
    distills: compileRecentDistills(distillsDir, 7),
  };
}

/** Generate and write data.json to the site directory. Returns the SiteData. */
export function writeSiteData(cwd?: string): SiteData {
  const siteDir = getSiteDir(cwd);
  mkdirSync(siteDir, { recursive: true });

  const data = generateSiteData(cwd);
  writeFileSync(join(siteDir, "data.json"), JSON.stringify(data, null, 2));

  return data;
}
