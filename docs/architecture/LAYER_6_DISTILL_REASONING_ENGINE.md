# Layer 6: Distill Reasoning Engine

> Transforming Unfade's daily distill from a mechanical activity summary into a high-fidelity, narrative-driven reasoning engine that captures *what mattered and why*, not just *what happened*.

---

## Table of Contents

1. [Overview](#overview)
2. [Root Cause Analysis — Why Distill Falls Short](#root-cause-analysis--why-distill-falls-short)
3. [Target Architecture](#target-architecture)
4. [Stage 0: Signal Triage & Prioritization](#stage-0-signal-triage--prioritization)
5. [Stage 1: Narrative Spine Construction](#stage-1-narrative-spine-construction)
6. [Stage 2: Context Enrichment & Cross-Source Fusion](#stage-2-context-enrichment--cross-source-fusion)
7. [Stage 3: Progressive Synthesis](#stage-3-progressive-synthesis)
8. [Stage 4: Post-Synthesis Enrichment](#stage-4-post-synthesis-enrichment)
9. [Enhanced Schema Definitions](#enhanced-schema-definitions)
10. [LLM Synthesis Upgrade](#llm-synthesis-upgrade)
11. [Fallback Synthesis Upgrade](#fallback-synthesis-upgrade)
12. [UI Transformation — Structured Narrative Rendering](#ui-transformation--structured-narrative-rendering)
13. [Data Flow & Pipeline Architecture](#data-flow--pipeline-architecture)
14. [Design Decisions & Trade-offs](#design-decisions--trade-offs)
15. [Upstream Data Quality — The DRRVE Transformation](#upstream-data-quality--the-drrve-transformation)

---

## Overview

The Daily Distill is Unfade's most visible output — the artifact users read every day to understand their own engineering reasoning. Today it produces a flat markdown document that reads like a git log summary: "Engineering activity on 2026-04-25: 12 commits, 8 AI interactions, across [ui, database, auth]." This tells users what *happened* but not what *mattered*.

**The transformation:** Apply the same rigor that makes the Decision Intelligence Pipeline (Layer 5) effective — strict signal definitions, multi-stage transformation, context-aware interpretation, cross-source dedup, prioritization, structured schemas — to the entire distill output. The result is a **daily reasoning model** with a narrative spine, decision-first hierarchy, impact scoring, temporal coherence, and evidence-linked claims.

### Current state vs. target state

| Dimension | Current | Target |
|-----------|---------|--------|
| **Summary** | Mechanical stat counting: "N commits, N interactions across domains" | Narrative headline: "Pivoted the auth strategy from JWT to session tokens after discovering token refresh failures in mobile clients" |
| **Structure** | Flat sections: Decisions, Trade-offs, Dead Ends (equal weight) | Narrative spine: Context → Problems → Decisions → Trade-offs → Outcomes → Unresolved |
| **Decision quality** | All events passed as candidates; generic rationale | Impact-scored decisions with causal chains: what triggered the decision, what it affected, what evidence supports it |
| **Trade-offs** | Generic: "Developer's approach vs AI suggestion" | Specific: "Chose Postgres over DynamoDB; rejected DynamoDB because eventual consistency conflicts with event ordering requirements" |
| **Evidence** | None — flat markdown with no links back to source events | Every claim links to source events via evidence IDs; clickable in the UI |
| **Narrative** | No story structure; reads as a list | Temporal narrative arc: morning context → problems encountered → key decisions → end-of-day state |
| **Cross-source** | Dedup exists in synthesis but not in the output | Unified view: a single decision that appeared in a commit, an AI conversation, and a branch switch appears once with all three as evidence |
| **LLM prompt** | 6 lines: "Reply with exactly one JSON object" | Multi-section structured prompt with decision-grade rigor, narrative instructions, dedup directives, quality constraints |
| **Fallback path** | Mechanical summary with generic placeholders | Structured narrative builder using signal prioritization, template composition, and causal inference |
| **UI rendering** | Raw markdown blob via ReactMarkdown | Structured components: NarrativeTimeline, DecisionCards with evidence drawers, TradeOffMatrix, ProjectBadges, TemporalArc |
| **Schema** | Flat lists with optional fields | Hierarchical: NarrativeSpine → NarrativeActs → Decisions/TradeOffs/DeadEnds with impact scores, evidence chains, causal links |

### Principles

1. **Quality over cost** — LLM calls, fuzzy algorithms, and specialized text processing are preferred over cheap heuristics. A distill that reads like a story is worth the token cost.
2. **Decision-first hierarchy** — Decisions are the primary organizing unit. Everything else (trade-offs, dead ends, patterns) is contextualized around decisions.
3. **Every claim has evidence** — No statement in the distill exists without source event linkage. If it can't be traced, it doesn't belong.
4. **Narrative coherence** — The distill reads as a temporal story, not a list. Events are connected by causality, not just chronology.
5. **Progressive disclosure** — Summary → Highlights → Full narrative → Evidence drawer → Raw data. Each layer adds detail without overwhelming.

### Files involved

| File | Stage | Role |
|------|-------|------|
| `src/services/distill/distiller.ts` | Orchestrator | Pipeline coordinator — calls each stage, writes both JSON + MD, personalization section ("Your Patterns") |
| `src/services/distill/signal-fusion.ts` | Stage 0 (pre) | Conversation-ID deduplication + source-based active/passive fusion |
| `src/services/distill/signal-extractor.ts` | Stage 0 | Signal extraction with impact scoring (`triageSignals()`) and prioritization |
| `src/services/distill/narrative-builder.ts` | Stage 1 | Constructs narrative spine from prioritized signals (`buildNarrativeSpine()`) |
| `src/services/distill/conversation-digester.ts` | Stage 1.5 | Digests ALL `ai-conversation` events (not just `ai-session`). Fallback: metadata-based decision derivation with noise filtering |
| `src/services/distill/context-linker.ts` | Stage 2 | Context enrichment — cross-references signals with git context, AI conversations, temporal chains |
| `src/services/distill/synthesizer.ts` | Stage 3 | Fallback synthesis with narrative summary builder, tightened noise filters, conversation-title-first decision extraction. LLM prompt: multi-section, priority-tier-based |
| `src/services/distill/post-enricher.ts` | Stage 4 | Evidence linking, project name resolution, continuity thread cross-day linking, narrative markdown generation |
| `src/services/distill/amplifier.ts` | MCP/API | Cross-temporal decision matching (Jaccard ≥0.8, ≥3 shared tokens). Domain trend detection (`detectDomainTrends()`) |
| `src/schemas/distill.ts` | — | Enhanced schemas: NarrativeSpine, NarrativeAct, EnrichedDecision, ImpactScore, ContinuityThread |
| `src/ui/pages/DistillPage.tsx` | UI | Structured narrative rendering with tier-based decision cards, trade-off/dead-end sections, continuity threads, v1 markdown fallback |
| `src/server/routes/distill.ts` | API | `GET /api/distill/:date/enriched` — discriminated union response (v2 structured / v1 markdown) |
| `src/ui/lib/api.ts` | API client | `api.distill.enriched(date)` with full TypeScript types for `EnrichedDistillResponse` |

---

## Root Cause Analysis — Why Distill Falls Short

### Problem 1: The summary is mechanical stat counting

**Where:** `synthesizer.ts` — `synthesizeFallback()` line ~580

```typescript
const summary = `Engineering activity on ${date}: ${commitCount} commits, ${aiCount} AI interactions, across ${domains}.`;
```

**Why it fails:** This tells the user what a `git log --oneline | wc -l` would tell them. No insight, no narrative, no reasoning. The user learns nothing they didn't already know.

**Root cause:** The fallback synthesizer has no model of *importance*. Every commit and AI conversation has equal weight. Without signal prioritization, the summary can only count.

### Problem 2: The LLM system prompt is under-specified

**Where:** `synthesizer.ts` — `distillSystemPromptPortable()` line ~55

The entire system prompt is 6 lines:
```
"You are Unfade's distillation engine."
"Reply with exactly one JSON object and nothing else..."
"Required keys: date, summary, decisions[], eventsProcessed."
"Optional keys: tradeOffs, deadEnds, breakthroughs, patterns, themes, domains..."
"Use only the user message for factual content; do not invent events..."
```

**Why it fails:** Compare with the Decision Intelligence Pipeline's conversation digester, which specifies *exactly* what constitutes a decision (4 types), provides examples, defines priority ordering, and constrains the output format. The distill prompt gives no guidance on:
- What makes a "good" summary (narrative vs. listing)
- How to prioritize decisions by impact
- How to write trade-offs with specificity (not "Developer's approach")
- How to structure the narrative arc
- How to deduplicate across the input sections
- What quality bar to meet

**Root cause:** The prompt was written to produce valid JSON, not high-quality reasoning artifacts. It optimizes for parse-ability over insight.

### Problem 3: Flat list structure enforced by schema

**Where:** `schemas/distill.ts` — `DailyDistillSchema`

```typescript
DailyDistillSchema = z.object({
  date: z.string(),
  summary: z.string(),
  decisions: z.array(DecisionSchema),       // flat list
  tradeOffs: z.array(TradeOffSchema).optional(),  // flat list
  deadEnds: z.array(DeadEndSchema).optional(),    // flat list
  // ...all at the same level, no hierarchy
});
```

**Why it fails:** Decisions, trade-offs, and dead ends are independent flat lists with no relationships between them. In reality:
- A trade-off *belongs to* a decision (you traded off options *while making* a decision)
- A dead end *triggered* a decision (the dead end forced a pivot)
- Multiple decisions form a *narrative arc* (morning exploration → afternoon convergence)

**Root cause:** The schema was designed for storage convenience, not for reasoning representation. A flat list is easy to parse but destroys the causal structure of a day's reasoning.

### Problem 4: Trade-offs use generic placeholders

**Where:** `synthesizer.ts` — `synthesizeFallback()` line ~620

```typescript
const chose = "Developer's approach";
const rejected = "AI suggestion";
```

**Why it fails:** Every trade-off reads identically: "Developer's approach over AI suggestion." This provides zero insight into what was actually chosen or rejected. The user can't distinguish between trading off database choices and trading off UI framework choices.

**Root cause:** The signal extractor marks AI rejections as trade-offs but doesn't extract the *content* of what was rejected or chosen. The rejection event carries `source: "ai-rejection"` but the specific alternatives aren't parsed from the conversation context.

### Problem 5: No evidence linking in the output

**Where:** `distiller.ts` — `formatDistillMarkdown()` and output schema

Decisions in the distill output have no `evidenceEventIds`. The `appendToDecisionsGraph()` function adds evidence IDs to `decisions.jsonl`, but the distill markdown and the distill JSON schema don't carry them.

**Why it fails:** The distill says "Decided to use Postgres" but doesn't say which commit, which AI conversation, or which branch switch led to this decision. The user can't verify, explore, or understand the provenance.

**Root cause:** The distill and the decision graph are separate outputs. Evidence linking was added to the decision graph (Layer 5) but never backported to the distill itself.

### Problem 6: UI renders raw markdown blob

**Where:** `DistillPage.tsx` — entire file

```tsx
<ReactMarkdown remarkPlugins={[remarkGfm]}>{data.content}</ReactMarkdown>
```

**Why it fails:** The UI treats the distill as opaque text. None of the 6 UX enrichment techniques (T1-T6) are applied:
- No project names (T1) — UUIDs would show if present
- No evidence enrichment (T2) — no metadata displayed
- No on-demand detail (T3) — everything visible at once or nothing
- No evidence drawer (T5) — decisions aren't clickable
- No cross-entity filtering (T6) — no project filter

**Root cause:** The distill output is a markdown string, not structured data. The UI can only render what markdown gives it. Structured rendering requires structured data.

### Problem 7: No signal prioritization

**Where:** `signal-extractor.ts` — `extractSignals()`

Every event becomes a candidate with equal weight (AI conversations get 3x in `alternativesCount` but not in the synthesizer's decision ranking). The synthesizer receives a flat list of all candidates and must figure out what matters.

**Why it fails:** On a busy day with 50 commits and 20 AI conversations, the important decisions (architecture pivots, technology choices) are buried alongside routine work (fix typos, update imports). The LLM must do all the prioritization work from context alone, and the fallback path can't do it at all.

**Root cause:** Stage 1 was designed as a pass-through filter (intentionally — see Layer 5 design decision). But the distill needs a triage layer that the decision pipeline doesn't, because the distill must *summarize a whole day* while the decision pipeline processes individual decisions.

### Problem 8: No temporal narrative structure

**Where:** `distiller.ts` — `formatDistillMarkdown()`

```typescript
function formatDistillMarkdown(d: DailyDistill): string {
  const lines: string[] = [
    `# Daily Distill — ${d.date}`, "",
    `> ${d.summary}`, "",
    // Then flat sections: Decisions, Trade-offs, Dead Ends, ...
  ];
}
```

**Why it fails:** The day's events happened in a sequence with causal relationships. Morning exploration led to afternoon decisions which resolved into evening commits. The flat section structure destroys this temporal narrative. "Decisions" lumps together morning and evening decisions without context.

**Root cause:** The markdown formatter receives a flat `DailyDistill` and renders it section-by-section. There's no temporal information in the schema and no narrative structure to render.

---

## Target Architecture

```
CaptureEvents (JSONL, date-partitioned)
       │
       ▼
┌────────────────────┐
│  Pre-Stage         │  fuseSignals() — conversation-ID dedup + source fusion
│  Signal Fusion     │  (signal-fusion.ts)
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│  Stage 0           │  extractSignals() + triageSignals()
│  Signal Triage     │  Impact scoring, priority ranking, noise filtering
│  & Prioritization  │
└────────┬───────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌──────────┐  ┌───────────────────┐
│ Stage 1  │  │ Stage 1.5         │
│ Narrative│  │ Conversation      │  All ai-conversation events + metadata fallback
│ Spine    │  │ Digestion         │
│ Builder  │  │ (fuzzy + meta)    │
└────┬─────┘  └────────┬──────────┘
     │                 │
     ▼                 │
┌──────────────────┐   │
│  Stage 2         │◀──┘
│  Context         │  Enhanced: cross-source fusion, causal chain detection,
│  Enrichment      │  temporal arc building, trade-off content extraction
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Stage 3         │  LLM (upgraded prompt) or Fallback (narrative builder)
│  Progressive     │  + Cross-source dedup + narrative coherence pass
│  Synthesis       │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Stage 4         │  Evidence linking, project resolution,
│  Post-Synthesis  │  continuity threads, decision records
│  Enrichment      │
└────────┬─────────┘
         │
         ▼
   EnrichedDistill (structured JSON + narrative markdown)
         │
         ├──► distills/{date}.md        (narrative markdown)
         ├──► distills/{date}.json      (structured enriched distill — NEW)
         ├──► profile/reasoning_model.json
         ├──► graph/decisions.jsonl
         ├──► graph/domains.json
         └──► metrics/{date}.json
```

---

## Stage 0: Signal Triage & Prioritization

**File:** `src/services/distill/signal-extractor.ts` — enhanced with `triageSignals()`

The current signal extractor passes everything through and relies on downstream stages to filter. The new Stage 0 adds **impact scoring** and **priority ranking** so that downstream stages know what matters.

### Impact scoring model

Every signal candidate (decision, trade-off, dead end, breakthrough) receives an `impactScore: 0-100` computed from weighted factors:

```
Impact Score = Σ(factor_weight × factor_value) / Σ(factor_weight)
```

| Factor | Weight | How it's computed |
|--------|--------|-------------------|
| **Scope** | 30 | Number of files touched. 1 file = 10, 3-5 files = 40, 6-10 files = 70, 10+ files = 100 |
| **Alternatives** | 25 | alternativesConsidered: 0 = 0, 1 = 30, 2 = 60, 3+ = 100 |
| **Cross-source corroboration** | 20 | Same decision/topic appears in multiple source types (AI + git + terminal). 1 source = 20, 2 sources = 60, 3 sources = 100 |
| **Temporal investment** | 15 | Time between first and last related event. <5min = 10, 5-30min = 40, 30min-2h = 70, 2h+ = 100 |
| **Direction signal strength** | 10 | HDS score if available. No HDS = 50 (neutral), HDS ≥ 0.6 = 100, HDS 0.3-0.6 = 60, HDS < 0.3 = 30 |

### Priority tiers

After scoring, signals are sorted into 3 tiers:

| Tier | Impact Score | Treatment |
|------|-------------|-----------|
| **Primary** (headline decisions) | ≥ 60 | Always included in summary and narrative spine. Full detail in LLM prompt. |
| **Supporting** (context decisions) | 30-59 | Included in full narrative. Summarized in LLM prompt. |
| **Background** (routine work) | < 30 | Mentioned in stats only. Omitted from LLM prompt to save tokens. |

### Cross-source corroboration detection

Before scoring, `detectCorroboration()` scans for signals that appear across multiple source types. This uses the same normalized keyword Jaccard from Layer 5 (threshold 0.35 — slightly lower than dedup's 0.4 because cross-source descriptions are more divergent):

```
AI conversation: "Discussed migrating to Postgres for event storage"
Git commit:      "feat: switch event store to Postgres, drop Mongo driver"
Terminal:        "psql unfade_events < schema.sql"
                 ──────────────────────────────
                 corroboration_count = 3 → score = 100
```

Corroborated signals receive the highest scope scores because cross-source appearance proves the work was significant enough to span multiple tools.

### Triage output

```typescript
interface TriagedSignals extends ExtractedSignals {
  /** Signals sorted by impact score, partitioned into tiers */
  prioritized: {
    primary: ScoredSignal[];    // impact ≥ 60
    supporting: ScoredSignal[]; // impact 30-59
    background: ScoredSignal[]; // impact < 30
  };
  /** Cross-source corroboration groups */
  corroborations: CorroborationGroup[];
  /** Day-level summary stats */
  dayShape: {
    dominantDomain: string;
    peakActivityHour: number;
    arcType: "exploration" | "convergence" | "deep-dive" | "scattered" | "routine";
  };
}

interface ScoredSignal {
  signal: ExtractedDecision | ExtractedTradeOff | ExtractedDeadEnd | ExtractedBreakthrough;
  impactScore: number;
  tier: "primary" | "supporting" | "background";
  corroborationGroup?: string;  // links to CorroborationGroup.id
}
```

### Day shape classification

The `arcType` classifies the overall shape of the day to guide narrative tone:

| Arc Type | Detection | Narrative Tone |
|----------|-----------|---------------|
| **exploration** | Many branches touched, high alternatives count, low convergence | "A day of investigating options..." |
| **convergence** | Morning exploration → afternoon focused commits on fewer branches | "Started broad and narrowed to..." |
| **deep-dive** | Most events in one domain/module, few branches, sustained focus | "Deep focus on [module]..." |
| **scattered** | Many domains, many branches, no clear temporal clustering | "Multiple parallel streams of work..." |
| **routine** | Low alternatives, routine commits, few AI conversations | "Steady execution on established patterns..." |

Detection uses heuristics on temporal clustering, branch count, domain diversity, and alternatives density.

---

## Stage 1: Narrative Spine Construction

**File:** `src/services/distill/narrative-builder.ts` — **new file**

The narrative builder takes triaged signals and constructs a **narrative spine** — a temporal, causal structure that the synthesizer (LLM or fallback) renders into prose.

### Narrative spine structure

```typescript
interface NarrativeSpine {
  /** Overall arc of the day */
  arc: {
    type: "exploration" | "convergence" | "deep-dive" | "scattered" | "routine";
    headline: string;           // 1-sentence summary: "Pivoted auth from JWT to sessions"
    openingContext: string;     // What state the day started in
    closingState: string;       // Where things stand at end of day
  };

  /** Ordered sequence of narrative acts (temporal) */
  acts: NarrativeAct[];

  /** Threads that carry across days (unresolved questions, ongoing explorations) */
  continuityThreads: ContinuityThread[];
}

interface NarrativeAct {
  /** Time window this act covers */
  timeWindow: { start: string; end: string };

  /** What drove this act — the trigger */
  trigger: string;   // "Discovered token refresh failures in integration tests"

  /** Primary decisions made in this act */
  decisions: EnrichedDecision[];

  /** Trade-offs evaluated during this act */
  tradeOffs: EnrichedTradeOff[];

  /** Dead ends hit and abandoned */
  deadEnds: EnrichedDeadEnd[];

  /** Causal links to other acts */
  causedBy?: string;  // act ID that led to this one
  ledTo?: string;     // act ID this one triggered
}

interface ContinuityThread {
  /** What was left unresolved */
  question: string;
  /** Evidence events related to the open question */
  evidenceEventIds: string[];
  /** Domain this thread belongs to */
  domain: string;
  /** Whether this continues from a previous day's thread */
  continuedFrom?: string; // date
}
```

### Constructing the spine

```
triaged signals → temporal clustering → causal chain detection → act formation → spine assembly
```

#### Step 1: Temporal clustering

Group signals by time proximity. Events within a 45-minute window that share domain or file overlap form a cluster. The algorithm:

1. Sort all signals by timestamp
2. Initialize first cluster with first signal
3. For each subsequent signal:
   - If within 45 min of cluster's last event AND (same domain OR shared files): merge into cluster
   - Otherwise: start new cluster
4. Clusters with 3+ signals become candidate acts

#### Step 2: Causal chain detection

Within and across clusters, detect causal relationships:

- **Dead end → Decision:** A revert event followed within 60 minutes by a decision in the same domain = the dead end *caused* the decision pivot
- **Exploration → Convergence:** Multiple AI conversations in the same domain followed by a single commit = exploration led to convergence
- **AI conversation → Commit:** An AI conversation mentioning specific files followed by a commit touching those files within 30 minutes = the conversation informed the commit
- **Decision → Trade-off:** A decision with alternativesConsidered ≥ 2 implies at least one trade-off was evaluated

Causal links are stored as `causedBy`/`ledTo` references between acts.

#### Step 3: Act formation

Each temporal cluster with at least one primary-tier signal becomes a `NarrativeAct`. The act inherits:
- Time window from the cluster's first and last event
- Trigger from the first signal's summary or from a causal link
- All decisions, trade-offs, dead ends within the cluster (ordered by impact score)

#### Step 4: Spine assembly

Acts are ordered chronologically. The arc type (from Stage 0) determines the headline template:

| Arc Type | Headline Template |
|----------|------------------|
| exploration | "Investigated [primary domains]: [top decision summaries]" |
| convergence | "Converged on [primary decision] after exploring [alternatives count] options" |
| deep-dive | "Deep focus on [primary domain]: [primary decision summary]" |
| scattered | "Parallel work across [domain count] areas: [top decisions]" |
| routine | "Steady progress: [commit count] changes across [primary domain]" |

The `openingContext` is derived from the first act's trigger. The `closingState` is derived from the last act's outcome.

### Continuity thread detection

Before building the spine, the narrative builder checks for **continuity** with the previous day's distill:

1. Load `distills/{yesterday}.json` (the enriched JSON, not markdown)
2. If it has `continuityThreads`, check if today's signals address any of them (keyword overlap on the thread's question)
3. Matched threads become `continuedFrom` references in today's threads
4. Today's unresolved signals (primary-tier decisions without clear outcomes, dead ends without resolutions) become new continuity threads

---

## Stage 2: Context Enrichment & Cross-Source Fusion

**File:** `src/services/distill/context-linker.ts` — enhanced

The current context linker adds files, repos, and related AI conversations to signals. The enhanced version adds **causal metadata**, **trade-off content extraction**, and **evidence chains**.

### New enrichment capabilities

#### Trade-off content extraction

The current pipeline marks AI rejections as trade-offs with generic `chose: "Developer's approach"`. The enhanced linker extracts specific content:

```
For each trade-off signal:
  1. Find the AI conversation event that was rejected
  2. Extract the last assistant turn before rejection → this is the "rejected" option
  3. Find the user turn that caused rejection → extract the chosen approach
  4. If the user turn contains a decision (via fuzzy token-bag from Layer 5):
     chose = decision.decision
     rejected = summarize(assistant_turn, 100 chars)
  5. Otherwise:
     chose = user_turn summary (first sentence)
     rejected = assistant_turn summary (first sentence)
```

This transforms:
```
Before: { tradeOff: "Rejected AI suggestion", chose: "Developer's approach", rejected: "AI suggestion" }
After:  { tradeOff: "Auth token storage strategy", chose: "Server-side sessions with Redis", rejected: "JWT with refresh token rotation" }
```

#### Evidence chain building

For each decision, build a complete evidence chain — the ordered sequence of events that contributed to this decision:

```typescript
interface EvidenceChain {
  /** Ordered event IDs that form the chain */
  eventIds: string[];
  /** What role each event plays in the chain */
  roles: Map<string, "trigger" | "exploration" | "decision" | "implementation" | "verification">;
  /** Summary of the chain's narrative */
  chainSummary: string;
}
```

Chain construction:
1. Start from the decision's primary event
2. Walk backward in time: find AI conversations, commits, and terminal events that touched the same files or domain within a 4-hour window
3. Classify each event's role:
   - First related event = "trigger" (what started the investigation)
   - AI conversations exploring alternatives = "exploration"
   - The decision event itself = "decision"
   - Commits after the decision on the same files = "implementation"
   - Test runs or verification events after implementation = "verification"
4. Build `chainSummary` from the role sequence: "Triggered by [trigger], explored via [N] AI sessions, decided [decision], implemented in [N] commits"

#### Enriched signal types

```typescript
interface EnrichedDecision extends LinkedDecision {
  impactScore: number;
  evidenceChain: EvidenceChain;
  relatedTradeOffs: string[];     // indices into tradeOffs array
  relatedDeadEnds: string[];      // indices into deadEnds array
  causalTrigger?: string;         // what caused this decision to be needed
  outcome?: string;               // what resulted from this decision (if commits followed)
}

interface EnrichedTradeOff extends LinkedTradeOff {
  /** Specific content of what was chosen and rejected */
  choseDetail: string;
  rejectedDetail: string;
  /** Which decision this trade-off belongs to */
  parentDecisionIndex?: number;
  /** Context from the conversation where the trade-off happened */
  evaluationContext?: string;
}

interface EnrichedDeadEnd extends LinkedDeadEnd {
  /** What the developer tried before abandoning */
  attemptSummary: string;
  /** What decision was made after the dead end */
  pivotDecisionIndex?: number;
  /** How the dead end was detected (revert, explicit abandon, timeout) */
  detectionMethod: "revert" | "branch-abandon" | "explicit" | "timeout";
}
```

---

## Stage 3: Progressive Synthesis

**File:** `src/services/distill/synthesizer.ts` — fallback path redesigned, LLM prompt upgraded

### LLM synthesis upgrade

The new LLM prompt is structured, multi-section, and narrative-aware. See [LLM Synthesis Upgrade](#llm-synthesis-upgrade) for the full prompt.

Key changes:
- **Narrative instruction:** Write a temporal story, not a list. Connect decisions causally.
- **Priority-aware:** Primary signals are presented first with full context. Supporting signals are summarized. Background signals are counted but not detailed.
- **Quality constraints:** Each decision must have a specific rationale (not generic). Each trade-off must name what was chosen and rejected. No "Developer's approach" placeholders.
- **Dedup directive:** Explicit instruction to consolidate cross-source duplicates, keeping the richest version.
- **Schema guidance:** Detailed output schema with examples showing the expected narrative quality level.

### Fallback synthesis upgrade

The new fallback is no longer a mechanical stat counter. See [Fallback Synthesis Upgrade](#fallback-synthesis-upgrade) for full details.

Key changes:
- **Narrative builder:** Uses the narrative spine to compose prose paragraphs from templates, not a single summary sentence.
- **Trade-off specificity:** Pulls extracted content from the enriched trade-off signals instead of using "Developer's approach."
- **Decision-first organization:** Headline decisions appear first with their causal chains. Supporting decisions appear under them.
- **Impact-aware summary:** The summary highlights the highest-impact decisions, not the highest counts.

### Cross-source narrative dedup

After synthesis, a dedup pass runs on the narrative output to ensure the same event doesn't appear as both a decision and a trade-off or dead end trigger. The algorithm:

1. Build a set of all event IDs referenced across all decisions, trade-offs, and dead ends
2. If the same event ID appears in multiple roles, keep it in the highest-priority role:
   - Decision > Trade-off > Dead End > Background
3. Remove duplicate references from lower-priority roles
4. Update the narrative to reflect consolidated references

---

## Stage 4: Post-Synthesis Enrichment

**File:** `src/services/distill/post-enricher.ts` — extracted from `distiller.ts`

After synthesis produces the structured distill, the post-enricher adds cross-cutting concerns that require the full synthesis output.

### Evidence ID propagation

Ensure every decision in the distill output has `evidenceEventIds`:

1. For LLM-synthesized decisions: match decision text against evidence chains built in Stage 2 using normalized keyword Jaccard (0.35 threshold)
2. For fallback-synthesized decisions: evidence chains are already attached from Stage 2
3. Write evidence IDs into both the distill JSON and the decisions graph

### Project resolution

Resolve all `projectId` UUIDs to human-readable labels:

1. Load the global registry (`~/.unfade/state/registry.v1.json`)
2. Build `projectId → label` map
3. Replace/annotate all projectId references in the distill with `projectName`

### Continuity thread linking

1. Check today's continuity threads against the last 7 days of distills
2. If a thread has been open for 3+ days, flag it as a "persistent open question"
3. If today's decisions resolve a previous thread, mark it as `resolved` with the resolving decision's index

### Markdown generation

Generate narrative markdown from the structured distill (replaces `formatDistillMarkdown()`):

```typescript
function generateNarrativeMarkdown(distill: EnrichedDistill): string {
  // Hero section: headline + narrative summary
  // For each act: temporal heading → trigger → decisions (with rationale) → trade-offs → outcomes
  // Unresolved threads section (if any)
  // Stats footer (events processed, domains, etc.)
}
```

The markdown is still written to `distills/{date}.md` for backward compat, but the primary artifact is now `distills/{date}.json` with the full enriched structure.

### Decision record generation

Upgraded from the current basic ADR generation (`decision-records.ts`):
- Only generates records for primary-tier decisions (impact ≥ 60)
- Includes the full evidence chain in the record
- Links back to the distill date for context

---

## Enhanced Schema Definitions

**File:** `src/schemas/distill.ts` — restructured

### EnrichedDistillSchema (replaces DailyDistillSchema for output)

```typescript
const EnrichedDistillSchema = z.object({
  /** ISO date */
  date: z.string(),

  /** Version of the enriched distill format */
  version: z.literal(2),

  /** Narrative spine — the structural backbone */
  narrative: NarrativeSpineSchema,

  /** All decisions, ordered by impact score descending */
  decisions: z.array(EnrichedDecisionSchema),

  /** All trade-offs with specific content */
  tradeOffs: z.array(EnrichedTradeOffSchema).default([]),

  /** Dead ends with attempt summaries and pivot links */
  deadEnds: z.array(EnrichedDeadEndSchema).default([]),

  /** Breakthroughs with trigger context */
  breakthroughs: z.array(EnrichedBreakthroughSchema).default([]),

  /** Patterns detected across the day's activity */
  patterns: z.array(z.string()).default([]),

  /** Domains active this day */
  domains: z.array(z.string()).default([]),

  /** Cross-day continuity threads */
  continuityThreads: z.array(ContinuityThreadSchema).default([]),

  /** Synthesis metadata */
  meta: z.object({
    eventsProcessed: z.number(),
    synthesizedBy: z.enum(["llm", "fallback"]),
    synthesizedAt: z.string(),
    signalCounts: z.object({
      primary: z.number(),
      supporting: z.number(),
      background: z.number(),
    }),
    dayShape: z.object({
      arcType: z.enum(["exploration", "convergence", "deep-dive", "scattered", "routine"]),
      dominantDomain: z.string(),
      peakActivityHour: z.number(),
    }),
  }),
});
```

### EnrichedDecisionSchema

```typescript
const EnrichedDecisionSchema = z.object({
  /** The decision statement — what was decided */
  decision: z.string(),

  /** Why this decision was made — specific, not generic */
  rationale: z.string(),

  /** Engineering domain */
  domain: z.string().optional(),

  /** How many alternatives were evaluated */
  alternativesConsidered: z.number().default(0),

  /** Impact score 0-100 */
  impactScore: z.number().min(0).max(100),

  /** Priority tier */
  tier: z.enum(["primary", "supporting", "background"]),

  /** Project this decision belongs to */
  projectId: z.string().optional(),
  projectName: z.string().optional(),

  /** Ordered evidence chain */
  evidenceEventIds: z.array(z.string()).default([]),

  /** What triggered the need for this decision */
  causalTrigger: z.string().optional(),

  /** What resulted from this decision */
  outcome: z.string().optional(),

  /** Indices of related trade-offs in the tradeOffs array */
  relatedTradeOffIndices: z.array(z.number()).default([]),

  /** Indices of related dead ends in the deadEnds array */
  relatedDeadEndIndices: z.array(z.number()).default([]),

  /** Human Direction Score */
  humanDirectionScore: z.number().min(0).max(1).optional(),

  /** Direction classification */
  directionClassification: z.enum(["human-directed", "collaborative", "ai-suggested"]).optional(),

  /** Which narrative act this decision belongs to */
  actIndex: z.number().optional(),
});
```

### EnrichedTradeOffSchema

```typescript
const EnrichedTradeOffSchema = z.object({
  /** What was being traded off */
  tradeOff: z.string(),

  /** Specific description of what was chosen */
  chose: z.string(),

  /** Specific description of what was rejected */
  rejected: z.string(),

  /** Context: why this trade-off arose */
  context: z.string().optional(),

  /** Which decision this trade-off belongs to */
  parentDecisionIndex: z.number().optional(),

  /** Evidence event IDs */
  evidenceEventIds: z.array(z.string()).default([]),

  /** Project context */
  projectId: z.string().optional(),
  projectName: z.string().optional(),
});
```

### NarrativeSpineSchema

```typescript
const NarrativeSpineSchema = z.object({
  arc: z.object({
    type: z.enum(["exploration", "convergence", "deep-dive", "scattered", "routine"]),
    headline: z.string(),
    openingContext: z.string(),
    closingState: z.string(),
  }),

  acts: z.array(z.object({
    timeWindow: z.object({ start: z.string(), end: z.string() }),
    trigger: z.string(),
    decisionIndices: z.array(z.number()),
    tradeOffIndices: z.array(z.number()),
    deadEndIndices: z.array(z.number()),
    causedBy: z.number().optional(),   // index of the act that caused this one
    ledTo: z.number().optional(),      // index of the act this one triggered
  })),

  continuityThreads: z.array(ContinuityThreadSchema),
});

const ContinuityThreadSchema = z.object({
  question: z.string(),
  evidenceEventIds: z.array(z.string()).default([]),
  domain: z.string(),
  continuedFrom: z.string().optional(),  // date
  resolved: z.boolean().default(false),
  resolvingDecisionIndex: z.number().optional(),
});
```

### Backward compatibility

The existing `DailyDistillSchema` is preserved for backward compat. The enriched distill includes a `toV1()` method that flattens the enriched structure back to the v1 schema:

```typescript
function enrichedToV1(enriched: EnrichedDistill): DailyDistill {
  return {
    date: enriched.date,
    summary: enriched.narrative.arc.headline,
    decisions: enriched.decisions.map(d => ({
      decision: d.decision,
      rationale: d.rationale,
      domain: d.domain,
      alternativesConsidered: d.alternativesConsidered,
      projectId: d.projectId,
    })),
    tradeOffs: enriched.tradeOffs.map(t => ({
      tradeOff: t.tradeOff,
      chose: t.chose,
      rejected: t.rejected,
      context: t.context,
    })),
    deadEnds: enriched.deadEnds.map(d => ({
      description: d.description ?? d.attemptSummary,
      timeSpentMinutes: d.timeSpentMinutes,
      resolution: d.resolution,
    })),
    eventsProcessed: enriched.meta.eventsProcessed,
    synthesizedBy: enriched.meta.synthesizedBy,
    domains: enriched.domains,
    patterns: enriched.patterns,
  };
}
```

---

## LLM Synthesis Upgrade

**File:** `src/services/distill/synthesizer.ts` — `distillSystemPrompt()`

### New system prompt

```
You are Unfade's reasoning distillation engine. Your job is to transform a day's raw engineering signals into a high-fidelity narrative that captures WHAT MATTERED AND WHY — not a list of what happened.

## Output Format

Return a single JSON object conforming to the schema below. Every field marked "required" must be present and non-empty.

## Quality Requirements

1. NARRATIVE SUMMARY: Write the summary as a 2-3 sentence narrative that a developer would want to read the next morning. Lead with the most impactful decision. Connect events causally ("After discovering X, pivoted to Y because Z"). Never write stat-counting summaries like "12 commits and 8 AI interactions."

2. DECISIONS: Each decision MUST have:
   - A specific "decision" statement (what was chosen)
   - A specific "rationale" (WHY it was chosen — not "for better results" but the actual reasoning)
   - An "impactScore" (0-100) based on: scope of files affected, alternatives evaluated, cross-source corroboration
   - A "causalTrigger" if known (what problem or discovery led to this decision)
   - An "outcome" if known (what commit or result followed)

3. TRADE-OFFS: Each trade-off MUST name specific alternatives:
   - "chose": What was actually selected (e.g., "Server-side sessions with Redis")
   - "rejected": What was considered and rejected (e.g., "JWT with refresh token rotation")
   - NEVER use generic placeholders like "Developer's approach" or "AI suggestion"

4. DEDUPLICATION: The input contains signals from multiple sources (AI conversations, git commits, terminal). The SAME decision often appears in multiple sources with different wording. You MUST consolidate duplicates — keep the richest version, merge evidence event IDs.

5. NARRATIVE STRUCTURE: Organize decisions into temporal acts. If the day had a clear arc (morning exploration → afternoon convergence), reflect that in the act structure. Each act should have a "trigger" explaining what prompted the work.

6. DEAD ENDS: Describe what was attempted and WHY it was abandoned. Include the pivot decision if one followed.

## Input Sections

The input contains these sections, ordered by signal quality:
- PRIMARY SIGNALS (impact ≥ 60): Full context provided. These are the day's most important decisions.
- SUPPORTING SIGNALS (impact 30-59): Summarized. Context decisions that support the primary narrative.
- CONVERSATION DIGESTS: Pre-extracted decisions from AI sessions with specific rationale.
- GIT ACTIVITY: Commits with branch, files, and timing.
- CORROBORATION GROUPS: Signals that appear across multiple sources — these are likely the most significant decisions of the day.

## Schema
{schema}
```

### Prompt construction

The new `buildLLMPrompt()` allocates budget by priority tier, not by source type:

| Section | Budget share | Content |
|---------|-------------|---------|
| Primary signals | 40% | Full signal detail: summary, files, branch, evidence, alternatives |
| Corroboration groups | 15% | Cross-source signal groups with all source details |
| Conversation digests | 20% | Pre-extracted decisions, trade-offs from Stage 1.5 |
| Supporting signals | 15% | Summarized signals (1 line each) |
| Git activity (background) | 10% | Commit count, domain summary, branch list |

This ensures the LLM focuses on what matters most. Background signals are counts only, freeing tokens for detailed primary signals.

---

## Fallback Synthesis Upgrade

**File:** `src/services/distill/synthesizer.ts` — `synthesizeFallback()`

The fallback path no longer produces `"Engineering activity on {date}..."`. Instead, it uses the narrative spine to compose structured prose.

### Narrative summary builder

```typescript
function buildFallbackSummary(spine: NarrativeSpine, decisions: EnrichedDecision[]): string {
  const primaryDecisions = decisions.filter(d => d.tier === "primary");

  if (primaryDecisions.length === 0) {
    // Routine day — focus on domains and volume
    return `Steady progress across ${spine.arc.dominantDomain}: ${decisions.length} decisions ` +
           `maintained momentum on established patterns.`;
  }

  // Lead with the highest-impact decision
  const top = primaryDecisions[0];
  let summary = top.decision;

  // Add causal context if available
  if (top.causalTrigger) {
    summary = `${top.causalTrigger} — ${summary.charAt(0).toLowerCase()}${summary.slice(1)}`;
  }

  // Add secondary decisions if they exist
  if (primaryDecisions.length > 1) {
    const otherDomains = [...new Set(primaryDecisions.slice(1).map(d => d.domain).filter(Boolean))];
    if (otherDomains.length > 0) {
      summary += `. Also advanced work in ${otherDomains.join(", ")}`;
    }
  }

  return summary + ".";
}
```

### Trade-off content for fallback

Instead of `"Developer's approach"`, the fallback uses extracted content from Stage 2:

```typescript
function buildFallbackTradeOff(enriched: EnrichedTradeOff): TradeOff {
  return {
    tradeOff: enriched.tradeOff,
    chose: enriched.choseDetail || enriched.chose,        // specific content from context extraction
    rejected: enriched.rejectedDetail || enriched.rejected, // specific content from context extraction
    context: enriched.context,
  };
}
```

### Decision-first organization

The fallback synthesizer now orders decisions by impact score and groups them by narrative act:

1. **Headline decisions** (primary tier): Full presentation with rationale and evidence count
2. **Context decisions** (supporting tier): One-line summaries grouped by domain
3. **Background work**: Aggregate counts by domain

---

## UI Transformation — Structured Narrative Rendering

**File:** `src/ui/pages/DistillPage.tsx` — rewritten (evidence drawer and project filter pending Phase 6)

The current UI renders raw markdown. The new UI renders structured components from the enriched JSON, with all 6 UX enrichment techniques applied.

### Data fetching

```typescript
// New API endpoints
api.distill.enrichedByDate(date: string) → EnrichedDistill   // primary
api.distill.byDate(date: string) → DistillResponse            // fallback for v1 distills
```

The page first attempts to load the enriched JSON. If unavailable (pre-upgrade distills), falls back to markdown rendering.

### Component hierarchy

```
DistillPage
├── DateNavigation (prev/next arrows, date display)
├── ProjectFilter (T6 — dropdown when multiple projects)
├── NarrativeHero
│   ├── Headline (narrative arc headline — NOT stat counting)
│   ├── ArcTypeBadge ("Deep Dive" / "Convergence" / "Exploration" / ...)
│   ├── DomainBadges (active domains this day)
│   ├── FreshnessBadge (R-3 compliance)
│   └── MetaStats (events processed, synthesis method, signal counts)
├── NarrativeTimeline
│   └── For each NarrativeAct:
│       ├── ActHeader (time window, trigger)
│       ├── DecisionCard[] (T3 — click for detail)
│       │   ├── Decision text + rationale
│       │   ├── ImpactBadge (score + tier)
│       │   ├── DirectionLabel ("You directed" / "Collaborative" / "AI suggested")
│       │   ├── ProjectBadge (T1 — human name, not UUID)
│       │   ├── DomainBadge
│       │   ├── EvidenceCount badge
│       │   └── CausalTrigger (if present)
│       ├── TradeOffCard[] (specific chose/rejected — NOT generic)
│       │   ├── TradeOff description
│       │   ├── Chose / Rejected with specific content
│       │   └── Context
│       └── DeadEndCard[] (what was attempted + pivot)
├── ContinuityThreads (unresolved questions with domain badges)
├── EvidenceDrawer (T5 — slide-over on decision click)
│   ├── EvidenceChainTimeline (ordered events with role labels)
│   ├── EvidenceEventCard[] (reused from DecisionsPage)
│   └── MetricsPanel (impact, domain, project, direction, evidence count)
└── LegacyMarkdownView (fallback for v1 distills)
```

### UX enrichment techniques applied

| Technique | Implementation |
|-----------|---------------|
| **T1: UUID → Human Name** | `projectId` resolved to `projectName` via enriched distill. ProjectBadge component shows label. |
| **T2: Evidence Enrichment** | Each decision shows causal trigger, outcome, impact score. Trade-offs show specific chose/rejected. |
| **T3: On-Demand Detail** | Click any decision card → evidence drawer with full chain. List shows summary only. |
| **T4: Remove Artificial Caps** | No `.slice()` caps. All decisions, trade-offs, dead ends shown. Narrative acts provide natural grouping. |
| **T5: Evidence Drawer** | `EvidenceDrawer` slide-over with evidence chain timeline, role labels, rich event cards. |
| **T6: Cross-Entity Filtering** | Project filter dropdown. Domain filter. Date navigation. |

### Evidence chain timeline

When a decision is clicked, the evidence drawer shows the chain as a timeline:

```
[trigger] ────► [exploration] ────► [decision] ────► [implementation] ────► [verification]
  │                 │                    │                   │                     │
  │  "Found token   │  "Discussed auth   │  "Chose sessions  │  "feat: implement   │  "Tests pass
  │   refresh bug"  │   strategies with   │   over JWT"       │   session store"    │   for session
  │                 │   Claude"           │                   │                     │   auth"
  │                 │                     │                   │                     │
  └─ Git (test)    └─ AI Session         └─ AI Session       └─ Git (commit)      └─ Terminal
```

Each node in the timeline is an `EvidenceEventCard` (reused from the Decisions page — shared component).

---

## Data Flow & Pipeline Architecture

### Full pipeline data flow

```
CaptureEvents (JSONL)
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│  Pre-Stage: Signal Fusion                                    │
│                                                              │
│  fuseSignals(events)                                         │
│       → deduplicateByConversationId() (keep latest per ID)   │
│       → source-based active/passive dedup                    │
│       → deduplicated CaptureEvent[]                          │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  Stage 0: Signal Triage & Prioritization                    │
│                                                              │
│  extractSignals(events, date)                                │
│       → ExtractedSignals (decisions, tradeOffs, deadEnds...) │
│                                                              │
│  triageSignals(extracted)                                    │
│       → TriagedSignals (scored, tiered, corroborated)        │
│                                                              │
│  classifyDayShape(triaged)                                   │
│       → dayShape: { arcType, dominantDomain, peakHour }      │
└──────────────────────────┬───────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              │                         │
              ▼                         ▼
┌─────────────────────┐   ┌───────────────────────┐
│  Stage 1: Narrative │   │  Stage 1.5: Convo     │
│  Spine Builder      │   │  Digestion            │
│                     │   │  (fuzzy + metadata)   │
│  temporal cluster   │   │                       │
│  → causal chains    │   │  digestConversations() │
│  → act formation    │   │  filter: type=ai-conv │
│  → spine assembly   │   │  fallback: metadata   │
│  → continuity       │   │  → Map<id, Digest>    │
└────────┬────────────┘   └───────────┬───────────┘
         │                            │
         ▼                            │
┌──────────────────────────────┐      │
│  Stage 2: Context Enrichment │◀─────┘
│  & Cross-Source Fusion       │
│                              │
│  linkContext(signals, events) │
│  + enrichTradeOffs()         │
│  + buildEvidenceChains()     │
│  + detectCausalTriggers()    │
│  → EnrichedLinkedSignals     │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│  Stage 3: Progressive        │
│  Synthesis                   │
│                              │
│  LLM path:                   │
│    buildStructuredPrompt()    │
│    → LLM call                │
│    → parse + validate        │
│                              │
│  Fallback path:              │
│    buildFallbackNarrative()  │
│    → template composition    │
│    → impact-aware summary    │
│                              │
│  Both paths:                 │
│    narrativeDedup()           │
│    → EnrichedDistill          │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│  Stage 4: Post-Synthesis     │
│  Enrichment                  │
│                              │
│  propagateEvidenceIds()      │
│  resolveProjectNames()       │
│  linkContinuityThreads()     │
│  generateNarrativeMarkdown() │
│  generateDecisionRecords()   │
└──────────────┬───────────────┘
               │
               ▼
         EnrichedDistill
               │
               ├──► distills/{date}.json    (primary — enriched structure)
               ├──► distills/{date}.md      (narrative markdown — backward compat)
               ├──► profile/reasoning_model.json
               ├──► graph/decisions.jsonl   (with evidence IDs)
               ├──► graph/domains.json
               └──► metrics/{date}.json
```

### Schema progression through the pipeline

```
CaptureEvent[]                       (raw events from JSONL)
       │
       ▼
CaptureEvent[] (deduplicated)        (Pre-stage: conversation-ID dedup + source fusion)
       │
       ▼
ExtractedSignals                     (Stage 0 output — same as Layer 5)
  ├── decisions, tradeOffs, deadEnds, breakthroughs, debuggingSessions, stats
       │
       ▼
TriagedSignals                       (Stage 0.5 output — NEW)
  ├── ...ExtractedSignals
  ├── prioritized: { primary[], supporting[], background[] }
  ├── corroborations: CorroborationGroup[]
  └── dayShape: { arcType, dominantDomain, peakActivityHour }
       │
       ├──── ConversationDigest[]    (Stage 1.5 — all ai-conversation events, metadata fallback)
       │
       ▼
NarrativeSpine                       (Stage 1 output — NEW)
  ├── arc: { type, headline, openingContext, closingState }
  ├── acts: NarrativeAct[]           { timeWindow, trigger, decisionIndices, ... }
  └── continuityThreads[]
       │
       ▼
EnrichedLinkedSignals                (Stage 2 output — enhanced)
  ├── decisions[]: EnrichedDecision  { ...linked + impactScore, evidenceChain, causalTrigger, outcome }
  ├── tradeOffs[]: EnrichedTradeOff  { ...linked + choseDetail, rejectedDetail, parentDecisionIndex }
  ├── deadEnds[]: EnrichedDeadEnd    { ...linked + attemptSummary, pivotDecisionIndex }
  └── ...rest
       │
       ▼
EnrichedDistill                      (Stage 3+4 output — FINAL)
  ├── date, version: 2
  ├── narrative: NarrativeSpine
  ├── decisions[]: EnrichedDecision  (with evidence IDs, project names)
  ├── tradeOffs[]: EnrichedTradeOff  (with specific chose/rejected content)
  ├── deadEnds[]: EnrichedDeadEnd    (with attempt summaries and pivot links)
  ├── continuityThreads[]
  └── meta: { eventsProcessed, synthesizedBy, signalCounts, dayShape }
```

---

## Design Decisions & Trade-offs

### Why add impact scoring instead of relying on LLM prioritization?

**Chose:** Explicit impact scoring (0-100) computed before synthesis
**Over:** Passing all signals to the LLM and letting it prioritize
**Rationale:** The fallback path has no LLM — it needs a computational prioritization signal. Even for the LLM path, pre-scoring focuses the limited token budget on what matters. Impact scoring uses objective factors (file count, alternatives, cross-source corroboration) that the LLM would have to infer from context. The LLM can still override the scoring in its narrative, but it starts with a clear signal of what the pipeline considers important.

### Why a narrative spine instead of flat sections?

**Chose:** Hierarchical NarrativeSpine → NarrativeAct[] structure
**Over:** Current flat {decisions[], tradeOffs[], deadEnds[]} structure
**Rationale:** A developer's day has temporal structure — morning exploration, afternoon convergence, evening cleanup. Flat lists destroy this structure. The narrative spine preserves it, enabling both the LLM and the fallback to produce temporally coherent output. It also enables the UI to render a timeline view instead of a list view. The cost is schema complexity, but the schema is internal (not user-facing) and the v1 compat layer handles backward compat.

### Why extract trade-off content from conversation context?

**Chose:** Parse AI conversation turns to extract specific chose/rejected content
**Over:** Using generic "Developer's approach" / "AI suggestion" labels
**Rationale:** A trade-off that says "Chose server-side sessions over JWT" is actionable and memorable. "Developer's approach over AI suggestion" is meaningless. The extraction adds compute cost (scanning conversation turns, running fuzzy matching) but transforms a useless data point into a useful one. The fallback path already has the conversation data available — it just wasn't being parsed for this purpose.

### Why a separate Stage 4 (post-synthesis) instead of doing it in Stage 3?

**Chose:** Separate post-synthesis enrichment stage
**Over:** Embedding evidence linking and project resolution in the synthesizer
**Rationale:** The synthesizer (Stage 3) produces semantic content (narrative, decisions, rationale). Evidence linking and project resolution are mechanical transformations that need the synthesis output as input. Separating them keeps the synthesizer focused on quality and the enricher focused on completeness. It also means the same enrichment runs regardless of whether the LLM or fallback path was used.

### Why write both JSON and markdown?

**Chose:** Dual output: `{date}.json` (enriched structure) + `{date}.md` (narrative markdown)
**Over:** JSON only (breaking markdown consumers) or markdown only (limiting UI)
**Rationale:** The markdown format is consumed by the MCP `unfade_distill` tool, the `unfade history` CLI command, and any user who reads the files directly. Breaking markdown would break these consumers. The JSON format enables the new structured UI and evidence drawer. Writing both is cheap — the markdown is generated from the JSON structure, so there's no redundant computation.

### Why 45-minute temporal clustering window?

**Chose:** 45-minute window for temporal clustering
**Over:** 30-minute or 60-minute windows
**Rationale:** Developer flow sessions typically last 30-90 minutes. A 30-minute window would split single work sessions into multiple acts. A 60-minute window would merge distinct work sessions (e.g., morning standup notes + post-standup coding). 45 minutes with the additional requirement of domain/file overlap provides a good balance. The window is a constant that can be tuned based on observed distill quality.

### Why 0.35 Jaccard threshold for corroboration (vs. 0.4 for dedup)?

**Chose:** 0.35 threshold for cross-source corroboration detection
**Over:** Using the same 0.4 threshold as dedup
**Rationale:** Cross-source descriptions of the same work are more divergent than within-source duplicates. A commit message ("feat: migrate to Postgres") and an AI conversation summary ("Discussed database migration strategy for the event store") describe the same work but share fewer keywords after normalization. The lower threshold catches these cross-source links without introducing false positives, because the additional requirement of temporal proximity (within 4 hours) provides a secondary filter.

### Why quality over cost for the LLM prompt?

**Chose:** Detailed multi-section prompt with examples and quality constraints
**Over:** Minimal prompt (current: 6 lines)
**Rationale:** This is the user's daily artifact — the thing they read every morning. A minimal prompt produces mechanical output that users stop reading after a week. A structured prompt with quality constraints produces narrative output that provides genuine insight. The additional tokens in the prompt (est. ~800 tokens vs. current ~100) are negligible compared to the input tokens (3,000-10,000 depending on day activity). The ROI on prompt quality is enormous because the output quality improvement is directly visible to users.

### Why preserve the v1 DailyDistillSchema?

**Chose:** Keep v1 schema and provide `enrichedToV1()` converter
**Over:** Migrating all consumers to v2
**Rationale:** Multiple consumers depend on the v1 schema: profile updater, graph appender, MCP tools, metric snapshots, CLI commands. Migrating all at once is risky and unnecessary. The v1 schema is a valid subset of v2 (every v2 distill can produce a valid v1). Consumers can be migrated incrementally to consume enriched data when they benefit from it.

---

## Upstream Data Quality — The DRRVE Transformation

The enriched schema, narrative builder, and structured UI were well-designed but produced no useful output. The root cause was upstream: all captured events were AI conversations (zero commits), the signal extractor's primary path (git→decision) produced nothing, and fallback paths echoed raw prompts as "decisions." This section documents the systematic fixes that transformed distill output from random text ("1077 AI interactions... Recurring: 'need' 228 times") into usable daily narratives.

### Signal Fusion: Conversation-ID Deduplication

**File:** `src/services/distill/signal-fusion.ts`

**Problem:** The Go daemon captures the same AI conversation at multiple points during a session. Events sharing the same `conversation_id` all passed through `fuseSignals()` as separate events, inflating event counts (17K+ events for what was actually ~50 conversations).

**Fix:** `deduplicateByConversationId()` runs as the **first pass** before source-based active/passive fusion. For each `conversation_id`, only the latest event (most complete snapshot) is kept:

```typescript
function deduplicateByConversationId(events: CaptureEvent[]): CaptureEvent[] {
  const byConvId = new Map<string, CaptureEvent>();
  const noConvId: CaptureEvent[] = [];

  for (const e of events) {
    const convId = e.metadata?.conversation_id as string | undefined;
    if (!convId) { noConvId.push(e); continue; }

    const existing = byConvId.get(convId);
    if (!existing || new Date(e.timestamp) > new Date(existing.timestamp)) {
      byConvId.set(convId, e);
    }
  }

  return [...noConvId, ...byConvId.values()];
}
```

This is called at the top of `fuseSignals()`:
```
fuseSignals(events) → deduplicateByConversationId(events) → source-based active/passive dedup → deduplicated events
```

Events without a `conversation_id` pass through unchanged (git commits, terminal events).

### Conversation Digester: Universal AI Event Processing

**File:** `src/services/distill/conversation-digester.ts`

**Problem:** `digestConversations()` filtered for `e.source === "ai-session"` only. The Go daemon's global AI capture writes events with `source: "ai-global"`, which were never digested. Most AI conversation events silently bypassed the digester.

**Fix:** Changed the filter to match on event **type** instead of **source**:

```typescript
const aiConversations = events.filter((e) => e.type === "ai-conversation");
```

This processes ALL ai-conversation events regardless of source (`ai-session`, `ai-global`, `mcp-active`), since conversation-ID deduplication already ran upstream.

#### Metadata-Based Decision Derivation

**Problem:** The fallback digester (`digestFallback()`) extracted decisions only from user turn text. When conversations had no clear decision language in turns, no decision was produced — even if the conversation modified files and had a meaningful title.

**Fix:** Added a fallback chain when turn-level analysis finds nothing:

```
Turn-level analysis → (empty) → deriveDecisionFromMetadata(title, filesModified, toolCalls)
```

`deriveDecisionFromMetadata()` produces decisions from structured metadata in priority order:

1. **Conversation title** — if meaningful (>10 chars, <200 chars, not noisy): use as decision text. "Implement auth middleware" is a clean decision.
2. **File modifications** — if files exist: `"Work on [topDir]: file1, file2, file3 (+N more)"`. A conversation that modified 5 files in `src/auth/` is clearly "auth work."
3. **Tool calls** — if tool usage exists: `"Development: Read, Edit, Write (5 calls on auth.ts)"`. Describes what was done, not what was typed.

#### Noise Filtering

Added `RAW_PROMPT_NOISE` patterns and `isNoisyText()` helper to both the turn-level analysis and metadata fallback:

```typescript
const RAW_PROMPT_NOISE = [
  /^(I need|I want|please|can you|hey|go through|check|verify|look at|read|show me|help me|fix|do |make |let'?s |tell me|explain|what |how |why |don'?t|do not)\b/i,
  /^The (codebase|project|repo|code|system|file|directory|folder)\b/i,
  /^(Based on|According to|Looking at|After reading|From the|In the|As per)\b/i,
  /^(Now |OK |Sure |Yes |No |Alright |So |Well |Right )/i,
  /^\//,                                     // Slash commands
  /\/Users\/|\/home\/|\/var\/|C:\\|[A-Z]:\\/,  // File path dumps
];
```

### Synthesizer: Narrative-First Output

**File:** `src/services/distill/synthesizer.ts`

Three interlocking changes transform the synthesizer from a stat counter into a narrative engine.

#### 1. Tightened Decision Detection

**Problem:** `DECISION_RE` matched broadly — "implementing", "adding", "creating" matched virtually every conversation, because those are activity verbs, not decision language.

**Fix:** Restricted to **deliberate choice language only**:

```typescript
const DECISION_RE =
  /\b(chose|decided|switch(?:ed|ing)\s+(?:to|from)|replac(?:ed|ing)\s+\w+\s+with|migrat(?:ed|ing)|revert(?:ed|ing)|trade.?off|instead of|rather than|opt(?:ed|ing)\s+(?:for|to)|picked|selected|redesign(?:ed|ing)|rewrit(?:e|ten)|adopt(?:ed|ing)|deprecat(?:ed|ing))\b/i;
```

Added two additional noise filters that work alongside `RAW_PROMPT_RE`:

- **`EXTENDED_NOISE_RE`** — catches codebase descriptions ("The codebase at..."), hedging ("Based on...", "Looking at..."), and conversational filler ("Now ", "OK ", "Sure ")
- **`PATH_NOISE_RE`** — catches file path dumps in the first 60 characters (`/Users/`, `/home/`, `C:\`)

All three filters are applied in `extractQualityDecisions()` before any decision passes through.

#### 2. Conversation-Title-First Decision Extraction

**Problem:** AI conversation decisions were extracted from the raw summary (the user's first prompt). Even after noise filtering, truncated prompts became "decisions."

**Fix:** `extractQualityDecisions()` now follows this priority:

1. **Conversation digests** (highest quality — LLM-extracted or fallback-derived with metadata)
2. **Git commits** with meaningful messages (≥10 chars)
3. **AI conversations without a digest** — and here the key change:
   - First: prefer `conversationMeta.conversationTitle` if it passes all noise filters
   - Then: fall back to cleaned summary only if it has structural signals (`filesModified`, `turnCount ≥ 3`, or deliberate decision language)
   - `cleanDecisionText()` still prefers title, extracts first sentence from long text, and returns null if nothing clean survives

#### 3. Narrative Summary Builder

**Problem:** `buildNarrativeSummary()` counted commits and AI interactions: "Engineering activity on 2026-04-25: 12 commits, 8 AI interactions, across [ui, database, auth]."

**Fix:** Complete rewrite to lead with accomplishments:

```typescript
function buildNarrativeSummary(linked, decisions, deadEnds, stats): string {
  const parts: string[] = [];

  // Lead with the top decision — what was actually done
  if (decisions.length > 0) {
    parts.push(decisions[0].decision);
    if (decisions.length > 1) {
      parts.push(`Also: ${decisions.slice(1, 3).map(d => d.decision).join("; ")}.`);
    }
  }

  // Domain context
  if (stats.domains.length > 0) parts.push(`Active in ${stats.domains.join(", ")}.`);

  // Commits shipped (if any)
  if (stats.commitCount > 0) parts.push(`${stats.commitCount} commits shipped.`);

  // Dead ends (high-signal friction)
  if (deadEnds?.length > 0) parts.push(`Hit ${deadEnds.length} dead end(s).`);

  // Session depth — count unique conversation titles as proxy
  const sessionTitles = new Set(linked.decisions.map(d => d.conversationMeta?.conversationTitle).filter(Boolean));
  if (sessionTitles.size > 0) parts.push(`Across ${sessionTitles.size} AI sessions.`);

  return parts.join(" ") || "Light activity day.";
}
```

### Amplifier: Cross-Day Decision Matching & Domain Trends

**File:** `src/services/distill/amplifier.ts`

The amplifier is an **MCP/API endpoint** (`unfade_amplify`, `unfade_similar`), not part of the distill pipeline. It finds cross-temporal connections between today's decisions and past decisions.

#### Tightened Matching Thresholds

**Problem:** `RELEVANCE_THRESHOLD = 0.7` Jaccard similarity produced too many shallow matches.

**Fix:**
- Raised `RELEVANCE_THRESHOLD` from `0.7` to `0.8`
- Added `MIN_SHARED_TOKENS = 3` — matches now require at least 3 shared non-stopword tokens, not just a high ratio on small token sets

#### Domain Trend Detection

**Problem:** The old `cross-session-detector.ts` (now dead code — nothing imports it) generated word-frequency "insights" like "Recurring: 'branch' 204 times across 31 days." This was noise, not insight.

**Fix:** Added `detectDomainTrends()` as a new export — meaningful cross-day patterns instead of word frequencies:

```typescript
export interface DomainTrend {
  type: "focus-streak" | "new-domain" | "domain-shift";
  description: string;
  domain: string;
  days?: number;
}
```

Detection logic:
- **Focus streak:** ≥3 consecutive days working in the same domain → `"5 consecutive days in auth"`
- **New domain:** First-ever appearance of a domain in 30-day history → `"First time working in infra"`
- **Domain shift:** Yesterday's domain set differs completely from today's → `"Shifted from auth to UI"`

### Personalization Section: Guard Against Degenerate Data

**File:** `src/services/distill/distiller.ts` — `formatPersonalizationSection()`

**Problem:** Output like "Decision style: You evaluate 0.0 alternatives on average. AI acceptance rate: 100%" — meaningless numbers when insufficient data exists.

**Fixes:**

1. **Guard clause:** Returns empty string if `profile.dataPoints < 5` or `avgAlternativesEvaluated === 0`. No broken metrics shown.
2. **Section renamed:** "Personalization" → **"Your Patterns"** (user-facing language per Transmission Thesis).
3. **"AI acceptance rate: 100%" removed entirely** — always 100% when no alternatives are tracked, provides no insight.
4. **Domain depth gated:** Only shown when ≥2 domains have ≥3 decisions each. Single domains with undefined depth values add clutter.

```typescript
export function formatPersonalizationSection(profile, distill): string {
  if (!profile || profile.dataPoints < 5) return "";
  if (profile.decisionStyle.avgAlternativesEvaluated === 0) return "";

  const lines: string[] = ["## Your Patterns", ""];
  // ... domain depth only for meaningful domains:
  const meaningfulDomains = profile.domainDistribution.filter(d => d.frequency >= 3);
  if (meaningfulDomains.length >= 2) { /* show domain depth */ }
  // ...
}
```

### Dead Code: Cross-Session Detector

**File:** `src/services/personalization/cross-session-detector.ts`

This file exports `detectCrossSessionPatterns()` and `loadCrossSessionPatterns()` but **nothing in the codebase imports them**. It was the source of the "Recurring: 'branch' 204 times across 31 days" noise in older distills. It is effectively dead code — the distill pipeline no longer calls it, and regenerated distills will not produce this noise.

### Before/After: Distill Output Quality

| Dimension | Before DRRVE | After DRRVE |
|-----------|-------------|-------------|
| **Summary** | "1077 AI interactions across Docs, TypeScript" | "Implement auth middleware. Also: Fix session handling; Upgrade token validation. Active in auth, api. Across 8 AI sessions." |
| **Decisions** | Raw prompts: "I need to understand the decision system in this project..." | Conversation titles or metadata: "Implement auth middleware" / "Work on distill: synthesizer.ts, amplifier.ts" |
| **Event count** | 17K+ (duplicated conversations) | ~50 unique conversations (after conversation-ID dedup) |
| **Noise filtering** | `RAW_PROMPT_RE` only (many patterns slip through) | 3-layer filter: `RAW_PROMPT_RE` + `EXTENDED_NOISE_RE` + `PATH_NOISE_RE` |
| **Amplified insights** | "Recurring: 'need' 228 times across 15 days" | Domain trends: "5 consecutive days in auth" / "First time working in infra" |
| **Personalization** | "Decision style: 0.0 alternatives. AI acceptance rate: 100%" | Empty (guard: insufficient data) or meaningful patterns with ≥5 data points |
| **Decision detection** | Any verb: "implementing", "adding", "creating" | Deliberate choice only: "chose", "decided", "switched to", "replaced X with" |
