// FILE: src/services/intelligence/prompt-classifier.ts
// Zero-cost prompt type classification using structural analysis.
// No LLM calls — regex + heuristic + file-path resolution.
// Sprint 16J: softmax confidence, word-boundary enforcement, weighted scoring.

export type PromptType =
  | "discovery"
  | "building"
  | "debugging"
  | "refactoring"
  | "review"
  | "explaining"
  | "testing"
  | "configuring";

export type ExecutionPhase = "planning" | "implementing" | "debugging" | "reviewing" | "exploring";

export type ConstraintType = "none" | "soft" | "hard" | "mixed";

export interface PromptClassification {
  primaryType: PromptType;
  secondaryTypes: PromptType[];
  confidence: number;
  executionPhase: ExecutionPhase;
  structure: PromptStructure;
  specificity: number;
  targetedModules: string[];
  featureGroupId: string | null;
}

export interface PromptStructure {
  segmentTypes: PromptSegmentType[];
  decompositionDepth: number;
  referenceDensity: number;
  constraintType: ConstraintType;
  hasExpectedOutput: boolean;
}

export type PromptSegmentType =
  | "context"
  | "instruction"
  | "constraint"
  | "example"
  | "question"
  | "code";

export interface ClassifyContext {
  filesReferenced?: string[];
  filesModified?: string[];
  branch?: string;
  conversationTitle?: string;
  turnIndex?: number;
  totalTurns?: number;
}

// ---------------------------------------------------------------------------
// Signal patterns — all use \b word boundaries to prevent false positives
// ---------------------------------------------------------------------------

const DEBUGGING_VERBS =
  /\b(?:fix|debug|investigate|diagnose|troubleshoot|resolve|track\s+down|figure\s+out\s+why|find\s+the\s+bug|what(?:'?s)?\s+wrong|broken|failing|error|crash|exception|stack\s*trace)\b/i;
const BUILDING_VERBS =
  /\b(?:add|create|implement|build|make|write|generate|set\s+up|scaffold|new\s+feature|introduce)\b/i;
const DISCOVERY_VERBS =
  /\b(?:explain|what\s+does|how\s+does|why\s+does|what\s+is|show\s+me|walk\s+me\s+through|describe|understand|where\s+is|find|search|look\s+for)\b/i;
const REFACTORING_VERBS =
  /\b(?:refactor|rename|extract|restructure|reorganize|simplify|clean\s+up|decouple|split|move|consolidate)\b/i;
const TESTING_VERBS =
  /\b(?:test|write\s+tests|add\s+tests|unit\s+test|integration\s+test|coverage|spec|assert|expect|mock|stub|e2e)\b/i;
const REVIEW_VERBS =
  /\b(?:review|check|audit|evaluate|assess|best\s+practice|code\s+quality|lint|improve|optimize)\b/i;
const CONFIGURING_VERBS =
  /\b(?:configure|setup|config|deploy|ci\/cd|pipeline|docker|environment|env|install|package|dependency|build\s+config)\b/i;
const EXPLAINING_VERBS =
  /\b(?:document|comment|explain|annotate|readme|description|jsdoc|tsdoc|how\s+to\s+use)\b/i;

const QUESTION_PATTERN = /\?/g;
const FILE_PATH_PATTERN = /(?:^|\s)((?:\.{0,2}\/)?(?:[\w.-]+\/)+[\w.-]+\.\w+)/gm;
const FUNCTION_REF_PATTERN =
  /\b(?:function|class|interface|type|const|let|var|export|import)\s+(\w+)/g;
const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;
const LINE_NUMBER_PATTERN = /\bline\s+\d+\b/gi;
const ERROR_TRACE_PATTERN = /\b(?:Error|TypeError|ReferenceError|SyntaxError)\b|at\s+\w+\s*\(/i;

const CONSTRAINT_HARD = /\b(?:must|shall|require|never|always|exactly|only|do\s+not|don'?t)\b/i;
const CONSTRAINT_SOFT = /\b(?:should|prefer|ideally|try\s+to|consider|might\s+want|could)\b/i;
const EXAMPLE_PATTERN =
  /\b(?:example|for\s+instance|e\.g\.|such\s+as|like\s+this|expected\s+output|should\s+look\s+like|should\s+return)\b/i;

const BRANCH_PATTERNS: Record<string, PromptType> = {
  "fix/": "debugging",
  "bugfix/": "debugging",
  "hotfix/": "debugging",
  "feat/": "building",
  "feature/": "building",
  "refactor/": "refactoring",
  "test/": "testing",
  "chore/": "configuring",
  "ci/": "configuring",
  "docs/": "explaining",
};

// ---------------------------------------------------------------------------
// Softmax utility
// ---------------------------------------------------------------------------

function softmax(scores: Record<string, number>, temperature = 1.5): Record<string, number> {
  const entries = Object.entries(scores);
  const maxVal = Math.max(...entries.map(([, v]) => v));
  const exps = entries.map(([k, v]) => [k, Math.exp((v - maxVal) / temperature)] as const);
  const sumExp = exps.reduce((s, [, e]) => s + e, 0);
  const result: Record<string, number> = {};
  for (const [k, e] of exps) {
    result[k] = sumExp > 0 ? e / sumExp : 0;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Multi-match counting (counts how many patterns match, not just boolean)
// ---------------------------------------------------------------------------

function countMatches(text: string, pattern: RegExp): number {
  const global = new RegExp(pattern.source, "gi");
  let count = 0;
  while (global.exec(text) !== null) count++;
  return count;
}

// ---------------------------------------------------------------------------
// Main classifier
// ---------------------------------------------------------------------------

export function classifyPrompt(
  promptText: string,
  context: ClassifyContext = {},
): PromptClassification {
  if (!promptText || promptText.trim().length === 0) {
    return makeEmpty();
  }

  const text = promptText.trim();
  const rawScores = computeTypeScores(text, context);
  const probabilities = softmax(rawScores);
  const sorted = Object.entries(probabilities).sort(([, a], [, b]) => b - a) as Array<
    [PromptType, number]
  >;

  const primary = sorted[0][0];
  const primaryProb = sorted[0][1];

  const secondaryTypes = sorted
    .slice(1)
    .filter(([, p]) => p > 0.1 && p >= primaryProb * 0.3)
    .map(([t]) => t);

  const rawMax = Math.max(...Object.values(rawScores));
  const rawSpread = rawMax - sorted[sorted.length - 1][1];
  const confidence = Math.min(1, Math.max(0, primaryProb * (1 + rawSpread)));

  const structure = analyzeStructure(text);
  const specificity = computeSpecificity(text, context);
  const targetedModules = extractModules(text, context);
  const executionPhase = deriveExecutionPhase(primary, secondaryTypes, context);

  return {
    primaryType: primary,
    secondaryTypes,
    confidence: Math.round(confidence * 1000) / 1000,
    executionPhase,
    structure,
    specificity,
    targetedModules,
    featureGroupId: null,
  };
}

// ---------------------------------------------------------------------------
// Type scoring — weighted multi-signal with diminishing returns
// ---------------------------------------------------------------------------

interface SignalWeight {
  base: number;
  perMatch: number;
  cap: number;
}

const VERB_WEIGHT: SignalWeight = { base: 0.35, perMatch: 0.08, cap: 0.6 };
const CONTEXT_WEIGHT: SignalWeight = { base: 0.15, perMatch: 0, cap: 0.25 };
const STRUCTURAL_WEIGHT: SignalWeight = { base: 0.1, perMatch: 0.05, cap: 0.3 };

function addSignal(
  scores: Record<PromptType, number>,
  type: PromptType,
  weight: SignalWeight,
  matchCount: number,
): void {
  if (matchCount <= 0) return;
  const bonus =
    weight.base + Math.min(weight.perMatch * (matchCount - 1), weight.cap - weight.base);
  scores[type] = (scores[type] ?? 0) + Math.min(bonus, weight.cap);
}

function computeTypeScores(text: string, ctx: ClassifyContext): Record<PromptType, number> {
  const scores: Record<PromptType, number> = {
    discovery: 0,
    building: 0,
    debugging: 0,
    refactoring: 0,
    review: 0,
    explaining: 0,
    testing: 0,
    configuring: 0,
  };

  // Signal 1: Verb analysis with match counting (strongest signal)
  addSignal(scores, "debugging", VERB_WEIGHT, countMatches(text, DEBUGGING_VERBS));
  addSignal(scores, "building", VERB_WEIGHT, countMatches(text, BUILDING_VERBS));
  addSignal(scores, "discovery", VERB_WEIGHT, countMatches(text, DISCOVERY_VERBS));
  addSignal(scores, "refactoring", VERB_WEIGHT, countMatches(text, REFACTORING_VERBS));
  addSignal(scores, "testing", VERB_WEIGHT, countMatches(text, TESTING_VERBS));
  addSignal(scores, "review", VERB_WEIGHT, countMatches(text, REVIEW_VERBS));
  addSignal(scores, "configuring", VERB_WEIGHT, countMatches(text, CONFIGURING_VERBS));
  addSignal(scores, "explaining", VERB_WEIGHT, countMatches(text, EXPLAINING_VERBS));

  // Signal 2: Question density
  const sentences = text.split(/[.!?\n]/).filter((s) => s.trim().length > 0);
  const questionCount = (text.match(QUESTION_PATTERN) ?? []).length;
  const questionRatio = sentences.length > 0 ? questionCount / sentences.length : 0;
  if (questionRatio > 0.5) addSignal(scores, "discovery", CONTEXT_WEIGHT, 2);
  else if (questionRatio > 0.25) addSignal(scores, "discovery", CONTEXT_WEIGHT, 1);
  if (/\bcould\b.+\b(?:cause|be\s+the\s+reason|explain)\b/i.test(text)) {
    addSignal(scores, "debugging", CONTEXT_WEIGHT, 1);
  }

  // Signal 3: File-path specificity
  const hasLineNumbers = LINE_NUMBER_PATTERN.test(text);
  const filePaths = extractFilePaths(text);
  if (hasLineNumbers) {
    addSignal(scores, "debugging", STRUCTURAL_WEIGHT, 2);
    addSignal(scores, "refactoring", STRUCTURAL_WEIGHT, 1);
  }
  if (filePaths.length > 3) addSignal(scores, "building", STRUCTURAL_WEIGHT, 1);
  if (filePaths.length === 0 && questionRatio > 0.3)
    addSignal(scores, "discovery", STRUCTURAL_WEIGHT, 1);

  // Signal 4: Branch name context
  if (ctx.branch) {
    const branchLower = ctx.branch.toLowerCase();
    for (const [prefix, type] of Object.entries(BRANCH_PATTERNS)) {
      if (branchLower.startsWith(prefix) || branchLower.includes(`/${prefix}`)) {
        addSignal(scores, type, CONTEXT_WEIGHT, 1);
        break;
      }
    }
  }

  // Signal 5: Code block presence
  const codeBlocks = text.match(CODE_BLOCK_PATTERN) ?? [];
  if (codeBlocks.length > 0) {
    if (ERROR_TRACE_PATTERN.test(text)) addSignal(scores, "debugging", STRUCTURAL_WEIGHT, 2);
    else if (TESTING_VERBS.test(text)) addSignal(scores, "testing", STRUCTURAL_WEIGHT, 1);
    else addSignal(scores, "building", STRUCTURAL_WEIGHT, 1);
  }

  // Signal 6: Turn position heuristic
  if (ctx.turnIndex !== undefined && ctx.totalTurns !== undefined && ctx.totalTurns > 1) {
    const position = ctx.turnIndex / ctx.totalTurns;
    if (position < 0.2) scores.discovery += 0.08;
    if (position > 0.8) scores.review += 0.08;
  }

  // Ensure at least one type scores > 0 (prevents all-zero softmax)
  const maxScore = Math.max(...Object.values(scores));
  if (maxScore === 0) scores.discovery = 0.05;

  return scores;
}

// ---------------------------------------------------------------------------
// Structure analysis
// ---------------------------------------------------------------------------

function analyzeStructure(text: string): PromptStructure {
  const segments: PromptSegmentType[] = [];

  if (/^(?:context|background|current\s+state|situation)\b/im.test(text)) segments.push("context");
  if (BUILDING_VERBS.test(text) || DEBUGGING_VERBS.test(text)) segments.push("instruction");
  if (CONSTRAINT_HARD.test(text) || CONSTRAINT_SOFT.test(text)) segments.push("constraint");
  if (EXAMPLE_PATTERN.test(text)) segments.push("example");
  if (QUESTION_PATTERN.test(text)) segments.push("question");
  if (CODE_BLOCK_PATTERN.test(text)) segments.push("code");

  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const numberedSteps = lines.filter((l) => /^\s*\d+[.)]\s/.test(l)).length;
  const bulletPoints = lines.filter((l) => /^\s*[-*]\s/.test(l)).length;
  const decompositionDepth = Math.max(
    1,
    numberedSteps > 0 ? numberedSteps : bulletPoints > 2 ? 2 : 1,
  );

  const filePaths = extractFilePaths(text);
  const funcRefs = [...text.matchAll(FUNCTION_REF_PATTERN)].length;
  const codeBlockCount = (text.match(CODE_BLOCK_PATTERN) ?? []).length;
  const referenceDensity = filePaths.length + funcRefs + codeBlockCount;

  const hasHard = CONSTRAINT_HARD.test(text);
  const hasSoft = CONSTRAINT_SOFT.test(text);
  let constraintType: ConstraintType = "none";
  if (hasHard && hasSoft) constraintType = "mixed";
  else if (hasHard) constraintType = "hard";
  else if (hasSoft) constraintType = "soft";

  const hasExpectedOutput =
    EXAMPLE_PATTERN.test(text) || /\bshould\s+(?:return|output|produce|look\s+like)\b/i.test(text);

  return {
    segmentTypes: segments,
    decompositionDepth,
    referenceDensity,
    constraintType,
    hasExpectedOutput,
  };
}

// ---------------------------------------------------------------------------
// Specificity
// ---------------------------------------------------------------------------

function computeSpecificity(text: string, ctx: ClassifyContext): number {
  let score = 0;
  const maxScore = 8;

  const filePaths = extractFilePaths(text);
  if (filePaths.length > 0) score += 1;
  if (filePaths.length > 2) score += 0.5;

  if (LINE_NUMBER_PATTERN.test(text)) score += 1;

  const funcRefs = [...text.matchAll(FUNCTION_REF_PATTERN)].length;
  if (funcRefs > 0) score += 0.5;
  if (funcRefs > 3) score += 0.5;

  if (CONSTRAINT_HARD.test(text)) score += 1;
  if (EXAMPLE_PATTERN.test(text)) score += 0.5;

  if (text.length > 500) score += 0.5;
  if (text.length > 1000) score += 0.5;

  if ((ctx.filesReferenced?.length ?? 0) > 0) score += 0.5;
  if ((ctx.filesModified?.length ?? 0) > 0) score += 0.5;

  if (CODE_BLOCK_PATTERN.test(text)) score += 0.5;

  return Math.round(Math.min(1, score / maxScore) * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Module extraction
// ---------------------------------------------------------------------------

function extractModules(text: string, ctx: ClassifyContext): string[] {
  const modules = new Set<string>();

  const allFiles = [
    ...extractFilePaths(text),
    ...(ctx.filesReferenced ?? []),
    ...(ctx.filesModified ?? []),
  ];

  for (const fp of allFiles) {
    const parts = fp.split("/");
    if (parts.length >= 2) {
      const topLevel = parts.slice(0, Math.min(3, parts.length - 1)).join("/");
      modules.add(topLevel);
    }
  }

  return [...modules].slice(0, 10);
}

function extractFilePaths(text: string): string[] {
  const paths = new Set<string>();

  FILE_PATH_PATTERN.lastIndex = 0;
  for (let m = FILE_PATH_PATTERN.exec(text); m !== null; m = FILE_PATH_PATTERN.exec(text)) {
    const p = m[1].trim();
    if (p.includes(".") && !p.startsWith("http")) {
      paths.add(p);
    }
  }

  return [...paths];
}

// ---------------------------------------------------------------------------
// Execution phase derivation
// ---------------------------------------------------------------------------

function deriveExecutionPhase(
  primary: PromptType,
  secondary: PromptType[],
  _ctx: ClassifyContext,
): ExecutionPhase {
  switch (primary) {
    case "discovery":
    case "explaining":
      return "exploring";
    case "building":
    case "configuring":
      return "implementing";
    case "debugging":
      return "debugging";
    case "refactoring":
    case "review":
      return "reviewing";
    case "testing":
      return secondary.includes("review") ? "reviewing" : "implementing";
    default:
      return "exploring";
  }
}

function makeEmpty(): PromptClassification {
  return {
    primaryType: "discovery",
    secondaryTypes: [],
    confidence: 0,
    executionPhase: "exploring",
    structure: {
      segmentTypes: [],
      decompositionDepth: 1,
      referenceDensity: 0,
      constraintType: "none",
      hasExpectedOutput: false,
    },
    specificity: 0,
    targetedModules: [],
    featureGroupId: null,
  };
}

// ---------------------------------------------------------------------------
// Batch classification for materializer integration
// ---------------------------------------------------------------------------

export interface BatchClassificationResult {
  eventId: string;
  classification: PromptClassification;
}

export async function classifyUnclassifiedEvents(
  db: import("../cache/manager.js").DbLike,
  limit = 200,
): Promise<number> {
  try {
    const result = await db.exec(
      `SELECT id,
              COALESCE(metadata_extra->>'prompt_full', content_summary) as prompt_text,
              content_branch,
              conversation_title,
              files_referenced,
              files_modified
       FROM events
       WHERE prompt_type IS NULL
         AND source IN ('ai-session', 'mcp-active')
       ORDER BY ts DESC
       LIMIT $1`,
      [limit],
    );

    if (!result[0]?.values.length) return 0;

    let classified = 0;
    for (const row of result[0].values) {
      const eventId = row[0] as string;
      const promptText = (row[1] as string) ?? "";
      const branch = (row[2] as string) ?? undefined;
      const title = (row[3] as string) ?? undefined;
      const filesRef = Array.isArray(row[4]) ? (row[4] as string[]) : [];
      const filesMod = Array.isArray(row[5]) ? (row[5] as string[]) : [];

      if (!promptText) continue;

      const classification = classifyPrompt(promptText, {
        branch,
        conversationTitle: title,
        filesReferenced: filesRef,
        filesModified: filesMod,
      });

      db.run(
        `UPDATE events SET
           prompt_type = $1,
           execution_phase = $2,
           prompt_type_confidence = $3,
           prompt_specificity_v2 = $4,
           prompt_decomposition_depth = $5,
           prompt_reference_density = $6,
           prompt_constraint_type = $7,
           targeted_modules = $8,
           prompt_type_secondary = $9
         WHERE id = $10`,
        [
          classification.primaryType,
          classification.executionPhase,
          classification.confidence,
          classification.specificity,
          classification.structure.decompositionDepth,
          classification.structure.referenceDensity,
          classification.structure.constraintType,
          classification.targetedModules.join(",") || null,
          classification.secondaryTypes.join(",") || null,
          eventId,
        ],
      );
      classified++;
    }

    return classified;
  } catch {
    return 0;
  }
}
