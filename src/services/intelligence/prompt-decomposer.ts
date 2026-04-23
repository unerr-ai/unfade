// FILE: src/services/intelligence/prompt-decomposer.ts
// Deep structural decomposition of prompts into semantic segments.
// Goes beyond the classifier's `analyzeStructure()` to produce a full
// parse tree of a prompt: context blocks, instruction blocks, constraint
// blocks, code blocks, question blocks — each with metadata about
// specificity, file references, and implied intent.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SegmentKind =
  | "context"
  | "instruction"
  | "constraint"
  | "example"
  | "question"
  | "code"
  | "reference"
  | "rationale"
  | "output-spec";

export interface PromptSegment {
  kind: SegmentKind;
  text: string;
  startLine: number;
  endLine: number;
  metadata: SegmentMetadata;
}

export interface SegmentMetadata {
  filePaths: string[];
  functionNames: string[];
  constraintStrength: "none" | "soft" | "hard";
  specificity: number;
  wordCount: number;
  hasCodeBlock: boolean;
  language: string | null;
}

export interface PromptDecomposition {
  segments: PromptSegment[];
  stats: DecompositionStats;
  quality: PromptQualitySignals;
}

export interface DecompositionStats {
  totalSegments: number;
  segmentsByKind: Record<string, number>;
  totalLines: number;
  totalWords: number;
  codeToProseRatio: number;
  constraintDensity: number;
  referenceDensity: number;
}

export interface PromptQualitySignals {
  hasContext: boolean;
  hasExplicitConstraints: boolean;
  hasExpectedOutput: boolean;
  hasExamples: boolean;
  hasFileReferences: boolean;
  decompositionDepth: number;
  specificityScore: number;
  structureScore: number;
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

const CODE_FENCE = /^```(\w*)\s*$/;
const CODE_FENCE_END = /^```\s*$/;
const NUMBERED_STEP = /^\s*\d+[.)]\s/;
const BULLET_POINT = /^\s*[-*•]\s/;
const QUESTION_LINE = /\?\s*$/;
const FILE_PATH = /(?:^|\s)((?:\.{0,2}\/)?(?:[\w.-]+\/)+[\w.-]+\.\w+)/g;
const FUNCTION_REF = /\b(?:function|class|interface|type|const|let|var|def|fn)\s+(\w+)/g;
const IMPORT_REF = /(?:import|require|from)\s+['"]([^'"]+)['"]/g;

const CONTEXT_SIGNALS =
  /^(?:context|background|current state|situation|currently|right now|the project|we have|there is)/i;
const CONSTRAINT_HARD =
  /\b(?:must|shall|require|never|always|exactly|only|do not|don't|cannot|forbidden)\b/i;
const CONSTRAINT_SOFT = /\b(?:should|prefer|ideally|try to|consider|might want|could|recommend)\b/i;
const RATIONALE_SIGNALS =
  /\b(?:because|since|the reason|this is important|the goal|we need this|so that|in order to)\b/i;
const OUTPUT_SPEC_SIGNALS =
  /\b(?:output|return|produce|generate|create|result should|format as|respond with|give me)\b/i;
const EXAMPLE_SIGNALS =
  /\b(?:example|for instance|e\.g\.|such as|like this|here's what|sample|demo)\b/i;
const INSTRUCTION_SIGNALS =
  /\b(?:add|create|implement|build|fix|debug|refactor|update|write|modify|change|remove|delete|move|rename)\b/i;

// ---------------------------------------------------------------------------
// Main decomposer
// ---------------------------------------------------------------------------

export function decomposePrompt(text: string): PromptDecomposition {
  if (!text || text.trim().length === 0) {
    return {
      segments: [],
      stats: emptyStats(),
      quality: emptyQuality(),
    };
  }

  const lines = text.split("\n");
  const rawSegments = splitIntoRawSegments(lines);
  const segments = rawSegments.map((raw) => classifySegment(raw));
  const stats = computeStats(segments, lines);
  const quality = computeQuality(segments, stats);

  return { segments, stats, quality };
}

// ---------------------------------------------------------------------------
// Segmentation (split lines into logical blocks)
// ---------------------------------------------------------------------------

interface RawSegment {
  lines: string[];
  startLine: number;
  endLine: number;
  isCode: boolean;
  codeLanguage: string | null;
}

function splitIntoRawSegments(lines: string[]): RawSegment[] {
  const segments: RawSegment[] = [];
  let current: string[] = [];
  let currentStart = 0;
  let inCode = false;
  let codeLang: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inCode) {
      const fenceMatch = line.match(CODE_FENCE);
      if (fenceMatch) {
        if (current.length > 0) {
          segments.push({
            lines: current,
            startLine: currentStart,
            endLine: i - 1,
            isCode: false,
            codeLanguage: null,
          });
        }
        current = [line];
        currentStart = i;
        inCode = true;
        codeLang = fenceMatch[1] || null;
        continue;
      }
    } else {
      current.push(line);
      if (CODE_FENCE_END.test(line) && current.length > 1) {
        segments.push({
          lines: current,
          startLine: currentStart,
          endLine: i,
          isCode: true,
          codeLanguage: codeLang,
        });
        current = [];
        currentStart = i + 1;
        inCode = false;
        codeLang = null;
        continue;
      }
      continue;
    }

    if (line.trim() === "" && current.length > 0) {
      const prevNonEmpty = current.some((l) => l.trim().length > 0);
      if (prevNonEmpty) {
        segments.push({
          lines: current,
          startLine: currentStart,
          endLine: i - 1,
          isCode: false,
          codeLanguage: null,
        });
        current = [];
        currentStart = i + 1;
        continue;
      }
    }

    current.push(line);
  }

  if (current.length > 0 && current.some((l) => l.trim().length > 0)) {
    segments.push({
      lines: current,
      startLine: currentStart,
      endLine: lines.length - 1,
      isCode: inCode,
      codeLanguage: codeLang,
    });
  }

  return segments;
}

// ---------------------------------------------------------------------------
// Segment classification
// ---------------------------------------------------------------------------

function classifySegment(raw: RawSegment): PromptSegment {
  const text = raw.lines.join("\n");
  const trimmed = text.trim();

  if (raw.isCode) {
    return makeSegment("code", text, raw, {
      hasCodeBlock: true,
      language: raw.codeLanguage,
    });
  }

  const kind = inferKind(trimmed);
  const filePaths = extractFilePaths(trimmed);
  const functionNames = extractFunctionNames(trimmed);
  const constraintStrength = detectConstraintStrength(trimmed);
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  const specificity = computeSegmentSpecificity(
    trimmed,
    filePaths,
    functionNames,
    constraintStrength,
  );

  return {
    kind,
    text,
    startLine: raw.startLine,
    endLine: raw.endLine,
    metadata: {
      filePaths,
      functionNames,
      constraintStrength,
      specificity,
      wordCount,
      hasCodeBlock: false,
      language: null,
    },
  };
}

function inferKind(text: string): SegmentKind {
  const lower = text.toLowerCase();
  const firstLine = text.split("\n")[0] ?? "";

  if (CONTEXT_SIGNALS.test(firstLine)) return "context";
  if (EXAMPLE_SIGNALS.test(firstLine)) return "example";
  if (OUTPUT_SPEC_SIGNALS.test(firstLine) && !INSTRUCTION_SIGNALS.test(firstLine))
    return "output-spec";
  if (RATIONALE_SIGNALS.test(firstLine)) return "rationale";

  const questionLines = text.split("\n").filter((l) => QUESTION_LINE.test(l.trim()));
  const totalNonEmpty = text.split("\n").filter((l) => l.trim().length > 0).length;
  if (questionLines.length > 0 && questionLines.length >= totalNonEmpty * 0.5) return "question";

  if (CONSTRAINT_HARD.test(text) && !INSTRUCTION_SIGNALS.test(firstLine)) return "constraint";

  const hasFilePaths = FILE_PATH.test(text);
  FILE_PATH.lastIndex = 0;
  const hasImports = IMPORT_REF.test(text);
  IMPORT_REF.lastIndex = 0;
  if ((hasFilePaths || hasImports) && !INSTRUCTION_SIGNALS.test(firstLine)) return "reference";

  if (INSTRUCTION_SIGNALS.test(firstLine)) return "instruction";

  if (text.split("\n").some((l) => NUMBERED_STEP.test(l) || BULLET_POINT.test(l))) {
    return "instruction";
  }

  return "context";
}

function makeSegment(
  kind: SegmentKind,
  text: string,
  raw: RawSegment,
  overrides: Partial<SegmentMetadata> = {},
): PromptSegment {
  return {
    kind,
    text,
    startLine: raw.startLine,
    endLine: raw.endLine,
    metadata: {
      filePaths: [],
      functionNames: [],
      constraintStrength: "none",
      specificity: kind === "code" ? 0.8 : 0.5,
      wordCount: text.split(/\s+/).filter(Boolean).length,
      hasCodeBlock: false,
      language: null,
      ...overrides,
    },
  };
}

// ---------------------------------------------------------------------------
// Metadata extraction
// ---------------------------------------------------------------------------

function extractFilePaths(text: string): string[] {
  const paths = new Set<string>();
  const pattern = new RegExp(FILE_PATH.source, FILE_PATH.flags);
  for (const m of text.matchAll(pattern)) {
    const p = m[1].trim();
    if (p.includes(".") && !p.startsWith("http")) paths.add(p);
  }
  return [...paths];
}

function extractFunctionNames(text: string): string[] {
  const names = new Set<string>();
  const pattern = new RegExp(FUNCTION_REF.source, FUNCTION_REF.flags);
  for (const m of text.matchAll(pattern)) names.add(m[1]);
  return [...names];
}

function detectConstraintStrength(text: string): "none" | "soft" | "hard" {
  const hard = CONSTRAINT_HARD.test(text);
  const soft = CONSTRAINT_SOFT.test(text);
  if (hard) return "hard";
  if (soft) return "soft";
  return "none";
}

function computeSegmentSpecificity(
  text: string,
  filePaths: string[],
  funcNames: string[],
  constraintStrength: string,
): number {
  let score = 0;
  if (filePaths.length > 0) score += 0.25;
  if (filePaths.length > 2) score += 0.1;
  if (funcNames.length > 0) score += 0.15;
  if (constraintStrength === "hard") score += 0.2;
  else if (constraintStrength === "soft") score += 0.1;
  if (/line\s*\d+/i.test(text)) score += 0.15;
  if (text.length > 200) score += 0.1;
  return Math.min(1, score + 0.05);
}

// ---------------------------------------------------------------------------
// Stats + quality
// ---------------------------------------------------------------------------

function computeStats(segments: PromptSegment[], lines: string[]): DecompositionStats {
  const byKind: Record<string, number> = {};
  let codeWords = 0;
  let proseWords = 0;
  let constraintSegments = 0;
  let referenceSegments = 0;

  for (const seg of segments) {
    byKind[seg.kind] = (byKind[seg.kind] ?? 0) + 1;
    if (seg.kind === "code") codeWords += seg.metadata.wordCount;
    else proseWords += seg.metadata.wordCount;
    if (seg.metadata.constraintStrength !== "none") constraintSegments++;
    if (seg.metadata.filePaths.length > 0 || seg.metadata.functionNames.length > 0)
      referenceSegments++;
  }

  const totalWords = codeWords + proseWords;

  return {
    totalSegments: segments.length,
    segmentsByKind: byKind,
    totalLines: lines.length,
    totalWords,
    codeToProseRatio: proseWords > 0 ? Math.round((codeWords / proseWords) * 100) / 100 : 0,
    constraintDensity: segments.length > 0 ? constraintSegments / segments.length : 0,
    referenceDensity: segments.length > 0 ? referenceSegments / segments.length : 0,
  };
}

function computeQuality(
  segments: PromptSegment[],
  stats: DecompositionStats,
): PromptQualitySignals {
  const kinds = new Set(segments.map((s) => s.kind));
  const allPaths = segments.flatMap((s) => s.metadata.filePaths);
  const allSpecificities = segments.map((s) => s.metadata.specificity);
  const avgSpecificity =
    allSpecificities.length > 0
      ? allSpecificities.reduce((s, v) => s + v, 0) / allSpecificities.length
      : 0;

  let structureScore = 0;
  if (kinds.has("context")) structureScore += 0.2;
  if (kinds.has("instruction")) structureScore += 0.2;
  if (kinds.has("constraint")) structureScore += 0.2;
  if (kinds.has("example") || kinds.has("code")) structureScore += 0.15;
  if (kinds.has("output-spec")) structureScore += 0.15;
  if (kinds.has("rationale")) structureScore += 0.1;

  return {
    hasContext: kinds.has("context"),
    hasExplicitConstraints:
      kinds.has("constraint") || segments.some((s) => s.metadata.constraintStrength !== "none"),
    hasExpectedOutput: kinds.has("output-spec"),
    hasExamples: kinds.has("example"),
    hasFileReferences: allPaths.length > 0,
    decompositionDepth: stats.totalSegments,
    specificityScore: Math.round(avgSpecificity * 100) / 100,
    structureScore: Math.round(structureScore * 100) / 100,
  };
}

function emptyStats(): DecompositionStats {
  return {
    totalSegments: 0,
    segmentsByKind: {},
    totalLines: 0,
    totalWords: 0,
    codeToProseRatio: 0,
    constraintDensity: 0,
    referenceDensity: 0,
  };
}

function emptyQuality(): PromptQualitySignals {
  return {
    hasContext: false,
    hasExplicitConstraints: false,
    hasExpectedOutput: false,
    hasExamples: false,
    hasFileReferences: false,
    decompositionDepth: 0,
    specificityScore: 0,
    structureScore: 0,
  };
}
