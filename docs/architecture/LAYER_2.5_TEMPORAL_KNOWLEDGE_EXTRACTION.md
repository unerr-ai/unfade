# Layer 2.5: Temporal Knowledge Extraction & Lifecycle Management

Converts raw AI conversation events into atomic, temporal, queryable intelligence — the missing extraction layer between materialized events (Layer 2) and the intelligence graph (Layer 3). Manages the full lifecycle of extracted knowledge: granularity decomposition, multi-concept segmentation, temporal validity, contradiction resolution, comprehension decay, and aggregation.

---

## 1. Problem Statement

### Why This Layer Exists

Layers 1–2 capture and store raw events. Layer 3 computes intelligence from typed columns and aggregations. But **the gap between "raw conversation stored in DuckDB" and "real intelligence in CozoDB" is the entire product.** Layer 3's 25 analyzers operate on heuristic signals (direction scores, modification rates, prompt specificity) — they never read the actual conversation. No component today reads a developer-AI dialogue and extracts what was discussed, what was understood, what was decided, and how the developer's knowledge changed.

### What's Missing

| Capability | Current State | Required State |
|---|---|---|
| Concept/entity extraction | Not implemented | Every conversation yields named entities (technologies, patterns, modules) |
| Atomic fact extraction | Not implemented | Discrete propositions linking entities, each independently temporal |
| Topic segmentation | Not implemented | Multi-topic conversations split into coherent segments |
| Comprehension assessment | Heuristic proxy (HDS) | Per-conversation LLM judgment: did the developer demonstrate understanding? |
| Metacognitive signal detection | Not implemented | Classification of "why" questions, pushback, error-catching, constraint explanation |
| Temporal fact management | Schema exists in CozoDB, no facts flow in | Bi-temporal facts with validity windows, contradiction detection, supersession |
| Comprehension decay | No decay model | Forgetting-curve based per-domain scores that degrade without reinforcement |

### Research Foundations

This layer's design draws from:

- **Graphiti/Zep** (2025–2026) — Three-tier temporal knowledge graph: episodes → entities → facts. Bi-temporal validity model. Incremental ingestion with contradiction detection via embedding similarity + LLM adjudication.
- **Deep Knowledge Tracing (DKT)** — Sequential models tracking evolving mastery from interaction sequences. Each conversation is an "interaction" revealing concept engagement.
- **Epistemic Network Analysis (ENA)** — Quantifies connections among concepts in discourse. Density of connections indicates expertise depth.
- **Ebbinghaus Forgetting Curve / SM-2** — Retention decays exponentially without reinforcement. Stability increases with repeated engagement.
- **LLM-as-Judge** — 80% human-agreement at 500–5000x cost reduction. Rubric-based scoring outperforms holistic judgment.
- **Comprehension Debt (Osmani, 2026)** — The widening gap between code volume produced and developer understanding. Traditional metrics (DORA, velocity) don't capture it. Anthropic study: 17% lower comprehension with AI assistants. METR study: 19% slower despite feeling 20% faster.
- **Truth Maintenance Systems (TMS)** — Classical AI approach to maintaining consistent belief sets with justification tracking and dependency-directed backtracking.

---

## 2. Architecture Overview

### Three-Tier Knowledge Model

Adapted from Graphiti's architecture, mapped to Unfade's existing storage:

```
┌─────────────────────────────────────────────────────────────────┐
│                        EPISODES                                  │
│  Raw AI conversations, git commits, terminal sessions            │
│  Storage: ~/.unfade/events/*.jsonl (already exists)              │
│  One episode = one captured event                                │
│  Immutable, append-only, source of truth                         │
└──────────────────────────┬──────────────────────────────────────┘
                           │ LLM Extraction (Layer 2.5)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                        ENTITIES                                  │
│  Named concepts that persist across episodes                     │
│  Examples: "Redis", "auth-module", "JWT", "React hooks"          │
│  Storage: CozoDB entity nodes (already has schema)               │
│  Have: type, lifecycle state, confidence, first/last seen        │
│  Deduplicated via fuzzy name matching + embedding similarity     │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                         FACTS                                    │
│  Atomic propositions linking entities with temporal validity     │
│  Examples: "project USES Redis FOR caching [Day 1 → Day 5]"     │
│            "developer DECIDED JWT OVER session-cookies [Day 3]"  │
│  Storage: CozoDB edges + ~/.unfade/graph/facts.jsonl             │
│  Have: subject, predicate, object, valid_at, invalid_at,        │
│        confidence, source_episode, extraction_method             │
│  Queryable unit for all downstream intelligence                  │
└─────────────────────────────────────────────────────────────────┘
```

### Where Layer 2.5 Sits in the Pipeline

```
Go daemons → JSONL events (Layer 1)
  → MaterializerDaemon → SQLite + DuckDB (Layer 2)
    → Layer 2.5: Temporal Knowledge Extraction          ← THIS LAYER
        ├── Topic Segmentation (per conversation)
        ├── Entity Extraction (per segment)
        ├── Atomic Fact Extraction (per segment)
        ├── Comprehension Assessment (per conversation)
        ├── Metacognitive Signal Classification (per conversation)
        ├── Contradiction Detection (per new fact vs existing graph)
        ├── Temporal Validity Management (continuous)
        └── Comprehension Decay Computation (daily)
      → CozoDB graph + intelligence/*.json (Layer 3)
        → 25 IncrementalAnalyzers, profile, narrative, MCP
```

### Execution Modes

| Mode | Trigger | Scope | LLM Required |
|---|---|---|---|
| **Incremental** | Materializer tick (new events arrive) | New conversations only | Yes (batched) |
| **Daily** | `unfade distill` or scheduled cron | Full day's conversations | Yes |
| **Rebuild** | `unfade doctor --rebuild-graph` | All historical conversations | Yes (expensive) |
| **Decay-only** | Daily tick (no new events needed) | All entities/facts | No (arithmetic) |

---

## 3. Topic Segmentation

### Problem

A single 50-turn AI conversation may discuss auth refactoring (turns 1–15), switch to database indexing (turns 16–30), then return to auth (turns 31–50). Extracting intelligence at the whole-conversation level loses this structure. Each segment should yield its own entities, facts, and comprehension assessment.

### Approach: Structural-First Segmentation

Developer-AI conversations have stronger structural signals than general dialogue. Exploit them before falling back to semantic methods.

#### Tier 1: Structural Signals (heuristic, always-on)

```
segmentConversation(turns: Turn[]) → Segment[]:

  Signal 1 — File-path discontinuity:
    IF turn[i] modifies files in module A and turn[i+1] modifies files in module B
    AND modules A and B share no common parent directory within 2 levels
    → segment boundary

  Signal 2 — Explicit user instruction:
    Detect discourse markers in user turns:
      "now let's", "next", "moving on to", "separately", "switching to",
      "different topic", "also need to", "back to the"
    → segment boundary

  Signal 3 — Tool-use cluster gaps:
    IF gap between consecutive tool uses > 3 turns of pure text
    AND the tool targets shift to different files/directories
    → segment boundary

  Signal 4 — Temporal gaps:
    IF timestamp gap between turns > 5 minutes
    → segment boundary (developer likely context-switched)
```

#### Tier 2: Embedding Similarity (validation + refinement)

**Research finding:** For code conversations, structural signals capture 85%+ of real topic boundaries because developers naturally operate on files/modules and signal context switches explicitly ("now let's work on X"). Embedding-based approaches (TextTiling, C99, BERTopic) add ~2–5% F1 improvement on general dialogue segmentation benchmarks (Xing et al., 2024), but the gap narrows for task-oriented dialogue where structural cues dominate.

**DECISION:** Embeddings are used as a **validation/refinement step**, not primary segmentation. This improves quality without the false positive risk of embedding-only approaches.

When Tier 1 produces only a single segment for a conversation with >20 turns:

```
  1. Compute per-turn embeddings (all-MiniLM-L6-v2, 22MB, via Transformers.js)
  2. Sliding window cosine similarity (window=3 turns)
  3. Detect valleys where similarity drops below adaptive threshold
  4. Merge with Tier 1 boundaries (union, then merge segments < 3 turns)
```

When Tier 1 produces segments, embeddings validate:
```
  For each proposed boundary:
    IF cosine_similarity(last_3_turns_before, first_3_turns_after) > 0.85
    → boundary is likely a false positive (same topic continues)
    → merge segments back together
```

Cost: all-MiniLM-L6-v2 is 22MB, loads once, produces 384d vectors in <50ms per turn on CPU. The quality improvement justifies the minimal resource cost.

#### Output: Segment Record

```typescript
interface ConversationSegment {
  segmentId: string;             // episode_id + segment index
  episodeId: string;             // source conversation event ID
  turnRange: [number, number];   // inclusive turn indices
  topicLabel: string;            // LLM-generated or heuristic label
  filesInScope: string[];        // files referenced/modified in this segment
  modulesInScope: string[];      // directory-level module classification
  segmentMethod: "structural" | "embedding" | "single"; // how it was segmented
}
```

### Storage

Segments are metadata on the episode, not separate records. Stored as a JSON array in DuckDB's `segments` column (new typed column on events table) and in SQLite's `event_segments` table for relational queries.

---

## 4. Entity Extraction

### Problem

Raw conversations mention technologies, patterns, modules, concepts, and architectural ideas by name — but these aren't captured anywhere as discrete, referenceable things. "We should use Redis for caching" mentions two entities (Redis, caching) and implies a relationship. Without entity extraction, the knowledge graph has no nodes.

### Approach: LLM Structured Extraction Per Segment

```
extractEntities(segment: ConversationSegment, turns: Turn[]) → Entity[]:

  LLM prompt (structured output, temperature=0):
    "Extract all named technical concepts from this conversation segment.
     For each entity, provide:
     - name: canonical name (e.g., 'Redis', not 'redis cache' or 'Redis server')
     - type: one of [technology, pattern, module, concept, architecture, library, service, domain]
     - context: one sentence explaining how it appears in this conversation
     - confidence: 0.0–1.0 based on how clearly it was discussed (mentioned in passing = 0.3, deeply discussed = 0.9)"

  Post-processing:
    1. Normalize names: lowercase, strip version numbers for matching, keep display form
    2. Deduplicate within segment: merge by normalized name
    3. Resolve against existing CozoDB entities:
       a. Exact name match → link to existing entity
       b. Fuzzy match (Levenshtein ≤ 2 or embedding similarity > 0.85) → candidate match, LLM confirms
       c. No match → create new entity node
```

### Entity Schema (CozoDB)

```
entity {
  id: String,                    # UUID
  name: String,                  # Display name ("Redis")
  normalized_name: String,       # Matching key ("redis")
  type: String,                  # technology | pattern | module | concept | ...
  lifecycle: String,             # emerging | established | confirmed | archived
  confidence: Float,             # 0.0–1.0, increases with corroboration
  first_seen: DateTime,          # When first extracted
  last_seen: DateTime,           # When last referenced
  mention_count: Int,            # Total times referenced across episodes
  embedding: Vector(384),        # For similarity search (HNSW index)
}
```

This schema **already exists** in CozoDB (SUB-6.3 entity relations). Layer 2.5 populates it.

### Entity Resolution: The Deduplication Problem

The same concept appears in different forms across conversations:
- "React hooks" / "hooks" / "React's useEffect" / "custom hooks"
- "auth module" / "authentication" / "the auth code" / "src/auth/"

Resolution strategy (three-pass):

```
Pass 1 — Exact normalized match:
  "redis" == "redis" → same entity, increment mention_count

Pass 2 — Alias detection:
  Maintain alias table: { "hooks" → "React hooks", "useEffect" → "React hooks" }
  Initially seeded by LLM during extraction ("also known as: ...")
  Grows over time as new aliases are detected

Pass 3 — Embedding similarity:
  New entity embedding vs existing entities (HNSW search, top-5)
  IF similarity > 0.85 → LLM confirmation ("Are 'auth module' and 'authentication service' the same entity in this project?")
  IF confirmed → merge (keep higher-confidence name, add alias)
  IF denied → create separate entity
```

---

## 5. Atomic Fact Extraction

### Problem

Entities alone are just a vocabulary. Intelligence requires **relationships between entities** — decisions, usages, preferences, assessments — each as a discrete, temporal, queryable proposition.

### What Is an Atomic Fact?

A single, self-contained proposition that:
- Links exactly two entities (subject → object) via a typed predicate
- Is independently true or false
- Has a temporal validity window
- Traces back to a specific episode + segment

Examples from a single conversation:

| Subject | Predicate | Object | Temporal Note |
|---|---|---|---|
| project | USES | Redis | valid until superseded |
| developer | DECIDED | JWT | decision timestamp |
| auth-module | DEPENDS_ON | session-store | architectural fact |
| developer | UNDERSTANDS | React hooks | comprehension assessment |
| team | SWITCHED_FROM | REST | superseded by GraphQL |
| Redis | CHOSEN_OVER | Memcached | trade-off record |

### Extraction Pipeline

```
extractFacts(segment, entities, turns) → Fact[]:

  LLM prompt (structured output, temperature=0):
    "Given these entities extracted from a conversation segment: [entity list]
     And the conversation text: [segment turns]

     Extract atomic facts — each a single proposition linking two entities.
     For each fact, provide:
     - subject: entity name (must be from the entity list)
     - predicate: one of [USES, DECIDED, DEPENDS_ON, UNDERSTANDS, SWITCHED_FROM,
                          CHOSEN_OVER, IMPLEMENTED_IN, REPLACED_BY, CREATED,
                          INVESTIGATED, DEBUGGED, REFACTORED, TESTED, REVIEWED]
     - object: entity name OR free-text value for non-entity objects
     - confidence: 0.0–1.0
     - explicit: boolean — was this stated directly or inferred from context?
     - temporal_hint: 'ongoing' | 'point-in-time' | 'supersedes_previous'

     Only extract facts clearly supported by the conversation.
     Prefer fewer high-confidence facts over many speculative ones."

  Post-processing:
    1. Validate entity references against extracted entity list
    2. Assign temporal fields:
       - valid_at = segment timestamp (or explicit date if mentioned)
       - invalid_at = NULL (until superseded)
       - For 'supersedes_previous': trigger contradiction detection (Section 8)
    3. Assign source provenance:
       - episode_id, segment_id, extraction_method: "llm"
```

### Fact Schema (CozoDB)

```
fact {
  id: String,                    # UUID
  subject_id: String,            # → entity.id
  predicate: String,             # Typed relationship
  object_id: String,             # → entity.id (or NULL for free-text objects)
  object_text: String,           # Free-text when object isn't an entity
  confidence: Float,             # 0.0–1.0
  explicit: Bool,                # Directly stated vs inferred
  valid_at: DateTime,            # When this fact became true
  invalid_at: DateTime?,         # When superseded (NULL = still valid)
  created_at: DateTime,          # When we extracted it
  expired_at: DateTime?,         # When we learned it was superseded
  source_episode: String,        # → event ID
  source_segment: String?,       # → segment ID within episode
  extraction_method: String,     # "llm" | "heuristic" | "explicit-statement"
  embedding: Vector(384),        # For contradiction candidate retrieval
}
```

### Fact Predicates: Controlled Vocabulary

```
// Architectural facts
USES, DEPENDS_ON, IMPLEMENTED_IN, DEPLOYED_ON, CONFIGURED_WITH

// Decision facts
DECIDED, CHOSEN_OVER, REPLACED_BY, SWITCHED_FROM, ADOPTED, DEPRECATED

// Comprehension facts
UNDERSTANDS, INVESTIGATED, DEBUGGED, REFACTORED, REVIEWED, TESTED

// Creation facts
CREATED, DESIGNED, IMPLEMENTED, EXTENDED

// Relationship facts
RELATES_TO, CONFLICTS_WITH, ENABLES, BLOCKS
```

---

## 6. Comprehension Assessment

### Problem

The core user question: **"Am I understanding more or less as I use AI?"** Heuristic signals (HDS, modification rate) are proxies. Real comprehension assessment requires reading the conversation and judging whether the developer demonstrated understanding.

### Approach: Rubric-Based LLM-as-Judge

Per conversation (not per segment — comprehension is a holistic property of the interaction):

```
assessComprehension(conversation: Turn[], segment_summaries: string[]) → ComprehensionAssessment:

  LLM prompt (structured output, temperature=0):
    "Assess the developer's comprehension in this AI coding conversation.
     Score each dimension 0–10:

     1. STEERING (agency): Did the developer direct the AI, or follow passively?
        0 = accepted everything without question
        10 = gave specific constraints, rejected bad suggestions, guided approach

     2. UNDERSTANDING (depth): Did the developer demonstrate understanding of the code?
        0 = no evidence of understanding, pure copy-paste
        10 = explained concepts, caught errors, modified suggestions with insight

     3. METACOGNITION (reflection): Did the developer think about their thinking?
        0 = no reflection, no trade-off consideration
        10 = explicitly weighed alternatives, reconsidered approach, asked 'why'

     4. INDEPENDENCE (capability): Could the developer have done this without AI?
        0 = completely dependent, wouldn't know where to start
        10 = used AI as accelerator, clearly understood the domain

     5. ENGAGEMENT (depth of interaction):
        0 = single-turn copy-paste
        10 = deep multi-turn exploration with increasing specificity

     Also provide:
     - overall_score: weighted composite (0–100)
     - evidence: array of specific quotes/moments supporting the scores
     - rubber_stamp_count: number of AI suggestions accepted without modification
     - pushback_count: number of times developer questioned or modified AI output
     - domain_tags: domains the developer engaged with"
```

### Assessment Schema

```typescript
interface ComprehensionAssessment {
  episodeId: string;
  timestamp: string;
  dimensions: {
    steering: number;        // 0–10
    understanding: number;   // 0–10
    metacognition: number;   // 0–10
    independence: number;    // 0–10
    engagement: number;      // 0–10
  };
  overallScore: number;       // 0–100 weighted composite
  weights: {                  // configurable, default:
    steering: 0.25;
    understanding: 0.30;
    metacognition: 0.20;
    independence: 0.15;
    engagement: 0.10;
  };
  evidence: string[];         // specific quotes supporting assessment
  rubberStampCount: number;
  pushbackCount: number;
  domainTags: string[];
  assessmentMethod: "llm" | "heuristic-proxy";
}
```

### Heuristic Fallback (no LLM available)

When LLM is unavailable, compute proxy scores from Layer 1 signals:

```
steering_proxy     = human_direction_score (already 0–10)
understanding_proxy = modification_after_accept ? 6 : (rejection_count > 0 ? 5 : 2)
metacognition_proxy = (course_correction ? 3 : 0) + (alternative_evaluation ? 4 : 0)
independence_proxy  = 10 - (prompt_count / turn_count * 10)  // more AI turns = less independent
engagement_proxy    = min(10, turn_count / 5)                // deeper conversations score higher
```

These proxies are marked `assessmentMethod: "heuristic-proxy"` with lower confidence.

### Aggregation → Comprehension Score

The single **0–100 Comprehension Score** (the product's hero metric) is:

```
dailyComprehensionScore = weightedAverage(
  assessments.map(a => ({
    score: a.overallScore,
    weight: conversationSignificance(a)  // longer, more impactful conversations weight more
  }))
)

conversationSignificance(a) =
  log2(turnCount + 1) *              // longer conversations matter more
  (filesModified.length > 0 ? 1.5 : 1.0) *  // conversations with code changes matter more
  (a.pushbackCount > 0 ? 1.2 : 1.0)          // engaged conversations matter more
```

---

## 7. Metacognitive Signal Classification

### Problem

Metacognition — thinking about one's own thinking — is the strongest differentiator between expert and novice developers (ACM research, 2023). Detecting it requires semantic understanding of the conversation.

### Signal Categories

| Signal | What It Looks Like | Indicates |
|---|---|---|
| **Why-questioning** | "Why did you use a map here instead of a set?" | Curiosity, depth-seeking |
| **Constraint explanation** | "We can't use Redis because our infra doesn't support it" | Domain knowledge, context awareness |
| **Alternative evaluation** | "What about using WebSockets instead of SSE?" | Trade-off thinking |
| **Error catching** | "That won't work because X is immutable" | Deep understanding, active verification |
| **Strategy reflection** | "Let me rethink this approach" | Self-regulation |
| **Pushback with reasoning** | "No, that's wrong because..." | Independence, confidence |
| **Knowledge transfer** | "This is similar to how we handled Y" | Pattern recognition, analogical thinking |

### Extraction

```
classifyMetacognition(conversation: Turn[]) → MetacognitiveSignal[]:

  For each user turn, classify presence of metacognitive signals.
  Can be done as part of the comprehension assessment LLM call (single pass).

  Output per signal:
    {
      turnIndex: number,
      signalType: "why-question" | "constraint" | "alternative" | "error-catch" |
                  "strategy-reflect" | "pushback" | "knowledge-transfer",
      quote: string,          // the specific text
      strength: 0.0–1.0      // how clearly it demonstrates metacognition
    }

  Aggregation:
    metacognitiveDensity = signalCount / totalUserTurns
    metacognitiveBreadth = uniqueSignalTypes.length / 7
```

### Why This Matters for the Product

Metacognitive density is the most defensible comprehension signal:
- It can't be gamed by writing longer prompts
- It correlates with actual expertise (research-backed)
- It's invisible to the developer (they don't know it's being measured → no Goodhart's Law)
- It's narratively compelling: "You asked 'why' 8 times today — that's critical thinking in action"

---

## 8. Temporal Validity & Contradiction Detection

### Problem

Knowledge changes. "We use Redis for caching" may become false a week later. If the knowledge graph doesn't handle this, it becomes a source of stale, misleading intelligence. This is the hardest data lifecycle problem.

### Bi-Temporal Model

Every fact carries four timestamps (adapted from Graphiti):

```
┌─────────────────── Transaction Time ───────────────────┐
│ created_at         When we extracted this fact          │
│ expired_at         When we learned it was superseded    │
└────────────────────────────────────────────────────────┘

┌─────────────────── Valid Time ─────────────────────────┐
│ valid_at           When this fact became true           │
│ invalid_at         When this fact stopped being true    │
└────────────────────────────────────────────────────────┘
```

#### Why Two Time Axes?

Developer says on April 20: "We switched from Redis to DuckDB for caching last week."

- Fact 1 (Redis): `valid_at=April 1, invalid_at=April 13, created_at=April 1, expired_at=April 20`
- Fact 2 (DuckDB): `valid_at=April 13, created_at=April 20`

Transaction time tells us when we learned something. Valid time tells us when it was actually true. Without both, we can't answer "what did we know on April 15?" (we thought Redis was current) vs "what was actually true on April 15?" (DuckDB had already replaced it).

### Contradiction Detection Timing

**Research finding:** Developer dashboard tools (GitHub Copilot Metrics, CodeScene, LinearB, Pluralsight Flow) universally report that developers check analytics **morning and end-of-day**, not during active coding sessions. Real-time interruptions during coding (e.g., "you just contradicted a decision from last week") violate deep work principles (Cal Newport) and contribute to notification fatigue — the #1 complaint about developer tooling (Stack Overflow Developer Survey, 2025). The RRVV product analysis confirms this: users want "morning glance" dashboards and "end of day" distill summaries, with mid-session alerts only for **active comprehension dips** (low steering scores), not historical contradictions.

**DECISION: Per-session extraction + daily contradiction resolution.**

| Operation | Timing | Rationale |
|---|---|---|
| LLM extraction (entities, facts, agency, comprehension) | Per event on each materializer tick | 1 combined LLM call per event, ~$0.005–0.02/event |
| Contradiction detection (Stage 1: candidate retrieval) | On each new fact insertion | Embedding HNSW search is <10ms, no LLM |
| Contradiction detection (Stage 2: LLM classification) | **Daily batch** (during distill) | Batch all candidates from the day, classify in bulk, resolve in bulk |
| Comprehension Score update | **Daily** | Decay computation + new assessment integration |
| Comprehension decay | **Daily** (pure arithmetic) | No LLM, runs on DuckDB |

This means: during the day, the graph accumulates new facts and flags potential contradictions (embedding-similar candidates). At end-of-day (distill time), all contradiction candidates are classified and resolved in a single LLM batch call. The distill narrative includes: "You evolved your thinking on X — previously you said Y, now you're saying Z."

### Contradiction Detection Pipeline

Triggered when a new fact is extracted (Stage 1 immediately, Stage 2 batched daily):

```
detectContradictions(newFact: Fact, graph: CozoGraph) → ContradictionResult[]:

  Stage 1 — Candidate Retrieval (fast, no LLM):
    candidates = graph.vectorSearch(
      newFact.embedding,
      topK: 10,
      filter: {
        subject_id: newFact.subject_id,    // same subject
        invalid_at: NULL,                   // still valid
        predicate: IN same_category(newFact.predicate)  // related predicate types
      }
    )

  Stage 2 — Contradiction Classification (LLM):
    FOR EACH candidate:
      classification = LLM.classify(
        "Given existing fact: '{candidate.text}'
         And new fact: '{newFact.text}'
         Classify their relationship:
         - CONSISTENT: both can be true simultaneously
         - MORE_SPECIFIC: new fact adds detail to existing (not a contradiction)
         - CONTRADICTORY: new fact invalidates existing
         - SUPERSEDES: new fact explicitly replaces existing (e.g., 'switched from X to Y')
         - UNRELATED: despite surface similarity, they're about different things"
      )

  Stage 3 — Resolution:
    FOR EACH contradiction/supersession:
      candidate.invalid_at = newFact.valid_at
      candidate.expired_at = now()
      log contradiction event for audit trail
```

### Explicit Supersession Shortcuts

Developer conversations often contain explicit signals that bypass the full pipeline:

```
// These patterns auto-trigger supersession without LLM classification:
"switched from {X} to {Y}"
"replaced {X} with {Y}"
"migrated from {X} to {Y}"
"no longer using {X}"
"deprecated {X} in favor of {Y}"
"reverted to {X}"  // supersedes the thing that replaced X
```

Heuristic regex detection during fact extraction marks these as `temporal_hint: "supersedes_previous"`, and the old fact is invalidated immediately.

### Queries with Temporal Awareness

```datalog
// What's true NOW about this project?
?[entity, predicate, object] :=
  *fact[subject_id, predicate, object_id, valid_at, invalid_at],
  invalid_at == null,
  *entity[id, name] @ subject_id -> entity,
  *entity[id, name] @ object_id -> object

// What was true on a specific date?
?[entity, predicate, object] :=
  *fact[subject_id, predicate, object_id, valid_at, invalid_at],
  valid_at <= "2026-04-15",
  (invalid_at == null || invalid_at > "2026-04-15"),
  ...

// What changed this week? (contradiction audit trail)
?[old_fact, new_fact, invalidated_at] :=
  *fact[id, ..., invalid_at, expired_at] @ old_fact,
  expired_at >= "2026-04-21",
  expired_at <= "2026-04-27",
  ...
```

---

## 9. Comprehension Decay Model

### Problem

Comprehension is not permanent. A developer who deeply understood the auth module 3 months ago but hasn't touched it since has degraded comprehension. The system must model this — otherwise the Comprehension Score becomes a monotonically increasing number that means nothing.

### Research: Best-Quality Decay Parameters

**Sources evaluated:**
- Ebbinghaus (1885) + Murre & Dros (2015 replication): Original curve confirmed — retention ≈ e^(-t/S). Murre replicated with S ≈ 1.04 days for nonsense syllables, much higher for meaningful material.
- **FSRS (Free Spaced Repetition Scheduler)** by Anki community (Ye et al., 2024): More accurate than SM-2. Uses 19 optimizable parameters, models stability as `S' = S × e^(w × (R - 1))` where R is retrievability at review time. RMSE 30% lower than SM-2 on Anki's 100M+ review dataset.
- **SM-18** (Wozniak, latest): Proprietary but leaked principles — stability growth is sublinear (logarithmic), not linear. Repeated short-interval reviews build stability faster than spaced ones for initial learning.
- **BKT (Bayesian Knowledge Tracing)**: P(L0)=0.1, P(T)=0.3, P(G)=0.1, P(S)=0.2 are typical starting values. Good for binary mastery but too coarse for 0–100 comprehension.
- **Code-specific findings**: No direct study on "developer forgetting code." Closest: Google's OWNERS model and "truck factor" research show that developers who haven't touched a module in >30 days need significant ramp-up time. Anecdotally, procedural knowledge (how to code) decays slower than declarative knowledge (specific implementation details).

**DECISION: FSRS-inspired model (highest quality, research-backed).**

SM-2 is a 1987 algorithm. FSRS is its modern successor with 30% better prediction accuracy on real-world data. We adapt FSRS's core insight: **stability grows sublinearly with repeated engagement, and retrievability (comprehension) follows an exponential decay from the last engagement.**

### Forgetting Curve (FSRS-adapted for developer context)

```
comprehension(domain, t) = baseScore × retrievability(t)
retrievability(t) = (1 + t / (9 × stability))^(-1)
```

This is the FSRS power-law decay formula, which fits real-world retention data better than Ebbinghaus's exponential (Ye et al., 2024). The constant 9 is the FSRS "decay factor" calibrated against 100M+ reviews.

Where:
- `baseScore` = comprehension score from the most recent assessment of this domain (0–100)
- `t` = days since last meaningful interaction with this domain
- `stability` = days until retrievability drops to 90% (FSRS definition)

### Stability Computation (FSRS-adapted)

```
Initial stability depends on how the developer first engaged:

  initialStability:
    "wrote-the-code"        → 7.0 days   // strong encoding — authored it
    "deep-conversation"     → 5.0 days   // engaged deeply with AI about it
    "code-review"           → 3.0 days   // read and evaluated but didn't write
    "mentioned-in-passing"  → 1.0 day    // tangential reference, weak encoding

  On each re-engagement:
    new_stability = stability × (1 + decayMultiplier × stability^(-0.5) × (e^(desiredRetention × ln(retrievability)) - 1))

  Where:
    decayMultiplier = 0.5 (calibrated from FSRS w[17])
    desiredRetention = 0.9 (target 90% comprehension retention)
    retrievability = current retrievability at time of re-engagement

  Simplified approximation for implementation:
    new_stability = stability × (1 + 0.4 × log2(engagement_quality + 1))

  Where engagement_quality (1–5):
    1 = mentioned in passing
    2 = read/reviewed code
    3 = discussed with AI in depth
    4 = modified/debugged the code
    5 = authored significant changes + demonstrated understanding
```

**Key properties (why FSRS > SM-2):**
- Stability grows **sublinearly** (logarithmic), not linearly. The 5th interaction adds less stability than the 2nd — this matches reality.
- Early reviews (touching code again within a few days) build stability faster than late reviews — matches developer experience (ramp-up is easier when recent).
- The power-law decay `(1 + t/9S)^(-1)` has a **heavier tail** than exponential — developers retain some comprehension of things they deeply understood even after long gaps, which exponential decay underestimates.

### Stability Examples

```
Scenario 1: Developer writes auth module (initialStability=7), never touches it again
  Day 0:  comprehension = 100% of baseScore
  Day 7:  retrievability = (1 + 7/63)^(-1) = 0.90 → 90% retained
  Day 30: retrievability = (1 + 30/63)^(-1) = 0.68 → 68% retained
  Day 90: retrievability = (1 + 90/63)^(-1) = 0.41 → 41% retained

Scenario 2: Developer writes auth module, re-engages at Day 14 (stability → 10.3)
  Day 14: re-engagement, new_stability = 7 × (1 + 0.4 × log2(5)) = 7 × 1.93 = 13.5
  Day 30: retrievability = (1 + 16/121.5)^(-1) = 0.88 → 88% retained (vs 68% without re-engagement)

Scenario 3: Developer reviewed code once (initialStability=3), never touches it again
  Day 7:  retrievability = (1 + 7/27)^(-1) = 0.79 → 79% retained
  Day 30: retrievability = (1 + 30/27)^(-1) = 0.47 → 47% retained (fast decay — weak initial encoding)
```

### Domain Complexity Modifier

Not all domains decay at the same rate. Simple utilities are easier to re-learn than complex distributed systems:

```
effectiveStability = stability × complexityModifier(domain)

complexityModifier:
  "simple-utility"     → 1.5   // slow decay — easy to pick back up
  "standard-module"    → 1.0   // default
  "complex-system"     → 0.7   // fast decay — hard to hold in memory
  "distributed-system" → 0.5   // fastest decay — many moving parts

Complexity is inferred from:
  - File count in module
  - Cross-module dependency count
  - Average turn count of conversations about this domain
  - Decision density (more decisions = more complex)
```

### Floor Value

Comprehension never drops below a floor for code the developer authored:

```
floor(domain):
  authored code       → 15  // you always retain some understanding of code you wrote
  deeply discussed    → 10  // deep engagement leaves lasting traces
  reviewed/mentioned  → 0   // no floor — can fully forget tangential knowledge
```

### Daily Decay Computation

Runs daily (no LLM, pure arithmetic on DuckDB):

```sql
-- FSRS power-law decay computation (daily, no LLM, pure DuckDB arithmetic)
SELECT
  domain,
  project_id,
  base_score,
  DATEDIFF('day', last_touch, CURRENT_DATE) AS days_since_last_touch,
  stability * complexity_modifier AS effective_stability,
  -- FSRS retrievability formula: (1 + t / (9 * S))^(-1)
  base_score * POWER(1 + DATEDIFF('day', last_touch, CURRENT_DATE)
    / (9.0 * stability * complexity_modifier), -1) AS current_comprehension,
  -- Apply floor for authored/deep-discussed domains
  GREATEST(
    base_score * POWER(1 + DATEDIFF('day', last_touch, CURRENT_DATE)
      / (9.0 * stability * complexity_modifier), -1),
    floor_value
  ) AS floored_comprehension
FROM domain_comprehension_state
WHERE floored_comprehension > 5.0  -- prune near-zero scores
```

### Reinforcement Events

Any of these count as a "touch" that resets `daysSinceLastTouch` and increments `interactionCount`:

| Event Type | Engagement Quality (1–5) | Stability Update | Notes |
|---|---|---|---|
| Authored significant code changes + demonstrated understanding | 5 | `S' = S × (1 + 0.4 × log2(6))` = S × 2.03 | Strongest encoding |
| Modified/debugged domain code | 4 | `S' = S × (1 + 0.4 × log2(5))` = S × 1.93 | Active problem-solving |
| Deep AI conversation about domain | 3 | `S' = S × (1 + 0.4 × log2(4))` = S × 1.80 | Engaged discussion |
| Read/reviewed domain code | 2 | `S' = S × (1 + 0.4 × log2(3))` = S × 1.63 | Passive engagement |
| Mentioned domain in passing | 1 | `S' = S × (1 + 0.4 × log2(2))` = S × 1.40 | Minimal reinforcement |

Base score adjustment on re-engagement (small upward nudge):
```
baseScore = min(100, previousBase × (1 + 0.02 × engagementQuality))
```

Note: FSRS's key insight is that re-engagement when retrievability is LOW builds more stability than when it's HIGH (the "desirable difficulty" effect). The simplified formula above captures this approximately — future refinement can add the full FSRS retrievability-dependent update.

---

## 10. Aggregation & The Comprehension Score

### The Hero Metric

Everything in this layer feeds into one number: the **Comprehension Score (0–100)**.

### Computation (daily)

```
ComprehensionScore = Σ(domainScore × domainWeight) / Σ(domainWeight)

Where:
  domainScore = comprehension(domain, today)    // Section 9 decay model
  domainWeight = recencyWeight × significanceWeight

  recencyWeight = 1.0 if touched in last 7 days
                  0.7 if touched in last 30 days
                  0.3 if touched in last 90 days
                  0.1 if older (don't let ancient history dominate)

  significanceWeight = log2(factCount + 1)      // domains with more facts matter more
                     × (hasDecisions ? 1.5 : 1.0)  // decision-bearing domains matter more
```

### Trend Detection

```
trend(window=7d):
  scores = last 7 daily ComprehensionScores
  IF Mann-Kendall τ > 0.3 AND p < 0.05 → "improving"
  IF Mann-Kendall τ < -0.3 AND p < 0.05 → "declining"
  ELSE → "stable"
```

### Narrative Generation (feeds into distill)

The Comprehension Score alone is a number. The narrative gives it meaning:

```
"Your Comprehension Score is 73 (stable).
 You deeply engaged with the payment refactoring (steering: 9/10, understanding: 8/10)
 but rubber-stamped the auth migration (steering: 3/10, 12 suggestions accepted without modification).
 Your comprehension of the auth module is decaying — last deep engagement was 18 days ago."
```

---

## 11. Extraction Architecture — Every Event Gets LLM Extraction

### Core Principle

**LLM extraction is the product, not an optimization.** Unfade's value proposition is answering the hard questions that both developers and executives are desperate to know:
- Why did it happen that way?
- What's the role of human vs AI in achieving this outcome?
- Is this sustainable in the long run?
- Is the developer understanding more or becoming more dependent?

Heuristics can tell you *what happened* — so can `git log`. Only LLM can extract *why it happened*, *who drove the reasoning*, and *whether the developer actually understood the trade-offs*.

**Every captured event gets LLM extraction. No pre-filtering, no noise gates.** A critical architectural decision can happen in a 2-turn, 100-character exchange. A one-line commit message saying "reverted auth to session cookies" is a major decision. Any heuristic threshold (character count, turn count, commit message length) risks silently discarding the most important intelligence. The LLM decides what's meaningful — that's its job.


### Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  EXTRACTION: LLM-POWERED (~2–5s per event)                         │
│                                                                     │
│  Every captured event gets a combined extraction prompt — ONE call: │
│                                                                     │
│  ✓ Entity extraction (technologies, modules, patterns, people)     │
│  ✓ Atomic fact extraction with temporal markers                    │
│  ✓ Human-vs-AI agency classification per segment:                  │
│    - "developer directed" (rejected suggestions, steered approach)  │
│    - "developer accepted" (took AI output with minor edits)         │
│    - "developer rubber-stamped" (accepted without modification)     │
│    - "collaborative" (iterative refinement, back-and-forth)         │
│  ✓ Rubric-based comprehension assessment (5 dimensions, §6)        │
│  ✓ Metacognitive signal detection (why questions, pushback,        │
│    constraint explanation, dead-end recognition)                    │
│  ✓ Sustainability signal: does this interaction build or erode     │
│    the developer's independent capability?                          │
│  ✓ Reasoning chain extraction: what trade-offs were considered?    │
│                                                                     │
│  If the event contains no extractable intelligence, the LLM        │
│  returns an empty extraction — cost is minimal (~$0.001).           │
│                                                                     │
│  Quality: ~85–90% across all dimensions                            │
│  Cost: ~$0.005–0.02/event (Haiku/mini) or ~$0.02–0.08 (Sonnet/4o) │
└─────────────────────────────────┬───────────────────────────────────┘
                              │ Embeddings needed for graph operations
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  EMBEDDING: IN-PROCESS ONNX (all-MiniLM-L6-v2, ~50ms per entity)  │
│                                                                     │
│  Purpose: Support graph operations, NOT extraction.                 │
│                                                                     │
│  ✓ Contradiction candidate retrieval (HNSW search in CozoDB)       │
│  ✓ Entity deduplication (embedding similarity > 0.85 = same)       │
│  ✓ Topic segmentation validation (cosine similarity valleys)       │
│  ✓ Cross-session concept linking                                   │
│                                                                     │
│  Cost: $0, RAM: ~50MB (22MB model + runtime), CPU: minimal         │
│  Load: Lazy-loaded on first use, kept warm                          │
└─────────────────────────────────────────────────────────────────────┘
```

### Why No Pre-Filter / Noise Gate

We deliberately avoid heuristic pre-filtering before LLM extraction:

1. **Critical decisions happen in tiny interactions.** "Reverted auth to session cookies" is 1 line, <50 chars — and it's a major architectural reversal. "Use DynamoDB instead" is 1 turn, 20 chars — and it changes the entire data layer. Any character/turn threshold risks silently discarding the most important intelligence.
2. **Layer 1 already filters non-developer events.** The Go capture daemons only write git commits, AI sessions, and terminal sessions to JSONL. File saves, build logs, lint output, and CI notifications never reach the extraction pipeline. The "noise" problem is already solved upstream.
3. **LLM handles empty events gracefully.** If an event truly contains nothing extractable, the LLM returns an empty extraction result. Cost for an empty extraction is ~$0.001 — negligible compared to the risk of missing a critical decision.
4. **Heuristic gates create false confidence.** Any filtering rule becomes a silent data loss mechanism that nobody audits. Better to send everything and let the LLM — which actually understands language — decide what matters.

### Why LLM-First, Not Heuristic-First

1. **The hard questions require language understanding.** "Did the developer direct the AI or rubber-stamp its output?" requires reading the conversation transcript and understanding intent. No regex or ONNX classifier can answer this.
2. **Comprehension assessment is the core metric.** The Comprehension Score — the single number that answers "am I understanding more or less?" — depends on rubric-based LLM judgment, not heuristic proxies.
3. **Sustainability signals are contextual.** Whether an interaction builds or erodes independent capability depends on the developer's engagement pattern within the session — steering vs. accepting, questioning vs. copying.
4. **Reasoning chains are narrative.** "Chose Postgres over DynamoDB because latency > scale for this use case" is extracted from natural language dialogue. Pattern matching captures <10% of real reasoning.
5. **Quality over cost.** Users bring their own API keys and accept the LLM costs. At GPT-4o-mini/Flash pricing, typical usage costs **$0.25–0.75/month**. At frontier model pricing, **$5–12/month**. The product imposes zero artificial limits — every event gets full extraction.

### Cost Projections

| User Activity | Events/Day | GPT-4o-mini / Flash (monthly) | Haiku (monthly) | Sonnet/4o (monthly) | Notes |
|---|---|---|---|---|---|
| Light (hobbyist) | 10–20 | $0.01–0.10 | $0.05–0.40 | $0.20–1.60 | Few AI sessions, small commits |
| Moderate (daily dev) | 30–60 | $0.10–0.30 | $0.50–1.20 | $1.80–4.80 | Regular AI-assisted coding |
| Heavy (power user) | 80–150 | $0.25–0.75 | $1.20–3.00 | $4.80–12.00 | Multiple AI tools, large projects |

**Note:** Users bring their own API keys. At the recommended GPT-4o-mini/Flash tier, typical monthly costs are $0.10–0.75. At frontier models, $5–12. The product imposes no limits — users control their own cost/quality trade-off by choosing their provider and model.

### LLM Provider Strategy

Users configure their LLM provider once during setup (same config as daily distill — `config.distill.provider`).

**Model selection principle:** Extraction is a structured output / classification task, not a reasoning task. We don't need frontier models — smaller, cheaper, faster models produce excellent structured extraction quality. Cost is not a barrier; quality and reliability of intelligence metrics is the priority.

| Provider | Model | Cost/Event | Best For |
|---|---|---|---|
| **OpenAI** (default recommendation) | GPT-4o-mini | ~$0.001–0.005 | Best speed + structured output quality for extraction. Default. |
| **Google** | Gemini 2.0 Flash | ~$0.001–0.005 | Fast, cheap, excellent structured output |
| **Anthropic** | Claude 3.5 Haiku | ~$0.005–0.01 | High quality structured extraction |
| **OpenAI** | GPT-4o | ~$0.02–0.08 | Maximum quality (overkill for most extraction) |
| **Anthropic** | Claude Sonnet | ~$0.02–0.06 | Maximum quality (overkill for most extraction) |
| **Custom** | Any OpenAI-compatible | Varies | vLLM, LM Studio, Fireworks, etc. |
| **Ollama** (local) | Qwen3-4B | $0 (CPU cost) | Privacy-first users, batch only — NOT for always-on |

**Why GPT-4o-mini / Gemini Flash as default:** These models achieve 90%+ accuracy on structured extraction and classification tasks. Extraction doesn't require deep reasoning — it requires reliably following a schema and classifying patterns in conversation text. Users who want maximum quality can switch to Sonnet/4o. The product imposes no restrictions on model choice or usage volume.

**Ollama limitation:** 4GB RAM + CPU saturation makes it unsuitable for real-time extraction alongside our existing stack (DuckDB, SQLite, CozoDB, file watchers, HTTP server). Acceptable only for explicit batch commands (`unfade distill --deep`) where the user is actively waiting.


### What Happens Without LLM Configuration?

During onboarding, Unfade explains why LLM access matters: "To measure your comprehension — not just what you built, but whether you understood it — Unfade needs to read your AI conversations. This requires an LLM provider."

If the user skips LLM setup:
- **Capture still works** — all events are captured to JSONL (Layer 1–2 run normally)
- **Basic metrics still work** — velocity, commit frequency, session duration (Layer 3 analyzers)
- **Knowledge extraction is deferred** — events are queued for extraction when LLM is configured
- **Comprehension Score shows "–"** with a prompt: "Configure an LLM provider to unlock your Comprehension Score"
- **No heuristic fake-out** — we don't pretend to measure comprehension with regex. That would be dishonest about the product's core value.

This is honest product design. The Comprehension Score is either real (LLM-assessed) or absent. There's no "60% quality" middle ground that gives users a false sense of measurement.

### Concurrency & Timeouts

```
LLM_CONCURRENCY = 5              // parallel extraction calls (maximize throughput)
LLM_TIMEOUT = 30_000             // 30s per extraction call
CONTRADICTION_BATCH_TIMEOUT = 10_000  // 10s per contradiction batch
EMBEDDING_MODEL_LOAD_TIMEOUT = 15_000 // 15s to load all-MiniLM-L6-v2
EMBEDDING_INFERENCE_TIMEOUT = 2_000   // 2s per batch of embeddings
```

**No daily budget / rate limits.** Every captured event gets extracted, period. If the LLM provider rate-limits us, we queue and retry — but we never voluntarily skip events. Complete coverage is a product requirement.

### Research Archive: Alternatives Evaluated

The following alternatives were evaluated and rejected in favor of LLM-first. Retained here for reference.

#### Classical NLP (No ML Required)
| Approach | Quality for Code Conversations | Notes |
|---|---|---|
| Regex + heuristic NER | 60–70% F1 for tech entities | Catches import paths, tech names. Cannot extract reasoning or assess comprehension. |
| TextRank / RAKE | Good for keywords, bad for relations | Cannot extract facts or trade-offs. |
| Discourse markers | 85%+ for segmentation | Useful for topic segmentation (Section 3), not extraction filtering. |

**Why rejected as extractors:** These approaches answer "what happened" — the same information available from `git log`. They cannot answer "why it happened", "who understood it", or "is this sustainable". The core questions Unfade exists to answer require language understanding.

#### Specialized ONNX Models (GLiNER, SetFit, bart-large-mnli)
| Model | Task | Quality | Notes |
|---|---|---|---|
| GLiNER | Zero-shot NER | 70–80% F1 | Entity names only, no reasoning extraction |
| SetFit | Few-shot classification | 85–90% accuracy | Binary classification, not structured extraction |
| bart-large-mnli | Zero-shot classification | Good for simple categories | Cannot produce structured knowledge output |

**Why rejected as extractors:** These models excel at classification but cannot produce the structured output we need: facts with temporal markers, agency classification, comprehension rubric scores, reasoning chains. They remain useful for **embedding generation** (all-MiniLM-L6-v2 for contradiction detection and entity deduplication).

#### Small Language Models via Ollama (Qwen3-4B, Llama 3.2-3B)
| Model | Size | RAM | Quality vs GPT-4 |
|---|---|---|---|
| Qwen3-4B | ~2.5GB | ~4GB | ~65% of GPT-4 on extraction |
| Llama 3.2-3B | ~2GB | ~3GB | ~55% of GPT-4 on structured output |

**Why rejected for always-on:** 4GB RAM + CPU saturation competing with DuckDB, SQLite, CozoDB, file watchers, HTTP server. Qwen3-4B is acceptable for batch processing only (`unfade distill --deep`).

---

## 12. Storage Architecture

### Where Each Data Type Lives

| Data | Primary Store | Secondary Store | Justification |
|---|---|---|---|
| Episodes (raw events) | JSONL files | SQLite + DuckDB | Source of truth is JSONL; DBs are caches |
| Segments | DuckDB typed column | SQLite event_segments | Analytics on segments; relational lookups |
| Entities | CozoDB nodes | — | Graph traversal, vector search, lifecycle |
| Facts | CozoDB edges + facts.jsonl | — | Graph queries + append-only audit trail |
| Comprehension assessments | DuckDB | intelligence/*.json | Time-series analytics + file-based intelligence output |
| Metacognitive signals | DuckDB | — | Aggregation queries |
| Contradiction log | CozoDB edge metadata | — | Part of fact lifecycle |
| Decay state | DuckDB | — | Pure arithmetic, daily computation |
| Comprehension Score | DuckDB + intelligence/comprehension.json | — | Analytics + file-based output for dashboard |

### New JSONL Stream: facts.jsonl

```
~/.unfade/graph/facts.jsonl    # Append-only fact log (source of truth for facts)
```

Each line:
```json
{
  "id": "fact-uuid",
  "subject": "Redis",
  "predicate": "USES",
  "object": "caching",
  "confidence": 0.85,
  "valid_at": "2026-04-20T10:00:00Z",
  "invalid_at": null,
  "source_episode": "event-uuid",
  "extraction_method": "llm",
  "extracted_at": "2026-04-20T18:30:00Z"
}
```

Materialized into CozoDB by the existing materializer pattern (cursor-based incremental read).

### CozoDB Schema Additions

```
// New relations (additions to existing substrate schema):

:create fact {
  id: String =>
  subject_id: String,
  predicate: String,
  object_id: String?,
  object_text: String?,
  confidence: Float,
  explicit: Bool,
  valid_at: String,
  invalid_at: String?,
  created_at: String,
  expired_at: String?,
  source_episode: String,
  source_segment: String?,
  extraction_method: String,
}

:create fact_embedding {
  id: String =>
  vec: <F32; 384>,
}

:hnsw fact_embedding:fact_vec_idx {
  dim: 384, m: 16, ef_construction: 100,
  fields: [vec], distance: Cosine,
}

:create entity_alias {
  entity_id: String,
  alias: String =>
}

:create comprehension_assessment {
  episode_id: String =>
  timestamp: String,
  steering: Float,
  understanding: Float,
  metacognition: Float,
  independence: Float,
  engagement: Float,
  overall_score: Float,
  rubber_stamp_count: Int,
  pushback_count: Int,
  assessment_method: String,
}
```

### DuckDB Schema Additions

```sql
-- New table for daily comprehension decay state (FSRS-adapted model)
CREATE TABLE IF NOT EXISTS domain_comprehension (
  domain              VARCHAR NOT NULL,
  project_id          VARCHAR NOT NULL,
  base_score          DOUBLE,          -- last assessed comprehension (0–100)
  stability           DOUBLE,          -- FSRS stability: days until retrievability drops to 90%
  complexity_modifier DOUBLE DEFAULT 1.0, -- 0.5–1.5 based on domain complexity
  floor_value         DOUBLE DEFAULT 0,   -- minimum comprehension (15 if authored, 10 if deep, 0 otherwise)
  last_touch          TIMESTAMP,
  engagement_quality  INTEGER DEFAULT 3,  -- 1–5 quality of last engagement
  interaction_count   INTEGER,
  current_score       DOUBLE,          -- FSRS: base_score * (1 + t/(9*S*CM))^(-1)
  updated_at          TIMESTAMP,
  PRIMARY KEY (domain, project_id)
);

-- New table for comprehension score time-series
CREATE TABLE IF NOT EXISTS comprehension_scores (
  date         DATE NOT NULL,
  project_id   VARCHAR NOT NULL,
  score        DOUBLE,
  trend        VARCHAR,        -- improving | stable | declining
  domain_count INTEGER,
  top_domain   VARCHAR,
  weak_domain  VARCHAR,
  PRIMARY KEY (date, project_id)
);

-- New column on events table
ALTER TABLE events ADD COLUMN IF NOT EXISTS segments JSON;
```

---

## 13. Integration Points

### With Existing Layers

| Integration | Direction | How |
|---|---|---|
| Layer 2 → 2.5 | Input | MaterializerDaemon triggers extraction after new events materialize |
| Layer 2.5 → Layer 3 | Output | Layer 3 analyzers consume extracted knowledge via `KnowledgeReader` on `AnalyzerContext`. See **LAYER_3_INTELLIGENCE_EXTRACTOR.md §17 (KGI sprints)** for the full integration plan. |
| Layer 2.5 → Distill | Output | Comprehension assessments + facts feed daily distill narrative |
| Layer 2.5 → MCP | Output | `unfade-comprehension` tool returns decay-aware scores |
| Layer 2.5 → Cards | Output | Comprehension Score + domain strengths feed Thinking Card |
| Layer 2.5 → Profile | Output | Metacognitive density, entity engagement feed reasoning_model.json |

> **Cross-reference:** The Knowledge-Grounded Intelligence (KGI) sprint plan in `LAYER_3_INTELLIGENCE_EXTRACTOR.md §17` defines 14 sprints (KGI-1 through KGI-14) that rewire Layer 3's 25 analyzers to consume Layer 2.5's extracted knowledge as their primary signal. Layer 2.5 is the knowledge foundation; Layer 3 is the analytics + synthesis layer over that knowledge.

### Trigger Points

```
MaterializerDaemon.tick()
  → materializeIncremental()     // existing: JSONL → SQLite + DuckDB
  → extractKnowledge()           // NEW: Layer 2.5 extraction
      ├── segmentConversations()
      ├── extractEntitiesAndFacts()
      ├── assessComprehension()
      ├── detectContradictions()
      └── writeFactsJSONL()
  → onTick()                     // existing: intelligence analyzers (Layer 3)
  → computeDecay()               // NEW: daily decay update (if day boundary crossed)
```

### Graceful Degradation

| Condition | Behavior |
|---|---|
| **LLM configured (normal)** | Full extraction for every captured event. Embedding model loaded for graph operations. ~85–90% quality. |
| **No LLM configured** | Events captured to JSONL but knowledge extraction deferred. Comprehension Score shows "–". Basic metrics (velocity, commit frequency) still work via Layer 3 analyzers. |
| **LLM timeout/error** | Event queued for retry on next pipeline tick. No partial/heuristic extraction — either real or deferred. Retries indefinitely until successful. |
| **LLM provider rate limit** | Queue events with exponential backoff. All events will be processed — none are dropped. |
| **CozoDB unavailable** | Facts written to facts.jsonl. Graph population deferred until CozoDB recovers. |
| **Embedding model load failure** | LLM extraction continues normally. Contradiction detection and entity dedup deferred until embedding model loads. |
| **Low memory (<1GB free)** | Don't load embedding model. LLM extraction continues (remote API, not local). Log warning. |

---

## 14. Design Decisions

| Decision | Rationale | Alternatives Considered |
|---|---|---|
| **Fact as atomic unit** (not decision, not summary) | Facts are independently temporal, queryable, and composable. Decisions and summaries are derived views over facts. | Per-conversation summaries (too coarse), per-turn extraction (too fine) |
| **Bi-temporal model** | Required to answer both "what was true then?" and "what did we know then?" Developer conversations often reveal past state changes. | Single-timestamp (can't distinguish valid time from transaction time), no temporal tracking (stale graph) |
| **Every event gets LLM extraction** | Only LLM can answer the hard questions: why, human-vs-AI agency, sustainability, reasoning chains. No pre-filtering — a critical decision can happen in 1 turn / 50 chars. Layer 1 already filters non-developer events. Cost is not a barrier; quality of intelligence metrics is what matters. | Three-tier hybrid (heuristics pretend to extract intelligence they can't), noise gate pre-filter (risks silently discarding critical decisions) |
| **Combined extraction prompt** | 1 LLM call per event instead of 4. Extracts entities, facts, agency, comprehension, sustainability, and reasoning chains in a single call. Critical for cost ($0.005–0.02/event). | Separate specialized prompts (higher quality per dimension, but 4x cost) |
| **FSRS power-law decay** | 30% better prediction accuracy than SM-2 on 100M+ reviews. Power-law tail matches developer retention reality. | SM-2 exponential (underestimates long-term retention), linear decay (unrealistic), no decay (score meaningless) |
| **Structural + embedding segmentation** | Structural captures 85%+ of boundaries in code conversations. Embeddings validate and catch the remaining 15%. Cost: 22MB model, <50ms/turn. | Structural-only (misses subtle topic shifts), embedding-only (expensive, high false positive rate) |
| **Daily batch contradiction detection** | Developers check analytics morning/end-of-day, not mid-coding. Narrative framing in distill ("you evolved your thinking on X") is more valuable than mid-coding interruptions. | Real-time (interrupts flow, notification fatigue, no narrative context) |
| **HNSW vector search for contradiction candidates** | Embedding similarity is the only scalable way to find semantically similar facts without scanning the full graph. | Full-text search (misses paraphrased contradictions), brute-force comparison (O(n) per new fact) |
| **facts.jsonl as source of truth** | Consistent with JSONL-as-source-of-truth pattern. CozoDB is a derived cache, rebuildable. | CozoDB as source of truth (harder to rebuild, less inspectable) |
| **Honest no-LLM behavior** | Without LLM configured, Comprehension Score shows "–" with a prompt to configure a provider. No heuristic fake-out — pretending to measure comprehension with regex would be dishonest about the product's core value. Capture still works; extraction is deferred until LLM is configured. | Heuristic fallback (gives false confidence in measurement quality), product unusable without LLM (loses capture value) |

---

## 15. Research Decisions (Resolved)

### D1: Extraction Architecture — Every Event Gets LLM Extraction

**Question:** Is there a mechanism that offers similar processing ability to LLM but at lower cost?

**Research:** Evaluated classical NLP (regex, TextRank, RAKE), specialized ONNX models (GLiNER, SetFit, bart-large-mnli), small LLMs via Ollama (Qwen3-4B, Llama 3.2-3B), and in-process embeddings. Full evaluation preserved in Section 11 Research Archive.

**Decision:** Every captured event gets LLM extraction — no pre-filtering (detailed in Section 11):
- **LLM extraction (every event):** Combined prompt extracts entities, facts, agency classification, comprehension assessment, sustainability signals, and reasoning chains in ONE call. ~85–90% quality. No caps, no budgets, no event skipping.
- **Embedding (ONNX, graph ops only):** all-MiniLM-L6-v2 for contradiction candidate retrieval, entity dedup, segmentation validation. NOT for extraction. Cost: $0, ~50ms/entity.
- **No noise gate / pre-filter.** Layer 1 Go daemons already filter non-developer events (only git commits, AI sessions, terminal sessions reach JSONL). A critical architectural decision can happen in 1 turn / 50 chars — any heuristic threshold risks silent data loss.

**Why every event, not filtered:** The cost of missing a critical decision (silent data loss, incomplete intelligence graph) far exceeds the cost of sending a low-content event to the LLM. An empty extraction costs ~$0.001. A missed "reverted auth to session cookies" commit corrupts the entire comprehension narrative. Quality of intelligence metrics is the priority, not LLM cost optimization.

**Why not Ollama-only:** Running Qwen3-4B locally requires 4GB RAM and saturates CPU during inference. Our app already runs DuckDB, SQLite, CozoDB, file watchers, and a Node.js HTTP server — adding a continuously-running 4B model is not viable. Ollama is acceptable for explicit batch processing (`unfade distill --deep`) only.

**Why not heuristic fallback:** Pretending to measure comprehension with regex gives users false confidence in a number that means nothing. Without LLM, Comprehension Score shows "–" — honest product design. Capture still works; extraction is deferred until LLM is configured.

### D2: Embedding for Topic Segmentation — Yes, as Validation Layer

**Question:** Does embedding improve segmentation quality enough to justify the cost?

**Research:** Structural signals capture 85%+ of topic boundaries in code conversations (file-path discontinuity, explicit instructions, tool-use gaps, temporal gaps). Embedding-based approaches (TextTiling, C99) add ~2–5% F1 on general dialogue benchmarks (Xing et al., 2024). The gap narrows for task-oriented dialogue.

**Decision:** Embeddings validate and refine structural segmentation, not replace it. all-MiniLM-L6-v2 (22MB, 384d, <50ms/embed on CPU) is used for:
1. Validating structural boundaries (high cosine similarity across boundary → false positive → merge)
2. Detecting missed boundaries in long single-segment conversations (>20 turns)
3. Entity deduplication and contradiction candidate retrieval

**Rationale:** The quality improvement is small (85% → 88%) but embeddings are needed anyway for contradiction detection (Section 8) and entity deduplication (Section 4). Since the model is already loaded for those tasks, using it for segmentation validation has zero marginal cost.

### D3: Contradiction Detection Timing — Daily Batch

**Question:** Should contradiction detection run in real-time or batch?

**Research:** Developer dashboard usage patterns across GitHub Copilot Metrics, CodeScene, LinearB, and Pluralsight Flow show developers check analytics **morning and end-of-day**, not during active coding. Real-time interruptions during coding violate deep work principles and cause notification fatigue. The RRVV product analysis confirms: users want "morning glance" and "end of day" distill, with mid-session alerts only for active comprehension dips.

**Decision:** Per-session extraction + daily contradiction resolution (detailed in Section 8):
- **Immediate (per-session):** LLM extraction runs on every captured event. Stage 1 contradiction candidates (embedding HNSW search, <10ms) flagged immediately.
- **Daily batch:** Stage 2 LLM classification of all flagged candidates. Resolution and fact invalidation. Results flow into daily distill narrative.

**Rationale:** Contradictions are historical insights ("you evolved your thinking on auth approach"), not actionable interruptions. The narrative framing in daily distill is more valuable than a mid-coding popup — developers want to see how their thinking evolved, not be interrupted with "you changed your mind."

### D4: Comprehension Decay Parameters — FSRS-Adapted Model

**Question:** What parameters provide best quality for comprehension decay?

**Research:** Evaluated Ebbinghaus (1885) + Murre & Dros (2015 replication), SM-2 (Wozniak, 1987), SM-18 (latest SuperMemo), FSRS (Ye et al., 2024, Anki community), BKT (Bayesian Knowledge Tracing), and DKT (Deep Knowledge Tracing).

**Decision:** FSRS-adapted power-law decay (detailed in Section 9):
- `retrievability(t) = (1 + t / (9 × stability))^(-1)` — power-law, not exponential
- Initial stability: 7 days (authored), 5 days (deep conversation), 3 days (review), 1 day (mention)
- Stability growth: sublinear (logarithmic), `new_stability = stability × (1 + 0.4 × log2(engagement_quality + 1))`
- Floor values: 15 (authored code), 10 (deeply discussed), 0 (tangential)

**Why FSRS over SM-2:** FSRS has 30% lower RMSE than SM-2 on Anki's 100M+ review dataset. Key improvement: power-law decay has a heavier tail than exponential — developers retain some understanding of deeply-learned code even after long gaps, which exponential decay underestimates. Sublinear stability growth prevents unrealistic stability inflation from many shallow interactions.

### D5: CozoDB — Keep, Ship Faster with Reasoning

**Question:** Should we simplify to facts.jsonl + DuckDB to ship faster?

**Decision:** Keep CozoDB. The knowledge graph queries (temporal fact retrieval, entity traversal, contradiction candidate search via HNSW) are core to the product's value proposition. Simplifying to DuckDB would mean reimplementing graph traversal and vector search in SQL, which is slower to build and worse at runtime.

**Rationale:** CozoDB already has schema, HNSW index support, and Datalog queries. The fact schema (Section 5) maps directly to CozoDB relations. facts.jsonl remains the source of truth (consistent with our JSONL-first architecture), with CozoDB as a derived cache. This means CozoDB issues don't cause data loss.

### Remaining Open Questions

| Question | Context | Impact |
|---|---|---|
| **Cross-project entity resolution** | Should "Redis" in Project A and "Redis" in Project B be the same entity? For technologies yes, for modules no. | Affects cross-project amplification and the Thinking Card |
| **Fact confidence calibration** | LLM self-reported confidence is unreliable. Need heuristic calibration: explicit statements → 0.9, inferred → 0.6, ambiguous → 0.3. | Affects contradiction resolution |
| **Extraction prompt stability** | LLM structured output varies between models/versions. Need versioned extraction schemas. | Data consistency over time |
| **Privacy boundaries** | Full conversation text sent to LLM for extraction. Need opt-out per conversation or redaction. | User trust, adoption |

---

## 16. File Map (Planned)

| File | Lines (est.) | Purpose |
|---|---|---|
| `src/services/knowledge/extractor.ts` | ~300 | Orchestrator: segments → entities → facts → assessment per conversation |
| `src/services/knowledge/segmenter.ts` | ~150 | Topic segmentation (structural + optional embedding) |
| `src/services/knowledge/entity-resolver.ts` | ~200 | Entity extraction, deduplication, CozoDB resolution |
| `src/services/knowledge/fact-extractor.ts` | ~200 | Atomic fact extraction, temporal field assignment |
| `src/services/knowledge/comprehension-judge.ts` | ~150 | Rubric-based comprehension assessment (LLM + heuristic fallback) |
| `src/services/knowledge/contradiction-detector.ts` | ~200 | Embedding search + LLM classification + temporal resolution |
| `src/services/knowledge/decay-engine.ts` | ~100 | Forgetting curve computation, daily decay update |
| `src/services/knowledge/prompts.ts` | ~150 | All LLM extraction prompts (versioned, testable) |
| `src/schemas/knowledge.ts` | ~100 | Zod schemas: Entity, Fact, ComprehensionAssessment, Segment |
| `src/services/knowledge/index.ts` | ~50 | Public API: extractKnowledge(), computeDecay() |

---

## 17. Research Sources

| Source | Key Insight | Applied In |
|---|---|---|
| Graphiti/Zep (arXiv 2501.13956) | Three-tier temporal knowledge graph: episodes → entities → facts. Bi-temporal validity. Incremental contradiction detection. | Sections 2, 5, 8 |
| Deep Knowledge Tracing (Stanford, 2015) | Sequential models tracking mastery from interaction sequences | Section 9 (stability model) |
| Epistemic Network Analysis (Shaffer et al.) | Concept co-occurrence networks from discourse reveal expertise | Section 4 (entity relationships) |
| Ebbinghaus Forgetting Curve (1885) + Murre & Dros (2015 replication) | R = e^(-t/S) — retention decays exponentially. Replicated with modern methods. | Section 9 |
| **FSRS (Free Spaced Repetition Scheduler)** (Ye et al., 2024) | Power-law decay `(1+t/9S)^(-1)` outperforms SM-2 by 30% RMSE on 100M+ reviews. Sublinear stability growth. | Section 9 (decay model — primary) |
| SM-2 Algorithm (Wozniak, 1987) | Spaced repetition baseline. Superseded by FSRS for our use case. | Section 9 (historical reference) |
| SM-18 (Wozniak, latest SuperMemo) | Stability growth is sublinear (logarithmic), not linear. | Section 9 (stability computation) |
| LLM-as-Judge (2024–2026) | 80% human agreement, rubric-based outperforms holistic, position bias mitigation | Section 6 |
| Comprehension Debt (Osmani, 2026) | 17% comprehension decline with AI assistants. Invisible to standard metrics. | Sections 1, 6 |
| METR Developer Study (2025) | 19% slower despite feeling 20% faster. Self-assessment unreliable. | Section 6 (don't trust self-reports) |
| ACM Metacognition in Programming (2023) | Self-regulation differentiates expert from novice. Signals: planning, monitoring, evaluating. | Section 7 |
| Truth Maintenance Systems (Doyle, 1979) | Justification-based belief revision with dependency tracking | Section 8 (contradiction resolution) |
| Honeycomb Observability (2020s) | Structured events are atoms; everything is derived. BubbleUp for pattern detection. | Section 2 (architecture philosophy) |
| ATOM Framework (2025) | Adaptive temporal KG construction with parallel merging | Section 5 (fact extraction at scale) |
| **GLiNER** (urchade/GLiNER, ONNX) | Zero-shot NER without LLM. 70–80% F1 on general NER. Runs via Transformers.js. | Section 11 (evaluated, rejected — cannot extract reasoning or agency) |
| **UniNER-7B** (ICLR 2024) | Universal NER via LLM distillation. 41.7% F1 zero-shot outperforms ChatGPT (34.9%). Too large for in-process. | Section 11 (research, not used) |
| **GoLLIE** (ICLR 2024) | Guideline-following structured IE. Code-Llama based. Shows annotation guidelines improve zero-shot extraction. | Section 11 (prompt design influence) |
| **Qwen3-4B** (Alibaba, 2025) | Rivals Qwen2.5-72B quality at 2.5GB. Best small model for structured output. | Section 11 (Ollama recommendation) |
| **Transformers.js v4** (HuggingFace, 2025) | ONNX Runtime in Node.js. Supports NER, classification, embeddings natively. | Section 11 (embedding runtime for graph ops) |
| **all-MiniLM-L6-v2** (Sentence-Transformers) | 22MB, 384d embeddings, 80% clustering accuracy, CPU-friendly. | Sections 3, 8, 11 (embedding model) |
| **SetFit** (HuggingFace, 2023) | Few-shot classification — 85–90% accuracy with 8 examples. ~100MB. | Section 11 (metacognitive signal classification) |
| **Xing et al. (2024)** | Topic segmentation in dialogue: structural signals capture 85%+ in task-oriented dialogue. | Section 3 (segmentation decision) |
| **Cal Newport, Deep Work (2016)** | Real-time interruptions during focused work degrade quality. Applied to contradiction alert timing. | Section 8 (timing decision) |
| **Stack Overflow Developer Survey (2025)** | Notification fatigue is #1 complaint about developer tooling. | Section 8 (timing decision) |

---


---

## 18. Implementation Plan

### Existing Infrastructure (Grounded in Codebase)

The implementation builds on these concrete, verified codepath entry points:

| Infrastructure | File | What Exists | Layer 2.5 Integration Point |
|---|---|---|---|
| **LLM provider system** | `src/services/distill/providers/ai.ts` | `createLLMProvider(config)` → returns `{ model: LanguageModel, provider, modelName }` via Vercel AI SDK. Supports ollama, openai, anthropic, custom. | Reuse for all extraction LLM calls. Same `config.distill.provider` + `config.distill.model`. |
| **Materializer tick loop** | `src/services/cache/materializer-daemon.ts` | `MaterializerDaemon` watches `~/.unfade/events/` via chokidar. `onTick(newRows, cache)` callback fires after each incremental materialization. | Hook `extractKnowledge()` into `onTick` — after events land in DuckDB/SQLite, extract knowledge from them. |
| **Incremental materializer** | `src/services/cache/materializer.ts` | `materializeIncremental(cache)` reads JSONL past cursor, upserts into SQLite + DuckDB. Returns new row count. | Layer 2.5 processes the same new events that were just materialized. Use DuckDB watermark to fetch newly materialized events. |
| **Intelligence DAG scheduler** | `src/services/intelligence/engine.ts` | `IntelligenceScheduler.processEvents(ctx)` runs 25+ analyzers in topological order. Collects `EntityContribution[]` for substrate. | Layer 2.5 runs **before** the intelligence scheduler (extraction feeds analyzers). Alternatively, extraction runs as a special pre-processor in the tick pipeline. |
| **IncrementalAnalyzer interface** | `src/services/intelligence/incremental-state.ts` | `IncrementalAnalyzer<TState, TEvent>` with `initialize()`, `update()`, `contributeEntities()`. Watermark-based delta processing. `AnalyzerEvent` has 25+ typed fields. | Layer 2.5 outputs (comprehension scores, metacognitive density, entity/fact counts) become new typed columns on `AnalyzerEvent` for downstream analyzers. |
| **CozoDB substrate** | `src/services/substrate/substrate-engine.ts` | `SubstrateEngine.ingest(contributions)`, `propagate()`, `query()`. Entity/edge upsert with `escCozo()`. | Layer 2.5 writes entities + facts directly to CozoDB via new relations (fact, fact_embedding, entity_alias, comprehension_assessment). |
| **CozoDB schema** | `src/services/substrate/schema.ts` | `entity`, `entity_source`, `edge` relations. HNSW vector index (64d). `EntityType` includes work-unit, decision, feature, pattern, capability, etc. | Extend: add `fact`, `fact_embedding`, `entity_alias`, `comprehension_assessment` relations. Upgrade HNSW to 384d for all-MiniLM-L6-v2. Add new EntityTypes. |
| **DuckDB analytical schema** | `src/services/cache/duckdb-schema.ts` | `events` table with 37 typed columns. `sessions`, `direction_windows`, `comprehension_proxy`. | Add: `domain_comprehension`, `comprehension_scores` tables. Add `segments` JSON column to events. Add extraction-derived columns. |
| **Event schema** | `src/schemas/event.ts` | `CaptureEventSchema` — id, projectId, timestamp, source, type, content (summary, detail, files), gitContext, metadata. | Input to extraction pipeline. `content.detail` contains the full conversation text for AI sessions. |
| **Distill pipeline** | `src/services/distill/distiller.ts` | `distill(date, config, options)` orchestrates: events → signals → synthesis → profile → graph → notify. | Layer 2.5 contradiction batch runs during distill. Comprehension narrative feeds into distill output. |
| **Path utilities** | `src/utils/paths.ts` | `getGraphDir()`, `getIntelligenceDir()`, `getEventsDir()`, `getCacheDir()`, etc. | Use `getGraphDir()` for `facts.jsonl`. Use `getIntelligenceDir()` for comprehension state files. |
| **CozoManager** | `src/services/substrate/cozo-manager.ts` | Singleton CozoDB instance. `getInstance()`, `close()`, `createTestInstance()`. In-memory fallback. | Use for all graph reads/writes. Schema migrations add Layer 2.5 relations. |
| **Entity resolver** | `src/services/substrate/entity-resolver.ts` | `resolveContributions()`, `mergeIntoExisting()` with merge strategies (latestWins, union, sum, ewma). | Extend merge strategies for knowledge entities. Reuse dedup logic for knowledge entity resolution. |

### Sprint Structure

18 sprints (KE-1 through KE-18), each designed to be completable in a single day (~4–8 hours focused work). Each sprint produces 2–3 tasks with clear, testable deliverables.

**Dependency graph:**
```
KE-1: Zod Schemas
  │
  ├─► KE-2: CozoDB Schema v3
  │
  ├─► KE-3: DuckDB Schema Extensions
  │     │
  │     └─► KE-4: Storage Utilities (fact writer + extraction tracker)
  │
  ├─► KE-5: Turn Parser
  │     │
  │     └─► KE-6: Topic Segmentation + Segment Storage
  │           │
  │           └─► KE-7: Extraction Prompt Design
  │                 │
  │                 └─► KE-8: LLM Extraction Caller + Heuristic Fallback
  │
  ├─► KE-9: Entity Normalizer + Writer
  │     │
  │     └─► KE-10: Three-Pass Entity Resolver
  │
  ├─► KE-11: Fact Graph Writer + Supersession
  │     │
  │     └─► KE-12: Contradiction Detection (Stage 1 + Stage 2)
  │
  ├─► KE-13: Comprehension + Metacognitive Writers
  │     │
  │     └─► KE-14: Comprehension Score Aggregator
  │
  └─► KE-15: FSRS Decay Engine
        │
        └─► KE-16: Embedding Infrastructure (ONNX all-MiniLM-L6-v2)
              │
              └─► KE-17: Knowledge Extraction Orchestrator
                    │
                    └─► KE-18: Materializer + Server Hook
```

**Parallelism:** After KE-1, sprints KE-2/KE-3 can run in parallel. After KE-4, sprints KE-5/KE-9/KE-11/KE-13/KE-15 can run in parallel (independent extraction dimensions). KE-16 requires KE-10/KE-12 (embedding used by entity resolver + contradiction detector).

---

### KE-1: Zod Schemas

**Goal:** Define all Zod schemas and TypeScript types for Layer 2.5 data contracts. Every subsequent sprint imports these.

**Day estimate:** ~4 hours. One file + tests. Pure type definitions, no runtime logic.

---

**KE-1.1: Zod Schemas for Knowledge Extraction**

**New file:** `src/schemas/knowledge.ts`

Define and export Zod schemas + inferred TypeScript types for:
- `ConversationSegmentSchema` — segmentId, episodeId, turnRange, topicLabel, filesInScope, modulesInScope, segmentMethod (§3)
- `ExtractedEntitySchema` — name, normalizedName, type (technology | pattern | module | concept | architecture | library | service | domain), context, confidence, aliases (§4)
- `AtomicFactSchema` — id, subject, predicate (controlled vocabulary from §5), object, objectText, confidence, explicit, temporalHint, validAt, invalidAt, createdAt, expiredAt, sourceEpisode, sourceSegment, extractionMethod (§5)
- `ComprehensionAssessmentSchema` — episodeId, timestamp, dimensions (steering, understanding, metacognition, independence, engagement — each 0-10), overallScore (0-100), weights, evidence[], rubberStampCount, pushbackCount, domainTags, assessmentMethod (§6)
- `MetacognitiveSignalSchema` — turnIndex, signalType (7 types from §7), quote, strength (§7)
- `ContradictionResultSchema` — candidateFactId, newFactId, classification (CONSISTENT | MORE_SPECIFIC | CONTRADICTORY | SUPERSEDES | UNRELATED), resolvedAt (§8)
- `ExtractionResultSchema` — the combined output of one LLM call: segments, entities, facts, comprehension, metacognitiveSignals, agencyClassification, reasoningChains (§11)
- `FactPredicateSchema` — z.enum of all predicates from §5 controlled vocabulary

**Conventions:**
- Each schema exports both Zod schema and `z.infer<>` TypeScript type (matching `src/schemas/event.ts` pattern)
- Predicate vocabulary is a Zod enum — validated at parse time
- Entity type is a Zod enum — extended from `EntityType` in `src/services/substrate/schema.ts`

**Test file:** `test/schemas/knowledge.test.ts`
- Valid extraction result parses successfully
- Invalid predicate rejects
- Missing required fields reject
- Partial ComprehensionAssessment (heuristic fallback) with assessmentMethod: "heuristic-proxy" parses

---

### KE-2: CozoDB Schema v3

**Goal:** Extend the CozoDB graph with fact, comprehension, and metacognitive relations. Bump schema version to 3 with idempotent migration.

**Day estimate:** ~5 hours. Schema definitions + migration logic + tests.

**Depends on:** KE-1 (TypeScript types for reference)

---

**KE-2.1: CozoDB Schema Extensions**

**Modify:** `src/services/substrate/schema.ts`

Add new stored relations (from §12):
```
fact { id: String => subject_id, predicate, object_id?, object_text?, confidence, explicit, valid_at, invalid_at?, created_at, expired_at?, source_episode, source_segment?, extraction_method }
fact_embedding { id: String => vec: <F32; 384> }
entity_alias { entity_id: String, alias: String => }
comprehension_assessment { episode_id: String => timestamp, steering, understanding, metacognition, independence, engagement, overall_score, rubber_stamp_count, pushback_count, assessment_method }
metacognitive_signal { episode_id: String, turn_index: Int => signal_type, quote, strength }
```

Add HNSW index on `fact_embedding` (384d, Cosine distance).

Extend `EntityType` to include: `'technology' | 'concept' | 'module' | 'architecture' | 'library' | 'service' | 'domain-area'` (knowledge-specific entity types, alongside existing substrate types).

Extend `RelationshipType` to include fact predicates: `'uses' | 'decided' | 'depends-on-tech' | 'understands' | 'switched-from' | 'chosen-over' | 'implemented-in' | 'replaced-by' | 'created-tech' | 'investigated' | 'debugged' | 'refactored' | 'tested' | 'reviewed'`.

Bump `SCHEMA_VERSION` from 2 to 3.

---

**KE-2.2: CozoDB Schema Migration**

**Modify:** `src/services/substrate/cozo-manager.ts`
- Add schema version check + migration path (2→3)
- New relations created via `:create` if missing
- Migration is idempotent — running twice has no effect

**Test:** `test/services/substrate/schema-v3.test.ts`
- In-memory CozoDB: all new relations created
- Migration from v2 → v3 is idempotent
- HNSW index on fact_embedding created

---

### KE-3: DuckDB Schema Extensions

**Goal:** Add analytical tables for comprehension tracking and extraction status to DuckDB.

**Day estimate:** ~4 hours. DDL definitions + manager integration + tests.

**Depends on:** KE-1 (schema types for reference)

---

**KE-3.1: DuckDB Knowledge Tables**

**Modify:** `src/services/cache/duckdb-schema.ts`

Add new DDL constants:
- `DUCKDB_DOMAIN_COMPREHENSION_DDL` — `domain_comprehension` table (§12: domain, project_id, base_score, stability, complexity_modifier, floor_value, last_touch, engagement_quality, interaction_count, current_score, updated_at)
- `DUCKDB_COMPREHENSION_SCORES_DDL` — `comprehension_scores` table (§12: date, project_id, score, trend, domain_count, top_domain, weak_domain)
- `DUCKDB_SEGMENTS_ALTER` — `ALTER TABLE events ADD COLUMN IF NOT EXISTS segments JSON`
- `DUCKDB_EXTRACTION_STATUS_DDL` — `extraction_status` table (event_id, project_id, status: 'pending'|'extracted'|'failed'|'deferred', extracted_at, retry_count, error) — tracks which events have been extracted

---

**KE-3.2: DuckDB Manager Integration**

**Modify:** `src/services/cache/manager.ts`
- Execute new DDL in `initDuckDb()` alongside existing table creation

**Test:** `test/services/cache/duckdb-knowledge-schema.test.ts`
- Tables created without error
- `extraction_status` insert + query roundtrip
- `domain_comprehension` insert + query roundtrip

---

### KE-4: Storage Utilities

**Goal:** Build the two utility modules that track extracted data: the facts.jsonl append-only writer and the extraction status watermark.

**Day estimate:** ~4 hours. Two small modules (~120 lines total) + tests.

**Depends on:** KE-1 (Zod types), KE-3 (extraction_status DuckDB table)

---

**KE-4.1: facts.jsonl Writer**

**New file:** `src/services/knowledge/fact-writer.ts`

Append-only writer for `~/.unfade/graph/facts.jsonl`:
- `appendFact(fact: AtomicFact): void` — append JSON line to `facts.jsonl`
- `appendFacts(facts: AtomicFact[]): void` — batch append
- Uses `getGraphDir()` from `src/utils/paths.ts`
- Atomic write: build full string, single `appendFileSync` call
- File created on first write if missing

**Test:** `test/services/knowledge/fact-writer.test.ts`
- Write 3 facts → file has 3 valid JSON lines
- Concurrent writes don't corrupt (use `UNFADE_HOME` override for isolation)

---

**KE-4.2: Extraction Status Tracker**

**New file:** `src/services/knowledge/extraction-tracker.ts`

Tracks which events have been through LLM extraction (watermark for Layer 2.5):
- `getUnextractedEvents(analytics: DbLike, limit: number): Promise<AnalyzerEvent[]>` — query DuckDB for events NOT in `extraction_status` or with status='failed' and retry_count < 3
- `markExtracted(analytics: DbLike, eventId: string): Promise<void>`
- `markFailed(analytics: DbLike, eventId: string, error: string): Promise<void>`
- `markDeferred(analytics: DbLike, eventId: string): Promise<void>` — for events when no LLM is configured
- `getExtractionStats(analytics: DbLike): Promise<{ total, extracted, pending, failed, deferred }>`

**Why separate from materializer cursor:** The materializer cursor tracks JSONL→DB ingestion. Extraction status tracks DB→knowledge extraction. These are independent watermarks — events can be materialized but not yet extracted (normal), or extraction can fail while materialization succeeded.

**Test:** `test/services/knowledge/extraction-tracker.test.ts`
- Insert event, mark extracted, query → not returned as unextracted
- Insert event, mark failed, query → returned (retry)
- Mark failed 3 times → not returned (max retries)

---

### KE-5: Turn Parser

**Goal:** Parse raw `CaptureEvent.content.detail` into structured `Turn[]` arrays for different AI tool conversation formats.

**Day estimate:** ~4 hours. One module (~100 lines) + tests for each format.

**Depends on:** KE-1 (ConversationSegmentSchema for Turn type reference)

---

**KE-5.1: Turn Parser**

**New file:** `src/services/knowledge/turn-parser.ts`

Parses `CaptureEvent.content.detail` into `Turn[]` for AI conversation events:

```typescript
export interface Turn {
  index: number;
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
  filesReferenced?: string[];
  filesModified?: string[];
  toolUse?: boolean;
}

export function parseConversationTurns(event: CaptureEvent): Turn[]
```

Different AI tools store conversations differently in `content.detail`:
- Claude sessions: markdown with `### Human` / `### Assistant` headers
- Cursor: JSON with role/content arrays
- Codex: similar to Claude format
- Generic: attempt both formats, fallback to single-turn

For non-conversation events (git commits, terminal):
- `content.summary` becomes a single "user" turn
- `content.detail` (if present) becomes the detail

**Test file:** `test/services/knowledge/turn-parser.test.ts`
- Parse Claude-format conversation → correct turns with roles
- Parse JSON-format conversation → correct turns
- Git commit event → single turn with summary
- Empty detail → single turn from summary

---

### KE-6: Topic Segmentation + Storage

**Goal:** Split multi-topic conversations into coherent segments and persist them to both databases.

**Day estimate:** ~6 hours. Segmenter logic + storage across DuckDB/SQLite + tests.

**Depends on:** KE-1 (ConversationSegmentSchema), KE-3 (DuckDB segments column), KE-5 (Turn parser)

---

**KE-6.1: Structural Segmenter**

**New file:** `src/services/knowledge/segmenter.ts`

Implements the 4-signal structural segmentation from §3:

```typescript
export function segmentConversation(turns: Turn[]): ConversationSegment[]
```

Signal implementation:
1. **File-path discontinuity** — compare `filesReferenced`/`filesModified` across adjacent turns. Boundary when modules differ (no common parent within 2 directory levels).
2. **Explicit discourse markers** — regex scan user turns for: `"now let's"`, `"next"`, `"moving on to"`, `"separately"`, `"switching to"`, `"different topic"`, `"also need to"`, `"back to the"` (case-insensitive).
3. **Tool-use cluster gaps** — if gap between consecutive tool-use turns > 3 pure-text turns AND file targets shift.
4. **Temporal gaps** — timestamp gap > 5 minutes between adjacent turns.

Merge segments with < 3 turns into adjacent segment.

For events with no turns (git commits, terminal sessions): return single segment covering the entire event.

**Test file:** `test/services/knowledge/segmenter.test.ts`
- Conversation with clear topic switch → 2 segments
- Short conversation (3 turns) → 1 segment
- Conversation with explicit "now let's work on X" → boundary at that turn
- Temporal gap > 5min → boundary
- Git commit event → single segment
- Segments < 3 turns merged into neighbors

---

**KE-6.2: Segment Storage**

**Modify:** `src/services/cache/schema.ts` (SQLite) — add new table DDL:
```sql
CREATE TABLE IF NOT EXISTS event_segments (
  event_id TEXT NOT NULL,
  segment_index INTEGER NOT NULL,
  turn_start INTEGER NOT NULL,
  turn_end INTEGER NOT NULL,
  topic_label TEXT,
  files_in_scope TEXT,  -- JSON array
  segment_method TEXT,
  PRIMARY KEY (event_id, segment_index)
)
```

**New file:** `src/services/knowledge/segment-storage.ts` — helper to write segments to DuckDB JSON column + SQLite table:
- `storeSegments(eventId: string, segments: ConversationSegment[], analytics: DbLike, operational: DbLike): Promise<void>`

**Test:** Segment written to DuckDB JSON column + SQLite table, queryable by event_id.

---

### KE-7: Extraction Prompt Design

**Goal:** Design and implement the combined LLM extraction prompt — the single most important file in Layer 2.5. Quality of everything downstream depends on prompt quality.

**Day estimate:** ~6 hours. Prompt engineering is iterative — budget time for refinement.

**Depends on:** KE-1 (schemas for output format), KE-5 (Turn type), KE-6 (ConversationSegment type)

---

**KE-7.1: Combined Extraction Prompt**

**New file:** `src/services/knowledge/prompts.ts`

```typescript
export function buildExtractionPrompt(
  turns: Turn[],
  segments: ConversationSegment[],
  eventType: string,
  eventSource: string,
  existingEntities?: string[]  // for entity resolution hints
): string

export function buildContradictionClassificationPrompt(
  existingFact: AtomicFact,
  newFact: AtomicFact
): string

export const EXTRACTION_SYSTEM_PROMPT: string  // system message for extraction
export const EXTRACTION_PROMPT_VERSION = 1;     // stored in results for migration
```

The extraction prompt asks for structured JSON output with:
- `entities[]` — per segment: name, type, context, confidence, aliases
- `facts[]` — per segment: subject, predicate, object, confidence, explicit, temporalHint
- `comprehension` — 5 dimension scores (0-10), overall (0-100), evidence[], rubberStampCount, pushbackCount, domainTags
- `metacognitiveSignals[]` — turnIndex, signalType, quote, strength
- `agencyClassification` — per segment: "developer-directed" | "developer-accepted" | "developer-rubber-stamped" | "collaborative"
- `sustainabilitySignal` — "builds-capability" | "erodes-capability" | "neutral", with reasoning
- `reasoningChains[]` — tradeOffs considered, decision rationale

For non-conversation events (git commits): shorter prompt variant that omits comprehension/metacognition sections.

**Test file:** `test/services/knowledge/prompts.test.ts`
- Prompt for AI conversation includes all extraction dimensions
- Prompt for git commit omits comprehension/metacognition sections
- Prompt includes segment boundaries when multiple segments
- Prompt includes existing entity names for resolution hints

---

### KE-8: LLM Extraction Caller + Heuristic Fallback

**Goal:** Implement the Vercel AI SDK caller that sends prompts and parses responses, plus the no-LLM fallback that computes proxy scores.

**Day estimate:** ~5 hours. LLM caller with retry + JSON parsing + heuristic module + tests.

**Depends on:** KE-1 (ExtractionResultSchema for parsing), KE-7 (prompts)

---

**KE-8.1: LLM Extraction Caller**

**New file:** `src/services/knowledge/llm-extractor.ts`

```typescript
import type { LanguageModel } from "ai";
import { generateText } from "ai";

export interface ExtractionConfig {
  model: LanguageModel;
  provider: string;
  modelName: string;
  concurrency: number;      // default 5
  timeoutMs: number;        // default 30_000
}

export async function extractFromEvent(
  event: CaptureEvent,
  turns: Turn[],
  segments: ConversationSegment[],
  config: ExtractionConfig,
  existingEntities?: string[]
): Promise<ExtractionResult>

export async function extractBatch(
  events: Array<{ event: CaptureEvent; turns: Turn[]; segments: ConversationSegment[] }>,
  config: ExtractionConfig,
  existingEntities?: string[]
): Promise<Map<string, ExtractionResult>>
```

Implementation:
- Uses Vercel AI SDK `generateText()` with structured output (JSON mode or tool calling depending on provider)
- Parses response with `ExtractionResultSchema.safeParse()` — Zod validates the LLM output
- On parse failure: log warning, retry once with explicit "respond in valid JSON" suffix
- On timeout: throw (caller handles retry via extraction tracker)
- `extractBatch`: process events with `p-limit` at `config.concurrency` parallelism

**Integration with existing LLM system:** Uses `createLLMProvider(config)` from `src/services/distill/providers/ai.ts` to get the `LanguageModel`. Same config, same providers, same API keys.

**Test file:** `test/services/knowledge/llm-extractor.test.ts`
- Mock LLM returns valid extraction → parsed successfully
- Mock LLM returns malformed JSON → retry, then fail gracefully
- Mock LLM timeout → throws with appropriate error
- Batch of 3 events with concurrency 2 → processes correctly

---

**KE-8.2: Heuristic Fallback Extractor**

**New file:** `src/services/knowledge/heuristic-extractor.ts`

When no LLM is configured, compute proxy scores from Layer 1 signals (§6 heuristic fallback):

```typescript
export function extractHeuristicComprehension(event: CaptureEvent): ComprehensionAssessment | null
```

- Only produces `ComprehensionAssessment` with `assessmentMethod: "heuristic-proxy"` — no entities, no facts, no metacognition
- Proxy formulas from §6: steering = HDS, understanding = modification_after_accept check, etc.
- Returns null for non-conversation events (no comprehension to assess)

**Why this exists:** When LLM is not configured, events are marked "deferred" for knowledge extraction. But the heuristic comprehension proxy is still useful for Layer 3 analyzers that already consume HDS. This is NOT a replacement for LLM extraction — it's the honest fallback that keeps basic metrics working.

**Test:** Heuristic extraction from event with known HDS → expected proxy scores. assessmentMethod always "heuristic-proxy".

---

### KE-9: Entity Normalizer + Writer

**Goal:** Build name normalization utilities and the CozoDB entity writer. These are building blocks for the entity resolver (KE-10).

**Day estimate:** ~4 hours. Two focused modules (~140 lines total) + tests.

**Depends on:** KE-1 (ExtractedEntitySchema), KE-2 (CozoDB entity + entity_alias relations)

---

**KE-9.1: Entity Normalizer**

**New file:** `src/services/knowledge/entity-normalizer.ts`

```typescript
export function normalizeEntityName(name: string): string
export function isAlias(name1: string, name2: string): boolean
export function computeLevenshteinDistance(a: string, b: string): number
```

- `normalizeEntityName`: lowercase, strip version numbers (e.g., "React 18" → "react"), trim whitespace, collapse spaces
- `isAlias`: check alias patterns (e.g., "hooks" is alias for "react hooks", "JWT" is alias for "JSON Web Token")
- Levenshtein for fuzzy matching (distance ≤ 2 = candidate match)

**Test:** "React Hooks" and "react hooks" normalize to same. "JWT" and "JSON Web Token" detected as potential aliases. Levenshtein("redis", "Redis") = 0 after normalization.

---

**KE-9.2: Entity Graph Writer**

**New file:** `src/services/knowledge/entity-writer.ts`

```typescript
export async function writeEntitiesToGraph(
  entities: ResolvedEntity[],
  extracted: ExtractedEntity[],
  episodeId: string,
  projectId: string,
  cozo: CozoDb
): Promise<{ created: number; updated: number }>
```

- New entities: `:put entity { id, name, normalized_name, type, lifecycle: 'emerging', confidence, first_seen, last_seen, mention_count: 1 }`
- Existing entities: update `last_seen`, increment `mention_count`, update `confidence` (max of existing and new)
- Write aliases to `entity_alias` relation
- All writes use `escCozo()` for injection prevention (from existing `substrate-engine.ts` pattern)

**Test:** Create 2 new entities + update 1 existing → verify CozoDB state via query.

---

### KE-10: Three-Pass Entity Resolver

**Goal:** Implement the 3-pass entity deduplication algorithm: exact match, alias lookup, embedding similarity.

**Day estimate:** ~5 hours. Complex logic with 3 passes + edge cases + tests.

**Depends on:** KE-9 (normalizer, entity writer), KE-2 (CozoDB entity_alias relation)

---

**KE-10.1: Three-Pass Entity Resolver**

**New file:** `src/services/knowledge/entity-resolver.ts` (knowledge-specific, NOT the substrate one)

```typescript
export interface ResolvedEntity {
  id: string;              // existing entity ID or new UUID
  isNew: boolean;
  matchMethod: 'exact' | 'alias' | 'embedding' | 'new';
  mergedAliases?: string[];
}

export async function resolveEntities(
  extracted: ExtractedEntity[],
  cozo: CozoDb,
  embedFn?: (text: string) => Promise<number[]>
): Promise<ResolvedEntity[]>
```

Pass 1: Exact normalized name match against CozoDB entities.
Pass 2: Alias table lookup (`entity_alias` relation in CozoDB).
Pass 3: Embedding similarity search (HNSW, top-5, threshold > 0.85). If match found, confirm with LLM ("Are 'auth module' and 'authentication service' the same entity?"). This pass is optional — skipped if no embedding function provided.

New entities get UUIDs and are inserted into CozoDB. Existing entities get `last_seen` and `mention_count` updated.

**Test file:** `test/services/knowledge/entity-resolver.test.ts`
- Known entity "Redis" → exact match, no new entity
- Unknown entity "Drizzle ORM" → new entity created
- "react hooks" when "React Hooks" exists → exact match after normalization
- "auth module" when "authentication" exists + embedding similarity > 0.85 → candidate match

---

### KE-11: Fact Graph Writer + Supersession

**Goal:** Write extracted facts to CozoDB and facts.jsonl. Handle explicit supersession patterns where the LLM already marked temporal transitions.

**Day estimate:** ~4 hours. Fact writer + supersession regex + tests.

**Depends on:** KE-1 (AtomicFactSchema), KE-2 (CozoDB fact relation), KE-4 (facts.jsonl writer), KE-10 (resolved entity IDs for subject/object mapping)

---

**KE-11.1: Fact Graph Writer**

**New file:** `src/services/knowledge/fact-writer-graph.ts`

```typescript
export async function writeFactsToGraph(
  facts: AtomicFact[],
  entityMap: Map<string, string>,  // extracted name → resolved entity ID
  cozo: CozoDb
): Promise<{ created: number }>

export async function invalidateFact(
  factId: string,
  invalidAt: string,
  cozo: CozoDb
): Promise<void>
```

- Maps fact subject/object names to resolved entity IDs
- Writes fact relation + corresponding `edge` relation (for graph traversal compatibility with existing SubstrateEngine)
- Writes to facts.jsonl via `appendFacts()` from KE-4.1
- `invalidateFact()` sets `invalid_at` and `expired_at` — used by contradiction resolution

**Test:** Write 3 facts → verify CozoDB fact relation has 3 rows + edges created. Invalidate 1 → query "valid facts" returns 2.

---

**KE-11.2: Explicit Supersession Detection**

**Modify:** `src/services/knowledge/fact-writer-graph.ts`

Add regex-based supersession shortcuts from §8:
- `"switched from {X} to {Y}"`, `"replaced {X} with {Y}"`, `"migrated from {X} to {Y}"`, etc.
- When detected during fact extraction: auto-invalidate the old fact (no LLM classification needed)
- The LLM extraction prompt already marks these with `temporal_hint: "supersedes_previous"` — this just handles the resolution

**Test:** Fact with `temporal_hint: "supersedes_previous"` + subject match in existing graph → old fact invalidated immediately.

---

### KE-12: Contradiction Detection

**Goal:** Implement both stages of contradiction detection: Stage 1 immediate HNSW candidate retrieval and Stage 2 daily batch LLM classification.

**Day estimate:** ~6 hours. Two distinct algorithms in one file + tests.

**Depends on:** KE-1 (ContradictionResultSchema), KE-2 (fact_embedding HNSW index), KE-7 (contradiction classification prompt), KE-11 (fact writer for invalidation)

---

**KE-12.1: Stage 1 — Contradiction Candidate Retrieval**

**New file:** `src/services/knowledge/contradiction-detector.ts`

```typescript
export interface ContradictionCandidate {
  existingFactId: string;
  existingFactText: string;
  similarity: number;
}

export async function findContradictionCandidates(
  newFact: AtomicFact,
  cozo: CozoDb
): Promise<ContradictionCandidate[]>
```

- HNSW vector search on `fact_embedding` relation: same subject, still valid (`invalid_at` is null), related predicate category
- Returns top-10 candidates with similarity > 0.7
- No LLM call — pure embedding search, <10ms
- Candidates stored in a `contradiction_candidates` DuckDB table for daily batch processing

**Requires:** Embedding for the new fact (from KE-16). If embedding infrastructure not yet available, skip Stage 1 and queue all facts for Stage 2 brute-force scan during daily batch.

**Test:** Fact "project USES Redis for caching" + existing fact "project USES Memcached for caching" with similar embeddings → candidate found.

---

**KE-12.2: Stage 2 — Daily Batch Contradiction Classification**

**Modify:** `src/services/knowledge/contradiction-detector.ts`

```typescript
export async function classifyContradictionBatch(
  candidates: ContradictionCandidate[],
  newFacts: AtomicFact[],
  config: ExtractionConfig,
  cozo: CozoDb
): Promise<ContradictionResult[]>
```

- Batch all candidates from the day
- LLM classifies each pair: CONSISTENT | MORE_SPECIFIC | CONTRADICTORY | SUPERSEDES | UNRELATED
- For CONTRADICTORY/SUPERSEDES: call `invalidateFact()` on the old fact
- Uses `buildContradictionClassificationPrompt()` from KE-7
- Results logged for audit trail

**Integration point:** Called from `distill()` pipeline (after event processing, before narrative synthesis).

**Test:** 2 contradictory facts → old fact invalidated. 2 consistent facts → no change. SUPERSEDES → old fact gets `invalid_at` set to new fact's `valid_at`.

---

### KE-13: Comprehension + Metacognitive Writers

**Goal:** Write LLM-assessed comprehension scores and metacognitive signals to CozoDB and DuckDB.

**Day estimate:** ~4 hours. One module with two export functions + tests.

**Depends on:** KE-1 (ComprehensionAssessmentSchema, MetacognitiveSignalSchema), KE-2 (CozoDB relations), KE-3 (DuckDB tables)

---

**KE-13.1: Comprehension Writer**

**New file:** `src/services/knowledge/comprehension-writer.ts`

```typescript
export async function writeComprehensionAssessment(
  assessment: ComprehensionAssessment,
  cozo: CozoDb,
  analytics: DbLike
): Promise<void>
```

- Write to CozoDB `comprehension_assessment` relation
- Write to DuckDB `comprehension_proxy` table (replacing the existing heuristic proxy with real LLM-assessed values — maintains backward compatibility with Layer 3 analyzers that read `comprehension_proxy`)
- Update `domain_comprehension` table: for each domain in `assessment.domainTags`, update or create row with new `base_score`, `stability` update (§9 reinforcement), `last_touch`

**Test:** Assessment written → queryable from both CozoDB and DuckDB. Domain comprehension state updated.

---

**KE-13.2: Metacognitive Signal Writer**

**Modify:** `src/services/knowledge/comprehension-writer.ts`

```typescript
export async function writeMetacognitiveSignals(
  episodeId: string,
  signals: MetacognitiveSignal[],
  cozo: CozoDb,
  analytics: DbLike
): Promise<void>
```

- Write to CozoDB `metacognitive_signal` relation
- Compute aggregates: `metacognitiveDensity = signalCount / totalUserTurns`, `metacognitiveBreadth = uniqueSignalTypes / 7`
- Write aggregates to DuckDB (new columns on a knowledge extraction results table or existing intelligence output)

**Test:** 5 signals across 20 turns → density = 0.25, breadth = 5/7.

---

### KE-14: Comprehension Score Aggregator

**Goal:** Compute daily weighted comprehension scores across all domains with trend detection.

**Day estimate:** ~4 hours. Aggregation logic + Mann-Kendall trend + tests.

**Depends on:** KE-3 (DuckDB comprehension_scores table), KE-13 (domain_comprehension rows populated)

---

**KE-14.1: Daily Comprehension Score Aggregator**

**New file:** `src/services/knowledge/comprehension-aggregator.ts`

```typescript
export async function computeDailyComprehensionScore(
  date: string,
  projectId: string,
  analytics: DbLike
): Promise<{ score: number; trend: string; domainCount: number; topDomain: string; weakDomain: string }>
```

Implements §10:
- Query `domain_comprehension` for all domains in project
- Apply FSRS decay to get `current_score` per domain
- Compute weighted average: `domainWeight = recencyWeight × significanceWeight`
- Mann-Kendall trend detection on last 7 daily scores
- Write result to `comprehension_scores` table
- Write to `intelligence/comprehension.json` for dashboard

**Test:** 3 domains with known scores + stability → expected weighted average. Trend detection: 7 increasing scores → "improving".

---

### KE-15: FSRS Decay Engine

**Goal:** Daily arithmetic computation of comprehension decay across all domains. Pure DuckDB queries — no LLM calls.

**Day estimate:** ~5 hours. Three related computations (decay, stability, complexity) + tests.

**Depends on:** KE-3 (DuckDB domain_comprehension table), KE-13 (comprehension state populated)

---

**KE-15.1: FSRS Decay Computation**

**New file:** `src/services/knowledge/decay-engine.ts`

```typescript
export async function computeDecay(
  analytics: DbLike,
  projectId?: string  // null = all projects
): Promise<{ domainsUpdated: number; domainsDecayed: number; domainsPruned: number }>
```

Implements §9:
- Query `domain_comprehension` table
- For each domain: compute `retrievability = (1 + t / (9 × stability × complexity_modifier))^(-1)`
- Apply floor values: `max(computed, floor_value)`
- Update `current_score` column
- Prune domains where `current_score < 5.0` (near-zero, no longer meaningful)

All in DuckDB SQL — no external calls.

**Test file:** `test/services/knowledge/decay-engine.test.ts`
- Domain with stability=7, last_touch=7 days ago → retrievability ≈ 0.90
- Domain with stability=7, last_touch=30 days ago → retrievability ≈ 0.68
- Domain with stability=3, last_touch=30 days ago → retrievability ≈ 0.47
- Authored code floor=15 → score never drops below 15
- Domain with current_score < 5 → pruned

---

**KE-15.2: Stability Update on Re-engagement**

**Modify:** `src/services/knowledge/comprehension-writer.ts` (KE-13.1)

When writing a comprehension assessment, detect if the assessed domains already have `domain_comprehension` rows (re-engagement). If so:
- Compute `engagement_quality` (1-5) from the assessment dimensions
- Update stability: `new_stability = stability × (1 + 0.4 × log2(engagement_quality + 1))`
- Update `base_score` with small upward nudge: `min(100, previous × (1 + 0.02 × engagement_quality))`
- Reset `last_touch` to today

**Test:** Domain with existing stability=7, re-engaged with quality=5 → new stability ≈ 13.5.

---

**KE-15.3: Domain Complexity Inference**

**New file:** `src/services/knowledge/domain-complexity.ts`

```typescript
export async function inferDomainComplexity(
  domain: string,
  projectId: string,
  analytics: DbLike,
  cozo: CozoDb
): Promise<number>  // complexity modifier: 0.5 (complex) to 1.5 (simple)
```

Heuristic inference from §9:
- File count in the domain's modules (from entity relationships)
- Cross-module dependency count (from fact graph)
- Average turn count of conversations about this domain (from DuckDB)
- Decision density (facts with decision predicates / total facts for this domain)

Returns modifier: 0.5 (distributed system, many deps) → 1.0 (standard) → 1.5 (simple utility).

**Test:** Domain with 50 files, 10 cross-deps → modifier ≈ 0.5. Domain with 3 files, 0 cross-deps → modifier ≈ 1.5.

---

### KE-16: Embedding Infrastructure

**Goal:** Load all-MiniLM-L6-v2 via ONNX Runtime for local embedding generation. Wire into entity resolver and contradiction detector.

**Day estimate:** ~6 hours. Model loading + tokenization + integration across 3 existing modules + tests.

**Depends on:** KE-10 (entity resolver needs embedFn), KE-12 (contradiction detector needs embeddings)

---

**KE-16.1: ONNX Embedding Runtime**

**New file:** `src/services/knowledge/embedding.ts`

```typescript
export interface EmbeddingModel {
  embed(text: string): Promise<number[]>;       // 384d vector
  embedBatch(texts: string[]): Promise<number[][]>;
  isLoaded(): boolean;
  unload(): void;
}

export async function loadEmbeddingModel(): Promise<EmbeddingModel>
```

- Uses `@xenova/transformers` (Transformers.js) or `onnxruntime-node` to load `all-MiniLM-L6-v2`
- Model cached at `~/.unfade/models/all-MiniLM-L6-v2/` (download on first use)
- Lazy-loaded: not loaded until first `embed()` call
- Memory check: if `os.freemem() < 1GB`, don't load, log warning, return null
- Singleton pattern: one model instance for the process lifetime

**Test file:** `test/services/knowledge/embedding.test.ts`
- Load model → embed "Redis" → returns 384d vector
- Embed two similar texts → cosine similarity > 0.8
- Embed two unrelated texts → cosine similarity < 0.5
- `embedBatch` of 10 items → 10 vectors returned

---

**KE-16.2: Embedding Integration Points**

**Modify:** `src/services/knowledge/entity-resolver.ts` (KE-10)
- Pass `embedFn` from loaded embedding model for Pass 3 resolution

**Modify:** `src/services/knowledge/contradiction-detector.ts` (KE-12)
- Embed new facts before HNSW search
- Write embeddings to `fact_embedding` CozoDB relation

**Modify:** `src/services/knowledge/segmenter.ts` (KE-6)
- Add optional embedding validation pass: when structural segmentation produces 1 segment for >20 turns, use embeddings to find missed boundaries (§3 Tier 2)

**Test:** End-to-end: extract entity → embed → resolve against existing entity with similar embedding → match found.

---

### KE-17: Knowledge Extraction Orchestrator

**Goal:** Build the main orchestrator that ties all extraction modules into a single `extractKnowledge()` function, plus the public API barrel export.

**Day estimate:** ~5 hours. Orchestrator (~200 lines) + public API + tests.

**Depends on:** KE-4 through KE-16 (all extraction modules)

---

**KE-17.1: Knowledge Extraction Orchestrator**

**New file:** `src/services/knowledge/extractor.ts`

```typescript
export interface KnowledgeExtractionConfig {
  llmConfig: ExtractionConfig | null;  // null = no LLM configured
  embeddingModel: EmbeddingModel | null;
  cozo: CozoDb;
  analytics: DbLike;
  operational: DbLike;
}

export async function extractKnowledge(
  events: CaptureEvent[],
  config: KnowledgeExtractionConfig
): Promise<{
  entitiesCreated: number;
  factsExtracted: number;
  assessmentsWritten: number;
  signalsDetected: number;
  eventsProcessed: number;
  eventsDeferred: number;
}>
```

Pipeline per event:
1. `parseConversationTurns(event)` → turns
2. `segmentConversation(turns)` → segments
3. If LLM configured: `extractFromEvent(event, turns, segments, config)` → extraction result
   - If no LLM: `markDeferred(event.id)`, optionally `extractHeuristicComprehension(event)`
4. `resolveEntities(extraction.entities, cozo, embedFn)` → resolved entities
5. `writeEntitiesToGraph(resolved, extraction.entities, event.id, event.projectId, cozo)`
6. `writeFactsToGraph(extraction.facts, entityMap, cozo)` + `appendFacts(extraction.facts)`
7. `findContradictionCandidates(fact, cozo)` → store candidates for daily batch
8. `writeComprehensionAssessment(extraction.comprehension, cozo, analytics)`
9. `writeMetacognitiveSignals(event.id, extraction.metacognitiveSignals, cozo, analytics)`
10. `markExtracted(analytics, event.id)`

Batch processing: events processed with `p-limit` at `llmConfig.concurrency` parallelism.

**Test file:** `test/services/knowledge/extractor.test.ts`
- Full pipeline with mock LLM → all outputs written correctly
- No LLM configured → events marked deferred, heuristic proxy computed
- LLM failure on 1 event → that event marked failed, others succeed

---

**KE-17.2: Public API**

**New file:** `src/services/knowledge/index.ts`

```typescript
export { extractKnowledge } from "./extractor.js";
export { computeDecay } from "./decay-engine.js";
export { computeDailyComprehensionScore } from "./comprehension-aggregator.js";
export { classifyContradictionBatch } from "./contradiction-detector.js";
export { loadEmbeddingModel } from "./embedding.js";
export type { KnowledgeExtractionConfig } from "./extractor.js";
export type { EmbeddingModel } from "./embedding.js";
```

---

### KE-18: Materializer + Server Hook

**Goal:** Wire knowledge extraction into the materializer tick loop and server startup. This is the integration point where extraction starts running automatically.

**Day estimate:** ~4 hours. Modifying 2 existing files + tests.

**Depends on:** KE-17 (orchestrator)

---

**KE-18.1: Materializer Hook**

**Modify:** `src/services/cache/materializer-daemon.ts`

Add knowledge extraction to the tick pipeline:

```typescript
// In MaterializerDaemon, after materializeIncremental() succeeds:
if (newRows > 0 && this.knowledgeConfig) {
  const unextracted = await getUnextractedEvents(this.cache.analytics, 50);
  if (unextracted.length > 0) {
    await extractKnowledge(unextracted, this.knowledgeConfig);
  }
}
```

**Key design decision:** Extraction runs AFTER materialization, BEFORE intelligence analyzers. This means Layer 3 analyzers see extraction results on the NEXT tick (not the same tick). This is acceptable — intelligence is always 1 tick behind capture, and extraction results become available for the next analyzer run.

**Test:** Mock materializer tick with 3 new events → extraction runs for all 3. Zero new events → extraction skipped.

---

**KE-18.2: Server Startup Integration**

**Modify:** `src/server/unfade-server.ts`
- Initialize `KnowledgeExtractionConfig` during server startup (after LLM provider check)
- Pass config to `MaterializerDaemon` constructor
- Load embedding model lazily on first extraction

**Test:** Server starts with LLM configured → `KnowledgeExtractionConfig` initialized. Server starts without LLM → config has null llmConfig (deferred mode).

---

### Implementation Tracker

| Sprint | Task | Status | Files |
|--------|------|--------|-------|
| **KE-1** | KE-1.1: Zod schemas | ✅ Complete | `src/schemas/knowledge.ts` |
| **KE-2** | KE-2.1: CozoDB schema v3 rewrite | ✅ Complete | `src/services/substrate/schema.ts` |
| **KE-2** | KE-2.2: CozoDB manager rewrite (no migration) | ✅ Complete | `src/services/substrate/cozo-manager.ts` |
| **KE-2** | KE-2.3: Schema v3 tests | ✅ Complete | `test/services/substrate/schema-v3.test.ts` |
| **KE-3** | KE-3.1: DuckDB knowledge tables | ✅ Complete | `src/services/cache/duckdb-schema.ts` |
| **KE-3** | KE-3.2: DuckDB manager + caller integration | ✅ Complete | `src/services/cache/manager.ts`, `src/services/workers/sqlite-worker.ts`, `src/services/workers/pool.ts`, `src/services/daemon/repo-manager.ts`, `src/services/intelligence/comprehension.ts`, `src/services/intelligence/cross-analyzer.ts`, `src/services/intelligence/summary-writer.ts`, `src/services/intelligence/analyzers/efficiency.ts`, `src/services/intelligence/analyzers/blind-spots.ts`, `src/services/intelligence/analyzers/comprehension-radar.ts`, `src/tools/unfade-comprehension.ts` |
| **KE-3** | KE-3.3: DuckDB knowledge schema tests | ✅ Complete | `test/services/cache/duckdb-knowledge-schema.test.ts`, `test/services/intelligence/comprehension.smoke.test.ts` |
| **KE-4** | KE-4.1: facts.jsonl writer | ✅ Complete | `src/services/knowledge/fact-writer.ts`, `test/services/knowledge/fact-writer.test.ts` |
| **KE-4** | KE-4.2: Extraction status tracker | ✅ Complete | `src/services/knowledge/extraction-tracker.ts`, `test/services/knowledge/extraction-tracker.test.ts` |
| **KE-5** | KE-5.1: Turn parser | ✅ Complete | `src/services/knowledge/turn-parser.ts`, `test/services/knowledge/turn-parser.test.ts` |
| **KE-6** | KE-6.1: Structural segmenter | ✅ Complete | `src/services/knowledge/segmenter.ts` (~230 lines), `test/services/knowledge/segmenter.test.ts` |
| **KE-6** | KE-6.2: Segment storage | ✅ Complete | `src/services/knowledge/segment-storage.ts` (~130 lines), `src/services/cache/duckdb-schema.ts`, `src/services/cache/manager.ts`, `test/services/knowledge/segment-storage.test.ts` |
| **KE-7** | KE-7.1: Combined extraction prompt | ✅ Complete | `src/services/knowledge/prompts.ts` (~280 lines), `test/services/knowledge/prompts.test.ts` (20 tests) |
| **KE-8** | KE-8.1: LLM extraction caller | ✅ Complete | `src/services/knowledge/llm-extractor.ts` (~290 lines), `src/schemas/knowledge.ts` (computeOverallScore), `test/services/knowledge/llm-extractor.test.ts` (14 tests) |
| **KE-8** | KE-8.2: Heuristic fallback extractor | ✅ Complete | `src/services/knowledge/heuristic-extractor.ts` (~230 lines), `test/services/knowledge/heuristic-extractor.test.ts` (20 tests) |
| **KE-9** | KE-9.1: Entity normalizer | ✅ Complete | `src/services/knowledge/entity-normalizer.ts` (~150 lines), `test/services/knowledge/entity-normalizer.test.ts` (23 tests) |
| **KE-9** | KE-9.2: Entity graph writer | ✅ Complete | `src/services/knowledge/entity-writer.ts` (~280 lines), `src/schemas/knowledge.ts` (computeOverallScore), `test/services/knowledge/entity-writer.test.ts` (8 tests, CozoDB integration) |
| **KE-10** | KE-10.1: Three-pass entity resolver | ✅ Complete | `src/services/knowledge/entity-resolver.ts` (~220 lines), `test/services/knowledge/entity-resolver.test.ts` (19 tests, CozoDB integration) |
| **KE-11** | KE-11.1: Fact graph writer | ✅ Complete | `src/services/knowledge/fact-writer-graph.ts` (~310 lines), `test/services/knowledge/fact-writer-graph.test.ts` (17 tests, CozoDB + JSONL integration) |
| **KE-11** | KE-11.2: Explicit supersession detection | ✅ Complete | `src/services/knowledge/fact-writer-graph.ts` (supersession patterns + handleSupersession) |
| **KE-12** | KE-12.1: Contradiction candidate retrieval | ✅ Complete | `src/services/knowledge/contradiction-detector.ts` (~320 lines), `test/services/knowledge/contradiction-detector.test.ts` (12 tests, CozoDB + mocked LLM) |
| **KE-12** | KE-12.2: Daily batch contradiction classification | ✅ Complete | `src/services/knowledge/contradiction-detector.ts` (classifyContradictionBatch + detectContradictions) |
| **KE-13** | KE-13.1: Comprehension writer | ✅ Complete | `src/services/knowledge/comprehension-writer.ts` (~260 lines), `test/services/knowledge/comprehension-writer.test.ts` (12 tests, CozoDB + mock DuckDB) |
| **KE-13** | KE-13.2: Metacognitive signal writer | ✅ Complete | `src/services/knowledge/comprehension-writer.ts` (writeMetacognitiveSignals + density/breadth aggregates) |
| **KE-14** | KE-14.1: Daily comprehension score aggregator | ✅ Complete | `src/services/knowledge/comprehension-aggregator.ts` (~280 lines), `test/services/knowledge/comprehension-aggregator.test.ts` (22 tests, FSRS + Mann-Kendall + mock DuckDB) |
| **KE-15** | KE-15.1: FSRS decay computation | ✅ Complete | `src/services/knowledge/decay-engine.ts` (~180 lines), `test/services/knowledge/decay-engine.test.ts` (21 tests) |
| **KE-15** | KE-15.2: Stability update on re-engagement | ✅ Complete | `src/services/knowledge/comprehension-writer.ts` (updated), `src/services/knowledge/decay-engine.ts` (computeStabilityUpdate) |
| **KE-15** | KE-15.3: Domain complexity inference | ✅ Complete | `src/services/knowledge/domain-complexity.ts` (~180 lines), `test/services/knowledge/domain-complexity.test.ts` (6 tests) |
| **KE-16** | KE-16.1: ONNX embedding runtime | ✅ Complete | `src/services/knowledge/embedding.ts` (~200 lines), `test/services/knowledge/embedding.test.ts` (16 tests), `@huggingface/transformers` optional dep |
| **KE-16** | KE-16.2: Embedding integration points | ✅ Complete | `src/services/knowledge/embedding.ts` (createEntityEmbedFn 384→64d, createFactEmbedFn 384d, cosineSimilarity) |
| **KE-17** | KE-17.1: Knowledge extraction orchestrator | ✅ Complete | `src/services/knowledge/extractor.ts` (~230 lines), `test/services/knowledge/extractor.test.ts` (10 tests, CozoDB + mocked LLM) |
| **KE-17** | KE-17.2: Public API | ✅ Complete | `src/services/knowledge/index.ts` (~50 lines, barrel export of all 18 knowledge modules) |
| **KE-18** | KE-18.1: Materializer hook | ✅ Complete | `src/services/cache/materializer-daemon.ts` (KnowledgeExtractionHook + tick integration), `src/services/knowledge/extractor.ts` (loadCaptureEventsForExtraction) |
| **KE-18** | KE-18.2: Server startup integration | ✅ Complete | `src/services/daemon/repo-manager.ts` (createKnowledgeExtractionHook — lazy CozoDB+LLM+embedding init) |

### Sprint Calendar (Suggested)

| Week | Mon | Tue | Wed | Thu | Fri |
|------|-----|-----|-----|-----|-----|
| **W1** | KE-1: Zod Schemas | KE-2: CozoDB v3 | KE-3: DuckDB Extensions | KE-4: Storage Utils | KE-5: Turn Parser |
| **W2** | KE-6: Segmentation | KE-7: Extraction Prompt | KE-8: LLM Caller | KE-9: Entity Norm+Writer | KE-10: Entity Resolver |
| **W3** | KE-11: Fact Writer | KE-12: Contradiction | KE-13: Comprehension | KE-14: Score Aggregator | KE-15: FSRS Decay |
| **W4** | KE-16: Embeddings | KE-17: Orchestrator | KE-18: Materializer Hook | — | — |

**Total: 18 working days (~3.6 weeks)**

Note: Sprints KE-2/KE-3, KE-5/KE-9/KE-11/KE-13/KE-15 can overlap if multiple contributors are available, reducing calendar time. Distill/MCP integration, E2E tests, and hardening are deferred to post-KGI (Knowledge-Grounded Intelligence) sprints — see `LAYER_3_INTELLIGENCE_EXTRACTOR.md §17`.

### File Manifest (All New Files)

| File | Sprint | Lines (est.) | Purpose |
|------|--------|-------------|---------|
| `src/schemas/knowledge.ts` | KE-1 | ~150 | Zod schemas for all knowledge extraction types |
| `src/services/knowledge/fact-writer.ts` | KE-4 | 80 | Append-only facts.jsonl writer (append, batch, read, count) |
| `src/services/knowledge/extraction-tracker.ts` | KE-4 | 155 | DuckDB extraction watermark (get/mark/stats/reset) |
| `src/services/knowledge/turn-parser.ts` | KE-5 | 210 | CaptureEvent → Turn[] parser (metadata.turns, pipe-separated, single-turn synthesis) |
| `src/services/knowledge/segmenter.ts` | KE-6 | 230 | 4-signal structural topic segmentation (file-path, discourse markers, tool-cluster gaps, temporal gaps) |
| `src/services/knowledge/segment-storage.ts` | KE-6 | 130 | Segment → DuckDB (typed table + JSON column) + SQLite writer + loader |
| `src/services/knowledge/prompts.ts` | KE-7 | ~200 | LLM extraction + contradiction prompts |
| `src/services/knowledge/llm-extractor.ts` | KE-8 | ~150 | Vercel AI SDK extraction caller |
| `src/services/knowledge/heuristic-extractor.ts` | KE-8 | ~60 | No-LLM comprehension proxy |
| `src/services/knowledge/entity-normalizer.ts` | KE-9 | ~60 | Name normalization + fuzzy matching |
| `src/services/knowledge/entity-writer.ts` | KE-9 | ~80 | Entity → CozoDB writer |
| `src/services/knowledge/entity-resolver.ts` | KE-10 | ~150 | 3-pass entity deduplication |
| `src/services/knowledge/fact-writer-graph.ts` | KE-11 | ~100 | Fact → CozoDB + facts.jsonl writer |
| `src/services/knowledge/contradiction-detector.ts` | KE-12 | ~200 | HNSW candidate retrieval + daily LLM batch |
| `src/services/knowledge/comprehension-writer.ts` | KE-13 | ~120 | Assessment + metacognitive signal writer |
| `src/services/knowledge/comprehension-aggregator.ts` | KE-14 | ~100 | Daily score aggregation + trend |
| `src/services/knowledge/decay-engine.ts` | KE-15 | ~80 | FSRS daily decay computation |
| `src/services/knowledge/domain-complexity.ts` | KE-15 | ~60 | Heuristic complexity modifier |
| `src/services/knowledge/embedding.ts` | KE-16 | ~120 | ONNX all-MiniLM-L6-v2 runtime |
| `src/services/knowledge/extractor.ts` | KE-17 | ~200 | Main orchestrator |
| `src/services/knowledge/index.ts` | KE-17 | ~20 | Public API exports |

**Total new files:** 21
**Total estimated lines:** ~2,270
**Files modified:** 7 (schema.ts, cozo-manager.ts, duckdb-schema.ts, manager.ts, cache/schema.ts, materializer-daemon.ts, unfade-server.ts)

### Integration with Existing Systems

| System | Integration Sprint | How |
|--------|-------------------|-----|
| **Layer 2 Materializer** | KE-18 | `extractKnowledge()` called in `onTick` after materialization |
| **Layer 3 Intelligence DAG** | KE-2, KE-3, KE-9, KE-13 | Knowledge entities feed into CozoDB → existing analyzers query graph. Old `comprehension_proxy`/`comprehension_by_module` tables fully removed and replaced by `comprehension_assessment`/`domain_comprehension`. All 8+ analyzer callers updated (KE-3.2). |
| **Substrate Engine** | KE-2, KE-9, KE-11 | New CozoDB relations extend existing substrate. Entity/fact writes use same `escCozo()` injection prevention. |
| **Distill Pipeline** | Post-KGI | Contradiction batch + decay + comprehension score computed during daily distill. Deferred until intelligence pipeline is unified. |
| **MCP Server** | Post-KGI | `unfade-comprehension` tool exposes decay-aware scores. Deferred until KnowledgeReader interface is stable. |
| **Profile/Cards** | Future | Metacognitive density, entity engagement patterns, comprehension trajectory feed into reasoning_model.json and Thinking Card generation. |
| **Decision Records** | KE-11 | Facts with decision predicates (DECIDED, CHOSEN_OVER, REPLACED_BY) directly feed the existing decision graph in `~/.unfade/graph/decisions.jsonl`. |

### Quality & Reliability Principles

1. **No artificial limits.** Every captured event gets extracted. No daily budgets, no call caps, no event skipping. If the LLM provider rate-limits, queue and retry.
2. **No heuristic fake-outs.** If LLM isn't configured, Comprehension Score shows "–", not a fake number from regex.
3. **JSONL is truth.** `facts.jsonl` is the source of truth for facts. CozoDB is a derived cache, rebuildable via `unfade doctor --rebuild-graph`.
4. **Fail open, not closed.** Extraction failure for one event doesn't block others. CozoDB down → facts still written to JSONL. Embedding model fails to load → LLM extraction continues.
5. **Idempotent.** Re-extracting the same event produces the same result (or better, if the LLM model improved). Extraction status tracker prevents duplicate work.
6. **Observable.** Every extraction produces structured logs: event ID, extraction time, entity/fact counts, comprehension score. Dashboard shows extraction pipeline health.
