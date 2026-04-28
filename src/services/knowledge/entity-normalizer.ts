// FILE: src/services/knowledge/entity-normalizer.ts
// Layer 2.5 KE-9.1: Entity name normalization and alias detection.
// Pure functions — no I/O, no state. Used by entity-resolver (KE-10) and
// entity-writer (KE-9.2) to match extracted entities against the knowledge graph.
//
// Three capabilities:
//   1. Name normalization — canonical lowercase key for exact matching
//   2. Alias detection — heuristic check if two names refer to the same concept
//   3. Levenshtein distance — fuzzy matching for near-miss entity names

// ─── Known Abbreviation Map ────────────────────────────────────────────────
// Bidirectional lookup: abbreviation ↔ expansion. Used by isAlias() to catch
// common developer jargon that wouldn't be caught by containment or Levenshtein.

const KNOWN_ABBREVIATIONS: ReadonlyMap<string, string> = new Map([
  ["jwt", "json web token"],
  ["html", "hypertext markup language"],
  ["css", "cascading style sheets"],
  ["js", "javascript"],
  ["ts", "typescript"],
  ["db", "database"],
  ["api", "application programming interface"],
  ["ssr", "server side rendering"],
  ["ssg", "static site generation"],
  ["orm", "object relational mapping"],
  ["cli", "command line interface"],
  ["ui", "user interface"],
  ["ux", "user experience"],
  ["ci", "continuous integration"],
  ["cd", "continuous deployment"],
  ["k8s", "kubernetes"],
  ["ws", "websocket"],
  ["sse", "server sent events"],
  ["sql", "structured query language"],
  ["grpc", "remote procedure call"],
  ["dns", "domain name system"],
  ["cdn", "content delivery network"],
  ["sdk", "software development kit"],
  ["ide", "integrated development environment"],
  ["tls", "transport layer security"],
  ["ssl", "secure sockets layer"],
  ["http", "hypertext transfer protocol"],
  ["ftp", "file transfer protocol"],
  ["ssh", "secure shell"],
  ["gpu", "graphics processing unit"],
  ["cpu", "central processing unit"],
  ["sso", "single sign on"],
  ["rbac", "role based access control"],
  ["wasm", "webassembly"],
  ["pkg", "package"],
  ["env", "environment"],
  ["config", "configuration"],
  ["auth", "authentication"],
  ["repo", "repository"],
]);

const REVERSE_ABBREVIATIONS: ReadonlyMap<string, string> = new Map(
  Array.from(KNOWN_ABBREVIATIONS.entries()).map(([k, v]) => [v, k]),
);

// ─── Name Normalization ─────────────────────────────────────────────────────

/**
 * Normalize an entity name to a canonical lowercase matching key.
 *
 * Transformations:
 *   1. Trim leading/trailing whitespace
 *   2. Lowercase
 *   3. Strip trailing version numbers ("React 18" → "react", "Node.js 20.1.0" → "node.js")
 *   4. Collapse multiple spaces to single space
 *   5. Final trim (version stripping may leave trailing space)
 */
export function normalizeEntityName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+v?\d+(?:\.\d+)*\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Alias Detection ────────────────────────────────────────────────────────

/**
 * Check if two entity names could be aliases for the same concept.
 *
 * Returns true if any of these signals match (after normalization):
 *   1. Known abbreviation pair (JWT ↔ JSON Web Token)
 *   2. Word-boundary containment ("hooks" appears as a word in "react hooks")
 *   3. Levenshtein distance ≤ 2 (typos and minor variations)
 *
 * Returns false if the names normalize to the same string (same entity, not aliases).
 */
export function isAlias(name1: string, name2: string): boolean {
  const n1 = normalizeEntityName(name1);
  const n2 = normalizeEntityName(name2);

  if (n1 === n2) return false;
  if (!n1 || !n2) return false;

  // Signal 1: Known abbreviation map
  if (KNOWN_ABBREVIATIONS.get(n1) === n2 || KNOWN_ABBREVIATIONS.get(n2) === n1) return true;
  if (REVERSE_ABBREVIATIONS.get(n1) === n2 || REVERSE_ABBREVIATIONS.get(n2) === n1) return true;

  // Signal 2: Word-boundary containment (shorter name is a complete word in the longer)
  const [shorter, longer] = n1.length <= n2.length ? [n1, n2] : [n2, n1];
  if (shorter.length >= 3) {
    const words = longer.split(" ");
    if (words.includes(shorter)) return true;
  }

  // Signal 3: Levenshtein distance ≤ 2, with length-ratio guard to prevent
  // false positives on very short strings ("red" vs "redux" = distance 2, but 40% of max length)
  const distance = computeLevenshteinDistance(n1, n2);
  const maxLen = Math.max(n1.length, n2.length);
  if (distance <= 2 && maxLen >= 4 && distance / maxLen <= 0.3) return true;

  return false;
}

// ─── Levenshtein Distance ───────────────────────────────────────────────────

/**
 * Compute the Levenshtein edit distance between two strings.
 * Classic O(m×n) dynamic programming with O(min(m,n)) space optimization.
 * Operates on normalized (lowercased) strings — caller should normalize first
 * for case-insensitive comparison, or this function can be used directly for
 * raw comparison.
 */
export function computeLevenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Ensure a is the shorter string for O(min(m,n)) space
  if (a.length > b.length) {
    [a, b] = [b, a];
  }

  const m = a.length;
  const n = b.length;

  // Single row of the DP matrix, reused per iteration
  let prev = new Array<number>(m + 1);
  let curr = new Array<number>(m + 1);

  for (let i = 0; i <= m; i++) prev[i] = i;

  for (let j = 1; j <= n; j++) {
    curr[0] = j;
    for (let i = 1; i <= m; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[i] = Math.min(
        prev[i] + 1,       // deletion
        curr[i - 1] + 1,   // insertion
        prev[i - 1] + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[m];
}
