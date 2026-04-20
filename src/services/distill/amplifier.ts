// FILE: src/services/distill/amplifier.ts
// UF-066 (v1) + UF-078 (v2): Amplifier — cross-temporal AND cross-domain
// connection detection. v1: Jaccard similarity with domain bonus.
// v2: Inverted index (decisions_index.json) + matching rules (≥2 signals, >0.3).
// Writes connections to amplification/connections.jsonl.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type {
  AmplificationConnection,
  AmplifyOutput,
  McpMeta,
  SimilarOutput,
  SimilarResultItem,
} from "../../schemas/mcp.js";
import type { ReasoningModelV2 } from "../../schemas/profile.js";
import {
  getAmplificationDir,
  getDistillsDir,
  getGraphDir,
  getProfileDir,
} from "../../utils/paths.js";
import { getFeedbackThreshold, readFeedback } from "../personalization/feedback.js";

const RELEVANCE_THRESHOLD = 0.7;
const DOMAIN_BONUS = 0.2;

interface ExtractedDecision {
  date: string;
  decision: string;
  rationale: string;
  domain?: string;
  alternativesConsidered?: number;
}

/**
 * Tokenize text into lowercase words, stripping punctuation.
 */
function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1),
  );
}

/**
 * Jaccard similarity between two token sets.
 */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Extract decisions from a distill markdown file content.
 * Looks for "## Decisions" section with "- **decision** [domain]" pattern.
 */
function extractDecisionsFromMarkdown(content: string, date: string): ExtractedDecision[] {
  const lines = content.split("\n");
  const decisions: ExtractedDecision[] = [];
  let inDecisions = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("## ")) {
      inDecisions = line.slice(3).trim().toLowerCase() === "decisions";
      continue;
    }

    if (inDecisions && line.startsWith("- **")) {
      const match = line.match(/^- \*\*(.+?)\*\*(?:\s*\[(.+?)\])?/);
      if (match) {
        let rationale = "";
        if (i + 1 < lines.length) {
          const rMatch = lines[i + 1].match(/^\s+_(.+)_$/);
          if (rMatch) rationale = rMatch[1];
        }
        decisions.push({
          date,
          decision: match[1],
          rationale,
          domain: match[2] || undefined,
        });
      }
    }
  }

  return decisions;
}

/**
 * Read all decisions from distill markdown files in the distills directory.
 */
function readAllDistillDecisions(distillsDir: string): ExtractedDecision[] {
  if (!existsSync(distillsDir)) return [];

  let files: string[];
  try {
    files = readdirSync(distillsDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));
  } catch {
    return [];
  }

  const all: ExtractedDecision[] = [];
  for (const file of files) {
    const date = file.replace(".md", "");
    try {
      const content = readFileSync(join(distillsDir, file), "utf-8");
      all.push(...extractDecisionsFromMarkdown(content, date));
    } catch {
      // skip unreadable files
    }
  }
  return all;
}

/**
 * Read decisions from graph/decisions.jsonl.
 */
function readGraphDecisions(graphDir: string): ExtractedDecision[] {
  const filePath = join(graphDir, "decisions.jsonl");
  if (!existsSync(filePath)) return [];

  try {
    const content = readFileSync(filePath, "utf-8");
    const decisions: ExtractedDecision[] = [];
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as ExtractedDecision;
        if (parsed.decision) decisions.push(parsed);
      } catch {
        // skip malformed lines
      }
    }
    return decisions;
  } catch {
    return [];
  }
}

/**
 * Get the most recent mtime from distills and graph files.
 */
function getLastUpdated(distillsDir: string, graphDir: string): string | null {
  const graphPath = join(graphDir, "decisions.jsonl");
  let latest: Date | null = null;

  if (existsSync(graphPath)) {
    try {
      latest = statSync(graphPath).mtime;
    } catch {}
  }

  if (existsSync(distillsDir)) {
    try {
      for (const f of readdirSync(distillsDir).filter((f) => f.endsWith(".md"))) {
        const mtime = statSync(join(distillsDir, f)).mtime;
        if (!latest || mtime > latest) latest = mtime;
      }
    } catch {}
  }

  return latest ? latest.toISOString() : null;
}

/**
 * Amplify — detect cross-temporal connections for a given date.
 * Reads target date's decisions, compares against ALL past distills.
 * Returns connections with relevance > 0.7, sorted by relevance descending.
 */
export function amplify(date: string, cwd?: string): AmplifyOutput {
  const start = performance.now();
  const distillsDir = getDistillsDir(cwd);
  const graphDir = getGraphDir(cwd);

  const connections: AmplificationConnection[] = [];

  // Read target date's decisions from distill markdown
  const targetFile = join(distillsDir, `${date}.md`);
  let todayDecisions: ExtractedDecision[] = [];
  if (existsSync(targetFile)) {
    try {
      const content = readFileSync(targetFile, "utf-8");
      todayDecisions = extractDecisionsFromMarkdown(content, date);
    } catch {
      // empty
    }
  }

  if (todayDecisions.length > 0) {
    // Gather ALL past decisions (from both sources, excluding target date)
    const distillDecisions = readAllDistillDecisions(distillsDir).filter((d) => d.date !== date);
    const graphDecs = readGraphDecisions(graphDir).filter((d) => d.date !== date);

    // Deduplicate: prefer graph entries, merge by decision text + date
    const seen = new Set<string>();
    const allPast: ExtractedDecision[] = [];
    for (const d of graphDecs) {
      const key = `${d.date}:${d.decision}`;
      if (!seen.has(key)) {
        seen.add(key);
        allPast.push(d);
      }
    }
    for (const d of distillDecisions) {
      const key = `${d.date}:${d.decision}`;
      if (!seen.has(key)) {
        seen.add(key);
        allPast.push(d);
      }
    }

    // Compare each today decision against all past decisions
    for (const today of todayDecisions) {
      const todayTokens = tokenize(today.decision);

      for (const past of allPast) {
        const pastTokens = tokenize(past.decision);
        let relevance = jaccard(todayTokens, pastTokens);

        // Domain match bonus
        if (
          today.domain &&
          past.domain &&
          today.domain.toLowerCase() === past.domain.toLowerCase()
        ) {
          relevance = Math.min(1, relevance + DOMAIN_BONUS);
        }

        if (relevance >= RELEVANCE_THRESHOLD) {
          connections.push({
            today: today.decision,
            past: { date: past.date, decision: past.decision },
            relevance: Math.round(relevance * 100) / 100,
          });
        }
      }
    }
  }

  // Sort by relevance descending
  connections.sort((a, b) => b.relevance - a.relevance);

  const lastUpdated = getLastUpdated(distillsDir, graphDir);
  const meta: McpMeta = {
    tool: "unfade-amplify",
    durationMs: Math.round(performance.now() - start),
    degraded: false,
    lastUpdated,
  };

  return { data: { connections, date }, _meta: meta };
}

// ---------------------------------------------------------------------------
// v2: Inverted Index + Cross-Domain Matching (UF-078)
// ---------------------------------------------------------------------------

/**
 * Inverted index for O(1) decision lookups by domain, keyword, and file.
 */
export interface DecisionsIndex {
  byDomain: Record<string, number[]>;
  byKeyword: Record<string, number[]>;
  byFile: Record<string, number[]>;
  totalDecisions: number;
  lastRebuilt: string;
}

/**
 * A v2 connection with match type and insight.
 */
export interface ConnectionV2 {
  date: string;
  today_decision: string;
  past_decision: string;
  past_date: string;
  match_type: string;
  match_score: number;
  insight: string;
}

/**
 * Extract keywords from a decision text — lowercase, >2 chars, no stopwords.
 */
const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "into",
  "over",
  "was",
  "were",
  "been",
  "have",
  "has",
  "had",
  "are",
  "but",
  "not",
  "all",
  "can",
  "will",
  "use",
  "used",
  "using",
  "chose",
  "added",
  "implemented",
  "selected",
  "decided",
  "based",
]);

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/**
 * Build the inverted index from all graph decisions.
 */
export function buildDecisionsIndex(decisions: ExtractedDecision[]): DecisionsIndex {
  const index: DecisionsIndex = {
    byDomain: {},
    byKeyword: {},
    byFile: {},
    totalDecisions: decisions.length,
    lastRebuilt: new Date().toISOString(),
  };

  for (let i = 0; i < decisions.length; i++) {
    const d = decisions[i];

    // Index by domain
    if (d.domain) {
      const dom = d.domain.toLowerCase();
      if (!index.byDomain[dom]) index.byDomain[dom] = [];
      index.byDomain[dom].push(i);
    }

    // Index by keyword
    const keywords = extractKeywords(`${d.decision} ${d.rationale}`);
    for (const kw of keywords) {
      if (!index.byKeyword[kw]) index.byKeyword[kw] = [];
      if (!index.byKeyword[kw].includes(i)) {
        index.byKeyword[kw].push(i);
      }
    }
  }

  return index;
}

/**
 * Rebuild the decisions index from graph/decisions.jsonl and write to disk.
 */
export function rebuildDecisionsIndex(cwd?: string): {
  index: DecisionsIndex;
  decisions: ExtractedDecision[];
} {
  const graphDir = getGraphDir(cwd);
  const decisions = readGraphDecisions(graphDir);
  const distillsDir = getDistillsDir(cwd);
  const distillDecisions = readAllDistillDecisions(distillsDir);

  // Merge — prefer graph entries
  const seen = new Set<string>();
  const all: ExtractedDecision[] = [];
  for (const d of decisions) {
    const key = `${d.date}:${d.decision}`;
    if (!seen.has(key)) {
      seen.add(key);
      all.push(d);
    }
  }
  for (const d of distillDecisions) {
    const key = `${d.date}:${d.decision}`;
    if (!seen.has(key)) {
      seen.add(key);
      all.push(d);
    }
  }

  const index = buildDecisionsIndex(all);

  // Write index to disk
  mkdirSync(graphDir, { recursive: true });
  const indexPath = join(graphDir, "decisions_index.json");
  const tmpPath = `${indexPath}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(index, null, 2)}\n`, "utf-8");
  renameSync(tmpPath, indexPath);

  return { index, decisions: all };
}

/**
 * Load the decisions index from disk. Returns null if not found.
 */
function _loadDecisionsIndex(cwd?: string): DecisionsIndex | null {
  const graphDir = getGraphDir(cwd);
  const indexPath = join(graphDir, "decisions_index.json");
  if (!existsSync(indexPath)) return null;

  try {
    return JSON.parse(readFileSync(indexPath, "utf-8")) as DecisionsIndex;
  } catch {
    return null;
  }
}

/**
 * Score a today decision against past decisions using the inverted index.
 * Matching rules from Phase 4 Boundary:
 * 1. Extract domain + keywords
 * 2. Lookup: intersect(byDomain[domain], byKeyword[kw1] ∪ byKeyword[kw2])
 * 3. Require ≥2 matching signals (domain + keyword, or keyword + file)
 * 4. Score: matching signals / total possible signals
 * 5. Surface only connections with score > threshold
 */
function matchWithIndex(
  today: ExtractedDecision,
  index: DecisionsIndex,
  allDecisions: ExtractedDecision[],
  threshold: number,
): ConnectionV2[] {
  const todayKeywords = extractKeywords(`${today.decision} ${today.rationale}`);
  const todayDomain = today.domain?.toLowerCase();

  // Collect candidate indices from domain + keyword lookups
  const candidateSignals = new Map<number, Set<string>>();

  // Domain signal
  if (todayDomain && index.byDomain[todayDomain]) {
    for (const idx of index.byDomain[todayDomain]) {
      if (!candidateSignals.has(idx)) candidateSignals.set(idx, new Set());
      candidateSignals.get(idx)?.add("domain");
    }
  }

  // Keyword signals
  for (const kw of todayKeywords) {
    if (index.byKeyword[kw]) {
      for (const idx of index.byKeyword[kw]) {
        if (!candidateSignals.has(idx)) candidateSignals.set(idx, new Set());
        candidateSignals.get(idx)?.add(`keyword:${kw}`);
      }
    }
  }

  const connections: ConnectionV2[] = [];
  // Total possible signals = 1 (domain) + number of unique keywords
  const totalPossible = (todayDomain ? 1 : 0) + todayKeywords.length;
  if (totalPossible === 0) return connections;

  for (const [idx, signals] of candidateSignals) {
    if (idx >= allDecisions.length) continue;
    const past = allDecisions[idx];

    // Skip same-date decisions
    if (past.date === today.date) continue;

    // Require ≥2 matching signals
    if (signals.size < 2) continue;

    const score = signals.size / totalPossible;
    if (score <= threshold) continue;

    // Determine match type
    const hasDomain = signals.has("domain");
    const hasKeyword = Array.from(signals).some((s) => s.startsWith("keyword:"));
    let matchType = "keyword";
    if (hasDomain && hasKeyword) matchType = "domain+keyword";
    else if (hasDomain) matchType = "domain";

    // Build insight
    const matchingKeywords = Array.from(signals)
      .filter((s) => s.startsWith("keyword:"))
      .map((s) => s.slice(8));
    const insight = hasDomain
      ? `Both in ${todayDomain} domain, sharing keywords: ${matchingKeywords.slice(0, 3).join(", ")}`
      : `Matching keywords: ${matchingKeywords.slice(0, 3).join(", ")}`;

    connections.push({
      date: today.date,
      today_decision: today.decision,
      past_decision: past.decision,
      past_date: past.date,
      match_type: matchType,
      match_score: Math.round(score * 100) / 100,
      insight,
    });
  }

  return connections.sort((a, b) => b.match_score - a.match_score);
}

/**
 * Amplify v2 — cross-temporal AND cross-domain connection surfacing.
 * Uses inverted index for efficient matching. Rebuilds index if needed.
 * Writes connections to amplification/connections.jsonl.
 */
export function amplifyV2(
  date: string,
  cwd?: string,
): { connections: ConnectionV2[]; connectionsSection: string } {
  // Read today's decisions
  const distillsDir = getDistillsDir(cwd);
  const targetFile = join(distillsDir, `${date}.md`);
  let todayDecisions: ExtractedDecision[] = [];
  if (existsSync(targetFile)) {
    try {
      const content = readFileSync(targetFile, "utf-8");
      todayDecisions = extractDecisionsFromMarkdown(content, date);
    } catch {
      // empty
    }
  }

  if (todayDecisions.length === 0) {
    return { connections: [], connectionsSection: "" };
  }

  // Rebuild index (ensures fresh data)
  const { index, decisions: allDecisions } = rebuildDecisionsIndex(cwd);

  // Read feedback for threshold adjustment
  const feedback = readFeedback(cwd);

  // Match each today decision against the index
  const allConnections: ConnectionV2[] = [];
  for (const today of todayDecisions) {
    const domain = today.domain?.toLowerCase();
    const threshold = getFeedbackThreshold(feedback, domain);
    const matches = matchWithIndex(today, index, allDecisions, threshold);
    allConnections.push(...matches);
  }

  // Sort by score descending, limit to top 5
  allConnections.sort((a, b) => b.match_score - a.match_score);
  const topConnections = allConnections.slice(0, 5);

  // Write to connections.jsonl
  if (topConnections.length > 0) {
    const ampDir = getAmplificationDir(cwd);
    mkdirSync(ampDir, { recursive: true });
    const lines = topConnections.map((c) => JSON.stringify(c)).join("\n");
    appendFileSync(join(ampDir, "connections.jsonl"), `${lines}\n`, "utf-8");
  }

  // Format CONNECTIONS section
  let connectionsSection = "";
  if (topConnections.length > 0) {
    const sectionLines = ["## Connections", ""];
    for (const c of topConnections) {
      sectionLines.push(`- **${c.today_decision}** ↔ **${c.past_decision}** (${c.past_date})`);
      sectionLines.push(`  Match: ${c.match_type} (score: ${c.match_score}) — ${c.insight}`);
    }
    sectionLines.push("");
    connectionsSection = sectionLines.join("\n");
  }

  return { connections: topConnections, connectionsSection };
}

// ---------------------------------------------------------------------------
// Personalization-weighted search (UF-076)
// ---------------------------------------------------------------------------

/**
 * Load v2 reasoning profile from disk for search personalization.
 * Returns null if not v2 or missing — search degrades to keyword-only.
 */
function loadProfileForSearch(cwd?: string): ReasoningModelV2 | null {
  const profilePath = join(getProfileDir(cwd), "reasoning_model.json");
  if (!existsSync(profilePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(profilePath, "utf-8"));
    if (parsed.version === 2 && parsed.dataPoints >= 2) return parsed as ReasoningModelV2;
    return null;
  } catch {
    return null;
  }
}

/**
 * Compute domain match score between a query and a decision's domain.
 * Uses the profile's domain distribution to weight matches:
 * exact match → 1.0, related domain → partial score based on profile frequency.
 */
function domainMatchScore(
  queryTokens: Set<string>,
  decision: ExtractedDecision,
  profile: ReasoningModelV2 | null,
): number {
  if (!decision.domain) return 0;
  const domainLower = decision.domain.toLowerCase();

  // Direct: query mentions the domain
  if (queryTokens.has(domainLower)) return 1.0;

  // Profile-weighted: if user works in this domain, boost it
  if (profile) {
    const domainEntry = profile.domainDistribution.find(
      (d) => d.domain.toLowerCase() === domainLower,
    );
    if (domainEntry) {
      // Higher frequency in profile → higher implicit relevance
      return domainEntry.percentageOfTotal * 0.5;
    }
  }

  return 0;
}

/**
 * Compute style match: how well the decision's characteristics match
 * the user's typical decision style from their profile.
 */
function styleMatchScore(decision: ExtractedDecision, profile: ReasoningModelV2 | null): number {
  if (!profile) return 0;

  // Decisions with alternatives count similar to user's average are more relevant
  if (decision.alternativesConsidered != null && decision.alternativesConsidered > 0) {
    const userAvg = profile.decisionStyle.avgAlternativesEvaluated;
    if (userAvg > 0) {
      const ratio =
        Math.min(decision.alternativesConsidered, userAvg) /
        Math.max(decision.alternativesConsidered, userAvg);
      return ratio; // 0-1, higher when similar
    }
  }

  return 0;
}

/**
 * Compute trade-off match: does the decision relate to user's known trade-off preferences?
 */
function tradeOffMatchScore(
  queryTokens: Set<string>,
  decision: ExtractedDecision,
  profile: ReasoningModelV2 | null,
): number {
  if (!profile || profile.tradeOffPreferences.length === 0) return 0;

  const decisionText = `${decision.decision} ${decision.rationale}`.toLowerCase();

  for (const pref of profile.tradeOffPreferences) {
    const prefTokens = tokenize(pref.preference);
    let matches = 0;
    for (const t of prefTokens) {
      if (queryTokens.has(t) || decisionText.includes(t)) matches++;
    }
    if (prefTokens.size > 0 && matches / prefTokens.size > 0.3) {
      return pref.confidence;
    }
  }

  return 0;
}

/**
 * Find similar past decisions matching a problem description.
 * Searches BOTH graph/decisions.jsonl AND distill markdown files.
 * UF-076: Personalization-weighted scoring when profile available:
 *   score = keyword_match * 0.4 + domain_match * 0.3 + style_match * 0.2 + tradeoff_match * 0.1
 * Falls back to pure keyword matching when no profile exists.
 */
export function findSimilar(problem: string, limit: number, cwd?: string): SimilarOutput {
  const start = performance.now();
  const distillsDir = getDistillsDir(cwd);
  const graphDir = getGraphDir(cwd);

  const problemTokens = tokenize(problem);
  const profile = loadProfileForSearch(cwd);

  // Gather all decisions from both sources
  const distillDecisions = readAllDistillDecisions(distillsDir);
  const graphDecs = readGraphDecisions(graphDir);

  // Deduplicate: prefer graph entries
  const seen = new Set<string>();
  const allDecisions: ExtractedDecision[] = [];
  for (const d of graphDecs) {
    const key = `${d.date}:${d.decision}`;
    if (!seen.has(key)) {
      seen.add(key);
      allDecisions.push(d);
    }
  }
  for (const d of distillDecisions) {
    const key = `${d.date}:${d.decision}`;
    if (!seen.has(key)) {
      seen.add(key);
      allDecisions.push(d);
    }
  }

  // Score each decision against the problem description
  const scored: SimilarResultItem[] = [];
  for (const d of allDecisions) {
    const decisionTokens = tokenize(`${d.decision} ${d.rationale}`);
    const keywordScore = jaccard(problemTokens, decisionTokens);

    let relevance: number;
    if (profile) {
      // Personalization-weighted scoring
      const domain = domainMatchScore(problemTokens, d, profile);
      const style = styleMatchScore(d, profile);
      const tradeOff = tradeOffMatchScore(problemTokens, d, profile);
      relevance = keywordScore * 0.4 + domain * 0.3 + style * 0.2 + tradeOff * 0.1;
    } else {
      // Fallback: pure keyword matching
      relevance = keywordScore;
    }

    if (relevance > 0) {
      scored.push({
        date: d.date,
        decision: d.decision,
        rationale: d.rationale,
        domain: d.domain,
        alternativesConsidered: d.alternativesConsidered,
        relevance: Math.round(relevance * 100) / 100,
      });
    }
  }

  // Sort by relevance descending
  scored.sort((a, b) => b.relevance - a.relevance);

  const total = scored.length;
  const results = scored.slice(0, limit);

  const lastUpdated = getLastUpdated(distillsDir, graphDir);
  const personalizationLevel = profile ? "personalized" : "keyword-only";
  const meta: McpMeta = {
    tool: "unfade-similar",
    durationMs: Math.round(performance.now() - start),
    degraded: false,
    lastUpdated,
    personalizationLevel,
  };

  return { data: { results, total }, _meta: meta };
}
