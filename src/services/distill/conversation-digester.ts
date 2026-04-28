// FILE: src/services/distill/conversation-digester.ts
// Stage 1.5 — Conversation Digester.
// Extracts structured decisions from AI conversation threads.
//
// Two paths:
// 1. LLM path: Sends conversation turn subsections to an LLM with a
//    decision-extraction prompt. Produces high-quality structured decisions.
// 2. Fallback path: Heuristic analysis of turn content, tool calls,
//    files modified, and conversation title. Never throws.
//
// Input: CaptureEvents of type "ai-conversation" with metadata.turns
// Output: Map<eventId, ConversationDigest>

import { generateText } from "ai";
import type { ConversationDigest, DigestedDecision } from "../../schemas/distill.js";
import type { CaptureEvent } from "../../schemas/event.js";
import { logger } from "../../utils/logger.js";
import type { LLMProviderResult } from "./providers/ai.js";

// ---------------------------------------------------------------------------
// Types for raw conversation turn data from Go daemon
// ---------------------------------------------------------------------------

interface RawTurn {
  role: string;
  content: string;
  turn_index: number;
  timestamp?: string;
  tool_use?: Array<{ name: string; target?: string }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max chars per conversation chunk sent to LLM */
const CHUNK_CHAR_LIMIT = 12_000;

/** Max turns to include per conversation (avoid enormous sessions) */
const MAX_TURNS_PER_CONVERSATION = 80;

// ---------------------------------------------------------------------------
// Decision type taxonomy (4 types of human steering decisions)
// ---------------------------------------------------------------------------
// Type 1: Invalidation — user corrects/rejects LLM output
// Type 2: Proactive direction — user steers before LLM asks
// Type 3: Question response — user chooses when LLM offers options
// Type 4: Post-output correction — user refines/adjusts LLM output

// ---------------------------------------------------------------------------
// Fuzzy Token-Bag Pattern Matching Engine
// ---------------------------------------------------------------------------
// Users write informal English to LLMs: fragments, typos, no punctuation,
// scrambled word order. Strict regex fails on this input.
//
// Algorithm: Weighted Token-Bag Matching (zero dependencies)
// 1. Each pattern = { anchors: required tokens, signals: bonus tokens }
// 2. Input normalized: lowercase, contractions expanded, typos handled
// 3. Score = (anchor_hits/anchors) * 0.7 + (signal_hits/signals) * 0.3
// 4. Score > threshold (0.5) = match
// 5. Regex kept as fast-path for well-formed input
//
// Why token-bag over alternatives:
// - Edit distance: O(n²), can't handle word reordering
// - N-gram: character n-grams miss semantic units
// - TF-IDF: needs corpus, heavy for this use case
// - Token-bag: O(n), word-order independent, partial credit, zero deps

interface TokenBagPattern {
  /** Anchor tokens — at least 60% must be present for a match */
  anchors: string[];
  /** Signal tokens — bonus scoring, optional */
  signals: string[];
  /** Minimum score threshold (default 0.5) */
  threshold?: number;
  /** Optional regex fast-path for well-formed input */
  fastPath?: RegExp;
}

/**
 * Normalize text for fuzzy matching:
 * - lowercase
 * - expand contractions (dont→do not, lets→let us, cant→can not, etc.)
 * - normalize common misspellings and informal variants
 * - strip non-alphanumeric except spaces
 */
function fuzzyNormalize(text: string): string {
  return (
    text
      .toLowerCase()
      // Expand contractions (handle both with and without apostrophe)
      .replace(/\bdon'?t\b/g, "do not")
      .replace(/\bcan'?t\b/g, "can not")
      .replace(/\bwon'?t\b/g, "will not")
      .replace(/\bshouldn'?t\b/g, "should not")
      .replace(/\bcouldn'?t\b/g, "could not")
      .replace(/\bwouldn'?t\b/g, "would not")
      .replace(/\bisn'?t\b/g, "is not")
      .replace(/\baren'?t\b/g, "are not")
      .replace(/\bwasn'?t\b/g, "was not")
      .replace(/\bweren'?t\b/g, "were not")
      .replace(/\blet'?s\b/g, "let us")
      .replace(/\bthat'?s\b/g, "that is")
      .replace(/\bit'?s\b/g, "it is")
      .replace(/\bi'?m\b/g, "i am")
      .replace(/\bi'?ll\b/g, "i will")
      .replace(/\bwe'?ll\b/g, "we will")
      .replace(/\bi'?d\b/g, "i would")
      .replace(/\bwe'?d\b/g, "we would")
      .replace(/\bi'?ve\b/g, "i have")
      .replace(/\bwe'?ve\b/g, "we have")
      .replace(/\bwhat'?s\b/g, "what is")
      .replace(/\bwhere'?s\b/g, "where is")
      .replace(/\bwho'?s\b/g, "who is")
      .replace(/\bhow'?s\b/g, "how is")
      // Common informal variants
      .replace(/\bnah\b/g, "no")
      .replace(/\byeah\b/g, "yes")
      .replace(/\byep\b/g, "yes")
      .replace(/\bnope\b/g, "no")
      .replace(/\bgonna\b/g, "going to")
      .replace(/\bwanna\b/g, "want to")
      .replace(/\bgotta\b/g, "got to")
      .replace(/\bpls\b/g, "please")
      .replace(/\bthx\b/g, "thanks")
      .replace(/\bimo\b/g, "in my opinion")
      .replace(/\bbtw\b/g, "by the way")
      .replace(/\bfyi\b/g, "for your information")
      // Strip non-alphanumeric (keep spaces and hyphens)
      .replace(/[^a-z0-9\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Extract word tokens from normalized text.
 */
function tokenize(text: string): Set<string> {
  return new Set(text.split(/\s+/).filter((w) => w.length >= 2));
}

/**
 * Score a token bag pattern against normalized input tokens.
 * Returns 0..1 score based on weighted anchor/signal hit ratio.
 */
function scoreTokenBag(tokens: Set<string>, pattern: TokenBagPattern, rawText?: string): number {
  if (pattern.anchors.length === 0) return 0;

  let anchorHits = 0;
  for (const anchor of pattern.anchors) {
    // Special: punctuation anchors check raw text
    if (anchor === "?") {
      if (rawText?.includes("?")) anchorHits++;
      continue;
    }
    // Support multi-word anchors (e.g., "go with" → check both words present)
    const parts = anchor.split(/\s+/);
    if (parts.length > 1) {
      if (parts.every((p) => tokens.has(p))) anchorHits++;
    } else if (tokens.has(anchor)) {
      anchorHits++;
    }
  }

  const anchorScore = anchorHits / pattern.anchors.length;

  // If no anchors hit, never match
  if (anchorHits === 0) return 0;

  let signalScore = 0;
  if (pattern.signals.length > 0) {
    let signalHits = 0;
    for (const signal of pattern.signals) {
      const parts = signal.split(/\s+/);
      if (parts.length > 1) {
        if (parts.every((p) => tokens.has(p))) signalHits++;
      } else if (tokens.has(signal)) {
        signalHits++;
      }
    }
    signalScore = signalHits / pattern.signals.length;
  }

  return anchorScore * 0.7 + signalScore * 0.3;
}

/**
 * Test if text matches any pattern in a set using hybrid fuzzy + regex matching.
 * Returns the first matching pattern index and the score, or null.
 */
function fuzzyMatchPatterns(
  text: string,
  patterns: TokenBagPattern[],
): { index: number; score: number } | null {
  // Fast-path: try regex first (cheap, handles well-formed input)
  for (let i = 0; i < patterns.length; i++) {
    if (patterns[i].fastPath?.test(text)) {
      return { index: i, score: 1.0 };
    }
  }

  // Slow-path: token-bag scoring for informal/malformed input
  const normalized = fuzzyNormalize(text);
  const tokens = tokenize(normalized);

  let bestIndex = -1;
  let bestScore = 0;

  for (let i = 0; i < patterns.length; i++) {
    const score = scoreTokenBag(tokens, patterns[i], text);
    const threshold = patterns[i].threshold ?? 0.5;
    if (score >= threshold && score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestIndex >= 0 ? { index: bestIndex, score: bestScore } : null;
}

// ---------------------------------------------------------------------------
// Decision Pattern Definitions (Token-Bag + Regex fast-paths)
// ---------------------------------------------------------------------------

/** Type 1: User invalidates or corrects LLM output (18 patterns) */
const INVALIDATION_PATTERNS: TokenBagPattern[] = [
  // "no, don't do that / no use X instead"
  {
    anchors: ["no", "do not"],
    signals: ["that", "use", "instead", "actually"],
    fastPath: /\bno[,.]?\s+(?:don'?t|do not)\b/i,
  },
  // "that's wrong / incorrect / not right"
  {
    anchors: ["that", "wrong"],
    signals: ["is", "not", "right", "approach"],
    fastPath: /\bthat'?s\s+(?:wrong|incorrect|not\s+(?:right|what|how))\b/i,
  },
  // "don't use / implement / go with"
  {
    anchors: ["do not", "use"],
    signals: ["that", "implement", "go", "with", "change", "modify"],
    fastPath: /\bdon'?t\s+(?:do that|use|go with|implement|change|modify|remove)\b/i,
  },
  // "stop / undo / revert"
  {
    anchors: ["stop"],
    signals: ["that", "this", "undo", "revert", "rollback", "go back"],
    fastPath: /\b(?:stop|undo|revert|rollback|go\s*back)\b.*\b(?:that|this|the|to)\b/i,
  },
  // "wrong approach / direction / way"
  {
    anchors: ["wrong"],
    signals: ["approach", "direction", "way", "pattern", "structure", "method"],
    fastPath: /\bwrong\s+(?:approach|direction|way|pattern|structure)\b/i,
  },
  // "not what I meant / wanted"
  {
    anchors: ["not", "what"],
    signals: ["meant", "wanted", "asked", "need", "looking"],
    fastPath: /\bnot\s+what\s+(?:i|we)\s+(?:meant|wanted|asked|need)\b/i,
  },
  // "no that is not it / no thats not how"
  { anchors: ["no", "not"], signals: ["it", "how", "right", "correct", "way"] },
  // "scrap that / scratch that / forget that"
  {
    anchors: ["scrap"],
    signals: ["that", "this", "idea", "approach"],
    fastPath: /\b(?:scrap|scratch|forget|discard|abandon|drop)\s+(?:that|this|the)\b/i,
  },
  // "nah / nope + directive" (already normalized to "no")
  { anchors: ["no"], signals: ["use", "instead", "try", "go", "switch", "different", "other"] },
  // "that won't work / that doesn't work"
  {
    anchors: ["not", "work"],
    signals: ["that", "will", "does", "approach", "way"],
    fastPath: /\b(?:that|this|it)\s+(?:won'?t|doesn'?t|does\s+not|will\s+not)\s+work\b/i,
  },
  // "I disagree / I don't agree"
  {
    anchors: ["not", "agree"],
    signals: ["with", "that", "approach", "think"],
    fastPath: /\b(?:disagree|do\s+not\s+agree|don'?t\s+agree)\b/i,
  },
  // "this is broken / this breaks"
  {
    anchors: ["broken"],
    signals: ["this", "that", "it", "breaks", "fix"],
    fastPath: /\b(?:this|that|it)\s+(?:is\s+)?(?:broken|breaks|broke)\b/i,
  },
  // "remove that / delete that / get rid of"
  {
    anchors: ["remove"],
    signals: ["that", "this", "it", "delete", "get rid"],
    fastPath: /\b(?:remove|delete|get\s+rid\s+of)\s+(?:that|this|the|it)\b/i,
  },
  // "no no no / nonono" (emphatic rejection)
  {
    anchors: ["no", "no"],
    signals: ["stop", "wait", "wrong"],
    threshold: 0.4,
    fastPath: /\bno\s+no\b/i,
  },
  // "hold on that's not / wait that's not"
  {
    anchors: ["wait", "not"],
    signals: ["hold", "on", "right", "correct"],
    fastPath: /\b(?:wait|hold\s+on)\b.*\bnot\b/i,
  },
  // "you misunderstood / you got it wrong"
  {
    anchors: ["misunderstood"],
    signals: ["you", "wrong", "not", "what"],
    fastPath: /\b(?:misunderstood|misread|got\s+it\s+wrong|missed\s+the\s+point)\b/i,
  },
  // "terrible / horrible / awful approach"
  {
    anchors: ["terrible"],
    signals: ["approach", "idea", "way", "pattern", "design"],
    fastPath: /\b(?:terrible|horrible|awful|bad|worst)\s+(?:approach|idea|way|pattern)\b/i,
  },
  // "I said X not Y" / "I meant X not Y"
  {
    anchors: ["said", "not"],
    signals: ["meant", "want", "need"],
    fastPath: /\bi\s+(?:said|meant)\b.*\bnot\b/i,
  },
];

/** Type 2: User proactively steers direction (22 patterns) */
const PROACTIVE_DIRECTION_PATTERNS: TokenBagPattern[] = [
  // "let's use / go with / switch to / implement"
  {
    anchors: ["let us", "use"],
    signals: ["go", "with", "switch", "implement", "adopt", "try", "build", "create"],
    fastPath: /\blet'?s\b.*\b(?:use|go\s+with|switch|implement|adopt|try|create|build|migrate)\b/i,
  },
  // "we should / I think we should"
  {
    anchors: ["we", "should"],
    signals: ["use", "go", "switch", "implement", "try", "build", "create", "make", "design"],
    fastPath: /\b(?:we\s+should|i\s+think\s+we\s+should)\b/i,
  },
  // "I want / I need"
  {
    anchors: ["want"],
    signals: ["use", "implement", "build", "create", "make", "switch", "to"],
    fastPath: /\bi\s+(?:want|need)\b.*\b(?:use|implement|build|create|switch|go|make)\b/i,
  },
  // "chose / decided / picked / settled on"
  {
    anchors: ["decided"],
    signals: ["use", "go", "with", "on", "pick", "chose"],
    fastPath: /\b(?:chose|decided|picked|selected|opted|went\s+with|settled\s+on)\b/i,
  },
  // "instead of X use Y / rather than X"
  {
    anchors: ["instead"],
    signals: ["of", "use", "using", "implement", "go", "do", "rather"],
    fastPath: /\b(?:instead\s+of|rather\s+than)\b.*\b(?:use|using|implement|do|doing|go|going)\b/i,
  },
  // "the approach should be / the plan is"
  {
    anchors: ["approach", "should"],
    signals: ["be", "strategy", "plan", "design", "architecture", "pattern", "is", "will"],
    fastPath:
      /\bthe\s+(?:approach|strategy|plan|design|architecture|pattern)\s+(?:should|is|will)\s+be\b/i,
  },
  // "focus on / prioritize / start with"
  {
    anchors: ["focus"],
    signals: ["on", "prioritize", "start", "first", "main", "primary", "goal"],
    fastPath: /\b(?:focus\s+on|prioritize|start\s+with|first\s+we|the\s+goal\s+is)\b/i,
  },
  // "keep / maintain / stick with current"
  {
    anchors: ["keep"],
    signals: ["current", "existing", "maintain", "stick", "stay", "continue", "with", "the"],
    fastPath:
      /\b(?:keep|maintain|stick\s+with|stay\s+with|continue\s+with)\b.*\b(?:the|this|current|existing)\b/i,
  },
  // "going to use / gonna use"
  {
    anchors: ["going to", "use"],
    signals: ["implement", "build", "create", "try", "switch", "adopt"],
    fastPath: /\b(?:going\s+to|gonna)\b.*\b(?:use|implement|build|try|switch)\b/i,
  },
  // "prefer X / X is better / X over Y"
  {
    anchors: ["prefer"],
    signals: ["over", "better", "than", "use", "approach", "way"],
    fastPath: /\b(?:prefer|is\s+better|over)\b/i,
  },
  // "switch to / migrate to / move to"
  {
    anchors: ["switch"],
    signals: ["to", "from", "migrate", "move", "transition"],
    fastPath: /\b(?:switch|migrate|move|transition)\s+(?:to|from)\b/i,
  },
  // "go with X / go for X"
  {
    anchors: ["go", "with"],
    signals: ["option", "approach", "this", "that", "the"],
    fastPath: /\bgo\s+(?:with|for)\b/i,
  },
  // "implement X / build X / create X" (standalone directives)
  {
    anchors: ["implement"],
    signals: ["the", "new", "using", "with", "based", "approach"],
    fastPath: /\b(?:implement|build|create|design|architect)\s+(?:a|the|this|new)\b/i,
  },
  // "skip X / avoid X / don't bother with X"
  {
    anchors: ["skip"],
    signals: ["that", "this", "avoid", "bother", "forget", "ignore", "unnecessary"],
    fastPath: /\b(?:skip|avoid|do\s+not\s+bother)\b.*\b(?:that|this|the|it|with)\b/i,
  },
  // "make it X / do it with X"
  {
    anchors: ["make", "it"],
    signals: ["with", "using", "like", "so", "the", "way"],
    fastPath: /\bmake\s+it\b/i,
  },
  // "try X / experiment with X"
  {
    anchors: ["try"],
    signals: ["using", "with", "approach", "way", "method", "instead", "different"],
    fastPath:
      /\b(?:try|experiment\s+with|test\s+out)\b.*\b(?:using|with|approach|instead|different)\b/i,
  },
  // "X not Y" pattern (implicit decision: "postgres not mongo")
  { anchors: ["not"], signals: ["use", "want", "need", "go", "prefer", "instead"], threshold: 0.6 },
  // "the way to do this is" / "the right way"
  {
    anchors: ["way", "to"],
    signals: ["right", "best", "proper", "correct", "do", "this", "is"],
    fastPath: /\bthe\s+(?:right|best|proper|correct)?\s*way\s+(?:to|is)\b/i,
  },
  // "separate X from Y" / "decouple X"
  {
    anchors: ["separate"],
    signals: ["from", "into", "decouple", "split", "extract", "isolate"],
    fastPath: /\b(?:separate|decouple|split|extract|isolate)\b.*\b(?:from|into)\b/i,
  },
  // "wrap X / abstract X / encapsulate"
  {
    anchors: ["wrap"],
    signals: ["abstract", "encapsulate", "hide", "behind", "interface", "layer"],
    fastPath: /\b(?:wrap|abstract|encapsulate)\b.*\b(?:behind|into|with|the)\b/i,
  },
  // "do X first then Y" (sequencing = decision)
  {
    anchors: ["first"],
    signals: ["then", "after", "before", "do", "start", "begin"],
    fastPath: /\b(?:first|start\s+(?:with|by))\b.*\b(?:then|after|before)\b/i,
  },
  // "X is overkill / too much / unnecessary"
  {
    anchors: ["overkill"],
    signals: ["too", "much", "unnecessary", "complex", "heavy", "simple", "enough"],
    fastPath: /\b(?:overkill|too\s+(?:much|complex|heavy)|unnecessary|over-?engineer)\b/i,
  },
];

/** Type 4: Post-output correction/refinement (16 patterns) */
const POST_CORRECTION_PATTERNS: TokenBagPattern[] = [
  // "actually change / wait switch / hmm use"
  {
    anchors: ["actually"],
    signals: ["change", "make", "use", "switch", "instead", "modify", "update", "wait"],
    fastPath:
      /\b(?:actually|wait|hmm|hold\s+on)\b.*\b(?:change|make|use|switch|instead|modify|update)\b/i,
  },
  // "change X to Y / modify X to Y"
  {
    anchors: ["change", "to"],
    signals: ["that", "this", "the", "it", "into", "instead", "modify", "update", "adjust"],
    fastPath:
      /\b(?:change|modify|update|adjust|tweak)\b.*\b(?:that|this|the|it)\b.*\b(?:to|into|so\s+that|instead)\b/i,
  },
  // "rename X / move X / replace X / swap X"
  {
    anchors: ["rename"],
    signals: ["to", "with", "from", "move", "replace", "swap"],
    fastPath: /\b(?:rename|move|replace|swap)\b.*\b(?:to|with|from)\b/i,
  },
  // "but change / however use / although"
  {
    anchors: ["but", "change"],
    signals: ["use", "make", "switch", "instead", "modify", "however", "although"],
    fastPath: /\b(?:but|however|although)\b.*\b(?:change|use|make|switch|instead|modify)\b/i,
  },
  // "one thing / small change / small tweak"
  {
    anchors: ["change"],
    signals: ["one", "small", "thing", "tweak", "fix", "minor", "quick"],
    fastPath: /\b(?:one\s+(?:thing|change)|small\s+(?:change|tweak|fix))\b/i,
  },
  // "on second thought / thinking about it"
  {
    anchors: ["second", "thought"],
    signals: ["on", "thinking", "about", "change", "instead", "better"],
    fastPath: /\b(?:on\s+second\s+thought|thinking\s+about\s+it|reconsidering)\b/i,
  },
  // "no wait / nm / never mind, do X instead"
  {
    anchors: ["never mind"],
    signals: ["do", "use", "instead", "forget", "ignore", "scratch"],
    fastPath: /\b(?:never\s*mind|nevermind|nm)\b/i,
  },
  // "also add / also include / also make"
  {
    anchors: ["also", "add"],
    signals: ["include", "make", "put", "insert", "plus", "and"],
    fastPath: /\b(?:also|and\s+also|plus)\s+(?:add|include|make|put|insert)\b/i,
  },
  // "can you also / while you're at it"
  {
    anchors: ["while", "at it"],
    signals: ["also", "change", "fix", "update", "add"],
    fastPath: /\b(?:while\s+you'?re\s+at\s+it|can\s+you\s+also|and\s+also)\b/i,
  },
  // "oh and / oh also / oh one more"
  {
    anchors: ["oh", "and"],
    signals: ["also", "more", "thing", "change", "add"],
    fastPath: /\boh\s+(?:and|also|one\s+more|wait)\b/i,
  },
  // "nvm do X / actually nvm"
  { anchors: ["never mind"], signals: ["do", "just", "forget", "instead"], threshold: 0.4 },
  // "tweak X / adjust X / fine-tune X"
  {
    anchors: ["tweak"],
    signals: ["adjust", "fine-tune", "tune", "that", "this", "the", "slightly"],
    fastPath: /\b(?:tweak|adjust|fine-?tune|nudge)\b.*\b(?:the|that|this|it)\b/i,
  },
  // "flip X / invert X / reverse the order"
  {
    anchors: ["flip"],
    signals: ["invert", "reverse", "order", "swap", "opposite", "the"],
    fastPath: /\b(?:flip|invert|reverse)\b.*\b(?:the|order|logic|condition)\b/i,
  },
  // "bump X / increase X / decrease X"
  {
    anchors: ["bump"],
    signals: ["increase", "decrease", "raise", "lower", "up", "down", "to"],
    fastPath: /\b(?:bump|increase|decrease|raise|lower)\b.*\b(?:the|to|by)\b/i,
  },
  // "make it more / make it less"
  {
    anchors: ["make", "more"],
    signals: ["it", "less", "readable", "clean", "simple", "robust", "generic", "specific"],
    fastPath: /\bmake\s+(?:it|this|that)\s+(?:more|less)\b/i,
  },
  // "simplify / clean up / refactor that"
  {
    anchors: ["simplify"],
    signals: ["clean", "up", "refactor", "that", "this", "the"],
    fastPath: /\b(?:simplify|clean\s+up|refactor|tidy)\b.*\b(?:that|this|the|it)\b/i,
  },
];

/** Patterns that detect assistant asking a question (for Type 3 detection) */
const ASSISTANT_QUESTION_PATTERNS: TokenBagPattern[] = [
  // "would you like / prefer / want"
  {
    anchors: ["would", "you"],
    signals: ["like", "prefer", "want", "rather"],
    fastPath: /\b(?:would\s+you\s+(?:like|prefer|want)|do\s+you\s+want|should\s+i|shall\s+i)\b/i,
  },
  // "option 1/2/3 / approach A/B/C"
  {
    anchors: ["option"],
    signals: ["1", "2", "3", "approach", "alternative", "choice"],
    fastPath: /\b(?:option\s+[1-3A-Ca-c]|alternative|approach\s+[1-3A-Ca-c])\b/i,
  },
  // "we could either / can go with"
  {
    anchors: ["could", "either"],
    signals: ["we", "can", "go", "with", "or"],
    fastPath: /\bwe\s+(?:could|can)\s+(?:either|go\s+with)\b/i,
  },
  // "which one / which approach / which option"
  {
    anchors: ["which"],
    signals: ["one", "approach", "option", "prefer", "want"],
    fastPath: /\bwhich\s+(?:one|approach|option|way|method)\b/i,
  },
  // "do you prefer / what do you think"
  {
    anchors: ["do", "you", "prefer"],
    signals: ["think", "want", "suggest", "recommend"],
    fastPath: /\b(?:do\s+you\s+prefer|what\s+do\s+you\s+think)\b/i,
  },
  // "here are some options / here are the alternatives"
  {
    anchors: ["here", "options"],
    signals: ["are", "some", "alternatives", "choices", "approaches"],
    fastPath: /\bhere\s+are\s+(?:some|the)\s+(?:options|alternatives|approaches|choices)\b/i,
  },
  // Ends with question mark (broad fallback)
  { anchors: ["?"], signals: [], threshold: 0.7, fastPath: /\?[\s]*$/m },
  // "I can do X or Y" / "two ways to"
  {
    anchors: ["or"],
    signals: ["can", "could", "ways", "either", "approaches", "options", "between"],
    fastPath: /\b(?:i\s+can|we\s+(?:can|could))\b.*\bor\b/i,
  },
];

/** Content that is never a decision — pure noise */
const NOISE_PATTERNS = [
  /^(?:this session is being continued|<command-name>|<local-command)/i,
  /^(?:looks?\s*good|perfect|thanks?|ok|okay|correct|exactly|great|nice|awesome|wonderful|excellent|sweet|cool|neat|solid|beautiful|gorgeous|amazing)\s*[.!,]?\s*$/i,
  /^(?:yes|no|yep|yeah|nope|sure|agreed|right|absolutely|definitely|certainly|totally|got\s*it|understood|roger|ack|k|kk)\s*[.!,]?\s*$/i,
  /^(?:please|pls|plz|thx|ty|thank\s*you)\s*[.!,]?\s*$/i,
  /^(?:go\s*ahead|proceed|continue|carry\s*on|do\s*it|ship\s*it|lgtm|sgtm)\s*[.!,]?\s*$/i,
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Digest AI conversation events into structured decision extracts.
 * Uses LLM when available, falls back to heuristics.
 * Never throws — returns empty digests on error.
 */
/** Max conversations to send to LLM (most substantive first, rest use heuristic). */
const MAX_LLM_CONVERSATIONS = 15;
/** Max concurrent LLM digest calls. */
const LLM_DIGEST_CONCURRENCY = 3;

export async function digestConversations(
  events: CaptureEvent[],
  provider?: LLMProviderResult | null,
): Promise<Map<string, ConversationDigest>> {
  const aiConversations = events.filter((e) => e.type === "ai-conversation");

  if (aiConversations.length === 0) return new Map();

  const digests = new Map<string, ConversationDigest>();

  if (!provider) {
    // Heuristic path — fast, no LLM
    for (const event of aiConversations) {
      const digest = digestFallback(event);
      if (digest.decisions.length > 0 || digest.conversationSummary !== event.content.summary) {
        digests.set(event.id, digest);
      }
    }
    return digests;
  }

  // LLM path — rank conversations by substance, send top N to LLM
  const ranked = [...aiConversations].sort((a, b) => {
    const turnsA = (a.metadata?.turns as RawTurn[] | undefined)?.length ?? 0;
    const turnsB = (b.metadata?.turns as RawTurn[] | undefined)?.length ?? 0;
    const filesA = (a.metadata?.files_modified as string[] | undefined)?.length ?? 0;
    const filesB = (b.metadata?.files_modified as string[] | undefined)?.length ?? 0;
    return (turnsB + filesB * 2) - (turnsA + filesA * 2);
  });

  const llmBatch = ranked.slice(0, MAX_LLM_CONVERSATIONS);
  const heuristicBatch = ranked.slice(MAX_LLM_CONVERSATIONS);

  // Heuristic fallback for overflow conversations
  for (const event of heuristicBatch) {
    const digest = digestFallback(event);
    if (digest.decisions.length > 0 || digest.conversationSummary !== event.content.summary) {
      digests.set(event.id, digest);
    }
  }

  // LLM digestion with concurrency limit
  const digestOne = async (event: CaptureEvent): Promise<void> => {
    try {
      const digest = await digestWithLLM(event, provider);
      if (digest.decisions.length > 0 || digest.conversationSummary !== event.content.summary) {
        digests.set(event.id, digest);
      }
    } catch (err) {
      logger.debug("LLM digest failed, using fallback", {
        eventId: event.id,
        error: err instanceof Error ? err.message : String(err),
      });
      const fallback = digestFallback(event);
      if (fallback.decisions.length > 0 || fallback.conversationSummary !== event.content.summary) {
        digests.set(event.id, fallback);
      }
    }
  };

  // Process in batches of LLM_DIGEST_CONCURRENCY
  for (let i = 0; i < llmBatch.length; i += LLM_DIGEST_CONCURRENCY) {
    const batch = llmBatch.slice(i, i + LLM_DIGEST_CONCURRENCY);
    await Promise.all(batch.map(digestOne));
  }

  return digests;
}

// ---------------------------------------------------------------------------
// LLM-based digestion
// ---------------------------------------------------------------------------

function digestSystemPrompt(): string {
  return [
    "You extract engineering decisions from developer-AI conversation threads.",
    "Reply with exactly one JSON object — no markdown fences, no preamble.",
    "Required keys:",
    '  decisions: array of { decision: string (concise: "Chose X over Y"), rationale: string (why), domain?: string (e.g. "auth", "database", "UI"), alternativesConsidered?: number }',
    "  conversationSummary: string (what was accomplished, NOT the raw user prompt)",
    "Optional keys: tradeOffs (string[]), keyInsights (string[]), filesActedOn (string[])",
    "",
    "Rules:",
    '- A decision is a deliberate choice between alternatives: "Chose Postgres over Mongo", "Switched from REST to gRPC", "Reverted feature X".',
    "- Routine instructions (fix this, implement that) are NOT decisions unless they involve a real choice or trade-off.",
    "- Extract rationale from the conversation context — why was this approach chosen?",
    "- If no real decisions exist, return an empty decisions array.",
    "- The conversationSummary should describe what was achieved, not echo the user's prompt.",
    "- Be specific: reference actual technologies, files, and approaches.",
  ].join("\n");
}

/**
 * Build a focused prompt from conversation turns, chunked to fit LLM context.
 * Prioritizes user turns and assistant responses that contain decision-relevant content.
 */
function buildDigestPrompt(event: CaptureEvent): string {
  const meta = event.metadata ?? {};
  const turns = (meta.turns as RawTurn[] | undefined) ?? [];
  const title = meta.conversation_title as string | undefined;
  const filesModified = (meta.files_modified as string[] | undefined) ?? [];
  const toolCalls = meta.tool_calls_summary as Array<{ name: string; target?: string }> | undefined;

  const header = [
    "## AI Conversation Thread",
    title ? `Title: ${title}` : "",
    filesModified.length > 0 ? `Files modified: ${filesModified.slice(0, 20).join(", ")}` : "",
    toolCalls && toolCalls.length > 0
      ? `Tools used: ${[...new Set(toolCalls.map((t) => t.name))].join(", ")}`
      : "",
    "",
    "## Conversation Turns",
  ]
    .filter(Boolean)
    .join("\n");

  // Select and truncate turns to fit budget
  const selectedTurns = selectRelevantTurns(turns);
  let turnText = "";
  let charBudget = CHUNK_CHAR_LIMIT - header.length;

  for (const turn of selectedTurns) {
    const content = turn.content?.trim();
    if (!content) continue;

    // Truncate individual turn content to avoid one massive turn dominating
    const truncated = content.length > 1500 ? `${content.slice(0, 1500)}…` : content;
    const line = `[${turn.role}]: ${truncated}\n`;

    if (line.length > charBudget) {
      turnText += `\n... (${selectedTurns.length - selectedTurns.indexOf(turn)} more turns truncated)\n`;
      break;
    }
    turnText += line;
    charBudget -= line.length;
  }

  return `${header}\n${turnText}`;
}

/**
 * Select the most decision-relevant turns from a conversation.
 * Prioritizes: user instructions, assistant decisions, tool-use turns.
 * Caps at MAX_TURNS_PER_CONVERSATION.
 */
function selectRelevantTurns(turns: RawTurn[]): RawTurn[] {
  if (turns.length <= MAX_TURNS_PER_CONVERSATION) return turns;

  // Always include first 4 turns (context setting) and last 4 (conclusion)
  const head = turns.slice(0, 4);
  const tail = turns.slice(-4);
  const middle = turns.slice(4, -4);

  // From the middle, prioritize user turns and turns with tool_use
  const prioritized = middle.filter(
    (t) => t.role === "user" || (t.tool_use && t.tool_use.length > 0),
  );

  // Fill remaining budget with assistant turns that likely contain decisions
  const remaining = MAX_TURNS_PER_CONVERSATION - head.length - tail.length - prioritized.length;
  if (remaining > 0) {
    const assistantTurns = middle.filter((t) => t.role === "assistant" && !prioritized.includes(t));
    // Take evenly spaced samples from assistant turns
    const step = Math.max(1, Math.floor(assistantTurns.length / remaining));
    for (
      let i = 0;
      i < assistantTurns.length && prioritized.length < remaining + prioritized.length;
      i += step
    ) {
      prioritized.push(assistantTurns[i]);
    }
  }

  // Sort by turn_index to maintain conversation order
  const selected = [...head, ...prioritized, ...tail];
  selected.sort((a, b) => (a.turn_index ?? 0) - (b.turn_index ?? 0));

  // Deduplicate by turn_index
  const seen = new Set<number>();
  return selected.filter((t) => {
    const idx = t.turn_index ?? -1;
    if (seen.has(idx)) return false;
    seen.add(idx);
    return true;
  });
}

async function digestWithLLM(
  event: CaptureEvent,
  provider: LLMProviderResult,
): Promise<ConversationDigest> {
  const prompt = buildDigestPrompt(event);

  const result = await generateText({
    model: provider.model,
    system: digestSystemPrompt(),
    prompt,
    temperature: 0,
    maxOutputTokens: 2048,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(30_000), // 30s per conversation — fail fast
  });

  let parsed: unknown;
  try {
    // Extract JSON from response (may have preamble/postscript)
    const text = result.text.trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("No JSON object in response");
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    logger.debug("LLM digest response not parseable, falling back", {
      eventId: event.id,
      responseSnippet: result.text.slice(0, 200),
    });
    return digestFallback(event);
  }

  const obj = parsed as Record<string, unknown>;
  const decisions = Array.isArray(obj.decisions) ? obj.decisions : [];

  return {
    eventId: event.id,
    decisions: decisions
      .filter(
        (d: unknown): d is Record<string, unknown> =>
          typeof d === "object" &&
          d !== null &&
          typeof (d as Record<string, unknown>).decision === "string",
      )
      .map((d) => ({
        decision: String(d.decision),
        rationale: String(d.rationale ?? ""),
        domain: typeof d.domain === "string" ? d.domain : undefined,
        alternativesConsidered:
          typeof d.alternativesConsidered === "number" ? d.alternativesConsidered : undefined,
      })),
    tradeOffs: Array.isArray(obj.tradeOffs)
      ? obj.tradeOffs.filter((t): t is string => typeof t === "string")
      : undefined,
    keyInsights: Array.isArray(obj.keyInsights)
      ? obj.keyInsights.filter((t): t is string => typeof t === "string")
      : undefined,
    filesActedOn: extractFilesActedOn(event),
    conversationSummary:
      typeof obj.conversationSummary === "string" && obj.conversationSummary.length > 0
        ? obj.conversationSummary
        : deriveConversationSummary(event),
  };
}

// ---------------------------------------------------------------------------
// Heuristic fallback digestion (no LLM)
// ---------------------------------------------------------------------------

/**
 * Extract decisions from conversation metadata using context-aware turn-pair analysis.
 * Recognizes 4 decision types:
 *   Type 1 — Invalidation: user corrects/rejects LLM output
 *   Type 2 — Proactive direction: user steers before LLM asks
 *   Type 3 — Question response: user chooses when LLM offers options
 *   Type 4 — Post-output correction: user refines/adjusts after seeing output
 *
 * Analyzes turn pairs (assistant → user) for context-dependent detection,
 * not just isolated user turns.
 */
/** Noise patterns for raw prompts/instructions that are NOT engineering decisions. */
const RAW_PROMPT_NOISE = [
  /^(I need|I want|please|can you|hey|go through|check|verify|look at|read|show me|help me|fix|do |make |let'?s |tell me|explain|what |how |why |don'?t|do not|research|thoroughly|explore|analyze|audit|identify|find|search|investigate|list|review|compare|ensure|update|create|build|write|add |remove|delete|set up|configure|implement|refactor|clean|optimize|improve|test |debug|deploy|run |install|generate|prepare|design|plan |move |copy |rename)\b/i,
  /^The (codebase|project|repo|code|system|file|directory|folder)\b/i,
  /^(Based on|According to|Looking at|After reading|From the|In the|As per)\b/i,
  /^(Now |OK |Sure |Yes |No |Alright |So |Well |Right |Let me |I'll |I will |Here'?s )/i,
  /^\//,
  /\/Users\/|\/home\/|\/var\/|C:\\|[A-Z]:\\/,
  // Additional patterns: conversational text directed at an AI assistant
  /^(also|got |when |did |seeing |post |access |along|alogn|focus on|<[a-z-]|`[a-z])/i,
  /<task-notification>|<tool-use-id>|<output-file>/,
  /^(Rejected|Examples of )/i,
  /\?\s*(Focus|What|How|Why|Is |Are |Do |Does |Can |Should )/i,
];

function isNoisyText(text: string): boolean {
  return RAW_PROMPT_NOISE.some((p) => p.test(text.trim()));
}

/**
 * Quality gate: does this text look like an actual engineering decision?
 * Instead of trying to enumerate all noise patterns (whack-a-mole),
 * require positive signals that the text describes a decision, not just
 * an instruction to an AI or a conversational fragment.
 *
 * A quality decision typically:
 * - Uses past tense or declarative form ("Chose X", "Switched to Y", "Adopted Z")
 * - References a specific technology choice, architecture pattern, or trade-off
 * - Describes WHY something was done, not WHAT to do
 */
const DECISION_QUALITY_SIGNALS = [
  // Past tense / declarative decisions — strong signal that something WAS decided
  /\b(chose|decided|switched to|adopted|migrated to|replaced .+ with|removed .+ in favor|introduced|redesigned|refactored .+ to|consolidated|unified|split .+ into|merged .+ into|extracted .+ from|inlined|deprecated)\b/i,
  // Trade-off / comparison language — implies weighing options
  /\b(instead of|rather than|trade.?off|in favor of|versus|vs\.)\b/i,
  // Specific technology choices with a verb
  /\b(use[ds]?\s+(React|Vue|Svelte|DuckDB|SQLite|Redis|Postgres|TypeScript|Go|Rust|Zod|Hono|Vite|CozoDB|TanStack|Zustand))\b/i,
  // Explicit decision framing
  /\b(went with|settled on|picked|opted for|committed to|pivoted to|reverted to|rolled back)\b/i,
];

export function looksLikeDecision(text: string): boolean {
  // Short text can't be a meaningful decision
  if (text.length < 15 || text.length > 300) return false;
  // Reject text that's obviously conversational (addressed to AI, contains instructions)
  if (/^(Corrected approach:|md[`\s-]|ts[`\s-])/i.test(text)) return false;
  if (text.includes("@.internal/") || text.includes("@src/")) return false;
  // Reject code/regex/config fragments
  if (/[|\\{}[\]^$]/.test(text.slice(0, 30))) return false;
  if (/^[a-z_]+[:(]/.test(text)) return false; // starts like a variable/function reference
  // Must start with a capital letter or "Chose/Decided/Switched..." — real decisions are sentences
  if (!/^[A-Z]/.test(text.trim())) return false;
  // Must have at least one positive decision signal
  return DECISION_QUALITY_SIGNALS.some((p) => p.test(text));
}

export function digestFallback(event: CaptureEvent): ConversationDigest {
  const meta = event.metadata ?? {};
  const turns = (meta.turns as RawTurn[] | undefined) ?? [];
  const filesModified = (meta.files_modified as string[] | undefined) ?? [];
  const title = meta.conversation_title as string | undefined;
  const toolCalls = meta.tool_calls_summary as Array<{ name: string; target?: string }> | undefined;

  const decisions: DigestedDecision[] = [];

  // Build ordered turn list for context-aware analysis
  const ordered = [...turns].sort((a, b) => (a.turn_index ?? 0) - (b.turn_index ?? 0));

  for (let i = 0; i < ordered.length; i++) {
    const turn = ordered[i];
    if (turn.role !== "user" || !turn.content?.trim()) continue;

    const content = turn.content.trim();

    // Skip pure noise (system messages, bare acknowledgments)
    if (NOISE_PATTERNS.some((p) => p.test(content))) continue;

    // Get preceding assistant turn for context-aware detection
    const prevAssistant = findPrecedingAssistant(ordered, i);

    const detected = detectDecision(content, prevAssistant, filesModified);
    if (detected && !isNoisyText(detected.decision) && looksLikeDecision(detected.decision)) {
      decisions.push(detected);
    }
  }

  // If turn-level analysis found nothing, derive a decision from conversation metadata.
  // A conversation that modified files IS engineering activity worth recording.
  if (decisions.length === 0) {
    const metaDecision = deriveDecisionFromMetadata(title, filesModified, toolCalls, event);
    if (metaDecision) {
      decisions.push(metaDecision);
    }
  }

  return {
    eventId: event.id,
    decisions: deduplicateDecisions(decisions),
    filesActedOn: filesModified.length > 0 ? filesModified : undefined,
    conversationSummary: deriveConversationSummary(event),
  };
}

/**
 * Derive a meaningful decision from conversation metadata when turn-level
 * analysis finds nothing. Prefers: title > file modifications > tool calls.
 */
function deriveDecisionFromMetadata(
  title: string | undefined,
  filesModified: string[],
  toolCalls: Array<{ name: string; target?: string }> | undefined,
  _event: CaptureEvent,
): DigestedDecision | null {
  // 1. Clean conversation title — often the best signal.
  //    Filter out raw prompts/instructions: titles starting with imperative verbs,
  //    research directives, or question words are user prompts, not decisions.
  if (title && title.length > 10 && title.length < 200 && !isNoisyText(title)) {
    const TITLE_PROMPT_RE =
      /^(I need|I want|please|can you|hey|go through|check|verify|look at|read|show me|help me|fix|do |make |let'?s |tell me|explain|what |how |why |donot|don't|do not|research|thoroughly|explore|analyze|audit|identify|find|search|investigate|list|review|compare|ensure|update|create|build|write|add |remove|delete|set up|configure|implement|refactor|clean|optimize|improve|test |debug|deploy|run |install|generate|prepare|design|plan |move |copy |rename|merge|rebase|push|pull |fetch|clone|open|close|start|stop|enable|disable|show|hide|get |put |send|try |use |apply |change )\b/i;
    if (TITLE_PROMPT_RE.test(title)) {
      // Title is a raw prompt — don't use it as a decision.
      // Fall through to tier 2 (file modifications).
    } else if (looksLikeDecision(title)) {
      const domain = inferDomain(title, filesModified);
      const rationale =
        filesModified.length > 0
          ? `Modified ${filesModified.length} file${filesModified.length !== 1 ? "s" : ""}: ${filesModified
              .slice(0, 3)
              .map((f) => f.split("/").pop())
              .join(", ")}${filesModified.length > 3 ? ` +${filesModified.length - 3} more` : ""}`
          : "From AI conversation";
      return { decision: title, rationale, domain };
    }
  }

  // 2. File modifications alone are activity, not decisions.
  // "Work on pages: DecisionsPage.tsx" tells the user nothing they don't already know.
  // Tool usage alone is also not a decision.
  // If neither title nor turn-level analysis produced a decision, this conversation
  // simply doesn't contain an extractable decision — and that's fine.
  return null;
}

/**
 * Find the closest preceding assistant turn before index i.
 */
function findPrecedingAssistant(turns: RawTurn[], userIndex: number): string | null {
  for (let j = userIndex - 1; j >= 0; j--) {
    if (turns[j].role === "assistant" && turns[j].content?.trim()) {
      return turns[j].content.trim();
    }
  }
  return null;
}

/**
 * Detect if a user turn represents a decision, considering the preceding assistant context.
 * Uses hybrid fuzzy + regex matching to handle informal English input.
 * Returns a structured decision if detected, null otherwise.
 */
function detectDecision(
  userContent: string,
  prevAssistant: string | null,
  filesModified: string[],
): DigestedDecision | null {
  // Type 3: Question response — assistant asked a question, user answered with substance
  if (prevAssistant && isAssistantQuestion(prevAssistant)) {
    const response = classifyQuestionResponse(userContent, prevAssistant);
    if (response) {
      return {
        decision: response.decision,
        rationale: response.rationale,
        domain: inferDomain(`${userContent} ${prevAssistant}`, filesModified),
      };
    }
  }

  // Type 1: Invalidation — user corrects/rejects preceding assistant output
  if (prevAssistant) {
    const invalidationMatch = fuzzyMatchPatterns(userContent, INVALIDATION_PATTERNS);
    if (invalidationMatch) {
      const decision = buildInvalidationDecision(userContent, prevAssistant);
      if (decision) {
        return {
          ...decision,
          domain: inferDomain(`${userContent} ${prevAssistant}`, filesModified),
        };
      }
    }
  }

  // Type 4: Post-output correction — user refines after seeing output
  if (prevAssistant) {
    const correctionMatch = fuzzyMatchPatterns(userContent, POST_CORRECTION_PATTERNS);
    if (correctionMatch) {
      // Find best sentence to extract — use regex fast-path match position if available
      const pattern = POST_CORRECTION_PATTERNS[correctionMatch.index];
      const regexMatch = pattern.fastPath?.exec(userContent);
      const matchPos = regexMatch?.index ?? 0;
      const sentence = extractSentenceAround(userContent, matchPos);
      if (sentence.length > 10 && sentence.length < 300) {
        return {
          decision: `Corrected approach: ${cleanDecisionText(sentence)}`,
          rationale: deriveRationale(userContent, sentence),
          domain: inferDomain(userContent, filesModified),
        };
      }
    }
  }

  // Type 2: Proactive direction — user steers regardless of context
  const directionMatch = fuzzyMatchPatterns(userContent, PROACTIVE_DIRECTION_PATTERNS);
  if (directionMatch) {
    const pattern = PROACTIVE_DIRECTION_PATTERNS[directionMatch.index];
    const regexMatch = pattern.fastPath?.exec(userContent);
    const matchPos = regexMatch?.index ?? 0;
    const sentence = extractSentenceAround(userContent, matchPos);
    if (sentence.length > 10 && sentence.length < 300) {
      return {
        decision: cleanDecisionText(sentence),
        rationale: deriveRationale(userContent, sentence),
        domain: inferDomain(userContent, filesModified),
      };
    }
  }

  return null;
}

/**
 * Check if assistant turn contains a question or presents options.
 * Uses fuzzy matching to catch informal question patterns.
 */
function isAssistantQuestion(content: string): boolean {
  // Check last 500 chars — questions are usually at the end
  const tail = content.slice(-500);
  return fuzzyMatchPatterns(tail, ASSISTANT_QUESTION_PATTERNS) !== null;
}

/**
 * Classify a user's response to an assistant question as a decision.
 * Only returns a decision if the response has substance (not just "yes"/"no").
 */
function classifyQuestionResponse(
  userContent: string,
  assistantContent: string,
): { decision: string; rationale: string } | null {
  const trimmed = userContent.trim();

  // Bare yes/no with no elaboration — not enough to extract a decision
  if (/^(?:yes|no|yep|nope|sure|ok|agreed)\s*[.!]?\s*$/i.test(trimmed)) return null;

  // Short affirmation + context: "yes, use option 2" or "go with the first approach"
  // Extract what they're choosing from the user response, using the assistant question for context
  const assistantTail = assistantContent.slice(-400);

  // User picks a numbered/lettered option
  const optionMatch = trimmed.match(
    /\b(?:option|approach|choice|number|go with|pick|prefer)\s*(?:#?\s*)([1-3A-Ca-c])\b/i,
  );
  if (optionMatch) {
    const optionId = optionMatch[1].toUpperCase();
    // Try to extract what that option was from assistant's message
    const optionTextMatch = assistantContent.match(
      new RegExp(`(?:option|approach|${optionId})[:\\s.-]+(.{10,150}?)(?:\\n|$)`, "i"),
    );
    const optionDesc = optionTextMatch ? optionTextMatch[1].trim() : `option ${optionId}`;
    return {
      decision: `Chose ${optionDesc}`,
      rationale: `Selected from alternatives presented by AI`,
    };
  }

  // User responds with a substantive choice (>15 chars, not a bare directive)
  if (trimmed.length > 15) {
    // Check if response contains decision/choice language (fuzzy: handles word order, contractions)
    const choicePatterns: TokenBagPattern[] = [
      {
        anchors: ["use"],
        signals: ["go", "with", "prefer", "pick", "the", "approach", "way", "let us"],
        fastPath: /\b(?:use|go\s+with|prefer|let'?s|pick|the\s+.+\s+(?:one|approach|way))\b/i,
      },
      {
        anchors: ["go", "with"],
        signals: ["the", "that", "this", "first", "second", "option"],
        threshold: 0.5,
      },
      {
        anchors: ["prefer"],
        signals: ["the", "this", "that", "approach", "option", "method"],
        threshold: 0.5,
      },
    ];
    const hasChoice = fuzzyMatchPatterns(trimmed, choicePatterns);
    if (hasChoice) {
      const sentence = trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
      return {
        decision: cleanDecisionText(sentence),
        rationale: extractQuestionContext(assistantTail),
      };
    }
  }

  return null;
}

/**
 * Extract a short rationale from the assistant's question context.
 */
function extractQuestionContext(assistantTail: string): string {
  // Find the last question sentence
  const sentences = assistantTail.split(/[.!?]\s+/);
  const questionSentence = sentences.reverse().find((s) => s.includes("?"));
  if (questionSentence && questionSentence.length < 150) {
    return `In response to: ${questionSentence.trim()}?`;
  }
  return "In response to AI question";
}

/**
 * Build an invalidation decision from user correction + assistant context.
 */
function buildInvalidationDecision(
  userContent: string,
  assistantContent: string,
): { decision: string; rationale: string } | null {
  const trimmed = userContent.trim();
  if (trimmed.length < 10) return null;

  // Extract what the user wants instead
  const insteadMatch = trimmed.match(
    /\b(?:instead|actually|rather)\b[,.]?\s*(.{10,200}?)(?:\.|$)/i,
  );
  if (insteadMatch) {
    return {
      decision: `Rejected AI approach; ${cleanDecisionText(insteadMatch[1])}`,
      rationale: deriveRationale(trimmed, insteadMatch[0]) || "Corrected AI direction",
    };
  }

  // "don't X, do Y" pattern
  const dontMatch = trimmed.match(/\b(?:don'?t|do not|stop)\b\s+(.{5,100}?)(?:[,;]|[.]\s)/i);
  if (dontMatch) {
    return {
      decision: `Rejected: ${cleanDecisionText(dontMatch[1])}`,
      rationale: deriveRationale(trimmed, dontMatch[0]) || "Human override of AI direction",
    };
  }

  // Generic invalidation with enough substance
  if (trimmed.length > 30) {
    const sentence = extractSentenceAround(trimmed, 0);
    if (sentence.length > 15 && sentence.length < 300) {
      // Use assistant context for a more informative rationale
      const assistantSnippet = assistantContent.slice(0, 100).replace(/\n/g, " ").trim();
      const rationale =
        assistantSnippet.length > 20
          ? `Overrode AI suggestion: "${assistantSnippet}…"`
          : "Human override of AI direction";
      return {
        decision: `Corrected AI: ${cleanDecisionText(sentence)}`,
        rationale,
      };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function deriveConversationSummary(event: CaptureEvent): string {
  const meta = event.metadata ?? {};
  const title = meta.conversation_title as string | undefined;
  const turns = (meta.turns as RawTurn[] | undefined) ?? [];
  const filesModified = (meta.files_modified as string[] | undefined) ?? [];
  const toolCalls = meta.tool_calls_summary as Array<{ name: string }> | undefined;
  const turnCount = typeof meta.turn_count === "number" ? meta.turn_count : turns.length;

  const parts: string[] = [];

  // Use conversation title if it's better than raw prompt
  if (title && title.length < 200 && !title.startsWith("<command-name>")) {
    // Check if title is just the raw prompt (Go daemon fallback)
    const rawSummary = event.content.summary;
    if (title !== rawSummary) {
      parts.push(title);
    }
  }

  // If no good title, derive from context
  if (parts.length === 0) {
    if (filesModified.length > 0) {
      const fileStr =
        filesModified.length <= 3
          ? filesModified.map((f) => f.split("/").pop()).join(", ")
          : `${filesModified.length} files`;
      parts.push(`Work on ${fileStr}`);
    }

    if (toolCalls && toolCalls.length > 0) {
      const tools = [...new Set(toolCalls.map((t) => t.name))];
      if (tools.length > 0) {
        parts.push(`using ${tools.slice(0, 5).join(", ")}`);
      }
    }
  }

  if (turnCount > 1) {
    parts.push(`(${turnCount} turns)`);
  }

  return parts.length > 0 ? parts.join(" ") : event.content.summary.slice(0, 200);
}

function extractFilesActedOn(event: CaptureEvent): string[] | undefined {
  const meta = event.metadata ?? {};
  const filesModified = (meta.files_modified as string[] | undefined) ?? [];
  const eventFiles = event.content.files ?? [];
  const all = [...new Set([...filesModified, ...eventFiles])];
  return all.length > 0 ? all : undefined;
}

/**
 * Extract the sentence containing the match position from text.
 */
function extractSentenceAround(text: string, matchIndex: number): string {
  // Find sentence boundaries
  const before = text.lastIndexOf(".", matchIndex - 1);
  const after = text.indexOf(".", matchIndex + 20);
  const start = before >= 0 ? before + 1 : 0;
  const end = after >= 0 ? after + 1 : Math.min(text.length, matchIndex + 200);
  return text.slice(start, end).trim();
}

function cleanDecisionText(text: string): string {
  return text
    .replace(/^\s*[-•*]\s*/, "")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function deriveRationale(fullContent: string, decision: string): string {
  // Look for "because", "since", "due to" after the decision
  const idx = fullContent.indexOf(decision);
  if (idx === -1) return "";
  const after = fullContent.slice(idx + decision.length, idx + decision.length + 300);
  const reasonMatch = after.match(/\b(?:because|since|due to|as|so that)\b(.{10,200}?)(?:\.|$)/i);
  if (reasonMatch) return reasonMatch[0].trim();
  return "";
}

function inferDomain(content: string, files: string[]): string | undefined {
  const text = `${content} ${files.join(" ")}`.toLowerCase();

  const domainMap: [RegExp, string][] = [
    [/\b(?:auth|login|session|jwt|token|oauth|password)\b/, "auth"],
    [/\b(?:database|sql|query|migration|schema|table|index)\b/, "database"],
    [/\b(?:api|endpoint|route|rest|graphql|grpc)\b/, "api"],
    [/\b(?:ui|frontend|component|react|vue|css|style|layout)\b/, "ui"],
    [/\b(?:test|spec|jest|vitest|assert|mock)\b/, "testing"],
    [/\b(?:deploy|ci|cd|docker|k8s|pipeline|infra)\b/, "infrastructure"],
    [/\b(?:cache|redis|memcached|performance|latency|optimize)\b/, "performance"],
    [/\b(?:config|setting|env|environment)\b/, "configuration"],
    [/\b(?:error|bug|fix|debug|crash|exception)\b/, "debugging"],
    [/\b(?:refactor|cleanup|reorganize|restructure)\b/, "refactoring"],
  ];

  for (const [pattern, domain] of domainMap) {
    if (pattern.test(text)) return domain;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Normalized keyword similarity + deduplication (exported for cross-source use)
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "was",
  "are",
  "were",
  "be",
  "been",
  "being",
  "to",
  "for",
  "of",
  "in",
  "on",
  "at",
  "by",
  "with",
  "and",
  "or",
  "not",
  "it",
  "its",
  "this",
  "that",
  "these",
  "those",
  "we",
  "i",
  "you",
  "they",
  "he",
  "she",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "shall",
  "can",
  "but",
  "if",
  "from",
  "as",
  "into",
  "about",
  "than",
  "so",
  "no",
  "up",
  "out",
  "have",
  "has",
  "had",
  "my",
  "our",
  "your",
  "their",
  "what",
  "which",
  "who",
  "whom",
  "how",
  "when",
  "where",
  "why",
  "all",
  "each",
  "every",
  "both",
  "some",
  "any",
  "such",
  "more",
  "most",
  "other",
  "just",
  "also",
  "very",
  "too",
  "then",
  "now",
  "here",
  "there",
  "only",
  // Decision-specific stop words that appear in framing but not substance
  "chose",
  "decided",
  "selected",
  "opted",
  "picked",
  "went",
  "approach",
  "option",
  "instead",
  "rather",
  "over",
  "because",
  "using",
  "use",
  "used",
  "corrected",
  "rejected",
  "ai",
  "llm",
]);

/** Trivial English stemming — strips common suffixes */
function stem(word: string): string {
  if (word.length < 4) return word;
  return word.replace(
    /(?:ing|tion|sion|ment|ness|able|ible|ful|less|ous|ive|ize|ise|ated|ting|ted|ed|ly|er|es|s)$/,
    "",
  );
}

/**
 * Extract normalized keywords: lowercase → strip non-alpha → remove stop words → stem.
 * Returns the set of stemmed content words.
 */
function extractKeywordSet(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
  return new Set(words.map(stem));
}

/**
 * Normalized keyword Jaccard: strips stop words, stems, then compares.
 * Much better at catching semantic equivalence than raw word Jaccard.
 */
export function normalizedSimilarity(a: string, b: string): number {
  const setA = extractKeywordSet(a);
  const setB = extractKeywordSet(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const w of setA) {
    if (setB.has(w)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function deduplicateDecisions(decisions: DigestedDecision[]): DigestedDecision[] {
  const result: DigestedDecision[] = [];
  for (const d of decisions) {
    const isDuplicate = result.some(
      (existing) => normalizedSimilarity(existing.decision, d.decision) > 0.4,
    );
    if (!isDuplicate) result.push(d);
  }
  return result;
}

/**
 * Deduplicate DailyDistill decisions across sources.
 * Uses normalized keyword similarity at 0.4 threshold.
 * Prefers earlier entries (higher-quality sources should be added first).
 */
export function deduplicateFinalDecisions(
  decisions: Array<{
    decision: string;
    rationale: string;
    domain?: string;
    alternativesConsidered?: number;
  }>,
): Array<{
  decision: string;
  rationale: string;
  domain?: string;
  alternativesConsidered?: number;
}> {
  const result: typeof decisions = [];
  for (const d of decisions) {
    const isDuplicate = result.some(
      (existing) => normalizedSimilarity(existing.decision, d.decision) > 0.4,
    );
    if (!isDuplicate) result.push(d);
  }
  return result;
}
