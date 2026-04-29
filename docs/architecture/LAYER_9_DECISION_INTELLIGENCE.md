# Layer 5: Decision Intelligence Pipeline

> How Unfade transforms raw developer prompts, commits, and AI conversations into structured, deduplicated, outcome-oriented decision records.

---

## Table of Contents

1. [Overview](#overview)
2. [Pipeline Architecture](#pipeline-architecture)
3. [Stage 0: Event Ingestion & Signal Fusion](#stage-0-event-ingestion--signal-fusion)
4. [Stage 1: Signal Extraction](#stage-1-signal-extraction)
5. [Stage 1.5: Conversation Digestion](#stage-15-conversation-digestion)
6. [Stage 2: Context Linking](#stage-2-context-linking)
7. [Stage 3: Synthesis](#stage-3-synthesis)
8. [Cross-Source Deduplication](#cross-source-deduplication)
9. [Fuzzy Token-Bag Pattern Matching](#fuzzy-token-bag-pattern-matching)
10. [Decision Types & Pattern Taxonomy](#decision-types--pattern-taxonomy)
11. [Data Flow & Schemas](#data-flow--schemas)
12. [Dual Synthesis Paths](#dual-synthesis-paths)
13. [API Presentation Layer](#api-presentation-layer)
14. [Design Decisions & Trade-offs](#design-decisions--trade-offs)

---

## Overview

The Decision Intelligence Pipeline is Unfade's core differentiator: it answers *what did the developer decide and why*, not just *what code changed*. Raw inputs — git commits, AI conversation turns, terminal events — are processed through a multi-stage pipeline that extracts, classifies, links, deduplicates, and synthesizes engineering decisions into structured records.

**Key insight:** Most "decisions" in developer-AI workflows are not explicit `"chose X over Y"` statements. They're informal corrections, implicit direction-setting, question responses, and post-output refinements buried in conversational English. The pipeline is designed to catch these.

### What qualifies as a decision

A decision is a **deliberate human choice** that steered the direction of work. Not every commit or conversation is a decision. Specifically:

- **Yes:** "Use Postgres instead of Mongo" / correcting the AI / choosing between options the AI presented / steering before the AI asks / refining output
- **No:** "Fix the typo on line 42" / "Looks good" / "Continue" / routine implementation without alternatives

---

## Pipeline Architecture

```
CaptureEvents (JSONL)
       │
       ▼
┌──────────────┐
│  Stage 0     │  fuseSignals() — merge duplicates, normalize
│  Fusion      │
└──────┬───────┘
       │
       ▼
┌──────────────┐     ┌───────────────────┐
│  Stage 1     │     │  Stage 1.5        │
│  Signal      │     │  Conversation     │
│  Extraction  │     │  Digestion        │
│              │     │  (fuzzy matching) │
└──────┬───────┘     └────────┬──────────┘
       │                      │
       ▼                      │
┌──────────────┐              │
│  Stage 2     │◀─────────────┘
│  Context     │
│  Linking     │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  Stage 3     │  LLM or Fallback synthesis
│  Synthesis   │  + Cross-source deduplication
└──────┬───────┘
       │
       ▼
  DailyDistill (structured JSON)
       │
       ├──► distills/{date}.md
       ├──► profile/reasoning_model.json
       ├──► graph/decisions.jsonl
       └──► graph/domains.json
```

### Files involved

| File | Stage | Role |
|------|-------|------|
| `src/services/distill/distiller.ts` | Orchestrator | Pipeline coordinator, reads events, calls each stage, writes output |
| `src/services/distill/signal-extractor.ts` | Stage 1 | Parses events into `ExtractedSignals` — decisions, trade-offs, dead ends, breakthroughs |
| `src/services/distill/conversation-digester.ts` | Stage 1.5 | Extracts structured decisions from AI conversation turns using fuzzy matching |
| `src/services/distill/context-linker.ts` | Stage 2 | Cross-references signals with git context, AI conversations, temporal chains |
| `src/services/distill/synthesizer.ts` | Stage 3 | LLM or fallback synthesis into `DailyDistill`, cross-source dedup |
| `src/schemas/distill.ts` | — | Zod schemas: `DailyDistillSchema`, `ExtractedSignalsSchema`, `ConversationDigestSchema`, `DigestedDecisionSchema`, `LinkedSignalsSchema` |

---

## Stage 0: Event Ingestion & Signal Fusion

**File:** `distiller.ts` — `distill()` / `distillIncremental()`

Events are read from date-partitioned JSONL files (`~/.unfade/events/{date}.jsonl`), then passed through `fuseSignals()` which merges duplicate events and normalizes timestamps.

```
readEvents(date) → fuseSignals(rawEvents) → events: CaptureEvent[]
```

Each `CaptureEvent` carries:
- `id`, `timestamp`, `source` (git / ai-session / terminal)
- `type` (commit / ai-conversation / ai-completion / ai-rejection / revert / branch-switch)
- `content` (summary, files, branch, detail)
- `gitContext` (repo, branch, hash)
- `metadata` (turns, conversation_title, files_modified, tool_calls_summary, direction_signals)

---

## Stage 1: Signal Extraction

**File:** `signal-extractor.ts` — `extractSignals(events, date) → ExtractedSignals`

Parses the day's events into structured signal categories. No LLM — pure computation.

### Decision extraction from events

Two sources feed decisions:

#### 1. AI conversation decisions (3x signal weight)

Every `ai-conversation` event becomes a decision candidate. The signal extractor passes ALL of them through — the downstream synthesizer (Stage 3) or conversation digester (Stage 1.5) decides which are real decisions.

Rich metadata is extracted:
- `conversationTitle` — from Go daemon capture
- `turnCount` — conversation length
- `filesModified` — files the AI touched
- `toolsUsed` — unique tool names from the session
- `alternativesCount` — derived from `direction_signals.rejection_count` or long turn count

#### 2. Git commit decisions (1x signal weight)

Every commit becomes a decision candidate. `alternativesCount` is estimated from how many branches touched the same files (multiple branches = higher chance of a real decision).

#### Other signals extracted

- **Trade-offs:** AI rejections (the developer chose differently from what AI suggested)
- **Dead ends:** Reverts, with estimated time spent based on preceding commits on the same branch
- **Breakthroughs:** Large commits (3x file count) after a period of small ones
- **Debugging sessions:** Sequential fix commits within 30-minute windows
- **Direction signals:** Human Direction Score (HDS) from AI session metadata, classified as human-directed (≥0.6), collaborative (≥0.3), or LLM-directed (<0.3)

---

## Stage 1.5: Conversation Digestion

**File:** `conversation-digester.ts` — `digestConversations(events, provider) → Map<eventId, ConversationDigest>`

This is where the heavy decision extraction happens. Raw AI conversation turns are analyzed to find **human steering decisions** — the moments where the developer directed the AI's work.

### Two paths

1. **LLM path** (`provider` is set): Sends conversation turn chunks to an LLM with a decision-extraction system prompt. Returns structured `{ decisions, conversationSummary, tradeOffs, keyInsights, filesActedOn }`.

2. **Fallback path** (`provider` is null): Context-aware turn-pair analysis using the fuzzy token-bag matching engine. Zero cost, zero latency.

### Fallback digestion algorithm

The fallback digester (`digestFallback`) processes each user turn in context:

```
for each user turn:
  1. Skip noise (bare acknowledgments, system messages, lgtm, etc.)
  2. Find preceding assistant turn
  3. Try decision detection in priority order:
     a. Type 3: Was assistant asking a question? → classify user's response
     b. Type 1: Does user invalidate/correct? → build invalidation decision
     c. Type 4: Does user refine/adjust? → extract correction
     d. Type 2: Does user proactively steer? → extract direction
  4. Deduplicate within conversation (normalized keyword Jaccard at 0.4)
```

### Turn selection for LLM path

For long conversations (>80 turns), `selectRelevantTurns()` prioritizes:
1. First 4 turns (context setting)
2. Last 4 turns (conclusion)
3. All user turns from the middle
4. Turns with tool_use from the middle
5. Evenly-spaced assistant turns to fill remaining budget

Each conversation is chunked to 12,000 chars max per LLM call.

---

## Stage 2: Context Linking

**File:** `context-linker.ts` — `linkContext(signals, events) → LinkedSignals`

Cross-references extracted signals with git context. No LLM.

### What gets linked

- **Decisions** gain: `files`, `repo`, `relatedAiConversations` (AI conversations that touched the same files), `source` and `conversationMeta` pass-through
- **Trade-offs** gain: `relatedCommits` (other commits touching the same files)
- **Dead ends** gain: `revertedFiles` (files from the reverted commit)
- **Breakthroughs** gain: `triggeredBy` (AI conversation within 1 hour before)
- **Temporal chains** built: groups of 2+ sequential commits on the same module (top-level directory), with narrative arcs from AI conversation `intent_summary` metadata

### File index

A `Map<filePath, eventId[]>` is built from all events, enabling O(1) lookups for "which events touched this file?"

### AI conversation matching

`findRelatedAiConversations(files, aiConversations)` checks both the conversation's `files` array and `detail`/`summary` text for file path or basename matches.

---

## Stage 3: Synthesis

**File:** `synthesizer.ts` — `synthesize(linked, provider, options) → DailyDistill`

Transforms linked signals into the final `DailyDistill` output.

### LLM synthesis

`synthesizeWithLLM()` builds a prompt from linked signals with budget-aware truncation:

| Section | Budget share | Content |
|---------|-------------|---------|
| Conversation digests | 30% | Pre-extracted decisions, trade-offs, files from Stage 1.5 |
| Commits | 35% (50% of remaining 70%) | Commit summaries with branch, files, alternatives |
| Trade-offs | 17.5% | AI rejections with related files |
| Dead ends | 10.5% | Reverts with time estimates |
| Temporal chains | 7% | Module-level commit sequences |

The system prompt instructs the LLM to:
- Extract only genuine decisions (not routine commits)
- **Deduplicate** across digest and commit sections (explicit instruction)
- Use developer's own words
- Reference actual files and branches

The LLM response is parsed as JSON and validated against `DailyDistillSchema` via Zod.

### Fallback synthesis

`synthesizeFallback()` produces valid `DailyDistill` without any LLM. Decisions are collected from 3 tiers:

```
┌─────────────────────────────────────────────┐
│ Tier 1: Conversation digest decisions       │  Highest quality — pre-extracted
│         (from Stage 1.5)                    │  by digester with context awareness
├─────────────────────────────────────────────┤
│ Tier 2: Git commit decisions                │  Filtered: only commits with
│         (from linked signals)               │  alternatives > 0 or decision-
│                                             │  indicating language (DECISION_RE)
├─────────────────────────────────────────────┤
│ Tier 3: Undigested AI conversation          │  AI conversations without a digest,
│         decisions (fallback)                │  filtered by DECISION_RE or
│                                             │  alternatives > 0
└─────────────────────────────────────────────┘
                    │
                    ▼
         deduplicateFinalDecisions()
                    │
                    ▼
              DailyDistill.decisions
```

The `DECISION_RE` filter for tiers 2 and 3:
```regex
/\b(chose|decided|switched|replaced|migrated|reverted|refactor|trade.?off|instead of|rather than|opted|picked|selected|merge)\b/i
```

---

## Cross-Source Deduplication

**File:** `conversation-digester.ts` — `deduplicateFinalDecisions()` + `normalizedSimilarity()`

The same decision often appears in multiple sources:
- A conversation digest says: "Chose React over Vue for the frontend"
- A commit message says: "switch to React framework"
- An undigested AI conversation summary says: "Discussed React migration"

### Algorithm: Normalized Keyword Jaccard

```
Input: "Chose React over Vue for the frontend"
       "switch to React framework"

Step 1: Lowercase + strip non-alpha
  → "chose react over vue for the frontend"
  → "switch to react framework"

Step 2: Remove stop words (80+ words including decision-framing:
        chose, decided, selected, opted, picked, went, approach,
        option, instead, rather, over, because, using, use, used,
        corrected, rejected, ai, llm)
  → ["react", "vue", "frontend"]
  → ["switch", "react", "framework"]

Step 3: Stem (strip common suffixes: -ing, -tion, -ed, -ly, -er, -es, -s, etc.)
  → {"react", "vue", "frontend"}
  → {"switch", "react", "framework"}

Step 4: Jaccard similarity
  intersection = {"react"} → 1
  union = {"react", "vue", "frontend", "switch", "framework"} → 5
  similarity = 1/5 = 0.2

Step 5: Compare against threshold (0.4)
  0.2 < 0.4 → NOT duplicate (correctly: these are related but different)
```

**Why 0.4 threshold?** After stop-word removal and stemming, the remaining tokens are high-signal content words. Two decisions sharing 40%+ of content keywords are almost certainly the same underlying choice expressed differently. The old raw Jaccard at 0.6 missed duplicates because framing words ("chose", "decided", "over") diluted the similarity score.

### Dedup application points

1. **Within-conversation dedup** — `deduplicateDecisions()` in `digestFallback()`: prevents the same decision from being detected multiple times in one conversation
2. **Cross-source dedup** — `deduplicateFinalDecisions()` in `synthesizeFallback()`: deduplicates across all 3 tiers after collection
3. **LLM dedup instruction** — explicit prompt instruction tells the LLM to consolidate duplicate decisions

---

## Fuzzy Token-Bag Pattern Matching

**File:** `conversation-digester.ts` — The matching engine

### Problem statement

Users write informal English to LLMs — sentence fragments, missing apostrophes, no punctuation, word-order scrambling, slang. Examples:

| User writes | Strict regex expects |
|-------------|---------------------|
| `"dont use that approach"` | `"don't use..."` (apostrophe required) |
| `"nah go react"` | `"no, go with react"` (formal phrasing) |
| `"switch it postgres instead"` | `"switch to postgres instead"` (preposition present) |
| `"hmm lets go react"` | `"let's go with react"` (apostrophe + preposition) |
| `"make it zustand not redux"` | No pattern matches implicit decisions |

### Algorithm: Weighted Token-Bag Matching

Zero dependencies. O(n) per match. Hybrid regex + fuzzy.

#### Step 1: Fast-path regex

Each pattern carries an optional `fastPath: RegExp`. For well-formed input, this matches instantly and returns. Covers ~40% of real input.

#### Step 2: Text normalization

```typescript
fuzzyNormalize(text):
  1. Lowercase
  2. Expand 25 contractions (with/without apostrophe):
     dont/don't → "do not"    lets/let's → "let us"
     cant/can't → "can not"   gonna → "going to"
     wont/won't → "will not"  wanna → "want to"
     thats/that's → "that is" nah → "no"
     ... etc.
  3. Normalize slang: yeah→yes, yep→yes, nope→no, pls→please,
     thx→thanks, imo→in my opinion, btw→by the way
  4. Strip non-alphanumeric (keep spaces and hyphens)
  5. Collapse whitespace
```

#### Step 3: Tokenize

Split on whitespace, filter tokens < 2 chars. Returns `Set<string>`.

#### Step 4: Score

Each pattern defines:
- `anchors: string[]` — Required tokens. At least 60% must be present.
- `signals: string[]` — Bonus tokens. Optional but increase confidence.
- `threshold?: number` — Minimum score (default 0.5).

```
score = (anchor_hits / anchor_count) * 0.7 + (signal_hits / signal_count) * 0.3
```

Multi-word anchors (e.g., `"go with"`) check that all constituent words are present in the token set (order-independent).

#### Step 5: Best match

All patterns in a category are scored. The highest-scoring pattern above threshold wins.

### Why token-bag over alternatives

| Algorithm | Weakness for this use case |
|-----------|---------------------------|
| Levenshtein/Edit distance | O(n²), can't handle word reordering or missing words |
| Character n-grams | Miss semantic word boundaries ("react" vs "reactive") |
| TF-IDF cosine | Needs a corpus, too heavy for inline matching |
| Token-set ratio (fuzzywuzzy) | External dependency, same core idea but heavier |
| **Token-bag (chosen)** | O(n), word-order independent, partial credit, zero deps |

---

## Decision Types & Pattern Taxonomy

### 4 decision types

| Type | Name | Trigger | Example |
|------|------|---------|---------|
| 1 | Invalidation | User corrects/rejects AI output | "no don't use that" / "that's wrong" / "scrap that" |
| 2 | Proactive direction | User steers before AI asks | "let's use postgres" / "we should migrate to React" |
| 3 | Question response | User chooses when AI presents options | AI: "Option A or B?" User: "go with option A" |
| 4 | Post-correction | User refines after seeing AI output | "actually change that to X" / "one small tweak" |

### Detection priority

Types are checked in order: 3 → 1 → 4 → 2. This matters because:
- Type 3 requires assistant context (a question) — most specific
- Type 1 requires assistant context (something to invalidate) — next most specific
- Type 4 requires assistant context (output to refine) — same specificity as 1
- Type 2 is context-independent — broadest, checked last

### Pattern counts (64 total)

| Category | Count | Examples |
|----------|-------|---------|
| Invalidation | 18 | "no don't", "that's wrong", "scrap that", "won't work", "disagree", "broken", "remove that", "no no no", "hold on", "misunderstood", "terrible approach", "I said X not Y" |
| Proactive direction | 22 | "let's use", "we should", "I want", "decided", "instead of", "approach should be", "focus on", "keep/maintain", "going to", "prefer", "switch to", "go with", "implement", "skip/avoid", "make it", "try", "X not Y", "the right way", "separate/decouple", "wrap/abstract", "first then", "overkill" |
| Post-correction | 16 | "actually change", "change X to Y", "rename/move/replace", "but change", "small tweak", "on second thought", "never mind", "also add", "while you're at it", "oh and", "tweak/adjust", "flip/invert", "bump/increase", "make it more/less", "simplify" |
| Assistant questions | 8 | "would you like", "option 1/2/3", "could either", "which one", "do you prefer", "here are options", "?", "X or Y" |
| Noise (rejection) | 5 | session continuations, bare acknowledgments, bare yes/no, bare thanks, bare "go ahead" / "lgtm" |

### Noise filtering

Content that is never a decision:
```
"looks good" / "perfect" / "thanks" / "ok" / "correct" / "great" / "awesome" / etc.
"yes" / "no" / "yep" / "nope" / "sure" / "agreed" / "right" / etc.
"please" / "pls" / "thx" / "thank you"
"go ahead" / "proceed" / "continue" / "carry on" / "do it" / "ship it" / "lgtm" / "sgtm"
"this session is being continued..." / "<command-name>..." (system messages)
```

---

## Data Flow & Schemas

### Schema progression through the pipeline

```
CaptureEvent                    (raw event from JSONL)
       │
       ▼
ExtractedSignals                (Stage 1 output)
  ├── decisions[]               { eventId, summary, branch, alternativesCount, source, conversationMeta }
  ├── tradeOffs[]               { eventId, summary, relatedFiles }
  ├── deadEnds[]                { revertEventId, summary, timeSpentMinutes }
  ├── breakthroughs[]           { eventId, summary }
  ├── debuggingSessions[]       { eventIds, summary, fixCount }
  └── stats                     { totalEvents, commitCount, aiCompletions, ... }
       │
       ├──── ConversationDigest (Stage 1.5 output, per conversation)
       │       ├── decisions[]  { decision, rationale, domain?, alternativesConsidered? }
       │       ├── tradeOffs?   string[]
       │       ├── keyInsights? string[]
       │       ├── filesActedOn? string[]
       │       └── conversationSummary
       │
       ▼
LinkedSignals                   (Stage 2 output)
  ├── decisions[]               { ...extracted + files, repo, relatedAiConversations, source, conversationMeta }
  ├── tradeOffs[]               { ...extracted + relatedCommits }
  ├── deadEnds[]                { ...extracted + revertedFiles }
  ├── breakthroughs[]           { ...extracted + triggeredBy }
  ├── temporalChains[]          { module, eventIds, summary }
  └── stats                     { ...extracted + aiAcceptanceRate }
       │
       ▼
DailyDistill                    (Stage 3 output — final)
  ├── date
  ├── summary
  ├── decisions[]               { decision, rationale, domain?, alternativesConsidered? }
  ├── tradeOffs?                { tradeOff, chose, rejected, context? }[]
  ├── deadEnds?                 { description, timeSpentMinutes?, resolution? }[]
  ├── breakthroughs?            { description, trigger? }[]
  ├── patterns?                 string[]
  ├── eventsProcessed
  ├── themes? / domains?        string[]
  ├── synthesizedBy             "llm" | "fallback"
  ├── directionSummary?         { averageHDS, humanDirectedCount, ... }
  └── aiCollaborationSummary?   { toolBreakdown, directionStyle }
```

---

## Dual Synthesis Paths

### LLM path (high quality, costs tokens)

```
distill(date, config, options):
  provider = createLLMProvider(config)
  digestConversations(events, provider)     ← LLM-assisted digestion
  synthesizeWithLLM(linked, provider)       ← LLM synthesis
  Zod validation of response
  Falls back to fallback on any error
```

- Used for: scheduled daily distill runs
- Cost: 1 LLM call for digestion per conversation + 1 LLM call for synthesis
- Quality: highest — LLM understands nuance, produces natural language decisions

### Fallback path (zero cost, instant)

```
distillIncremental(date, options):
  digestConversations(events, null)         ← Fuzzy token-bag matching only
  synthesize(linked, null)                  ← Heuristic synthesis
  No LLM calls at all
```

- Used for: incremental distill on every daemon tick, backfill
- Cost: zero
- Quality: good — catches ~60-75% of decisions that LLM would find

### When each runs

- **Incremental (fallback):** Every daemon tick, for the current date. Skips if an LLM-synthesized distill already exists. Populates all downstream folders immediately.
- **Full (LLM):** Scheduled daily run. Overwrites the incremental distill idempotently with higher-quality output.

---

## API Presentation Layer

Once decisions are written to `graph/decisions.jsonl`, they're served through two API tiers and rendered in a rich UI. This layer transforms internal IDs into human-readable context.

### Decision List API (`GET /api/decisions`)

**File:** `src/tools/unfade-decisions.ts` via `src/server/routes/decisions.ts`

The list endpoint reads from `graph/decisions.jsonl` (primary) or extracts from distill markdown (fallback). Before returning:

1. **Project name resolution** — Each decision's `projectId` UUID is resolved to a human-readable `projectName` via the global registry (`~/.unfade/state/registry.v1.json`). The `buildProjectNameMap()` function loads the registry once per request and maps `repo.id → repo.label`.

2. **Deduplication** — Normalized Jaccard similarity (≥0.7 threshold) merges near-duplicate decisions across dates. Merging preserves evidence IDs from both copies, keeps the most recent date, and carries forward `projectName`.

3. **Filtering** — Supports `domain`, `q` (substring), `period` (7d/30d/90d), and `project` (projectId match). All filters compose.

```
DecisionItem (API response shape):
  date                    "2026-04-23"
  decision                "Use Postgres instead of Mongo for event store"
  rationale               "Better JSONB support, team familiarity"
  domain?                 "Database"
  projectId?              "4eddd53f-..."     ← internal UUID
  projectName?            "unfade-cli"       ← resolved from registry
  evidenceEventIds?       ["9ec6...", ...]   ← ALL matching events (no cap)
  humanDirectionScore?    0.82
  directionClassification? "human-directed"
```

### Decision Detail API (`GET /api/decisions/:index`)

**File:** `src/server/routes/decision-detail.ts`

Returns a single decision with its full **evidence trail** — the actual events that contributed to the decision:

1. **Evidence resolution** — Two-tier: if `evidenceEventIds` exist on the record, resolve by ID against that day's JSONL events. Otherwise, fall back to keyword matching (extract 4+ char keywords from decision text, score events by hit count, require ≥2 hits).

2. **No evidence cap** — All matching events are returned (previously capped at 5). Real decisions often involve many events across AI conversations, commits, and branch switches.

3. **Enriched evidence events** — Each evidence event includes:

```
EvidenceEvent:
  id                      "9ec6e412-..."
  timestamp               "2026-04-23T14:32:00Z"
  source                  "ai-session"         ← human-readable via sourceLabel()
  type                    "ai-conversation"     ← human-readable via typeLabel()
  summary                 "Discussed migration strategy for event store"
  detail?                 First 500 chars of event detail
  branch?                 "feat/postgres-migration"
  files?                  ["src/db/schema.ts", ...] (up to 20)
  conversationTitle?      "Migrate from Mongo to Postgres"
```

4. **Project name resolution** — `resolveProjectName()` looks up the decision's `projectId` in the registry and returns the label alongside the decision.

### Frontend: DecisionsPage

**File:** `src/ui/pages/DecisionsPage.tsx`

The UI renders decisions as narrative cards (not flat tables) following the Transmission Thesis diagnostic language:

#### Decision Cards

Each card shows:
- **Decision text** — the core reasoning artifact
- **Rationale** — truncated to 2 lines
- **Direction label** — "You directed" / "Collaborative" / "AI suggested" (color-coded)
- **Project name** — resolved human-readable label (blue badge), never raw UUID
- **Domain** — taxonomy domain (accent badge)
- **Evidence count** — total source events
- **Relative date** — "Today", "3 days ago", etc.

#### Project Filter

When multiple projects exist in the registry, a project dropdown appears in the filter bar. Selecting a project passes `project=<id>` to the API, scoping decisions to that repo.

#### Evidence Drawer

Clicking a decision card opens the `EvidenceDrawer` slide-over panel. Unlike the previous static view, it now:

1. **Fetches real evidence** — calls `GET /api/decisions/:index` to get the full evidence trail
2. **Shows loading state** — "Loading evidence…" while fetching
3. **Renders rich evidence cards** — each with:
   - Timestamp + source badge (color-coded by source type)
   - Event type label
   - Conversation title (if AI session)
   - Summary text
   - Branch name (monospace badge)
   - Expandable file list
   - Detail snippet (3-line clamp)
4. **Metrics panel** — Domain, Date, Project (name, not UUID), Origin, Direction Score, Evidence count
5. **Raw data toggle** — "Show raw data" reveals full JSON for each evidence event

### Data Flow: ID Resolution

```
decisions.jsonl    →  getDecisions()    →  resolveProjectNames()  →  API response
  projectId: UUID       load registry        UUID → repo.label         projectName: "unfade-cli"
  evidenceEventIds      build map            enrich in-place            projectId still present

DecisionsPage      →  click card        →  detail API             →  EvidenceDrawer
  shows projectName      selectedIndex       /api/decisions/:idx       rich evidence cards
  shows evidence count                       resolves events           files, branch, title
```

---

## Design Decisions & Trade-offs

### Why fuzzy token-bag over regex-only?

**Chose:** Hybrid fuzzy token-bag + regex fast-path
**Over:** Pure regex matching
**Rationale:** Users write informal English to LLMs. Strict regex requires exact sequences and fails on missing apostrophes, word reordering, slang, and fragments. Token-bag matching handles all of these with zero dependencies and O(n) performance.

### Why 4 decision types instead of a single pattern list?

**Chose:** Taxonomy of 4 context-dependent decision types
**Over:** Flat list of patterns applied to isolated user turns
**Rationale:** Most decisions only make sense in context. "yes, the first one" is meaningless alone but is a clear decision if the assistant just asked "option 1 or 2?". Context-aware turn-pair analysis catches ~40% more decisions than isolated turn scanning.

### Why normalized keyword Jaccard for dedup?

**Chose:** Stop-word removal + stemming + Jaccard at 0.4 threshold
**Over:** Raw string Jaccard at 0.6 threshold
**Rationale:** Decision strings are padded with framing words ("Chose", "Rejected AI approach;", "Corrected:") that differ between sources. Raw Jaccard treats these as content, diluting similarity. Removing stop words (including decision-framing words) and stemming leaves only high-signal content words, making 0.4 threshold accurate.

### Why 3-tier fallback collection?

**Chose:** Digest decisions → commit decisions → undigested AI decisions (in that order)
**Over:** Treating all decision sources equally
**Rationale:** Digest decisions are pre-processed with context awareness and are highest quality. Git commits have clean summaries. Undigested AI conversations are raw prompts (lowest quality). Ordering by quality ensures `deduplicateFinalDecisions()` keeps the better version when duplicates are found (it prefers earlier entries).

### Why pass-through in Stage 1 + filter in Stage 3?

**Chose:** Signal extractor passes all events as candidates; synthesizer filters
**Over:** Signal extractor filtering aggressively
**Rationale:** The LLM synthesizer can understand nuance that heuristic filters miss. Passing everything through gives the LLM maximum context. The fallback synthesizer applies `DECISION_RE` filtering as a cheaper heuristic. This lets the same pipeline serve both paths without data loss.

### Why resolve projectId → projectName at API time, not write time?

**Chose:** Resolve UUID to label at read time via registry lookup
**Over:** Embedding label in `decisions.jsonl` at write time
**Rationale:** Repo labels can change (user renames directory). The registry is the source of truth for labels. JSONL stores the immutable UUID; the API resolves to current label on each read. This avoids stale labels and keeps the JSONL format stable.

### Why remove the 5-event evidence cap?

**Chose:** Return all matching evidence events (no `.slice(0, 5)`)
**Over:** Cap at 5 events for response size
**Rationale:** A single decision can involve 10+ AI conversation turns, multiple commits, and branch switches. Capping at 5 hides critical context — the user can't understand *why* a decision was made if they only see 5 of 15 events. The detail API is called on-demand (per decision click), so response size is bounded by a single day's events, not the entire history.

### Why fetch evidence on drawer open, not in the list response?

**Chose:** List returns decision metadata only; detail API fetches evidence on demand
**Over:** Embedding evidence events in the list response
**Rationale:** The list page shows 15 decisions at a time. Each could have 10+ evidence events with detail text, files, and metadata. Embedding all evidence in the list response would make it 10-50x larger and slow down page loads. Fetching on drawer open keeps the list fast and loads evidence only when the user actually wants it.
