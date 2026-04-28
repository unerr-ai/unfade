// FILE: src/services/workers/cpu-worker.ts
// Worker thread for CPU-heavy intelligence computations.
// Receives pre-fetched data, performs compute, returns results.
// No database access — keeps SQLite connections out of this worker.

// ---------------------------------------------------------------------------
// Task interface
// ---------------------------------------------------------------------------

export interface CpuTask {
  type: "cosineSimilarity" | "velocityClassify";
  payload: unknown;
}

// ---------------------------------------------------------------------------
// Cosine similarity — used by loop-detector
// ---------------------------------------------------------------------------

interface CosineSimilarityPayload {
  entries: Array<{
    summary: string;
    domain: string;
    approach: string;
    eventId: string;
    date: string;
    contentHash: string;
    resolution: string | null;
  }>;
  threshold: number;
  minClusterSize: number;
}

interface StuckLoopResult {
  domain: string;
  approach: string;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  resolution: string | null;
}

function computeCosineClusters(payload: CosineSimilarityPayload): StuckLoopResult[] {
  const { entries, threshold, minClusterSize } = payload;

  // Group by domain::approach
  const approachGroups = new Map<string, typeof entries>();
  for (const entry of entries) {
    const key = `${entry.domain}::${entry.approach}`;
    const group = approachGroups.get(key) ?? [];
    group.push(entry);
    approachGroups.set(key, group);
  }

  const loops: StuckLoopResult[] = [];

  for (const [, group] of approachGroups) {
    if (group.length < minClusterSize) continue;

    const similar = findSimilarCluster(group, threshold);
    if (similar.length >= minClusterSize) {
      const dates = similar.map((e) => e.date).sort();
      loops.push({
        domain: similar[0].domain,
        approach: similar[0].approach,
        occurrences: similar.length,
        firstSeen: dates[0],
        lastSeen: dates[dates.length - 1],
        resolution: null,
      });
    }
  }

  return loops.sort((a, b) => b.occurrences - a.occurrences);
}

function findSimilarCluster(
  entries: CosineSimilarityPayload["entries"],
  threshold: number,
): CosineSimilarityPayload["entries"] {
  if (entries.length < 2) return entries;

  const clusters: (typeof entries)[] = [];
  const visited = new Set<number>();

  for (let i = 0; i < entries.length; i++) {
    if (visited.has(i)) continue;
    const cluster = [entries[i]];
    visited.add(i);

    for (let j = i + 1; j < entries.length; j++) {
      if (visited.has(j)) continue;
      const sim = cosineSimilarity(entries[i].summary, entries[j].summary);
      if (sim >= threshold) {
        cluster.push(entries[j]);
        visited.add(j);
      }
    }

    clusters.push(cluster);
  }

  return clusters.reduce((max, c) => (c.length > max.length ? c : max), []);
}

// Inline cosine similarity (avoids importing from main thread modules)
function cosineSimilarity(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);

  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const vocab = new Set([...tokensA, ...tokensB]);
  const vecA = new Float64Array(vocab.size);
  const vecB = new Float64Array(vocab.size);

  let i = 0;
  for (const word of vocab) {
    vecA[i] = countOccurrences(tokensA, word);
    vecB[i] = countOccurrences(tokensB, word);
    i++;
  }

  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let k = 0; k < vocab.size; k++) {
    dot += vecA[k] * vecB[k];
    magA += vecA[k] * vecA[k];
    magB += vecB[k] * vecB[k];
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function countOccurrences(tokens: string[], word: string): number {
  let count = 0;
  for (const t of tokens) {
    if (t === word) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Velocity classification — used by velocity-tracker
// ---------------------------------------------------------------------------

interface VelocityClassifyPayload {
  rows: Array<{
    contentSummary: string;
    turns: number;
    date: string;
  }>;
}

interface VelocityClassifyResult {
  domainWeeklyAverages: Record<string, number[]>;
}

function classifyVelocityRows(payload: VelocityClassifyPayload): VelocityClassifyResult {
  const domainWeeks = new Map<string, Map<string, number[]>>();

  for (const row of payload.rows) {
    if (row.turns <= 0 || !row.date) continue;

    const domain = classifyDomainFast(row.contentSummary);
    const weekKey = getWeekKey(row.date);

    if (!domainWeeks.has(domain)) domainWeeks.set(domain, new Map());
    const weeks = domainWeeks.get(domain)!;
    if (!weeks.has(weekKey)) weeks.set(weekKey, []);
    weeks.get(weekKey)?.push(row.turns);
  }

  const output: Record<string, number[]> = {};
  for (const [domain, weeks] of domainWeeks) {
    const weeklyAverages: number[] = [];
    const sortedWeeks = [...weeks.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [, turns] of sortedWeeks) {
      weeklyAverages.push(mean(turns));
    }
    if (weeklyAverages.length >= 2) {
      output[domain] = weeklyAverages;
    }
  }

  return { domainWeeklyAverages: output };
}

// Inline domain classifier (avoids importing from main thread modules)
function classifyDomainFast(text: string): string {
  if (!text) return "general";
  const lower = text.toLowerCase();
  if (/\b(test|spec|jest|vitest|mocha|cypress)\b/.test(lower)) return "testing";
  if (/\b(api|endpoint|rest|graphql|grpc)\b/.test(lower)) return "api";
  if (/\b(ui|component|react|vue|angular|css|style)\b/.test(lower)) return "frontend";
  if (/\b(db|database|sql|migration|schema|query)\b/.test(lower)) return "data";
  if (/\b(deploy|ci|cd|pipeline|docker|k8s)\b/.test(lower)) return "devops";
  if (/\b(auth|login|session|jwt|oauth)\b/.test(lower)) return "auth";
  if (/\b(config|setup|init|scaffold)\b/.test(lower)) return "config";
  if (/\b(refactor|rename|cleanup|debt)\b/.test(lower)) return "refactoring";
  if (/\b(bug|fix|patch|hotfix|issue)\b/.test(lower)) return "bugfix";
  if (/\b(doc|readme|comment|jsdoc)\b/.test(lower)) return "docs";
  if (/\b(perf|optim|cache|speed|latency)\b/.test(lower)) return "performance";
  return "general";
}

function getWeekKey(date: string): string {
  const d = new Date(date);
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNum = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + yearStart.getDay() + 1) / 7,
  );
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export default function handler(task: CpuTask): unknown {
  switch (task.type) {
    case "cosineSimilarity":
      return computeCosineClusters(task.payload as CosineSimilarityPayload);
    case "velocityClassify":
      return classifyVelocityRows(task.payload as VelocityClassifyPayload);
    default:
      throw new Error(`Unknown CPU task type: ${task.type}`);
  }
}
