// FILE: src/services/knowledge/prompts.ts
// Layer 2.5 KE-7: LLM extraction prompts — the single most important file in the
// knowledge extraction pipeline. Every downstream fact, entity, comprehension score,
// and contradiction detection depends on the quality of these prompts.
//
// Two prompt families:
//   1. Extraction — entities, facts, comprehension, metacognition, agency,
//      sustainability, reasoning chains from developer-AI conversations (and a
//      lighter variant for git commits / terminal events).
//   2. Contradiction classification — pairwise fact relationship assessment.
//
// Prompt engineering patterns applied:
//   - Single-pass multi-extraction (Graphiti pattern) — one call, all dimensions
//   - Rubric-based scoring (LLM-as-Judge research) — explicit criteria per level
//   - Controlled vocabulary embedding — enum values listed in-prompt for Zod compat
//   - Resolution hints — existing entity names prevent duplication

import type { AtomicFact, PersistedFact } from "../../schemas/knowledge.js";
import type { ConversationSegment } from "../../schemas/knowledge.js";
import type { Turn } from "./turn-parser.js";

export const EXTRACTION_PROMPT_VERSION = 1;

// ─── Controlled Vocabularies (embedded in prompts) ──────────────────────────

const ENTITY_TYPES = [
  "technology",
  "pattern",
  "module",
  "concept",
  "architecture",
  "library",
  "service",
  "domain",
] as const;

const FACT_PREDICATES = [
  "USES", "DEPENDS_ON", "IMPLEMENTED_IN", "DEPLOYED_ON", "CONFIGURED_WITH",
  "DECIDED", "CHOSEN_OVER", "REPLACED_BY", "SWITCHED_FROM", "ADOPTED", "DEPRECATED",
  "UNDERSTANDS", "INVESTIGATED", "DEBUGGED", "REFACTORED", "REVIEWED", "TESTED",
  "CREATED", "DESIGNED", "IMPLEMENTED", "EXTENDED",
  "RELATES_TO", "CONFLICTS_WITH", "ENABLES", "BLOCKS",
] as const;

const METACOGNITIVE_SIGNAL_TYPES = [
  "why-question",
  "constraint",
  "alternative",
  "error-catch",
  "strategy-reflect",
  "pushback",
  "knowledge-transfer",
] as const;

const AGENCY_CLASSIFICATIONS = [
  "developer-directed",
  "developer-accepted",
  "developer-rubber-stamped",
  "collaborative",
] as const;

const SUSTAINABILITY_DIRECTIONS = [
  "builds-capability",
  "erodes-capability",
  "neutral",
] as const;

const TEMPORAL_HINTS = ["ongoing", "point-in-time", "supersedes_previous"] as const;

// ─── System Prompts ─────────────────────────────────────────────────────────

export const EXTRACTION_SYSTEM_PROMPT = `You are a knowledge extraction engine that analyzes developer-AI conversations to produce structured intelligence. You extract entities, atomic facts, comprehension scores, metacognitive signals, agency patterns, and reasoning chains.

Output ONLY valid JSON (no markdown fences, no commentary). The JSON must match this exact shape:

{
  "entities": [{
    "name": string,           // canonical display name ("Redis", "useEffect")
    "normalizedName": string, // lowercase key ("redis", "useeffect")
    "type": one of [${ENTITY_TYPES.map((t) => `"${t}"`).join(", ")}],
    "context": string,        // how this entity appears — role, usage, significance
    "confidence": number,     // 0.0–1.0 (0.3 = mentioned in passing, 0.9 = deeply discussed)
    "aliases": string[]       // alternative names detected (["hooks", "React hooks"])
  }],

  "facts": [{
    "subject": string,        // entity name (from entities list)
    "predicate": one of [${FACT_PREDICATES.map((p) => `"${p}"`).join(", ")}],
    "object": string,         // entity name or free-text value
    "confidence": number,     // 0.0–1.0
    "explicit": boolean,      // true = stated directly, false = inferred
    "temporalHint": one of [${TEMPORAL_HINTS.map((t) => `"${t}"`).join(", ")}],
    "context": string         // source quote or evidence from the conversation
  }],

  "comprehension": {
    "dimensions": {
      "steering": number,      // 0–10
      "understanding": number, // 0–10
      "metacognition": number, // 0–10
      "independence": number,  // 0–10
      "engagement": number     // 0–10
    },
    "evidence": string[],      // specific quotes/moments supporting scores
    "rubberStampCount": number,// AI suggestions accepted without modification
    "pushbackCount": number,   // times developer questioned or modified AI output
    "domainTags": string[]     // domains the developer engaged with
  },

  "metacognitiveSignals": [{
    "turnIndex": number,
    "signalType": one of [${METACOGNITIVE_SIGNAL_TYPES.map((s) => `"${s}"`).join(", ")}],
    "quote": string,           // exact text demonstrating metacognition
    "strength": number         // 0.0–1.0
  }],

  "agencyClassification": [{
    "segmentId": string,       // provided in segment headers
    "classification": one of [${AGENCY_CLASSIFICATIONS.map((a) => `"${a}"`).join(", ")}],
    "reasoning": string
  }],

  "sustainabilitySignal": {
    "direction": one of [${SUSTAINABILITY_DIRECTIONS.map((d) => `"${d}"`).join(", ")}],
    "reasoning": string,
    "evidence": string[]
  },

  "reasoningChains": [{
    "decision": string,        // what was decided
    "alternatives": string[],  // what alternatives were considered
    "rationale": string,       // why this option was chosen
    "tradeOffs": string[],     // trade-offs accepted
    "context": string          // source text containing the reasoning
  }]
}

COMPREHENSION SCORING RUBRIC:

steering (developer agency):
  0–3: Developer passively accepts AI output. Minimal direction or requirements.
  4–6: Developer provides goals but accepts most AI decisions. Some redirection.
  7–10: Developer sets clear constraints, redirects the AI, specifies requirements, and shapes output.

understanding (demonstrated comprehension):
  0–3: No evidence developer understood what was produced. Copy-paste behavior.
  4–6: Developer asks clarifying questions or makes minor modifications showing partial understanding.
  7–10: Developer explains concepts back, catches errors, makes informed modifications, or extends solutions.

metacognition (reflective thinking):
  0–3: No reflection on process or approach.
  4–6: Asks "why" questions or considers alternatives.
  7–10: Explicitly reasons about trade-offs, identifies gaps in own knowledge, or reflects on strategy.

independence (capability without AI):
  0–3: Task requires AI scaffolding from start to finish. Developer couldn't proceed alone.
  4–6: Developer handles parts independently, delegates complex/tedious portions to AI.
  7–10: Developer clearly capable — uses AI to accelerate, not to substitute understanding.

engagement (interaction depth):
  0–3: Single-turn or minimal back-and-forth. Shallow interaction.
  4–6: Multi-turn dialogue with moderate depth. Follow-up questions.
  7–10: Deep iterative exploration. Multiple refinement cycles. Thorough investigation.

EXTRACTION RULES:
- Extract ONLY entities and facts that are clearly present in the conversation. Do not infer entities that aren't discussed.
- Every fact must reference entities from the entities list as subject or object.
- Prefer explicit facts (explicit: true) over inferred ones. Mark inferred facts with confidence < 0.7.
- For metacognitive signals, quote the EXACT text from the conversation.
- If no reasoning chains exist (no trade-off discussions), return an empty array.
- Agency classification is per-segment. For single-segment conversations, classify that one segment.
- Sustainability assesses the OVERALL interaction: does it build the developer's capability to work independently, or create dependency?`;

export const EXTRACTION_SYSTEM_PROMPT_GIT = `You are a knowledge extraction engine that analyzes git commits to extract entities and facts. Git commits are non-conversational — they show what a developer changed, not a dialogue.

Output ONLY valid JSON (no markdown fences, no commentary). The JSON must match this shape:

{
  "entities": [{
    "name": string,
    "normalizedName": string,
    "type": one of [${ENTITY_TYPES.map((t) => `"${t}"`).join(", ")}],
    "context": string,
    "confidence": number,
    "aliases": string[]
  }],

  "facts": [{
    "subject": string,
    "predicate": one of [${FACT_PREDICATES.map((p) => `"${p}"`).join(", ")}],
    "object": string,
    "confidence": number,
    "explicit": boolean,
    "temporalHint": one of [${TEMPORAL_HINTS.map((t) => `"${t}"`).join(", ")}],
    "context": string
  }],

  "reasoningChains": [{
    "decision": string,
    "alternatives": string[],
    "rationale": string,
    "tradeOffs": string[],
    "context": string
  }]
}

EXTRACTION RULES:
- Extract entities (technologies, modules, patterns) mentioned in the commit message and file paths.
- Extract facts about what was created, modified, or adopted based on the commit content.
- If the commit message explains a decision or trade-off, extract it as a reasoningChain.
- Do not infer entities that aren't clearly evidenced. Mark inferred facts with confidence < 0.7.`;

export const CONTRADICTION_SYSTEM_PROMPT = `You are a fact relationship classifier for a temporal knowledge graph. Given two facts about the same subject, classify their relationship.

Output ONLY valid JSON:

{
  "classification": one of ["CONSISTENT", "MORE_SPECIFIC", "CONTRADICTORY", "SUPERSEDES", "UNRELATED"],
  "confidence": number,
  "reasoning": string
}

Classification definitions:
- CONSISTENT: Both facts can coexist. No conflict. Example: "project USES Redis" and "project USES PostgreSQL".
- MORE_SPECIFIC: The new fact is a more detailed version of the existing fact. Existing fact remains valid. Example: "project USES Redis" and "project USES Redis FOR session-caching".
- CONTRADICTORY: The facts cannot both be true simultaneously. Example: "project USES Redux" and "project USES Zustand FOR state-management" when Redux was the state management solution.
- SUPERSEDES: The new fact replaces the existing fact — the existing fact was true but is no longer. Example: "project USES Express" → "project SWITCHED_FROM Express" + "project USES Fastify".
- UNRELATED: The facts are about sufficiently different concerns that no relationship exists.

For CONTRADICTORY or SUPERSEDES: the existing fact should be invalidated (its valid_at window closes).
For CONSISTENT, MORE_SPECIFIC, or UNRELATED: no invalidation needed.`;

// ─── Prompt Builders ────────────────────────────────────────────────────────

/**
 * Build the user prompt for knowledge extraction from a developer-AI conversation.
 *
 * For multi-segment conversations, turns are grouped under segment headers so the
 * LLM can produce per-segment agency classifications. For single-segment or
 * non-conversation events, turns are listed sequentially.
 */
export function buildExtractionPrompt(
  turns: Turn[],
  segments: ConversationSegment[],
  eventType: string,
  eventSource: string,
  existingEntities?: string[],
): string {
  const isConversation = eventSource === "ai-session";

  if (!isConversation) {
    return buildGitCommitPrompt(turns, existingEntities);
  }

  const parts: string[] = [];

  parts.push(`Analyze this developer-AI conversation (source: ${eventSource}, type: ${eventType}).`);

  if (existingEntities && existingEntities.length > 0) {
    parts.push(
      `\nKnown entities from prior conversations (reuse these names when the same concept appears):\n${existingEntities.join(", ")}`,
    );
  }

  parts.push("");
  parts.push(formatTurnsWithSegments(turns, segments));
  parts.push("");
  parts.push("Extract the structured JSON now.");

  return parts.join("\n");
}

/**
 * Build the user prompt for contradiction classification between two facts.
 */
export function buildContradictionClassificationPrompt(
  existingFact: AtomicFact | PersistedFact,
  newFact: AtomicFact | PersistedFact,
): string {
  const parts: string[] = [];

  parts.push("Classify the relationship between these two facts about the same subject.");
  parts.push("");
  parts.push("EXISTING FACT:");
  parts.push(formatFactForPrompt(existingFact, "existing"));
  parts.push("");
  parts.push("NEW FACT:");
  parts.push(formatFactForPrompt(newFact, "new"));
  parts.push("");
  parts.push("Classify their relationship as JSON now.");

  return parts.join("\n");
}

// ─── Prompt Formatting Helpers ──────────────────────────────────────────────

/**
 * Format turns grouped by segment boundaries for the LLM.
 * Multi-segment conversations get headers; single-segment conversations are flat.
 */
function formatTurnsWithSegments(
  turns: Turn[],
  segments: ConversationSegment[],
): string {
  if (segments.length <= 1) {
    return formatTurnSequence(turns);
  }

  const parts: string[] = [];

  for (const segment of segments) {
    const [start, end] = segment.turnRange;
    parts.push(
      `--- Segment "${segment.topicLabel}" (${segment.segmentId}, turns ${start}–${end}) ---`,
    );

    const segmentTurns = turns.slice(start, end + 1);
    parts.push(formatTurnSequence(segmentTurns, start));
    parts.push("");
  }

  return parts.join("\n");
}

/**
 * Format a sequence of turns as numbered lines.
 * Truncates individual turn content at 2000 chars to stay within token budgets.
 */
function formatTurnSequence(turns: Turn[], indexOffset = 0): string {
  const lines: string[] = [];
  const MAX_TURN_CHARS = 2000;

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    const displayIndex = turn.index ?? indexOffset + i;
    const role = turn.role.toUpperCase();
    let content = turn.content;

    if (content.length > MAX_TURN_CHARS) {
      content = `${content.slice(0, MAX_TURN_CHARS - 3)}...`;
    }

    let line = `[${displayIndex}] ${role}: ${content}`;

    const annotations: string[] = [];
    if (turn.filesReferenced?.length) {
      annotations.push(`files_ref: ${turn.filesReferenced.join(", ")}`);
    }
    if (turn.filesModified?.length) {
      annotations.push(`files_mod: ${turn.filesModified.join(", ")}`);
    }
    if (turn.toolUse?.length) {
      annotations.push(`tools: ${turn.toolUse.map((t) => t.name).join(", ")}`);
    }

    if (annotations.length > 0) {
      line += `\n    [${annotations.join(" | ")}]`;
    }

    lines.push(line);
  }

  return lines.join("\n");
}

/**
 * Build the simpler git commit / terminal prompt variant.
 * Omits comprehension, metacognition, agency, and sustainability — no dialogue.
 */
function buildGitCommitPrompt(
  turns: Turn[],
  existingEntities?: string[],
): string {
  const parts: string[] = [];
  parts.push("Analyze this git commit / non-conversation event.");

  if (existingEntities && existingEntities.length > 0) {
    parts.push(
      `\nKnown entities (reuse these names when the same concept appears):\n${existingEntities.join(", ")}`,
    );
  }

  parts.push("");

  for (const turn of turns) {
    if (turn.filesModified?.length) {
      parts.push(`Files: ${turn.filesModified.join(", ")}`);
    }
    parts.push(turn.content);
  }

  parts.push("");
  parts.push("Extract entities, facts, and reasoning chains as JSON now.");

  return parts.join("\n");
}

/**
 * Format a single fact for the contradiction classification prompt.
 */
function formatFactForPrompt(
  fact: AtomicFact | PersistedFact,
  label: string,
): string {
  const lines: string[] = [];
  lines.push(`  Subject: ${fact.subject}`);
  lines.push(`  Predicate: ${fact.predicate}`);
  lines.push(`  Object: ${fact.object}`);
  lines.push(`  Confidence: ${fact.confidence}`);
  lines.push(`  Explicit: ${fact.explicit}`);
  lines.push(`  Temporal hint: ${fact.temporalHint}`);
  lines.push(`  Context: "${fact.context}"`);

  if ("validAt" in fact && fact.validAt) {
    lines.push(`  Valid since: ${fact.validAt}`);
  }
  if ("invalidAt" in fact && fact.invalidAt) {
    lines.push(`  Invalidated at: ${fact.invalidAt}`);
  }

  return lines.join("\n");
}

// ─── Utility: Determine which system prompt to use ──────────────────────────

/**
 * Select the appropriate system prompt based on event source.
 * Conversation events use the full extraction prompt with all 7 dimensions.
 * Non-conversation events use the lighter git commit variant.
 */
export function getSystemPromptForEvent(eventSource: string): string {
  return eventSource === "ai-session"
    ? EXTRACTION_SYSTEM_PROMPT
    : EXTRACTION_SYSTEM_PROMPT_GIT;
}

/**
 * Whether this event type produces comprehension data.
 * Used by the caller (KE-8) to know whether to expect comprehension in the output.
 */
export function eventSupportsComprehension(eventSource: string): boolean {
  return eventSource === "ai-session";
}
