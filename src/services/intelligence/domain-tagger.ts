// FILE: src/services/intelligence/domain-tagger.ts
// UF-206: Keyword-based domain classifier for CaptureEvents.
// TF-IDF-style scoring against a curated domain→keyword map. No LLM.
// O(events × domains) — fast enough for multi-week corpora.

const DOMAIN_KEYWORDS: Record<string, string[]> = {
  api: [
    "endpoint",
    "route",
    "REST",
    "handler",
    "middleware",
    "controller",
    "request",
    "response",
    "API",
    "fetch",
    "axios",
    "HTTP",
    "status code",
    "GET",
    "POST",
    "PUT",
    "DELETE",
    "PATCH",
    "graphql",
    "resolver",
    "schema",
    "openapi",
    "swagger",
  ],
  auth: [
    "auth",
    "login",
    "logout",
    "session",
    "token",
    "JWT",
    "OAuth",
    "password",
    "credential",
    "permission",
    "role",
    "RBAC",
    "ACL",
    "signup",
    "register",
    "2FA",
    "MFA",
    "SSO",
    "SAML",
    "OIDC",
  ],
  database: [
    "database",
    "SQL",
    "query",
    "migration",
    "schema",
    "table",
    "index",
    "ORM",
    "Prisma",
    "Drizzle",
    "Sequelize",
    "TypeORM",
    "Knex",
    "PostgreSQL",
    "MySQL",
    "SQLite",
    "MongoDB",
    "Redis",
    "DynamoDB",
    "transaction",
    "JOIN",
    "SELECT",
    "INSERT",
    "UPDATE",
    "DELETE",
  ],
  css: [
    "style",
    "CSS",
    "flex",
    "grid",
    "margin",
    "padding",
    "color",
    "font",
    "layout",
    "responsive",
    "breakpoint",
    "animation",
    "transition",
    "Tailwind",
    "SCSS",
    "SASS",
    "styled-components",
    "theme",
    "dark mode",
    "className",
    "display",
    "position",
    "z-index",
  ],
  testing: [
    "test",
    "spec",
    "assert",
    "expect",
    "mock",
    "stub",
    "fixture",
    "Jest",
    "Vitest",
    "Mocha",
    "Cypress",
    "Playwright",
    "coverage",
    "describe",
    "it(",
    "beforeEach",
    "afterEach",
    "snapshot",
    "integration test",
    "unit test",
    "e2e",
  ],
  infra: [
    "Docker",
    "Kubernetes",
    "CI/CD",
    "pipeline",
    "deploy",
    "terraform",
    "AWS",
    "GCP",
    "Azure",
    "Vercel",
    "Netlify",
    "nginx",
    "Cloudflare",
    "container",
    "pod",
    "service mesh",
    "load balancer",
    "CDN",
    "GitHub Actions",
    "workflow",
    "build",
    "Dockerfile",
  ],
  error_handling: [
    "error",
    "exception",
    "catch",
    "try",
    "throw",
    "retry",
    "fallback",
    "timeout",
    "circuit breaker",
    "graceful",
    "logging",
    "stack trace",
    "debug",
    "crash",
    "panic",
  ],
  state: [
    "state",
    "store",
    "Redux",
    "Zustand",
    "context",
    "provider",
    "useReducer",
    "useState",
    "atom",
    "signal",
    "observable",
    "cache",
    "memoize",
    "hydrate",
    "persist",
  ],
  ui: [
    "component",
    "render",
    "React",
    "Vue",
    "Svelte",
    "Angular",
    "button",
    "modal",
    "form",
    "input",
    "dropdown",
    "table",
    "page",
    "layout",
    "navigation",
    "sidebar",
    "dashboard",
    "JSX",
    "TSX",
    "template",
    "slot",
  ],
  performance: [
    "performance",
    "optimize",
    "lazy",
    "bundle",
    "chunk",
    "tree-shake",
    "profiling",
    "memory",
    "latency",
    "throughput",
    "bottleneck",
    "debounce",
    "throttle",
    "memoization",
    "virtual",
  ],
};

const DOMAIN_NAMES = Object.keys(DOMAIN_KEYWORDS);

export interface DomainScore {
  domain: string;
  score: number;
  matchCount: number;
}

/**
 * Classify a text blob into zero or more domains with confidence scores.
 * Returns domains sorted by score descending. Only domains with score > 0 are included.
 */
export function classifyDomain(text: string): DomainScore[] {
  if (!text) return [];

  const lowerText = text.toLowerCase();
  const scores: DomainScore[] = [];

  for (const domain of DOMAIN_NAMES) {
    const keywords = DOMAIN_KEYWORDS[domain];
    let matchCount = 0;

    for (const kw of keywords) {
      const kwLower = kw.toLowerCase();
      let idx = lowerText.indexOf(kwLower);
      while (idx !== -1) {
        matchCount++;
        idx = lowerText.indexOf(kwLower, idx + kwLower.length);
      }
    }

    if (matchCount > 0) {
      const normalizedScore = Math.min(matchCount / Math.max(keywords.length * 0.3, 1), 1.0);
      scores.push({ domain, score: Math.round(normalizedScore * 1000) / 1000, matchCount });
    }
  }

  scores.sort((a, b) => b.score - a.score);
  return scores;
}

/**
 * Get the top domain for a text, or "general" if no domain matches.
 */
export function topDomain(text: string): string {
  const scores = classifyDomain(text);
  return scores.length > 0 ? scores[0].domain : "general";
}

/**
 * Batch-classify multiple text blobs and return aggregated domain frequencies.
 */
export function aggregateDomains(
  texts: string[],
): Array<{ domain: string; eventCount: number; totalScore: number }> {
  const domainMap = new Map<string, { eventCount: number; totalScore: number }>();

  for (const text of texts) {
    const top = classifyDomain(text);
    if (top.length === 0) continue;

    const best = top[0];
    const existing = domainMap.get(best.domain);
    if (existing) {
      existing.eventCount++;
      existing.totalScore += best.score;
    } else {
      domainMap.set(best.domain, { eventCount: 1, totalScore: best.score });
    }
  }

  return Array.from(domainMap.entries())
    .map(([domain, stats]) => ({ domain, ...stats }))
    .sort((a, b) => b.eventCount - a.eventCount);
}
