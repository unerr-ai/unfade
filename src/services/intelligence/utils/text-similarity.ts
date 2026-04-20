// FILE: src/services/intelligence/utils/text-similarity.ts
// UF-106/107: Lightweight text similarity for prompt pattern matching and loop detection.
// Cosine similarity over term frequency vectors. No external deps.

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function termFrequency(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const token of tokens) {
    freq.set(token, (freq.get(token) ?? 0) + 1);
  }
  return freq;
}

/**
 * Cosine similarity between two text strings (0-1).
 * Uses term frequency vectors. No IDF — lightweight and fast.
 */
export function cosineSimilarity(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const freqA = termFrequency(tokensA);
  const freqB = termFrequency(tokensB);

  let dotProduct = 0;
  let magA = 0;
  let magB = 0;

  for (const [term, countA] of freqA) {
    magA += countA * countA;
    const countB = freqB.get(term) ?? 0;
    dotProduct += countA * countB;
  }

  for (const [, countB] of freqB) {
    magB += countB * countB;
  }

  const magnitude = Math.sqrt(magA) * Math.sqrt(magB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

/**
 * Content hash for deduplication — fast, deterministic.
 */
export function contentHash(text: string): string {
  const tokens = tokenize(text).sort().join(" ");
  let hash = 0;
  for (let i = 0; i < tokens.length; i++) {
    const char = tokens.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash).toString(36);
}
