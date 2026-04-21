// FILE: src/services/actions/rule-formatter.ts
// 12B.3: Rule formatter — converts prompt-patterns.json insights into tool-specific rule text.

export interface PatternRule {
  pattern: string;
  confidence: number;
  occurrences: number;
  domain?: string;
}

export type RuleTarget = "cursor" | "claude" | "copilot";

/**
 * Format rules for Cursor (.cursor/rules/unfade.mdc)
 * Uses MDC frontmatter format.
 */
function formatCursorMdc(rules: PatternRule[], date: string): string {
  const lines = [
    "---",
    "description: Auto-generated rules from Unfade pattern analysis",
    `alwaysApply: true`,
    "---",
    "",
    `# Patterns observed by Unfade (${date})`,
    "",
  ];

  for (const rule of rules) {
    lines.push(
      `- ${rule.pattern} (confidence: ${Math.round(rule.confidence * 100)}%, seen ${rule.occurrences}×)`,
    );
  }

  return lines.join("\n");
}

/**
 * Format rules for Claude Code (CLAUDE.md section)
 * Uses markdown with ## header.
 */
function formatClaudeMd(rules: PatternRule[], date: string): string {
  const lines = [`## Patterns observed by Unfade (${date})`, ""];

  for (const rule of rules) {
    lines.push(
      `- ${rule.pattern} (accepted ${rule.occurrences}× with ${Math.round(rule.confidence * 100)}% confidence)`,
    );
  }

  return lines.join("\n");
}

/**
 * Format rules for GitHub Copilot (.github/copilot-instructions.md)
 * Uses plain markdown.
 */
function formatCopilotMd(rules: PatternRule[], date: string): string {
  const lines = [`# Unfade-observed patterns (${date})`, ""];

  for (const rule of rules) {
    lines.push(`- ${rule.pattern}`);
  }

  return lines.join("\n");
}

/**
 * Format rules for the appropriate target tool.
 */
export function formatRules(target: RuleTarget, rules: PatternRule[], date: string): string {
  switch (target) {
    case "cursor":
      return formatCursorMdc(rules, date);
    case "claude":
      return formatClaudeMd(rules, date);
    case "copilot":
      return formatCopilotMd(rules, date);
  }
}

/**
 * Extract high-confidence patterns from prompt-patterns.json data.
 * Only returns patterns with confidence >= 0.7 and occurrences >= 3.
 */
export function extractHighConfidencePatterns(data: Record<string, unknown>): PatternRule[] {
  const patterns = (data.patterns ?? data.effective_patterns ?? []) as Array<
    Record<string, unknown>
  >;
  const rules: PatternRule[] = [];

  for (const p of patterns) {
    const confidence = (p.confidence ?? p.score ?? 0) as number;
    const occurrences = (p.occurrences ?? p.count ?? 0) as number;
    const pattern = (p.pattern ?? p.description ?? p.label ?? "") as string;

    if (confidence >= 0.7 && occurrences >= 3 && pattern) {
      rules.push({ pattern, confidence, occurrences, domain: p.domain as string | undefined });
    }
  }

  return rules;
}
