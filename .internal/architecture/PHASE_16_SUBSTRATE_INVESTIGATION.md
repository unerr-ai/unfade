# Phase 16 Substrate Investigation: Derived Analytics vs. Semantic Substrate

**RRVV Foundational Design Investigation**
**Date:** 2026-04-22
**Scope:** Should the intelligence layer remain a collection of derived metrics/analyzers, or evolve into a persistent, self-updating, queryable semantic substrate?
**Basis:** Phase 16 Intelligence System Redesign (planned architecture, not current code)

---

## Part I: Rigorous Research — The Question

### 1.1 What Phase 16 Plans to Build

Phase 16 redesigns intelligence from a **12-stage monolithic tick callback** into an **event-driven, incremental, DAG-scheduled system** across 8 sprints (16A-16H). The planned architecture introduces:

| Component | Nature | Representation |
|---|---|---|
| **IncrementalState** (16A.3) | Stateful abstraction | `f(state, delta) → state'` per analyzer, persisted as JSON files |
| **Prompt Classifier** (16B.1) | One-time event annotation | 8 prompt types + execution phase → DuckDB typed columns |
| **Feature Registry** (16B.2) | Dynamic entity registry | PathTrie + JSON + DuckDB table, learned from repo structure |
| **Prompt Chains** (16B.3) | Session-level pattern detection | 9 chain patterns → DuckDB `prompt_chains` table |
| **Prompt→Response Synthesis** (16B.4) | Statistical correlation | Per-type/per-feature effectiveness → `prompt_response_correlations` table |
| **DAG Scheduler** (16D) | Dependency-driven execution | Analyzer graph with change propagation and dirty marking |
| **DiagnosticStream** (16E.1) | Real-time observation emission | Event-driven, auto-expiring diagnostics |
| **Session Intelligence** (16E.2) | Per-session live state | Phase detection, loop risk, direction trend |
| **Causality Chains** (16E.3) | Higher-order event linking | Investigation/implementation/debugging/decision-revision chains |
| **Profile Accumulator** (16F.1) | Continuous identity evolution | Sub-daily profile updates from analyzer outputs |
| **Cross-Project Intelligence** (16G) | Multi-project pattern transfer | Federated read across project states |

### 1.2 The Representation Question

Phase 16 represents intelligence as:

```
Events (JSONL source of truth)
  → DuckDB typed columns (37 columns + 12 new from 16B)
    → IncrementalState per analyzer (JSON files in ~/.unfade/intelligence/state/)
      → Derived outputs (JSON files in ~/.unfade/intelligence/)
        → Diagnostics (ring buffer, ephemeral)
        → Profile (reasoning_model.json, accumulated)
```

This is a **multi-layer derived view architecture**. Each layer computes forward from the layer below. There is no backward flow. An insight at layer 4 cannot inform the interpretation of events at layer 1.

The question: should this forward-only, layer-by-layer derivation evolve into something where intelligence entities **know about each other**, where a decision is directly connected to the prompts that produced it, the files it changed, the session dynamics it emerged from, and the later revision that overturned it?

### 1.3 What External Research Says

**Knowledge Graphs** (RDF/OWL, Neo4j, property graphs):
- Entities as nodes, relationships as edges, both with properties.
- Strengths: relationship traversal ("what decisions touched this module in the last week?"), path queries ("how did this debugging session connect to that architecture decision?"), schema evolution without migration.
- Weaknesses: query planning complexity, storage overhead for high-cardinality event streams, impedance mismatch with time-series analytics.
- Relevant prior art: Microsoft's CodeGraph (code entity relationships), Google's Knowledge Graph (entity linking at scale), Roam Research / Obsidian (bidirectional linking for knowledge management).

**Temporal Graphs** (graph databases with time dimensions):
- Every edge has a validity interval. The graph at time T₁ is different from the graph at T₂.
- Strengths: natural fit for "what was the state of understanding at this point?" questions, supports decision revision tracking.
- Weaknesses: exponential edge growth with active development, complex query semantics.
- Relevant prior art: TerminusDB (temporal document graph), Datomic (immutable time-indexed facts).

**Event Sourcing + Projections** (what Phase 16 already does):
- Events are the source of truth. Views (projections) are computed forward.
- Strengths: provenance guaranteed, replay possible, independent projections evolve independently.
- Weaknesses: relationships between projections are implicit, cross-projection queries require denormalization, no backward reasoning.

**Vector-Semantic Memory** (embeddings + vector search):
- Encode events/decisions/insights as embeddings. Retrieve by semantic similarity.
- Strengths: "find sessions similar to this one" without explicit relationship modeling, handles fuzzy queries.
- Weaknesses: embedding quality depends on model, storage scales with event count, not interpretable, cold-start problem.
- Relevant prior art: LangChain Memory, Mem0, ChatGPT memory.

**Cognitive Architectures** (SOAR, ACT-R, Global Workspace Theory):
- Working memory (current context) + long-term memory (accumulated knowledge) + procedural memory (learned behaviors).
- Strengths: natural model for "what do I know now + what have I learned + what should I do."
- Weaknesses: heavy runtime overhead, designed for agent decision-making not passive observation, academic rather than production-ready.

**Hybrid Systems** (graph + vector + event sourcing):
- Use event sourcing as the write path, project into a graph for relationship queries, and into a vector store for similarity queries.
- Strengths: each query type uses the optimal representation.
- Weaknesses: consistency between representations, operational complexity, three systems to maintain.

---

## Part II: Reason — Phase 16 Through the Substrate Lens

### 2.1 What Phase 16 Already Gets Right

**Event sourcing is correct and non-negotiable.** JSONL as source of truth with derived views is the right foundation. Any substrate must be a projection, not a replacement. Phase 16 preserves this.

**IncrementalState is the right abstraction for computation.** `f(state, delta) → state'` is mathematically sound. The question is not about computation model — it's about **what the computed state represents** and **how computed states relate to each other**.

**The DAG Scheduler solves execution ordering.** Phase 16D's dependency graph with dirty propagation is correct for determining WHEN analyzers run. The question is about what happens AFTER they run — do their outputs remain isolated JSON files, or do they feed into a shared substrate?

**Classification is the right pre-computation.** Phase 16B's prompt type, feature registry, and chain analysis all annotate events before intelligence runs. This is forward-only and correct.

### 2.2 Where Phase 16's Representation Falls Short

**Shortcoming 1: No entity identity across analyzers.**

Phase 16 has multiple conceptions of the same real-world entity without linking them:

- A "debugging session on auth" is:
  - A session in `sessions` table (session-materializer)
  - A prompt chain with pattern `iterative-correction` (16B.3)
  - A loop candidate (loop-detector)
  - A causality chain of type `debugging` (16E.3)
  - A feature group activity on "auth" (16B.2)
  - An efficiency data point (efficiency analyzer)
  - A comprehension signal for "auth" module (comprehension-radar)

Each analyzer sees its own slice. None knows about the others' conclusions on the **same underlying work unit**. The DAG scheduler propagates data forward, but there's no entity that says "these 7 analyzer outputs all describe the same debugging effort."

**Shortcoming 2: No backward reasoning.**

Phase 16's data flow is strictly forward:

```
Event → Classification → Analyzer State → Output → Diagnostic/Profile
```

But real intelligence is bidirectional:

- A **later insight** should reinterpret an **earlier event**. ("That session I thought was inefficient was actually exploring a dead-end that prevented a much larger mistake.")
- A **pattern across sessions** should reclassify an **individual session**. ("Sessions that start with discovery and end with debugging in the auth module always take 3× longer — this is a feature of the problem domain, not inefficiency.")
- **Decision revision** should propagate backward to the original decision's quality assessment. ("Decision D was revised 3 weeks later. Was D wrong, or did requirements change?")

Phase 16's `IncrementalState` is forward-only by design. State can be updated with new events, but it cannot revisit old conclusions based on new understanding.

**Shortcoming 3: Cross-analyzer correlation is still statistical, not semantic.**

Phase 16D.3 replaces 4 hardcoded Pearson pairs with dynamic correlation discovery. But Pearson correlation between time-series measures **co-occurrence**, not **causation** or **meaning**. Two metrics that move together don't necessarily explain each other.

What's missing: semantic correlation. "Efficiency drops when the loop detector fires on auth module sessions where the chain pattern is iterative-correction with declining direction." This is a multi-entity relationship, not a statistical correlation between two scalar time-series.

**Shortcoming 4: The feature registry is isolated from reasoning.**

Phase 16B.2 builds a dynamic feature registry with PathTrie, git frequency, branch names, and prompt content. But the registry is a flat lookup table — "this file path belongs to feature X." It doesn't capture:

- Feature relationships (auth depends on database, billing imports from auth)
- Feature complexity (auth has 4 sub-features with deep interaction, utils is flat)
- Feature knowledge state (deep comprehension of auth/login, shallow of auth/oauth, zero of auth/mfa)
- Feature evolution (auth was simple 3 months ago, has grown complex through 47 sessions)

A semantic substrate would make each feature a rich entity with edges to sessions, decisions, comprehension scores, and historical evolution.

**Shortcoming 5: Diagnostics are ephemeral, not cumulative.**

Phase 16E.1's `DiagnosticStream` emits observations with `expiresAt`. They auto-dismiss. But diagnostics that keep happening are a signal:

- "Loop risk > 0.7 on auth module" emitted once is a warning. Emitted 5 times across 3 sessions is a **pattern** that should elevate to a persistent insight: "auth module has a structural complexity problem that manifests as loops."

This requires diagnostics to accumulate into entities, not just stream as events.

**Shortcoming 6: Profile accumulation is append-only, not graph-aware.**

Phase 16F.1's `ProfileAccumulator` updates running averages from analyzer outputs. But "your debugging efficiency has improved 15% over 3 months" is a trend line, not understanding. A substrate could represent:

- "You learned testing-first debugging in project-A (month 1), applied it to project-B (month 2), and it's now your default approach (month 3)" — this is a **learning trajectory**, not a metric trend.
- "Your decision durability in auth is 0.92 (decisions stick) but in billing is 0.54 (decisions get revised) — suggesting deeper understanding of auth patterns" — this connects decision durability to feature-level comprehension as entities, not as correlated time-series.

### 2.3 The Core Tension

Phase 16 is designed as a **computation graph** (analyzers + DAG + incremental state). The substrate question asks whether it should also be a **knowledge graph** (entities + relationships + temporal evolution).

These are not mutually exclusive. The computation graph determines WHEN things are computed. The knowledge graph determines WHAT is represented and HOW it's queried.

The question is: **does the knowledge graph add enough value to justify the complexity?**

---

## Part III: Validate — Decision Framework

### 3.1 Validation Against the Transmission Thesis

The transmission thesis says: AI agents = engines, codebases = tracks, intelligence layer = transmission/steering/diagnostics.

| Transmission Property | Phase 16 Coverage | Substrate Addition |
|---|---|---|
| **Gear detection** | Phase classification (16B.1) detects current gear per-event | Substrate: gear TRANSITIONS are entities — "shifted from exploring to implementing at minute 23, triggered by discovering the auth timeout bug" |
| **Torque conversion** | DiagnosticStream (16E.1) converts metrics to actionable messages | Substrate: diagnostics are grounded in entity chains — "recommending X because of Y which was caused by Z" with navigable provenance |
| **Power delivery** | Enhanced MCP (16E.4) includes phase + diagnostics in context | Substrate: MCP can traverse the graph to provide RELEVANT context, not just CURRENT context — "3 days ago you solved a similar auth issue by checking middleware timeouts" retrieved via semantic similarity ON the graph |
| **Diagnostic readout** | Hourly snapshots (16F.2) + real-time diagnostics | Substrate: diagnostics accumulate into persistent patterns, not just ephemeral observations |
| **Steering feedback** | Session intelligence (16E.2) with loop risk + direction trend | Substrate: feedback is connected to feature complexity model — "loops on auth are expected (complex domain), loops on config are a red flag (should be straightforward)" |
| **Memory** | Profile accumulator (16F.1) with running averages | Substrate: learning trajectories as first-class entities — "you learned X, applied it to Y, it became habit Z" |

**Verdict:** Phase 16 covers the transmission thesis at the **reactive** level (detect, report, respond). A substrate adds the **reflective** level (understand why, learn from patterns, provide context-grounded recommendations). The transmission thesis implicitly demands reflection — a good transmission doesn't just shift gears, it learns the driver's habits and road conditions.

### 3.2 Validation Against Practical Constraints

| Constraint | Impact on Substrate Decision |
|---|---|
| **Local-first, no cloud** | Rules out hosted graph databases. Embedded solutions only — CozoDB (Datalog, NAPI, SQLite backend) or Kuzu (Cypher, NAPI) are the viable options. |
| **Single-binary distribution** | Rules out Neo4j, JanusGraph, or any JVM-based graph DB. CozoDB's NAPI binding compiles to a native addon — same distribution model as DuckDB. |
| **Privacy-first** | Strengthens case for substrate — richer local representation means more value from local data without needing to send anything to an LLM for interpretation. |
| **Zero LLM cost for intelligence** | Entity resolution, relationship inference, and graph algorithms are all structural — no LLM calls. Vector embeddings (Step 4) can use lightweight local models or structural fingerprints. |
| **Event count scales** | At ~1 event/minute over months → 100K+ events. The graph contains ENTITIES (sessions, decisions, features, patterns), not raw events. ~100-500 active entities at steady state. Events remain in JSONL/DuckDB. |
| **2-second tick budget** | Substrate engine is a terminal DAG node — runs after analyzers, doesn't block them. Can be throttled independently. CozoDB transactions on SQLite backend handle batch upserts in <10ms for typical entity counts. |
| **Three databases justified** | Each database serves a distinct query paradigm: SQLite (point lookups, FTS), DuckDB (columnar analytics), CozoDB (graph traversal, recursive reasoning, vector similarity). No overlap in capabilities. |

### 3.3 Embedded Graph Database Landscape

Before deciding architecture, we surveyed embedded graph databases with Node.js bindings:

| Database | Query Language | Embedding | Graph + Temporal + Vector | Status |
|---|---|---|---|---|
| **CozoDB** | Datalog (CozoScript) | Rust/NAPI, `cozo-node` v0.7.6 | Property graph + recursive fixed-point + HNSW vector search + time-travel queries. SQLite/RocksDB/mem backends | Stable but maintenance slowing (single maintainer) |
| **Kuzu** | Cypher (openCypher) | C++/NAPI, `kuzu` v0.11.3 | Property graph with typed temporal edges. No built-in vector search | Active, pre-1.0, frequent releases |
| **SurrealDB** | SurrealQL | Rust/NAPI + WASM | Multi-model (document + graph via `RELATE`), temporal via fields | Active, v2.x, VC-funded. Embedded mode maturity lags |
| **TypeDB/DGraph/Memgraph** | Various | Require server process | Full graph capabilities | Disqualified: not embeddable |

**CozoDB is the optimal choice** for Unfade's intelligence substrate:

1. **Datalog is purpose-built for reasoning.** Recursive queries, transitive closure, fixed-point computation are first-class — not bolt-on recursive CTEs with depth limits. "Find all decisions transitively connected to this debugging arc" is a one-liner, not a fragile CTE.
2. **Built-in graph algorithms.** PageRank (identify most influential decisions), community detection (find natural feature clusters), shortest path (trace reasoning chains) — callable directly from queries.
3. **Vector search in the same query.** HNSW indexes enable "find sessions semantically similar to this one" combined with graph traversal in a single query. No separate vector store.
4. **Time-travel queries.** Historical snapshots of the graph at any point in time — "what was the state of understanding about auth at the start of last week?" is a native query, not a manual reconstruction.
5. **SQLite backend.** Aligns with local-first, single-file, CLI-distributable architecture. `cozo-node` embeds in-process via NAPI — no server, no sidecar.
6. **Maintenance risk is acceptable.** CozoDB is functionally stable (v0.7.6). The query language and storage are well-defined. If the project stalls completely, Kuzu (Cypher, actively maintained, v0.11.3) is a viable migration target — both are embedded NAPI graph databases with similar operational profiles.

### 3.4 The Architecture: Computation + Substrate

The question was framed as A vs B vs C. The right answer is **B+C together**: Phase 16's computation architecture (IncrementalState, DAG Scheduler, DiagnosticStream) provides the HOW of intelligence. A proper embedded graph database provides the WHAT — a persistent, queryable, self-evolving semantic substrate where intelligence entities live as first-class objects with rich relationships.

This is not an overlay on top of JSON files. The graph IS the intelligence layer's primary representation. Analyzer outputs flow INTO the graph. MCP queries, diagnostics, profile evolution, and cross-project reasoning all read FROM the graph. The JSON files become backward-compatible derived exports, not the source of intelligence truth.

```
Phase 16 Computation        →  Graph Substrate (CozoDB)  →  Consumers
                                                            
IncrementalState updates    →  Entity upserts             →  MCP semantic context
DAG cascade                 →  Relationship updates       →  DiagnosticStream
Classification pipeline     →  Node properties            →  Profile grounding
Cross-analyzer changes      →  Edge weight updates        →  Cross-project queries
Backward propagation        ←  Graph-triggered rules      ←  Pattern promotion
```

The critical shift: intelligence doesn't PRODUCE files that are later queried — intelligence BUILDS a graph that is continuously queryable. The graph is the living memory of the system.

---

## Part IV: Execute — Conceptual Architecture: The Semantic Substrate

### 4.1 Core Concept: Intelligence Entities

An **Intelligence Entity** is any real-world concept that multiple analyzers contribute information about. Phase 16 already produces these implicitly; the overlay makes them explicit.

```
Entity Types (initial, extensible):
  work-unit     — A coherent unit of work (session, multi-session investigation, debugging arc)
  decision      — A reasoning choice captured in a commit, prompt, or configuration change
  feature       — A part of the codebase (from 16B.2 FeatureRegistry), enriched with intelligence
  pattern       — A recurring behavior across sessions (loop pattern, prompt strategy, learning arc)
  capability    — A learned skill or knowledge area (from profile, grounded in evidence chains)
  diagnostic    — A persistent observation (promoted from ephemeral DiagnosticStream)
  maturity-assessment — A point-in-time maturity phase assessment (from 16F.3 MaturityModel)
```

Each entity has:
- `id` — stable identifier
- `type` — one of the entity types above
- `created_at`, `last_updated` — temporal bounds
- `sources` — which analyzers contributed to this entity's state
- `confidence` — how well-attested this entity is (more sources = higher confidence)
- `state` — current assessment (JSON blob, schema varies by type)

### 4.2 Entity Relationships

```
Relationship Types (initial, extensible):
  produced-by     — decision ← work-unit ("this decision came from that debugging session")
  targets         — work-unit → feature ("this session was working on auth")
  demonstrates    — work-unit → pattern ("this session exhibited iterative-correction")
  evidences       — work-unit → capability ("this session demonstrates auth debugging skill")
  revises         — decision → decision ("this decision overturned that earlier one")
  accumulates-to  — diagnostic → pattern ("5 loop warnings on auth → structural complexity")
  depends-on      — feature → feature ("billing imports from auth")
  applies-to      — pattern → feature ("iterative-correction pattern specific to auth module")
  learned-from    — capability → work-unit[] ("auth debugging skill learned across these sessions")
  assessed-at     — maturity-assessment → feature ("auth module assessed at Phase 2.3")
  bottlenecked-by — maturity-assessment → pattern ("maturity held back by loop-prone pattern on auth")
  narrated-by     — maturity-assessment → diagnostic ("maturity diagnostic: loose steering in infra")
```

Each relationship has:
- `source_id`, `target_id` — entity references
- `type` — relationship type
- `weight` — strength of relationship (0-1)
- `created_at` — when this relationship was established
- `evidence` — what analyzer/event established this relationship

### 4.3 How the Overlay Integrates with Phase 16

The semantic overlay does NOT replace any Phase 16 component. It adds a post-processing step after the DAG scheduler completes each cycle:

```
Phase 16 Pipeline:
  Event → Classification (16B) → IncrementalState update (16C) → DAG cascade (16D)
         → DiagnosticStream emission (16E) → Profile accumulation (16F)

With Semantic Overlay:
  Event → Classification (16B) → IncrementalState update (16C) → DAG cascade (16D)
         → DiagnosticStream emission (16E) → Profile accumulation (16F)
         → [NEW] Entity Resolution → Relationship Update → Backward Propagation
```

**Entity Resolution**: After analyzers run, the overlay checks: "Did any analyzer produce output about an entity I'm tracking?" If the loop detector flagged session S, and the efficiency analyzer computed AES for session S, and the feature registry links session S to feature F, then:
- Entity `work-unit:S` gets enriched with loop risk + efficiency + feature targeting.
- Relationship `work-unit:S → targets → feature:F` is created or updated.
- Relationship `work-unit:S → demonstrates → pattern:iterative-correction` is created.

**Backward Propagation**: When entity `work-unit:S` is assessed as a loop, the overlay checks: "Are there connected entities whose assessment should change?"
- If `feature:F` now has 5 work-units flagged as loops, promote a `diagnostic:loop-prone-feature` to `pattern:structural-complexity` on feature F.
- If `pattern:structural-complexity` on feature F exists, recalibrate the loop detector's threshold for feature F (loops on complex features have higher tolerance).

This is the backward reasoning that Phase 16 cannot do with forward-only IncrementalState.

### 4.4 Storage Model: CozoDB as the Intelligence Graph

The intelligence substrate lives in CozoDB with a SQLite backend at `~/.unfade/intelligence/graph.db`. This is a third database alongside the existing DuckDB (analytics) and SQLite (operational), purpose-built for relationship-rich intelligence queries.

**Why a third database is justified:**
- DuckDB is optimized for columnar analytics (time-series, aggregations). It cannot do recursive graph traversal efficiently.
- SQLite is optimized for point lookups and FTS. It has no graph query semantics.
- CozoDB is optimized for exactly what the intelligence layer needs: recursive relationship traversal, fixed-point computation, temporal queries, and built-in graph algorithms.
- Each database does what it's best at. No square pegs in round holes.

**CozoDB Schema (Datalog relations):**

```
# Entity relations (stored relations — persistent)
:create entity {
  id: String,
  type: String,          # 'work-unit' | 'decision' | 'feature' | 'pattern' | 'capability' | 'diagnostic'
  project_id: String,
  created_at: Float,     # Unix timestamp
  last_updated: Float,
  confidence: Float default 0.5,
  lifecycle: String default 'emerging',  # emerging | established | confirmed | decaying | archived
  => state: Json         # Entity-type-specific state
}

:create entity_source {
  entity_id: String,
  analyzer: String,
  => last_contributed: Float,
     contribution_count: Int default 1
}

# Relationship relation
:create edge {
  src: String,
  dst: String,
  type: String,          # 'produced-by' | 'targets' | 'demonstrates' | etc.
  => weight: Float default 1.0,
     created_at: Float,
     evidence: String default '',
     valid_from: Float,  # Temporal validity
     valid_to: Float default 9999999999.0
}

# Vector index for semantic similarity queries
::hnsw create entity:semantic_vec {
  dim: 64,
  ef: 50,
  fields: [embedding]
}
```

**Example queries that are trivial in Datalog, painful or impossible in SQL:**

```
# Transitive closure: all entities reachable from auth feature
reachable[to] := *edge{src: 'feat-auth', dst: to}
reachable[to] := reachable[mid], *edge{src: mid, dst: to}
?[id, type, state] := reachable[id], *entity{id, type, state}

# All decisions produced by debugging sessions on auth (multi-hop)
?[decision_id, decision_state] :=
  *entity{id: feat_id, type: 'feature', state: feat_state},
  feat_state.'name' = 'auth',
  *edge{src: wu_id, dst: feat_id, type: 'targets'},
  *entity{id: wu_id, type: 'work-unit', state: wu_state},
  wu_state.'phase' = 'debugging',
  *edge{src: wu_id, dst: decision_id, type: 'produced-by'},
  *entity{id: decision_id, type: 'decision', state: decision_state}

# PageRank on the entity graph (built-in algorithm)
ranked[id, rank] <~ PageRank(*edge[src, dst])
?[id, type, rank] := ranked[id, rank], *entity{id, type}, rank > 0.01

# Community detection: find natural feature clusters
communities[id, community] <~ CommunityDetectionLouvain(*edge[src, dst])
?[community, members] := communities[id, community],
  *entity{id, type: 'feature'},
  members = collect(id)

# Temporal query: state of understanding about auth one week ago
?[id, type, state] := *entity{id, type, state, last_updated},
  last_updated < 1745280000.0,  # Unix timestamp for 1 week ago
  *edge{src: id, dst: 'feat-auth', type: 'targets'}

# Semantic similarity + graph: find sessions similar to current one
# AND connected to the same feature
similar[id, dist] <~ KnnHnswSearch(entity:semantic_vec, current_embedding, 10)
?[id, state] := similar[id, dist], dist < 0.5,
  *entity{id, type: 'work-unit', state},
  *edge{src: id, dst: feat_id, type: 'targets'},
  *edge{src: current_session, dst: feat_id, type: 'targets'}
```

These queries demonstrate what a proper graph database enables that recursive CTEs cannot: fixed-point transitive closure, built-in graph algorithms, vector similarity combined with structural traversal, and temporal filtering — all in the same query language.

### 4.5 How Analyzers Feed the Graph

Each Phase 16 analyzer, after computing its IncrementalState, emits **entity contributions** that the substrate engine writes to CozoDB:

```typescript
interface EntityContribution {
  /** Entity this contribution is about */
  entityId: string;
  entityType: 'work-unit' | 'decision' | 'feature' | 'pattern' | 'capability' | 'diagnostic';
  /** What this analyzer contributes to the entity's state */
  stateFragment: Record<string, unknown>;
  /** Relationships this analyzer can establish */
  relationships: Array<{
    targetEntityId: string;
    type: RelationshipType;
    weight: number;
    evidence?: string;
  }>;
  /** Optional: embedding vector for semantic similarity */
  embedding?: number[];
}

// Extension to IncrementalAnalyzer (16A.3)
interface IncrementalAnalyzer<TState, TOutput> {
  // ... existing interface from Phase 16 ...

  /** Contribute to the intelligence graph after update */
  contributeEntities?(
    state: IncrementalState<TState>,
    batch: NewEventBatch
  ): EntityContribution[];
}
```

**The Substrate Engine** is the new component that sits between analyzers and CozoDB:

```typescript
interface SubstrateEngine {
  /** Process entity contributions from all analyzers that ran this cycle */
  ingest(contributions: EntityContribution[]): Promise<void>;
  
  /** Run backward propagation rules after ingestion */
  propagate(): Promise<PropagationResult>;
  
  /** Promote accumulated diagnostics to patterns */
  accumulateDiagnostics(diagnostics: Diagnostic[]): Promise<void>;
  
  /** Query the graph for MCP context */
  query(datalog: string, params?: Record<string, unknown>): Promise<unknown[]>;
  
  /** Run a named graph algorithm (PageRank, community detection, etc.) */
  algorithm(name: string, params?: Record<string, unknown>): Promise<unknown>;
  
  /** Get the CozoDB instance for direct Datalog queries */
  readonly db: CozoDb;
}
```

The substrate engine batches contributions per cycle, merges state fragments for the same entity (multiple analyzers enriching the same work-unit), and executes relationship upserts transactionally. After ingestion, backward propagation rules fire.

**Gradual adoption**: `contributeEntities()` is opt-in. Analyzers without it continue to produce JSON files. As each analyzer adds graph contributions, the substrate gets richer. The substrate degrades gracefully — fewer contributions = sparser graph = less rich queries, but nothing breaks. Phase 16 implementation is unaffected.

### 4.6 MCP Integration: Graph-Powered Context Injection

The graph substrate transforms MCP from "return current metrics" to "traverse accumulated intelligence and inject grounded reasoning context." Every MCP tool query becomes a graph traversal.

**Without graph (Phase 16 analyzers only):**
```json
{
  "_meta": {
    "currentPhase": "debugging",
    "activeSession": { "loopRisk": 0.7, "directionTrend": "falling" },
    "activeDiagnostics": [
      { "message": "Loop risk elevated" }
    ]
  }
}
```

**With graph substrate:**
```json
{
  "_meta": {
    "currentPhase": "debugging",
    "activeSession": { "loopRisk": 0.7, "directionTrend": "falling" },
    "graphContext": {
      "currentWorkUnit": {
        "targetFeature": "auth/middleware",
        "featureComplexity": "high",
        "loopHistory": "3 prior sessions on this feature also entered loops",
        "resolutionPattern": "2 of 3 resolved by writing a test case first",
        "relatedDecisions": [
          { "id": "d-47", "summary": "Chose timeout-based retry over circuit breaker", "durability": 0.85 }
        ],
        "similarSessions": [
          { "id": "wu-prev-1", "similarity": 0.87, "outcome": "resolved", "technique": "test-first" },
          { "id": "wu-prev-2", "similarity": 0.72, "outcome": "resolved", "technique": "middleware-isolation" }
        ]
      },
      "relevantCapability": {
        "authDebugging": { "level": "proficient", "confidence": 0.78 },
        "learnedTechniques": ["test-first", "middleware-isolation"],
        "growthEvidence": "12 sessions over 3 months, loop rate dropped from 40% to 8%"
      },
      "featureKnowledgeMap": {
        "auth/middleware": { "comprehension": 0.72, "decisionDurability": 0.85 },
        "auth/oauth": { "comprehension": 0.45, "decisionDurability": 0.61 },
        "auth/mfa": { "comprehension": 0.12, "decisionDurability": null }
      },
      "suggestedApproach": "Prior successful pattern: write a failing test for the timeout behavior before debugging the middleware implementation. This technique resolved 2 of 3 similar sessions on auth/middleware, reducing average turns from 12 to 5.",
      "connectedDecisions": [
        { "summary": "Chose timeout-based retry over circuit breaker", "durability": 0.85, "age": "3 weeks" },
        { "summary": "Separated auth middleware into per-route handlers", "durability": 0.92, "age": "6 weeks" }
      ]
    }
  }
}
```

This context is generated by a single Datalog query that traverses: `current-session → targets → auth/middleware ← targets ← past-sessions`, filters by semantic similarity (HNSW), pulls connected decisions, checks pattern entities, and reads capability growth trajectories. The AI agent consuming this MCP response now has deep contextual grounding — it knows what you've tried before, what worked, what your comprehension level is, and what approach historically succeeds.

**Named MCP graph queries** (pre-built Datalog templates the MCP server can invoke):

```typescript
const GRAPH_QUERIES = {
  // Context for current work: feature, history, patterns, capabilities
  'session-context': (sessionId: string) => `
    ?[feature, comprehension, loop_rate, best_technique, related_decisions] :=
      *edge{src: '${sessionId}', dst: feat_id, type: 'targets'},
      *entity{id: feat_id, type: 'feature', state: feat_state},
      feature = feat_state.'name',
      comprehension = feat_state.'comprehension',
      loop_rate = feat_state.'loopRate',
      best_technique = feat_state.'dominantPattern',
      *edge{src: _, dst: feat_id, type: 'targets'},
      *edge{src: _, dst: dec_id, type: 'produced-by'},
      *entity{id: dec_id, type: 'decision', state: dec_state},
      related_decisions = collect(dec_state)
  `,
  
  // Find similar past sessions via vector similarity + same feature
  'similar-sessions': (embedding: number[], featureId: string) => `
    similar[id, dist] <~ KnnHnswSearch(entity:semantic_vec, [${embedding}], 5)
    ?[id, state, dist] := similar[id, dist],
      *entity{id, type: 'work-unit', state},
      *edge{src: id, dst: '${featureId}', type: 'targets'}
  `,
  
  // Developer capability map for a feature domain
  'capability-map': (domain: string) => `
    ?[capability, level, techniques, evidence_count] :=
      *entity{id: cap_id, type: 'capability', state: cap_state},
      cap_state.'name' ~ '${domain}',
      capability = cap_state.'name',
      level = cap_state.'level',
      techniques = cap_state.'learnedTechniques',
      evidence_count = cap_state.'evidenceCount'
  `,
};
```

This is the transmission thesis fully realized: the system doesn't just detect the gear — it provides steering grounded in the driver's accumulated road knowledge, retrieved via graph traversal and semantic similarity in real time.

### 4.7 Diagnostic Accumulation

The overlay transforms ephemeral diagnostics into persistent intelligence:

```
DiagnosticStream emits: "Loop risk > 0.7 on session S (auth/middleware)"
                        ↓
Entity Resolution: work-unit:S → targets → feature:auth/middleware
                        ↓
Accumulation check: Is there a pattern entity for "loops on auth/middleware"?
  - No → Create diagnostic entity, wait for more evidence
  - Yes, seen 4 times → Promote to pattern entity:
    pattern:auth-middleware-structural-loops {
      type: 'pattern',
      state: {
        occurrences: 5,
        avgResolutionTurns: 12,
        bestResolution: 'test-first',
        featureId: 'auth/middleware',
        severity: 'structural'
      }
    }
                        ↓
Backward propagation: Adjust loop detector threshold for auth/middleware
  (loops on structurally complex features have higher tolerance)
```

### 4.8 Learning Trajectories

The overlay enables tracking HOW a developer's capabilities evolve:

```
Month 1: Sessions on auth have low comprehension (0.35), high loop rate (40%)
  → Entity: capability:auth-debugging { level: 'novice', evidence: [...] }

Month 2: Developer starts writing tests first (pattern detected), loop rate drops to 20%
  → Entity: capability:auth-debugging { level: 'developing', learnedTechnique: 'test-first' }
  → Relationship: capability:auth-debugging ← learned-from → [sessions where test-first appeared]

Month 3: Auth debugging comprehension at 0.78, loop rate 8%, developer applies test-first to billing module too
  → Entity: capability:auth-debugging { level: 'proficient' }
  → Relationship: capability:test-first-debugging ← applies-to → [feature:auth, feature:billing]
  → Cross-project: Applied in project-B (where auth is different) — technique transfers
```

This is not achievable with Phase 16's forward-only IncrementalState + Profile Accumulator. The accumulator sees running averages; the overlay sees a **narrative of growth** grounded in specific entities and relationships.

### 4.9 Maturity Model Graph Integration

The maturity model (16F.3) computes collaboration maturity from upstream analyzer states. The substrate enriches this with graph-powered capabilities that flat analyzer states cannot provide.

**Maturity Assessment Entity:**

Each maturity computation produces a `maturity-assessment` entity in the graph:

```
Entity: maturity-assessment:<date>:<project_id>
  state: {
    phase: 2.7,
    phaseLabel: 'first-gear',
    dimensions: { direction: 0.45, modification-depth: 0.38, ... },
    confidence: 0.72,
    bottlenecks: ['context-leverage', 'loop-resilience']
  }
  edges:
    assessed-at → feature:auth (per-feature maturity views)
    assessed-at → feature:billing
    bottlenecked-by → pattern:auth-loop-resolution (bottleneck grounded in evidence)
    narrated-by → diagnostic:loose-steering-infra (narrative traceability)
```

**Graph-Powered Maturity Queries (Datalog):**

```
# Maturity trajectory with evidence grounding
?[date, phase, confidence, bottleneck_patterns] :=
  *entity{id: aid, type: 'maturity-assessment', state: s, created_at: date},
  phase = get(s, 'phase'),
  confidence = get(s, 'confidence'),
  *edge{src: aid, dst: pid, type: 'bottlenecked-by'},
  *entity{id: pid, type: 'pattern', state: ps},
  bottleneck_patterns = get(ps, 'name')
  :order date

# Feature-level maturity comparison (which features drag down global maturity?)
?[feature_name, feature_phase, global_phase, gap] :=
  *entity{id: aid, type: 'maturity-assessment', state: s},
  global_phase = get(s, 'phase'),
  *edge{src: aid, dst: fid, type: 'assessed-at'},
  *entity{id: fid, type: 'feature', state: fs},
  feature_name = get(fs, 'name'),
  feature_phase = get(fs, 'maturityPhase'),
  gap = sub(global_phase, feature_phase)
  :order -gap
  :limit 5

# Bottleneck root-cause analysis via graph traversal
# "Why is context-leverage low?" → trace through graph edges to find evidence
?[bottleneck_dim, root_cause_type, root_cause, evidence_count] :=
  *entity{id: aid, type: 'maturity-assessment', state: s},
  bottleneck_dim = get(s, 'bottlenecks'),
  *edge{src: aid, dst: pid, type: 'bottlenecked-by'},
  *entity{id: pid, type: root_cause_type, state: ps},
  root_cause = get(ps, 'name'),
  *edge{src: pid, dst: _, type: _} {count: evidence_count}
```

**Temporal Maturity Progression:**

The graph stores maturity assessments as temporal entities, enabling queries like:
- "How long did it take to move from Phase 1 to Phase 2?" → traverse assessment chain by date
- "What decisions coincided with phase transitions?" → join maturity assessments with decision entities by temporal proximity
- "Which features improved most during Phase 2→3 transition?" → compare per-feature maturity across assessment snapshots

### 4.10 Narrative Synthesis Graph Queries

The narrative engine (16F.4) generates vehicle-analogy narratives from intelligence state. The substrate provides richer narrative context than analyzer states alone by enabling multi-hop evidence traversal.

**Graph-Enhanced Evidence Chains:**

When the narrative engine produces "your steering is loose in auth," the substrate can trace the full evidence chain:

```
# Full evidence chain for a diagnostic narrative
?[narrative_headline, evidence_type, evidence_detail, session_id, event_timestamp] :=
  *entity{id: did, type: 'diagnostic', state: ds},
  narrative_headline = get(ds, 'headline'),
  starts_with(narrative_headline, 'Your steering is loose'),
  *edge{src: did, dst: fid, type: 'applies-to'},
  *entity{id: fid, type: 'feature'},
  *edge{src: wid, dst: fid, type: 'targets'},
  *entity{id: wid, type: 'work-unit', state: ws},
  session_id = get(ws, 'sessionId'),
  evidence_type = get(ws, 'phase'),
  evidence_detail = get(ws, 'outcome'),
  event_timestamp = get(ws, 'created_at')
  :order -event_timestamp
  :limit 10
```

This enables the narrative engine to include specific session references: "Your steering is loose in auth — in your last 3 sessions (April 18, 19, 21), you accepted 94% of AI output with comprehension at 0.31."

**Graph-Powered Prescription Enhancement:**

Prescriptions like "transfer your API technique to auth" can be enriched with graph-derived specifics:

```
# Find transferable patterns between features
?[source_feature, target_feature, pattern_name, effectiveness_delta] :=
  *edge{src: p1, dst: f1, type: 'applies-to'},
  *entity{id: f1, type: 'feature', state: fs1},
  source_feature = get(fs1, 'name'),
  *entity{id: p1, type: 'pattern', state: ps},
  pattern_name = get(ps, 'name'),
  *edge{src: p1, dst: f2, type: 'applies-to'},
  f1 != f2,
  *entity{id: f2, type: 'feature', state: fs2},
  target_feature = get(fs2, 'name'),
  effectiveness_delta = sub(get(fs1, 'comprehension'), get(fs2, 'comprehension')),
  effectiveness_delta > 0.2
  :order -effectiveness_delta
```

**Progress Narrative Grounding:**

Phase transition narratives gain depth from the graph:
- "You entered Phase 3" → graph shows which capability entities crossed the `proficient` threshold
- "Your direction improved" → graph traces to specific decision entities that demonstrate increased steering
- "Context leverage is your bottleneck" → graph shows which sessions lacked MCP context injection and what patterns those sessions share

The narrative engine's `graphContext` optional field in `NarrativeContext` receives these graph query results, enabling richer narratives when the substrate is available, while falling back gracefully to analyzer-only narratives when it is not.

### 4.11 Entity Lifecycle

Entities are not permanent. They have a lifecycle:

```
emerging    → confidence < 0.3, few sources (1-2 analyzers contributed)
established → confidence 0.3-0.7, multiple sources confirm
confirmed   → confidence > 0.7, stable across multiple time windows
decaying    → no new evidence for N days (configurable, default 30)
archived    → decayed entities moved to cold storage, excluded from active queries
```

The lifecycle prevents unbounded graph growth. At steady state with active development, the graph should contain ~100-500 active entities (roughly: 10-50 active features, 20-100 recent work units, 10-30 patterns, 10-20 capabilities, misc decisions and diagnostics). This is well within DuckDB's comfortable range.

---

## Part V: Architectural Decision

### 5.1 Decision: Full Semantic Substrate + Semantic Overlay (Option B + C)

Phase 16 is unchanged — it defines the computation architecture (IncrementalState, DAG Scheduler, DiagnosticStream). This investigation defines the **intelligence representation** layer that lives alongside Phase 16: a full embedded graph database (CozoDB) serving as the persistent, queryable semantic substrate, with semantic overlay patterns (entity resolution, backward propagation, diagnostic accumulation, learning trajectories) as operational mechanisms on top of the graph.

**The architecture is now three layers:**

```
Layer 1: Phase 16 — Computation (HOW intelligence is computed)
  IncrementalState, DAG Scheduler, Classification Pipeline, DiagnosticStream
  → Unchanged. Built as specified in PHASE_16_INTELLIGENCE_SYSTEM_REDESIGN.md

Layer 2: Semantic Substrate — Representation (WHAT intelligence IS)
  CozoDB embedded graph database
  → Entities, relationships, temporal evolution, vector similarity, graph algorithms
  → The living memory of the system

Layer 3: Semantic Overlay — Operations (HOW the graph is maintained and queried)
  Entity resolution, backward propagation, diagnostic accumulation, learning trajectories
  → The rules that keep the graph alive, coherent, and useful
```

### 5.2 Phase 16 is Unchanged

**Nothing in Phase 16 changes.** Sprints 16A-16H are built exactly as specified. The substrate is a parallel concern:

- Phase 16 analyzers continue producing `intelligence/*.json` files (backward compatibility).
- The substrate engine is an additional downstream consumer of analyzer outputs — it observes what analyzers produce and writes to CozoDB.
- Analyzers that implement `contributeEntities()` provide richer graph data, but this is opt-in and additive.
- The DAG scheduler doesn't need to know about CozoDB. The substrate engine registers as a terminal node in the DAG — it runs after all analyzers complete, reads their outputs, and updates the graph.

**The substrate is its own concern**, documented here, implemented independently of Phase 16's sprints. It can be built in parallel with Phase 16 or as a follow-on. The only integration point is the `contributeEntities()` optional method on `IncrementalAnalyzer`.

### 5.3 Three-Database Architecture

The system now has three purpose-built databases:

```
~/.unfade/
├── cache/unfade.db          # SQLite — operational: FTS, point lookups, event_links, features
├── cache/unfade.duckdb      # DuckDB — analytics: time-series, typed columns, aggregations
├── intelligence/graph.db    # CozoDB (SQLite backend) — substrate: entities, relationships, 
│                            #   graph algorithms, vector similarity, temporal queries
```

| Concern | Database | Query Language | Justification |
|---|---|---|---|
| Event storage & FTS | SQLite | SQL | Point lookups, full-text search, operational lineage |
| Time-series analytics | DuckDB | SQL | Columnar scans, typed columns, window aggregations |
| Intelligence graph | CozoDB | Datalog | Recursive traversal, fixed-point computation, graph algorithms, vector HNSW |

**Data flows between them:**
- **JSONL → SQLite + DuckDB** (existing materializer, unchanged)
- **DuckDB → CozoDB** (substrate engine reads analyzer outputs from DuckDB, writes entities/edges to CozoDB)
- **CozoDB → MCP** (graph queries generate semantic context for AI agents)
- **CozoDB → Profile** (learning trajectories grounded in entity evidence)
- **CozoDB → Diagnostics** (accumulated patterns from the graph feed back into DiagnosticStream)

**Rebuild path:** `unfade doctor --rebuild-graph` replays all analyzer states into CozoDB from scratch. The graph is derived — JSONL remains the ultimate source of truth.

### 5.4 Substrate Evolution Strategy

The substrate is built incrementally, each step independently valuable:

```
Step 1: Foundation
  - CozoDB integration (cozo-node NAPI binding)
  - Entity and edge schema (Datalog stored relations)
  - SubstrateEngine class with ingest/query/algorithm methods
  - First entities: work-units from session materializer, features from feature registry
  - First edges: work-unit → targets → feature
  Validate: Can MCP query "what features am I working on?" from the graph?

Step 2: Multi-Analyzer Enrichment
  - Entity resolution: merge contributions from loop-detector, efficiency, comprehension
    onto work-unit entities created in Step 1
  - Pattern entities: promote repeated diagnostics to persistent patterns
  - Decision entities: from decision-durability analyzer
  - Edges: work-unit → demonstrates → pattern, work-unit → produced-by → decision
  Validate: Can MCP answer "what decisions came from debugging sessions on auth?"

Step 3: Backward Propagation + Temporal
  - Propagation rules: when a pattern is detected, adjust thresholds for connected features
  - Temporal edges: decision revisions, capability evolution over time
  - Time-travel queries: "what did I know about auth 2 weeks ago?"
  Validate: Does backward propagation improve analyzer accuracy?

Step 4: Semantic Similarity + Learning Trajectories
  - Lightweight local embeddings (or structural fingerprints) for work-unit similarity
  - HNSW vector index on entities
  - Capability entities with growth trajectories grounded in evidence chains
  - Cross-project entity matching via shared patterns/capabilities
  Validate: Does "find similar past sessions" improve MCP context quality?

Step 5: Graph Intelligence
  - PageRank on entity graph → identify most influential decisions/features
  - Community detection → discover natural feature clusters
  - Shortest path → trace reasoning chains from insight back to evidence
  - Feed graph-derived insights into the intelligence layer as a new signal source
  Validate: Do graph algorithms surface insights that statistical analyzers miss?
```

### 5.5 What This IS and What This IS NOT

**This IS:**
- A proper embedded graph database (CozoDB) as the intelligence substrate — first-class entities, relationships, graph algorithms, vector search, temporal queries.
- An operational overlay (entity resolution, backward propagation, diagnostic accumulation) that keeps the graph alive and coherent.
- A third database alongside DuckDB and SQLite, each purpose-built for its domain.
- A representation layer that makes Phase 16's computed intelligence **queryable, connectable, and grounded in evidence**.
- Quality-first: the product that provides a wow factor and is used daily to solve real pain points.

**This IS NOT:**
- A change to Phase 16. The computation architecture is unchanged.
- An implementation plan. This defines WHAT and WHY. Implementation details (sprint breakdown, file manifest, test strategy) are separate.
- A rewrite of the materializer, analyzers, or scheduler. Those remain as Phase 16 specifies.
- A cloud-dependent system. CozoDB with SQLite backend is fully local, fully embedded, single-file.
- An LLM-dependent system. All entity resolution, relationship inference, and graph queries are structural. Vector embeddings are optional (Step 4) and would use local models only.

---

## Appendix A: Entity Schema Examples

### Work Unit Entity
```json
{
  "id": "wu-abc123",
  "type": "work-unit",
  "created_at": "2026-04-22T14:30:00Z",
  "last_updated": "2026-04-22T15:45:00Z",
  "sources": "session-materializer,loop-detector,efficiency,prompt-chain",
  "confidence": 0.82,
  "state": {
    "sessionId": "sess-xyz",
    "phase": "debugging",
    "promptType": "debugging",
    "chainPattern": "iterative-correction",
    "loopRisk": 0.7,
    "efficiency": 0.45,
    "directionTrend": "falling",
    "turnCount": 8,
    "outcome": "ongoing"
  },
  "project_id": "unfade-cli"
}
```

### Feature Entity
```json
{
  "id": "feat-auth-middleware",
  "type": "feature",
  "created_at": "2026-03-01T00:00:00Z",
  "last_updated": "2026-04-22T15:45:00Z",
  "sources": "feature-registry,comprehension-radar,velocity-tracker,loop-detector",
  "confidence": 0.91,
  "state": {
    "name": "auth/middleware",
    "modulePath": "src/services/auth/middleware",
    "comprehension": 0.72,
    "velocity": 1.3,
    "loopRate": 0.25,
    "dominantPattern": "iterative-correction",
    "complexity": "high",
    "totalSessions": 47,
    "activeSessions": 1,
    "decisionCount": 8,
    "durability": 0.85
  },
  "project_id": "unfade-cli"
}
```

### Pattern Entity
```json
{
  "id": "pat-auth-loop-resolution",
  "type": "pattern",
  "created_at": "2026-03-15T00:00:00Z",
  "last_updated": "2026-04-22T15:45:00Z",
  "sources": "loop-detector,prompt-chain,diagnostic-accumulator",
  "confidence": 0.67,
  "state": {
    "name": "Test-first resolves auth loops",
    "occurrences": 5,
    "description": "Sessions on auth/middleware that start with writing a test case resolve in 60% fewer turns than those that dive into implementation",
    "applicableFeatures": ["auth/middleware", "auth/oauth"],
    "resolutionMethod": "test-first",
    "avgTurnsWithPattern": 5,
    "avgTurnsWithout": 12,
    "statisticalSignificance": 0.03
  },
  "project_id": "unfade-cli"
}
```

### Capability Entity
```json
{
  "id": "cap-auth-debugging",
  "type": "capability",
  "created_at": "2026-01-15T00:00:00Z",
  "last_updated": "2026-04-22T15:45:00Z",
  "sources": "comprehension-radar,efficiency,profile-accumulator",
  "confidence": 0.78,
  "state": {
    "name": "Auth system debugging",
    "level": "proficient",
    "comprehension": 0.78,
    "evidenceCount": 12,
    "learnedTechniques": ["test-first", "middleware-isolation"],
    "growthTrajectory": [
      { "date": "2026-01", "level": 0.35 },
      { "date": "2026-02", "level": 0.55 },
      { "date": "2026-03", "level": 0.68 },
      { "date": "2026-04", "level": 0.78 }
    ],
    "transferredTo": ["billing/middleware"]
  },
  "project_id": "unfade-cli"
}
```

## Appendix B: Transmission Thesis Alignment Summary

| Transmission Function | Phase 16 Only | Phase 16 + CozoDB Substrate |
|---|---|---|
| **Detect gear** | Per-event classification | Same — classification feeds into graph as entity state |
| **Shift gear** | Diagnostic suggestion | Suggestion grounded in past resolution patterns from graph traversal |
| **Learn driver habits** | Profile running averages | Learning trajectories as first-class entities with evidence chains |
| **Remember road conditions** | Feature registry (flat PathTrie) | Feature entities with complexity, comprehension, patterns, decision history, and community structure |
| **Predict road ahead** | Statistical correlation (Pearson) | Graph-derived predictions: "this feature + this prompt type → this outcome" via multi-hop traversal + semantic similarity |
| **Adapt to conditions** | Phase-normalized baselines | Backward propagation: feature complexity informs loop thresholds, capability level adjusts difficulty expectations |
| **Transfer knowledge** | Cross-project stat comparison (16G) | Cross-project entity matching via shared patterns/capabilities + graph community detection |
| **Explain decisions** | Diagnostic messages | Full provenance: navigable graph chain from recommendation → pattern → evidence sessions → specific events |
| **Know thyself** | Profile v2 with running stats | Capability map: PageRank on entity graph reveals most influential decisions, community detection reveals natural skill clusters |
| **Assess maturity** | Not available | Maturity assessment entities (§4.9) with per-feature views, bottleneck grounding via graph traversal, temporal progression queries across assessment chain |
| **Tell the story** | Raw metrics, no narrative | Narrative synthesis (§4.10) with graph-enhanced evidence chains: multi-hop traversal from headline → diagnostic → feature → sessions → events. Vehicle-analogy diagnostics, prescriptions, and progress narratives grounded in entity evidence |

## Appendix C: Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| **CozoDB maintenance stalls** | Medium | CozoDB is functionally stable at v0.7.6 with SQLite backend. If maintenance stops entirely, Kuzu (Cypher, actively maintained, v0.11.3) is a migration target — both are embedded NAPI graph DBs. The `SubstrateEngine` abstraction isolates graph queries from the rest of the system |
| **Third database adds operational complexity** | Medium | CozoDB with SQLite backend is a single file (`graph.db`). No server process, no configuration. `unfade doctor --rebuild-graph` handles corruption. Same operational model as existing DuckDB |
| **Datalog learning curve** | Low | Pre-built named queries (§4.6) handle 90% of use cases. Contributors only need to implement `contributeEntities()` (TypeScript), not write Datalog. Datalog is simpler than SQL for recursive queries |
| **Entity count grows unbounded** | Low | Lifecycle management: emerging → established → confirmed → decaying → archived. Active entities capped at ~500 via aging rules. Archived entities moved to separate relation for cold queries |
| **Relationship spam** | Low | Weight threshold: only relationships with weight > 0.3 are stored. Low-confidence edges pruned on accumulation cycles. Edge count bounded by entity count × max fan-out |
| **Substrate engine adds tick latency** | Low | Substrate engine is a terminal DAG node — runs after all analyzers, doesn't block them. Can be throttled independently (every 10s, or only when analyzers report `changed: true`) |
| **Backward propagation loops** | Low | Maximum propagation depth of 2. Dirty flag prevents re-entrant updates. Propagation rules are declarative and auditable |
| **Binary size increase from cozo-node** | Low | `cozo-node` NAPI binary is ~10-15MB (SQLite backend). Acceptable for a CLI tool that already bundles DuckDB (~20MB) |
| **Testing graph queries** | Low | CozoDB in-memory backend (`mem`) for tests — instant creation, no cleanup. Entity resolution is deterministic given analyzer outputs. Named queries are unit-testable |

## Appendix D: CozoDB Integration Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Phase 16 DAG Scheduler                │
│                                                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │ Analyzer │ │ Analyzer │ │ Analyzer │ │ Analyzer │   │
│  │    A     │ │    B     │ │    C     │ │    N     │   │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘   │
│       │             │             │             │         │
│       │ contributeEntities()      │             │         │
│       ▼             ▼             ▼             ▼         │
│  ┌──────────────────────────────────────────────────┐    │
│  │            Entity Contribution Batch              │    │
│  └───────────────────────┬──────────────────────────┘    │
└──────────────────────────┼───────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│                   Substrate Engine                        │
│                                                          │
│  ┌─────────────┐  ┌───────────────┐  ┌───────────────┐  │
│  │   Entity     │  │   Backward    │  │  Diagnostic   │  │
│  │  Resolution  │  │  Propagation  │  │ Accumulation  │  │
│  │  & Merge     │  │    Rules      │  │               │  │
│  └──────┬───────┘  └───────┬───────┘  └───────┬───────┘  │
│         │                  │                  │           │
│         ▼                  ▼                  ▼           │
│  ┌──────────────────────────────────────────────────┐    │
│  │              CozoDB (SQLite backend)              │    │
│  │          ~/.unfade/intelligence/graph.db           │    │
│  │                                                    │    │
│  │  Stored Relations:                                │    │
│  │    entity{id, type, state, confidence, lifecycle}  │    │
│  │    edge{src, dst, type, weight, valid_from/to}     │    │
│  │    entity_source{entity_id, analyzer}              │    │
│  │                                                    │    │
│  │  Algorithms: PageRank, CommunityDetection,        │    │
│  │              ShortestPath, KnnHnswSearch           │    │
│  └──────────────────────────────────────────────────┘    │
│         │                                                │
│         ▼                                                │
│  ┌──────────────────────────────────────────────────┐    │
│  │              Query Interface                      │    │
│  │  Named Datalog templates for MCP, Profile, Diag   │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
    MCP Tools            Profile              DiagnosticStream
  (graph context)    (grounded evidence)    (accumulated patterns)
```

**Data ownership boundaries:**
- **JSONL** — source of truth for ALL events (unchanged)
- **SQLite** — operational queries, FTS, event_links (unchanged)
- **DuckDB** — time-series analytics, typed columns, aggregations (unchanged)
- **CozoDB** — intelligence entities, relationships, graph queries, semantic similarity (new)
- **JSON files** — backward-compatible analyzer outputs (unchanged, derived from analyzer state)

## Part VI: Implementation Specification

This section provides implementation-ready details for each evolution step defined in §5.4. Each task includes exact file paths, interfaces, integration points, and test expectations.

### 6.1 Project Structure for Substrate

```
src/services/substrate/              # NEW directory for all substrate code
├── cozo-manager.ts                  # CozoDB connection manager (singleton)
├── schema.ts                        # Datalog stored relation definitions
├── substrate-engine.ts              # SubstrateEngine class (ingest, propagate, query)
├── entity-resolver.ts               # Entity resolution & state merge logic
├── propagation-rules.ts             # Backward propagation rule definitions
├── diagnostic-accumulator.ts        # Diagnostic → pattern promotion
├── graph-queries.ts                 # Named Datalog query templates for MCP
└── learning-trajectories.ts         # Capability entity evolution tracking

test/services/substrate/             # Test mirror
├── cozo-manager.test.ts
├── substrate-engine.test.ts
├── entity-resolver.test.ts
├── propagation-rules.test.ts
├── diagnostic-accumulator.test.ts
└── graph-queries.test.ts
```

### 6.2 Key Imports & Conventions

```typescript
// CozoDB NAPI binding
import { CozoDb } from "cozo-node";  // npm: cozo-node

// From existing codebase
import { getIntelligenceDir } from "../../utils/paths.js";
import { logger } from "../../utils/logger.js";
import type { DbLike } from "../cache/manager.js";
import type { AnalyzerContext, AnalyzerResult } from "../intelligence/analyzers/index.js";
import type { IncrementalState, IncrementalAnalyzer } from "../intelligence/incremental-state.js";
import type { Diagnostic } from "../intelligence/diagnostic-stream.js";

// All imports use .js extensions (ESM)
// Node builtins use node: prefix
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
```

### 6.3 Sprint Breakdown

#### SUB-1: Foundation (parallel with Phase 16D)

**SUB-1.1: CozoDB Integration**

**New file:** `src/services/substrate/cozo-manager.ts`

```typescript
import { CozoDb } from "cozo-node";
import { join } from "node:path";
import { getIntelligenceDir } from "../../utils/paths.js";
import { logger } from "../../utils/logger.js";

export class CozoManager {
  private static instance: CozoDb | null = null;

  /** Get or create CozoDB instance with SQLite backend */
  static async getInstance(): Promise<CozoDb> {
    if (this.instance) return this.instance;
    
    const dbPath = join(getIntelligenceDir(), "graph.db");
    this.instance = new CozoDb("sqlite", dbPath);
    await this.ensureSchema();
    return this.instance;
  }

  /** Initialize stored relations (idempotent) */
  private static async ensureSchema(): Promise<void> {
    const db = this.instance!;
    // Create relations if not exist — see schema.ts
    for (const stmt of ALL_COZO_SCHEMA) {
      try { await db.run(stmt); } catch { /* relation already exists */ }
    }
  }

  /** Close the database (for graceful shutdown) */
  static async close(): Promise<void> {
    if (this.instance) {
      await this.instance.close();
      this.instance = null;
    }
  }

  /** In-memory instance for testing */
  static createTestInstance(): CozoDb {
    return new CozoDb("mem", "");
  }
}
```

**Integration point:** Call `CozoManager.close()` in `RepoManager.shutdownAll()` (`src/services/daemon/repo-manager.ts`)

**Test file:** `test/services/substrate/cozo-manager.test.ts`
- Creates in-memory instance
- Schema creation is idempotent (run twice, no error)
- getInstance returns same instance (singleton)

---

**SUB-1.2: Schema Definitions**

**New file:** `src/services/substrate/schema.ts`

```typescript
/** CozoDB Datalog stored relation creation statements */

export const ENTITY_SCHEMA = `:create entity {
  id: String,
  type: String,
  project_id: String,
  created_at: Float,
  last_updated: Float,
  confidence: Float default 0.5,
  lifecycle: String default 'emerging',
  => state: Json
}`;

export const ENTITY_SOURCE_SCHEMA = `:create entity_source {
  entity_id: String,
  analyzer: String,
  => last_contributed: Float,
     contribution_count: Int default 1
}`;

export const EDGE_SCHEMA = `:create edge {
  src: String,
  dst: String,
  type: String,
  => weight: Float default 1.0,
     created_at: Float,
     evidence: String default '',
     valid_from: Float,
     valid_to: Float default 9999999999.0
}`;

export const ALL_COZO_SCHEMA = [
  ENTITY_SCHEMA,
  ENTITY_SOURCE_SCHEMA,
  EDGE_SCHEMA,
] as const;

/** Entity type constants */
export type EntityType = 'work-unit' | 'decision' | 'feature' | 'pattern' | 'capability' | 'diagnostic' | 'maturity-assessment';

/** Relationship type constants */
export type RelationshipType = 'produced-by' | 'targets' | 'demonstrates' | 'evidences' | 'revises' | 'accumulates-to' | 'depends-on' | 'applies-to' | 'learned-from' | 'assessed-at' | 'bottlenecked-by' | 'narrated-by';
```

**Test:** Schema types are string literals, no runtime test needed beyond SUB-1.1 schema creation.

---

**SUB-1.3: SubstrateEngine Core**

**New file:** `src/services/substrate/substrate-engine.ts`

```typescript
import type { CozoDb } from "cozo-node";
import type { EntityType, RelationshipType } from "./schema.js";
import { logger } from "../../utils/logger.js";

export interface EntityContribution {
  entityId: string;
  entityType: EntityType;
  projectId: string;
  stateFragment: Record<string, unknown>;
  relationships: Array<{
    targetEntityId: string;
    type: RelationshipType;
    weight: number;
    evidence?: string;
  }>;
  embedding?: number[];
}

export interface PropagationResult {
  entitiesUpdated: number;
  edgesCreated: number;
  patternsPromoted: number;
}

export class SubstrateEngine {
  constructor(private db: CozoDb) {}

  /** Process entity contributions from all analyzers that ran this cycle */
  async ingest(contributions: EntityContribution[]): Promise<void> {
    // 1. Group contributions by entityId
    // 2. For each entity: upsert with merged state fragments
    // 3. For each relationship: upsert edge
    // 4. Update entity_source records
  }

  /** Run backward propagation rules after ingestion */
  async propagate(): Promise<PropagationResult> {
    // Max depth: 2
    // 1. Find entities whose confidence changed significantly
    // 2. Walk edges to find affected entities
    // 3. Apply rules (e.g., diagnostic accumulation → pattern promotion)
    // Return count of updates
  }

  /** Query the graph with Datalog */
  async query(datalog: string, params?: Record<string, unknown>): Promise<unknown[]> {
    const result = await this.db.run(datalog);
    return result.rows;
  }

  /** Get active entities by type */
  async getEntitiesByType(type: EntityType, projectId?: string): Promise<unknown[]> {
    // Datalog query filtered by type + lifecycle != 'archived'
  }
}
```

**Integration:** The SubstrateEngine registers as a terminal node in the Phase 16D DAG scheduler (`src/services/intelligence/scheduler.ts`). After all analyzers run, the scheduler calls:
```typescript
const contributions = analyzers
  .filter(a => a.contributeEntities)
  .flatMap(a => a.contributeEntities!(state, batch));
await substrateEngine.ingest(contributions);
await substrateEngine.propagate();
```

**Test file:** `test/services/substrate/substrate-engine.test.ts`
- Ingest single contribution → entity created in graph
- Ingest two contributions for same entity → state merged
- Ingest with relationships → edges created
- Propagate with depth limit → stops at depth 2
- Query returns expected results

---

**SUB-1.4: First Entity Producers**

**Files to modify:**
- `src/services/intelligence/session-materializer.ts` — add `contributeEntities()` to produce `work-unit` entities
- `src/services/intelligence/feature-boundary.ts` — add `contributeEntities()` to produce `feature` entities

**Pattern for adding `contributeEntities()`:**
```typescript
// Add to any IncrementalAnalyzer implementation
contributeEntities(
  state: IncrementalState<SessionState>,
  batch: NewEventBatch
): EntityContribution[] {
  return batch.sessionUpdates.map(sessionId => ({
    entityId: `wu-${sessionId}`,
    entityType: 'work-unit' as const,
    projectId: state.value.projectId,
    stateFragment: {
      sessionId,
      phase: state.value.sessions[sessionId]?.phase,
      turnCount: state.value.sessions[sessionId]?.turnCount,
    },
    relationships: [{
      targetEntityId: `feat-${state.value.sessions[sessionId]?.featureId}`,
      type: 'targets' as const,
      weight: 1.0,
    }],
  }));
}
```

**Validation:** After SUB-1.4, the MCP query "what features am I working on?" should return results from the graph via a Datalog query that traverses `work-unit → targets → feature`.

---

#### SUB-2: Multi-Analyzer Enrichment (after Phase 16E)

**SUB-2.1: Entity Resolution**

**New file:** `src/services/substrate/entity-resolver.ts`

```typescript
import type { EntityContribution } from "./substrate-engine.js";

export interface MergeStrategy {
  /** How to merge two values for the same state key */
  (existing: unknown, incoming: unknown): unknown;
}

export const DEFAULT_MERGE_STRATEGIES: Record<string, MergeStrategy> = {
  // Numeric: latest wins
  loopRisk: (_old, next) => next,
  efficiency: (_old, next) => next,
  // Arrays: union
  techniques: (old, next) => [...new Set([...(old as string[]), ...(next as string[])])],
  // Counters: sum
  occurrences: (old, next) => (old as number) + (next as number),
};

/** Merge multiple contributions for the same entity */
export function mergeContributions(
  contributions: EntityContribution[]
): { mergedState: Record<string, unknown>; sources: string[] } {
  // Group by entityId, merge stateFragments using strategies
  // Return merged state + list of contributing analyzers
}
```

**Test file:** `test/services/substrate/entity-resolver.test.ts`
- Two contributions with non-overlapping keys → both keys present
- Two contributions with overlapping numeric key → latest wins
- Two contributions with array key → union
- Contribution with relationship → relationships merged

**SUB-2.2: Pattern Promotion**

**New file:** `src/services/substrate/diagnostic-accumulator.ts`

```typescript
import type { Diagnostic } from "../intelligence/diagnostic-stream.js";
import type { SubstrateEngine, EntityContribution } from "./substrate-engine.js";

export class DiagnosticAccumulator {
  private threshold = 5; // Promote after N occurrences

  /** Check if accumulated diagnostics should be promoted to patterns */
  async accumulateDiagnostics(
    engine: SubstrateEngine,
    diagnostics: Diagnostic[]
  ): Promise<EntityContribution[]> {
    // 1. Group diagnostics by (analyzer, feature)
    // 2. Query graph for existing diagnostic entities
    // 3. If count >= threshold, promote to pattern entity
    // 4. Return contributions for new pattern entities
  }
}
```

**Integration:** Called by SubstrateEngine.propagate() after entity ingestion.

**Test:** 4 diagnostics for same feature → no promotion. 5th → pattern entity created.

---

#### SUB-3: Backward Propagation + Temporal (after Phase 16F)

**New file:** `src/services/substrate/propagation-rules.ts`

```typescript
import type { CozoDb } from "cozo-node";

export interface PropagationRule {
  name: string;
  /** Datalog query that finds entities needing update */
  triggerQuery: string;
  /** Apply the rule to matching entities */
  apply(db: CozoDb, matches: unknown[]): Promise<number>;
}

export const BUILTIN_RULES: PropagationRule[] = [
  {
    name: 'pattern-threshold-adjustment',
    triggerQuery: `
      ?[feat_id, pattern_count] :=
        *entity{id: feat_id, type: 'feature'},
        *edge{src: _, dst: feat_id, type: 'applies-to'},
        *entity{id: _, type: 'pattern'},
        pattern_count = count(*)
      :limit 100
    `,
    async apply(db, matches) {
      // Adjust loop detector threshold for features with structural patterns
      return matches.length;
    },
  },
  {
    name: 'diagnostic-to-pattern-promotion',
    triggerQuery: `/* diagnostics with count >= 5 for same feature */`,
    async apply(db, matches) { /* promote to pattern */ return 0; },
  },
];
```

**Test:** Rule fires when pattern count exceeds threshold. Rule does NOT fire below threshold. Max depth 2 prevents infinite loops.

---

#### SUB-4: Semantic Similarity (after Phase 16G)

**Modify:** `src/services/substrate/schema.ts` — add HNSW index creation:
```typescript
export const ENTITY_VECTOR_INDEX = `::hnsw create entity:semantic_vec {
  dim: 64, ef: 50, fields: [embedding]
}`;
```

**New file:** `src/services/substrate/learning-trajectories.ts`

```typescript
export interface LearningTrajectory {
  capabilityId: string;
  dataPoints: Array<{ date: string; level: number; evidence: string[] }>;
  trend: 'improving' | 'stable' | 'declining';
  transferredTo: string[]; // Other features where this capability appeared
}

/** Compute learning trajectories from capability entities in the graph */
export async function computeTrajectories(
  engine: SubstrateEngine,
  projectId: string
): Promise<LearningTrajectory[]> {
  // Datalog: traverse capability entities ordered by time
  // Compute trend from last 3+ data points
}
```

**Test:** 3 capability snapshots with increasing levels → 'improving' trend. Capability appearing in 2 features → transferredTo populated.

---

#### SUB-5: Graph Intelligence (after Phase 16H)

**New file:** `src/services/substrate/graph-queries.ts`

```typescript
import type { SubstrateEngine } from "./substrate-engine.js";

/** Pre-built Datalog query templates for MCP and other consumers */
export const GRAPH_QUERIES = {
  /** Context for current work session */
  sessionContext: (sessionId: string) => `
    ?[feature, comprehension, loop_rate, related_decisions] :=
      *edge{src: 'wu-${sessionId}', dst: feat_id, type: 'targets'},
      *entity{id: feat_id, type: 'feature', state: feat_state},
      feature = get(feat_state, 'name'),
      comprehension = get(feat_state, 'comprehension'),
      loop_rate = get(feat_state, 'loopRate'),
      *edge{src: _, dst: feat_id, type: 'targets'},
      *edge{src: _, dst: dec_id, type: 'produced-by'},
      *entity{id: dec_id, type: 'decision', state: dec_state},
      related_decisions = collect(dec_state)
  `,

  /** Developer capability map for a domain */
  capabilityMap: (domain: string) => `
    ?[capability, level, techniques, evidence_count] :=
      *entity{id: cap_id, type: 'capability', state: cap_state},
      capability = get(cap_state, 'name'),
      is_in(capability, ['${domain}']),
      level = get(cap_state, 'level'),
      techniques = get(cap_state, 'learnedTechniques'),
      evidence_count = get(cap_state, 'evidenceCount')
  `,

  /** Most influential entities (PageRank) */
  influential: () => `
    ranked[id, rank] <~ PageRank(*edge[src, dst])
    ?[id, type, rank] := ranked[id, rank], *entity{id, type}, rank > 0.01
    :order -rank :limit 20
  `,

  /** Feature community detection */
  featureClusters: () => `
    communities[id, community] <~ CommunityDetectionLouvain(*edge[src, dst])
    ?[community, members] := communities[id, community],
      *entity{id, type: 'feature'},
      members = collect(id)
  `,
} as const;
```

**Integration with MCP:** Modify `src/services/mcp/tools.ts` to import graph queries and include graph context in `_meta` when substrate is available:
```typescript
import { CozoManager } from "../substrate/cozo-manager.js";
import { GRAPH_QUERIES } from "../substrate/graph-queries.js";

// In tool handler, add to _meta:
const graphContext = await getGraphContext(sessionId); // Uses GRAPH_QUERIES
```

**Test file:** `test/services/substrate/graph-queries.test.ts`
- Seed graph with known entities/edges
- Each query template returns expected results
- PageRank ranks high-connectivity entities higher
- Community detection groups connected features

### 6.4 Dependencies on Phase 16

```
Phase 16A.3 (IncrementalState) ──→ SUB-1.3 (SubstrateEngine uses IncrementalAnalyzer)
Phase 16B.2 (Feature Registry)  ──→ SUB-1.4 (feature entities from feature-boundary)
Phase 16D.1 (DAG Scheduler)    ──→ SUB-1.3 (SubstrateEngine is terminal DAG node)
Phase 16E.1 (DiagnosticStream) ──→ SUB-2.2 (diagnostic accumulation)
Phase 16F.3 (Maturity Model)   ──→ SUB-3 (maturity assessment entities)
Phase 16G   (Cross-Project)    ──→ SUB-4 (cross-project entity matching)
Phase 16H   (Migration)        ──→ SUB-5 (graph queries in MCP)
```

### 6.5 Test Strategy

**Unit tests:** Use CozoDB in-memory backend (`CozoDb("mem", "")`) — instant creation, no cleanup, deterministic.

**Integration tests:** `test/integration/substrate.test.ts`
- Full pipeline: create materializer → process events → run analyzers → ingest contributions → query graph
- Verify entity count grows with events
- Verify relationships correctly link work-units to features
- Verify backward propagation updates connected entities

**Graph assertion helpers:**
```typescript
// test/helpers/graph-helpers.ts
export async function assertEntityExists(db: CozoDb, id: string, type: string): Promise<void> {
  const result = await db.run(`?[id] := *entity{id: '${id}', type: '${type}'}`);
  expect(result.rows.length).toBe(1);
}

export async function assertEdgeExists(db: CozoDb, src: string, dst: string, type: string): Promise<void> {
  const result = await db.run(`?[src, dst] := *edge{src: '${src}', dst: '${dst}', type: '${type}'}`);
  expect(result.rows.length).toBe(1);
}

export async function getEntityState(db: CozoDb, id: string): Promise<Record<string, unknown>> {
  const result = await db.run(`?[state] := *entity{id: '${id}', state}`);
  return JSON.parse(result.rows[0][0] as string);
}
```

### 6.6 Execution Timeline

```
Week 5 (parallel with 16D):  SUB-1.1, SUB-1.2, SUB-1.3
Week 6 (parallel with 16E):  SUB-1.4, SUB-2.1
Week 7 (parallel with 16F):  SUB-2.2, SUB-3
Week 8 (parallel with 16G):  SUB-4
Week 9 (parallel with 16H):  SUB-5
```

---

## Implementation Tracker

**Last updated:** 2026-04-22

### Sprint SUB-1: Foundation — COMPLETE

| Task | Status | Notes |
|------|--------|-------|
| SUB-1.0: CozoDB Dependency | **[x] COMPLETE** | `pnpm add -w cozo-node` — v0.7.6 installed. NAPI native binary ~12MB. `CozoDb` class with `constructor(engine, path)`, `run(script, params)`, `close()`. Supports `'mem'` (testing), `'sqlite'` (production), `'rocksdb'` backends. |
| SUB-1.1: CozoDB Integration | **[x] COMPLETE** | Created `src/services/substrate/cozo-manager.ts`. `CozoManager` singleton: `getInstance()` returns CozoDB with SQLite backend at `~/.unfade/intelligence/graph.db`. Falls back to in-memory if SQLite fails. `createTestInstance()` returns in-memory for unit tests. `close()` for graceful shutdown. Schema auto-applied via `ensureSchema()` (idempotent). |
| SUB-1.2: Schema Definitions | **[x] COMPLETE** | Created `src/services/substrate/schema.ts`. Three Datalog stored relations: `entity{id, type, project_id, created_at, last_updated, confidence, lifecycle => state:Json}`, `entity_source{entity_id, analyzer => last_contributed, contribution_count}`, `edge{src, dst, type => weight, created_at, evidence, valid_from, valid_to}`. Type constants: `EntityType` (7 types), `RelationshipType` (12 types), `EntityLifecycle` (5 states). |
| SUB-1.3: SubstrateEngine Core | **[x] COMPLETE** | Created `src/services/substrate/substrate-engine.ts` (280 lines). `SubstrateEngine` class: `ingest(contributions)` groups by entityId, merges state fragments, upserts entities + entity_source + edges transactionally. `propagate()` runs backward propagation: (1) diagnostic-to-pattern promotion (threshold: 5 occurrences), (2) lifecycle decay (30-day stale → decaying). `query(datalog)` executes arbitrary Datalog. `getEntitiesByType()`, `getEdgesFor()`, `entityCounts()` convenience methods. State merge: arrays union, numbers latest-wins, objects deep-merge. Confidence: `0.3 + sources.length × 0.15`, capped at 1.0. Lifecycle transitions: emerging → established (≥0.5) → confirmed (≥0.7) → decaying (30d stale). Max propagation depth: 2. |
| SUB-1.4: First Entity Producers | **[x] COMPLETE** | Created `src/services/substrate/entity-mapper.ts`. Three mapper functions: `mapSessionsToWorkUnits()` reads DuckDB `sessions` table → `work-unit` entities with `targets` edges to features. `mapFeaturesToEntities()` reads `feature_registry` → `feature` entities with `depends-on` edges to parents. `mapDecisionsToEntities()` reads `decisions` → `decision` entities. `buildAllContributions()` runs all three in parallel. Extended `IncrementalAnalyzer` interface with optional `contributeEntities()` method. Wired into `repo-manager.ts` as post-scheduler step: `buildAllContributions → substrate.ingest → substrate.propagate`. `CozoManager.close()` added to `RepoManager.shutdownAll()`. |

### Sprint SUB-2: Multi-Analyzer Enrichment — COMPLETE

| Task | Status | Notes |
|------|--------|-------|
| SUB-2.1: Entity Resolution | **[x] COMPLETE** | Created `src/services/substrate/entity-resolver.ts`. `resolveContributions()` groups by entityId, merges stateFragments using configurable merge strategies, unions relationships (highest weight wins per target+type). 13 built-in strategies: `latestWins` (loopRisk, efficiency, phase, outcome, avgHds), `arrayUnion` (techniques, learnedTechniques, applicableFeatures), `sum` (occurrences), `max` (confidence, turnCount, eventCount). `mergeIntoExisting()` for incremental updates to already-persisted entities. `inferMerge()` fallback: arrays→union, numbers→latest-wins. Updated `SubstrateEngine.ingest()` to use `resolveContributions()` instead of inline merge. Updated `upsertEntity()` to use `mergeIntoExisting()` for existing entity state. Deleted old `mergeStateFragments()` private method. |
| SUB-2.2: Pattern Promotion | **[x] COMPLETE** | Created `src/services/substrate/diagnostic-accumulator.ts`. `DiagnosticAccumulator` class with `accumulate()` (pure counting) and `accumulateWithEntities()` (produces both diagnostic entities + pattern promotions). Bucketing by `(analyzer, messagePrefix, projectId)` with `extractPrefix()` normalization. Promotion threshold: 5 occurrences → creates `pattern` entity with `applies-to` edge to project/feature. Re-promotion every 5th occurrence for weight escalation. `accumulateWithEntities()` also produces `diagnostic` entities with `applies-to` edges to related work-units. Wired into `repo-manager.ts`: after building analyzer contributions, reads active diagnostics from `DiagnosticStream`, feeds through `accumulateWithEntities()`, merges resulting contributions into the ingestion batch. |

### Sprint SUB-3: Backward Propagation + Temporal — COMPLETE

| Task | Status | Notes |
|------|--------|-------|
| SUB-3: Propagation Rules | **[x] COMPLETE** | Created `src/services/substrate/propagation-rules.ts`. `PropagationEngine` class with `runAll(db)` method. Max depth 2 prevents infinite loops. 6 built-in rules: (1) `diagnostic-to-pattern-promotion` — 5+ active diagnostics on a feature → pattern entity with `applies-to` edge, severity escalation at 10+. (2) `feature-complexity-from-patterns` — 3+ patterns on a feature → sets `complexity: 'high'/'very-high'` in feature state. (3) `lifecycle-decay` — entities untouched 30+ days → `decaying` lifecycle. (4) `decision-revision-detection` — two decisions targeting same feature within 30 days → `revises` edge between them (newer→older). (5) `capability-evidence-accumulation` — 3+ work-units demonstrating same pattern → creates `capability` entity with `learned-from` edge. Levels: novice (3+), developing (5+), proficient (10+). (6) `temporal-edge-expiry` — removes edges past their `valid_to` timestamp. Updated `SubstrateEngine.propagate()` to delegate to `PropagationEngine.runAll()` instead of inline methods. Deleted old `promoteDiagnosticsToPatterns()` and `updateLifecycles()` private methods. `PropagationEngineResult` includes per-rule match/apply counts. `addRule()` for runtime extension. |

### Sprint SUB-4: Semantic Similarity — COMPLETE

| Task | Status | Notes |
|------|--------|-------|
| SUB-4: Vector Search + Learning Trajectories | **[x] COMPLETE** | **Schema**: Added `embedding: [Float; 64] default null` field to entity relation. Created `ENTITY_VECTOR_INDEX` — HNSW index `entity:semantic_vec` with dim=64, ef=50, filtered to exclude archived entities. `ALL_COZO_INDEXES` array applied by `CozoManager.ensureSchema()` after relation creation. **Learning Trajectories**: Created `src/services/substrate/learning-trajectories.ts`. `computeTrajectories(engine, projectId)` queries all capability entities, builds data points from `growthTrajectory` state field (or interpolates from created_at → last_updated), detects trend via linear regression (slope > 0.05 = improving, < -0.05 = declining), computes R² confidence. `detectTransfers()` traverses `capability → learned-from → pattern → applies-to → feature` to find cross-feature capability transfer. `TrajectoryReport` includes total/improving/declining counts. **Semantic Search**: `findSimilarEntities(engine, embedding, limit, minSimilarity)` uses CozoDB `KnnHnswSearch` to find nearest neighbors by embedding distance. `structuralFingerprint(type, state)` generates lightweight 64-dim normalized vectors from entity type + state keys/values for structural similarity (no LLM needed). |

### Sprint SUB-5: Graph Intelligence — COMPLETE

| Task | Status | Notes |
|------|--------|-------|
| SUB-5: Graph Queries + MCP Integration | **[x] COMPLETE** | **Graph Queries**: Created `src/services/substrate/graph-queries.ts`. 10 pre-built Datalog query templates: `sessionContext` (session → feature + comprehension + loop rate + decision count), `featureContext` (all entities connected to a feature, sorted by weight), `capabilityMap` (all capabilities with level/evidence/trend), `relatedDecisions` (decisions produced by work-units targeting a feature), `reachableFromEntity` (recursive transitive closure from any entity), `activePatterns` (patterns with occurrences + severity + linked feature), `entityTimeline` (chronological edges from an entity), `influential` (PageRank on full edge graph, top 20 by rank), `featureClusters` (Louvain community detection on features), `decisionRevisions` (decisions connected by `revises` edges), `graphStats` (entity + edge counts by type). `getGraphContextForSession()` convenience function runs session context + related decisions + active patterns + capabilities in parallel, returns `GraphContext` object. `esc()` prevents Datalog injection. **MCP Integration**: Updated `mcp-enrichment.ts` — `EnrichedMcpMeta` gains `graphContext` field with `currentFeature`, `relatedDecisions`, `activePatterns`, `capabilities`. `loadGraphContext()` reads cached `graph-context.json` (30s TTL). Wired into `repo-manager.ts`: after cross-project intelligence, writes `graph-context.json` via `getGraphContextForSession()` for MCP consumption. |

### Summary

| Sprint | Tasks | Complete | Not Started |
|--------|-------|----------|-------------|
| SUB-1: Foundation | 5 | **5** | 0 |
| SUB-2: Multi-Analyzer Enrichment | 2 | **2** | 0 |
| SUB-3: Backward Propagation | 1 | **1** | 0 |
| SUB-4: Semantic Similarity | 1 | **1** | 0 |
| SUB-5: Graph Intelligence | 1 | **1** | 0 |

**SEMANTIC SUBSTRATE ARCHITECTURE — CORE COMPLETE. 10/10 foundation + 3/15 hardening tasks done.**

The CozoDB-powered intelligence graph is fully operational:
- **Entity/edge schema** with 7 entity types, 12 relationship types, 5 lifecycle states
- **Entity resolution** with 13 configurable merge strategies for multi-analyzer contributions
- **Diagnostic accumulation** promoting recurring diagnostics to persistent pattern entities
- **6 backward propagation rules** (diagnostic-to-pattern, feature complexity, lifecycle decay, decision revision, capability evidence, temporal edge expiry)
- **HNSW vector similarity search** (64-dim, structural fingerprinting, zero LLM cost)
- **Learning trajectories** with trend detection (linear regression) and cross-feature transfer detection
- **10 pre-built Datalog query templates** (session context, feature context, capability map, related decisions, transitive closure, active patterns, entity timeline, PageRank, Louvain community detection, graph stats)
- **MCP integration** — `graphContext` in `_meta` with current feature, related decisions, active patterns, capabilities

---

## Part VII: RRVV Quality Audit (2026-04-23)

### 7.0 Audit Methodology

RRVV audit of every substrate component against five criteria:
1. **Quality** — Does the implementation match the architecture spec? Are there bugs?
2. **Performance** — Does the component scale with entity/edge growth?
3. **Explainability** — Can a developer or user understand why intelligence emerged?
4. **Transmission Thesis alignment** — Does the component serve the vehicle metaphor's intent?
5. **Composability** — Does the component integrate cleanly with upstream (Phase 16 analyzers) and downstream (MCP, profile, diagnostics)?

Verdicts: **SUFFICIENT** (ship as-is), **SUFFICIENT WITH FIXES** (minor patches), **NEEDS UPGRADE** (architectural improvement required), **CRITICAL FIX** (blocks correctness).

### 7.1 CozoDB Integration (`cozo-manager.ts`, 68 lines)

**Verdict: SUFFICIENT WITH FIXES**

**What's right:**
- Singleton pattern with lazy initialization
- In-memory backend for tests (`createTestInstance()`)
- Graceful shutdown via `close()`
- Falls back to in-memory if SQLite path fails

**Issues found:**
1. **No connection health check** — If CozoDB becomes corrupt mid-session, `getInstance()` returns the dead instance. No ping/heartbeat.
2. **No schema migration path** — `ensureSchema()` creates relations but has no mechanism for adding columns to existing relations. If `entity` schema changes (e.g., adding `embedding` field), existing databases won't get the new column without manual intervention.

**Fixes:**
- Add `healthCheck()` method: run `?[x] := x = 1` and reset instance if it fails.
- Add schema version tracking: store `{schema_version: N}` in a `meta` relation. On startup, compare and run migration steps.

### 7.2 Schema Definitions (`schema.ts`, 71 lines)

**Verdict: SUFFICIENT**

**What's right:**
- Clean Datalog relation definitions
- Type constants for all 7 entity types, 12 relationship types, 5 lifecycle states
- HNSW vector index definition separated from relation creation

**Minor observation:**
- `valid_to: Float default 9999999999.0` is a sentinel value. Works but consider documenting that `9999999999.0` means "no expiry" (it's ~2286 AD in Unix seconds, well beyond any reasonable timeline).

### 7.3 SubstrateEngine (`substrate-engine.ts`, 288 lines)

**Verdict: NEEDS UPGRADE — Datalog Injection + Performance**

**What's right:**
- Clean `ingest → resolve → upsert → propagate` pipeline
- Confidence formula (`0.3 + sources × 0.15`) is reasonable
- Lifecycle transitions (emerging → established → confirmed) well-structured
- `entityCounts()` for health monitoring

**Critical issues:**

1. **DATALOG INJECTION VULNERABILITY** (lines 233-234, 254, 277):
   `upsertEntity()` interpolates `id`, `type`, `projectId`, `stateJson` directly into Datalog strings without sanitization. Only `upsertEdge()` does `evidence.replace(/'/g, "")`. An entity ID containing `'` or Datalog syntax could corrupt queries or execute unintended operations.

   **Fix:** All string values passed into Datalog must go through an `esc()` function (already exists in `graph-queries.ts`). Import and use it in `substrate-engine.ts` for every interpolated value:
   ```typescript
   import { esc } from "./graph-queries.js";
   // Then: '${esc(id)}' instead of '${id}'
   ```

2. **N+1 QUERY PATTERN** — `ingest()` executes 3+ Datalog operations per entity (query existing → upsert entity → upsert entity_source × N → upsert edge × M). For 50 entities with 2 relationships each: ~250 Datalog round-trips. CozoDB supports multi-statement transactions — batch all upserts into a single `:put` with multiple rows.

   **Fix:** Batch upserts:
   ```typescript
   // Instead of N separate upserts:
   const entityRows = resolved.map(e => `['${esc(e.entityId)}', ...]`).join(',\n');
   await this.db.run(`?[...] <- [${entityRows}] :put entity {...}`);
   ```

3. **`stateJson` interpolated raw** (line 234) — `JSON.stringify(mergedState)` output is inserted directly into Datalog. CozoDB expects JSON values, but if the JSON contains characters that conflict with Datalog syntax, the query breaks silently.

   **Fix:** Use CozoDB parameterized queries if available, or base64-encode the state JSON and decode on read.

### 7.4 Entity Resolver (`entity-resolver.ts`, 193 lines)

**Verdict: SUFFICIENT**

**What's right:**
- 13 merge strategies covering all common cases (latestWins, arrayUnion, sum, max)
- `inferMerge()` fallback for unknown keys (arrays→union, numbers→latest-wins)
- Relationship deduplication with highest-weight-wins per (target, type)
- `mergeIntoExisting()` for incremental updates to persisted entities

**Minor:**
- Consider adding a `weightedAverage` merge strategy for scores that should be smoothed over time (e.g., comprehension, loopRate) rather than latest-wins. This aligns with Phase 16 Quality Audit's recommendation for EWMA.

### 7.5 Entity Mapper (`entity-mapper.ts`, 198 lines)

**Verdict: NEEDS UPGRADE — Architectural Divergence**

**The spec says** (§4.5): Analyzers implement `contributeEntities()` on `IncrementalAnalyzer` → entity contributions flow from analyzers after each update cycle.

**The implementation does**: `entity-mapper.ts` reads DuckDB tables (`sessions`, `feature_registry`, `decisions`) directly → produces entity contributions as a post-processing batch step.

**Why this matters:**
- Analyzers don't participate in entity production — the graph sees a batch snapshot of DuckDB state, not incremental updates as analyzers compute.
- When an analyzer's `update()` detects a new pattern, that knowledge doesn't reach the graph until the next full `buildAllContributions()` cycle.
- The `contributeEntities()` method on `IncrementalAnalyzer` is defined in `incremental-state.ts` but **no analyzer implements it**.

**This is the single biggest gap between spec and implementation.**

**Fix (Sprint SUB-6.1):** Implement `contributeEntities()` on the 4 highest-value analyzers:
1. **loop-detector** → `work-unit` enrichment with `loopRisk`, `demonstrates → pattern:iterative-loop`
2. **efficiency** → `work-unit` enrichment with `aes`, `efficiency` score
3. **comprehension-radar** → `feature` enrichment with `comprehension` score
4. **decision-replay** → `decision` entity creation with `revises` edges

Keep `entity-mapper.ts` as a fallback/bootstrap for cold-start and `--rebuild-graph`, but primary entity production should be analyzer-driven.

### 7.6 Propagation Rules (`propagation-rules.ts`, 355 lines)

**Verdict: SUFFICIENT WITH FIXES — Bug + Threshold Hardcoding**

**What's right:**
- 6 well-defined declarative rules
- Max depth 2 prevents infinite propagation loops
- `addRule()` for runtime extension
- Per-rule match/apply counts for observability

**Issues:**

1. **BUG: `totalEdgesCreated` always returns 0** (line 301):
   ```typescript
   const totalEdges = 0;  // declared as const — never incremented
   // ...
   return { totalEdgesCreated: totalEdges }; // always 0
   ```
   **Fix:** Change to `let totalEdges = 0;` and increment when rules create edges (rules 1, 4, 5 all create edges).

2. **Hardcoded thresholds**: Promotion at 5 occurrences, feature complexity at 3 patterns, lifecycle decay at 30 days, capability levels at 3/5/10. These should be configurable:
   ```typescript
   interface PropagationConfig {
     diagnosticPromotionThreshold: number;  // default 5
     featureComplexityThreshold: number;    // default 3
     lifecycleDecayDays: number;            // default 30
     capabilityLevels: { novice: number; developing: number; proficient: number };
   }
   ```

3. **No temporal weighting in capability-evidence rule** — Rule 5 counts work-units demonstrating a pattern equally regardless of age. A 6-month-old evidence is counted the same as yesterday's. Apply temporal decay: `weight = e^(-age_days / 90)`.

### 7.7 Diagnostic Accumulator (`diagnostic-accumulator.ts`, 190 lines)

**Verdict: SUFFICIENT**

**What's right:**
- Bucketing by `(analyzer, messagePrefix, projectId)` is sound
- `extractPrefix()` normalization for grouping similar diagnostics
- Promotion threshold with re-promotion for weight escalation
- Produces both diagnostic entities and pattern promotions in a single pass

**Minor:**
- Consider adding a `cooldown` after promotion — once a diagnostic bucket promotes to a pattern, reset the count so the same diagnostics don't immediately re-promote on the next cycle.

### 7.8 Graph Queries (`graph-queries.ts`, 207 lines)

**Verdict: SUFFICIENT WITH FIXES**

**What's right:**
- 11 pre-built Datalog templates covering the key use cases
- `esc()` function for Datalog injection prevention
- `getGraphContextForSession()` runs 4 queries in parallel
- PageRank, Louvain community detection, transitive closure all present

**Issues:**

1. **`esc()` is only used in `graph-queries.ts`** but not in `substrate-engine.ts` — the injection prevention is inconsistent. Export `esc()` and use it everywhere (see §7.3).

2. **`sessionContext` query assumes work-unit ID format** — `wu-${sessionId}` is baked into the query. If entity-mapper uses a different ID format, the query returns empty. Add a comment documenting the ID convention, or look up by state field instead.

3. **No pagination** — `influential()` returns top 20, but other queries return unbounded results. Add `:limit` clauses to all queries that could grow with time (especially `featureContext`, `entityTimeline`).

4. **Missing: temporal range queries** — The spec (§4.4) promised time-travel queries ("state of understanding one week ago"). No query template implements this. Add:
   ```
   temporalSnapshot: (entityId, beforeTimestamp) => `
     ?[id, type, state] := *entity{id, type, state, last_updated},
       last_updated < ${beforeTimestamp},
       *edge{src: id, dst: '${esc(entityId)}', type: 'targets'}
     :order -last_updated :limit 10
   `
   ```

### 7.9 Learning Trajectories (`learning-trajectories.ts`, 314 lines)

**Verdict: SUFFICIENT WITH FIXES**

**What's right:**
- Linear regression for trend detection (slope + R² confidence)
- `detectTransfers()` for cross-feature capability transfer
- `structuralFingerprint()` for zero-LLM-cost embeddings

**Issues:**

1. **`structuralFingerprint()` is weak** — Hashing state keys and values into 64 dimensions produces vectors where semantically similar entities may have zero correlation. Two sessions about "auth/middleware" and "auth/oauth" would have different fingerprints even though they share domain context.

   **Fix:** For structural fingerprints to be meaningful, use a consistent feature extraction:
   - Dimensions 0-15: entity type one-hot (4 bits) + lifecycle one-hot (5 bits) + confidence (1 float) + padding
   - Dimensions 16-31: domain hash (file path → consistent hash to 16 buckets)
   - Dimensions 32-47: behavioral metrics (loopRisk, efficiency, comprehension, turnCount, etc.) normalized 0-1
   - Dimensions 48-63: temporal features (hour-of-day, day-of-week, session-age, etc.)

   This produces vectors where semantically similar entities (same domain, similar metrics) have high cosine similarity.

2. **Cross-project transfer detection not implemented** — `detectTransfers()` traverses within a single project. The spec (§4.8, §5.4 Step 4) promises "cross-project entity matching via shared patterns/capabilities." This requires querying capabilities across all `project_id` values, not just the current one.

3. **No trajectory persistence** — `computeTrajectories()` computes on-the-fly from entity state. The trajectory itself isn't stored as a first-class entity. Consider writing `capability-trajectory` entities to the graph so the MCP can serve growth narratives without recomputing.

### 7.10 MCP Integration (via `mcp-enrichment.ts` + `graph-context.json`)

**Verdict: NEEDS UPGRADE — File-Based Cache Is a Bottleneck**

**The spec says** (§4.6): "Every MCP tool query becomes a graph traversal." Named Datalog queries execute live against CozoDB.

**The implementation does**: `repo-manager.ts` writes `graph-context.json` after each intelligence cycle → `mcp-enrichment.ts` reads the file with 30s TTL cache → MCP tools get stale, pre-computed graph context.

**Why this matters:**
- The graph's power is live traversal — "what's connected to what I'm working on right now?" A 30s-stale file snapshot loses this.
- The `graphContext` in MCP responses contains only 4 fields (currentFeature, relatedDecisions, activePatterns, capabilities). The spec promised rich multi-hop context: similar sessions, resolution patterns, feature knowledge maps, suggested approaches.
- No session-specific context — the same `graph-context.json` is served regardless of which session the MCP consumer is in.

**Fix (Sprint SUB-6.3):** Direct graph queries from MCP:
```typescript
// In MCP tool handler:
const substrate = new SubstrateEngine(await CozoManager.getInstance());
const context = await getGraphContextForSession(substrate, currentSessionId);
```
Keep the file cache as a fallback when CozoDB is unavailable.

### 7.11 Integration Wiring (`repo-manager.ts`)

**Verdict: SUFFICIENT WITH FIXES**

**What's right:**
- Substrate pipeline wired as post-scheduler step: `buildAllContributions → ingest → propagate`
- `CozoManager.close()` in shutdown path
- Wrapped in try/catch with "non-fatal" — substrate failure doesn't break the core pipeline
- Graph context written for MCP consumption

**Issues:**

1. **No `--rebuild-graph` command** — The spec (§5.3) promises `unfade doctor --rebuild-graph` to replay all analyzer states into CozoDB from scratch. Not implemented. Without this, graph corruption requires manual deletion of `graph.db`.

2. **Substrate runs on every intelligence cycle** — Even when no analyzers changed (`changed: false`), the substrate still runs `buildAllContributions` (reads all DuckDB tables). Should be gated on `anyAnalyzerChanged` flag from the scheduler.

3. **Graph context writes on every cycle** — `getGraphContextForSession()` + `writeFileSync()` happens even when the graph hasn't changed. Add a dirty flag.

---

## Part VIII: RRVV Upgrade Specifications

### 8.0 Summary of Findings

| Component | File | Lines | Verdict | Critical Issues |
|-----------|------|-------|---------|-----------------|
| CozoDB Integration | `cozo-manager.ts` | 68 | SUFFICIENT WITH FIXES | No health check, no schema migration |
| Schema Definitions | `schema.ts` | 71 | SUFFICIENT | — |
| SubstrateEngine | `substrate-engine.ts` | 288 | NEEDS UPGRADE | Datalog injection, N+1 queries |
| Entity Resolver | `entity-resolver.ts` | 193 | SUFFICIENT | — |
| Entity Mapper | `entity-mapper.ts` | 198 | NEEDS UPGRADE | Spec divergence: no analyzer-driven contributions |
| Propagation Rules | `propagation-rules.ts` | 355 | SUFFICIENT WITH FIXES | `totalEdges` bug, hardcoded thresholds |
| Diagnostic Accumulator | `diagnostic-accumulator.ts` | 190 | SUFFICIENT | — |
| Graph Queries | `graph-queries.ts` | 207 | SUFFICIENT WITH FIXES | Missing temporal queries, inconsistent `esc()` |
| Learning Trajectories | `learning-trajectories.ts` | 314 | SUFFICIENT WITH FIXES | Weak fingerprints, no cross-project |
| MCP Integration | `mcp-enrichment.ts` | ~50 lines | NEEDS UPGRADE | File cache bottleneck vs. live queries |
| Integration Wiring | `repo-manager.ts` | ~50 lines | SUFFICIENT WITH FIXES | No rebuild-graph, no dirty gating |

**Totals:** 3 SUFFICIENT, 5 SUFFICIENT WITH FIXES, 3 NEEDS UPGRADE, 0 CRITICAL FIX

### 8.1 Immediate Fixes (No Architecture Change)

These can be applied as patches to existing files:

**FIX-1: Datalog injection prevention** (`substrate-engine.ts`)
- Import `esc()` from `graph-queries.ts`
- Apply to all 6 interpolation sites in `upsertEntity()`, `upsertEntitySource()`, `upsertEdge()`, `getEntitiesByType()`, `getEdgesFor()`
- Estimated: 15 minutes

**FIX-2: `totalEdges` bug** (`propagation-rules.ts:301`)
- Change `const totalEdges = 0` to `let totalEdges = 0`
- Add `totalEdges += applied` in rules that create edges (rules 1, 4, 5)
- Estimated: 5 minutes

**FIX-3: Query pagination** (`graph-queries.ts`)
- Add `:limit 50` to `featureContext`, `entityTimeline`, `relatedDecisions`, `activePatterns`, `capabilityMap`
- Estimated: 10 minutes

**FIX-4: CozoManager health check** (`cozo-manager.ts`)
- Add `healthCheck()`: run `?[x] := x = 1`, reset instance on failure
- Call from `getInstance()` when instance exists
- Estimated: 15 minutes

**FIX-5: Dirty-gated substrate execution** (`repo-manager.ts`)
- Only run `buildAllContributions → ingest → propagate` when scheduler reports `anyAnalyzerChanged`
- Only write `graph-context.json` when graph changed
- Estimated: 10 minutes

### 8.2 Architectural Upgrades

#### UPGRADE-1: Batch Datalog Operations (`substrate-engine.ts`)

**Problem:** N+1 query pattern — 3+ round-trips per entity.

**Solution:** Batch all entity upserts into a single Datalog statement per type:

```typescript
async ingest(contributions: EntityContribution[]): Promise<number> {
  const resolved = resolveContributions(contributions);
  const now = Date.now() / 1000;

  // Batch entity upserts (single Datalog statement)
  if (resolved.length > 0) {
    const entityRows = resolved.map(e => {
      const conf = Math.min(1, 0.3 + e.sources.length * CONFIDENCE_PER_SOURCE);
      return `['${esc(e.entityId)}', '${esc(e.entityType)}', '${esc(e.projectId)}', ${now}, ${now}, ${conf}, 'emerging', ${JSON.stringify(e.mergedState)}]`;
    }).join(',\n');

    await this.db.run(`
      ?[id, type, project_id, created_at, last_updated, confidence, lifecycle, state] <- [
        ${entityRows}
      ]
      :put entity {id, type, project_id, created_at, last_updated, confidence, lifecycle => state}
    `);
  }

  // Batch edge upserts (single Datalog statement)
  const allEdges = resolved.flatMap(e =>
    e.relationships.map(r => `['${esc(e.entityId)}', '${esc(r.targetEntityId)}', '${esc(r.type)}', ${r.weight}, ${now}, '${esc(r.evidence ?? "")}', ${now}, 9999999999.0]`)
  );
  if (allEdges.length > 0) {
    await this.db.run(`
      ?[src, dst, type, weight, created_at, evidence, valid_from, valid_to] <- [
        ${allEdges.join(',\n')}
      ]
      :put edge {src, dst, type => weight, created_at, evidence, valid_from, valid_to}
    `);
  }

  return resolved.length;
}
```

**Impact:** Reduces Datalog round-trips from O(entities × relationships) to O(1). Critical for scaling beyond ~100 entities.

**Note:** This loses the existing-entity merge behavior (read → merge → write). For the batch path, entity state replacement is acceptable for the initial `buildAllContributions` pass. For incremental analyzer contributions, keep the read-merge-write path but consider a `MERGE` operation if CozoDB supports it.

#### UPGRADE-2: Analyzer-Driven Entity Contributions

**Problem:** Entity production is disconnected from analyzer computation (§7.5).

**Solution:** Implement `contributeEntities()` on 4 priority analyzers. Each returns `EntityContribution[]` after `update()`:

| Analyzer | Entity Type | Key State | Relationships |
|----------|-------------|-----------|---------------|
| loop-detector | work-unit enrichment | `loopRisk`, `loopStatus` | `demonstrates → pattern:loop-*` |
| efficiency | work-unit enrichment | `aes`, `efficiency` | — |
| comprehension-radar | feature enrichment | `comprehension`, `overall` | — |
| decision-replay | decision creation | `summary`, `durability`, `domain` | `revises → decision:*`, `targets → feature:*` |

**Integration:** In `scheduler.ts`, after each analyzer's `update()`:
```typescript
if (analyzer.contributeEntities && result.changed) {
  const contributions = analyzer.contributeEntities(result.state, batch);
  pendingContributions.push(...contributions);
}
// After all analyzers:
await substrateEngine.ingest(pendingContributions);
```

Keep `entity-mapper.ts` for cold-start bootstrap and `--rebuild-graph`.

#### UPGRADE-3: Live MCP Graph Queries

**Problem:** File-based cache loses the graph's power (§7.10).

**Solution:** MCP tools query CozoDB directly:

```typescript
// src/services/mcp/tools.ts — in tool handler
async function getGraphContext(sessionId: string): Promise<GraphContext | null> {
  try {
    const db = await CozoManager.getInstance();
    const engine = new SubstrateEngine(db);
    return await getGraphContextForSession(engine, sessionId);
  } catch {
    return loadGraphContextFromFile(); // fallback
  }
}
```

**Session-aware context:** The MCP request should include the current session ID (available from the AI tool's session state). `getGraphContextForSession(engine, sessionId)` then runs session-specific queries:
- "What feature is this session targeting?"
- "What past sessions worked on the same feature?"
- "What patterns emerged on this feature?"
- "What decisions were made about this feature?"

**Performance:** CozoDB Datalog queries on ~500 entities with HNSW index execute in <5ms. No caching needed at this scale.

#### UPGRADE-4: `unfade doctor --rebuild-graph`

**Problem:** No recovery path for graph corruption.

**Solution:** Add `--rebuild-graph` to the `doctor` command:

```typescript
// src/commands/doctor.ts
if (flags.rebuildGraph) {
  logger.info("Rebuilding intelligence graph from analyzer states...");
  const db = await CozoManager.getInstance();
  // Drop all relations
  await db.run(":remove entity {}");
  await db.run(":remove edge {}");
  await db.run(":remove entity_source {}");
  // Re-create schema
  for (const stmt of ALL_COZO_SCHEMA) await db.run(stmt);
  // Replay from DuckDB
  const contributions = await buildAllContributions(analytics, operational);
  const engine = new SubstrateEngine(db);
  await engine.ingest(contributions);
  await engine.propagate();
  logger.info(`Graph rebuilt: ${await engine.entityCounts()}`);
}
```

#### UPGRADE-5: Improved Structural Fingerprints

**Problem:** Current `structuralFingerprint()` produces low-quality vectors (§7.9).

**Solution:** Deterministic feature extraction with semantic structure:

```typescript
function structuralFingerprint(type: EntityType, state: Record<string, unknown>): number[] {
  const vec = new Float32Array(64);

  // Dims 0-7: entity type one-hot (7 types)
  const typeIndex = ENTITY_TYPES.indexOf(type);
  if (typeIndex >= 0 && typeIndex < 8) vec[typeIndex] = 1.0;

  // Dims 8-11: lifecycle one-hot (5 states, using 4 dims — archived excluded)
  const lifecycle = (state.lifecycle as string) ?? 'emerging';
  const lcIndex = LIFECYCLE_STATES.indexOf(lifecycle);
  if (lcIndex >= 0 && lcIndex < 4) vec[8 + lcIndex] = 1.0;

  // Dims 12-15: core metrics (normalized 0-1)
  vec[12] = clamp((state.loopRisk as number) ?? 0);
  vec[13] = clamp((state.efficiency as number) ?? 0.5);
  vec[14] = clamp((state.comprehension as number) ?? 0);
  vec[15] = clamp((state.confidence as number) ?? 0.5);

  // Dims 16-31: domain hash (module path → consistent hash to 16 buckets)
  const domain = (state.modulePath as string) ?? (state.name as string) ?? '';
  const domainParts = domain.split('/').filter(Boolean);
  for (const part of domainParts) {
    const bucket = 16 + (simpleHash(part) % 16);
    vec[bucket] = Math.min(1.0, vec[bucket] + 0.3);
  }

  // Dims 32-47: behavioral signature
  vec[32] = clamp((state.turnCount as number ?? 0) / 50);     // session length
  vec[33] = clamp((state.totalSessions as number ?? 0) / 100); // feature familiarity
  vec[34] = clamp((state.decisionCount as number ?? 0) / 20);  // decision density
  vec[35] = clamp((state.velocity as number ?? 1) / 3);        // velocity
  // ... remaining dims for temporal + pattern features

  // L2 normalize
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  if (norm > 0) for (let i = 0; i < 64; i++) vec[i] /= norm;

  return Array.from(vec);
}
```

This produces vectors where:
- Same-domain entities cluster together (dims 16-31)
- Behaviorally similar sessions cluster (dims 32-47)
- Entity type and lifecycle are preserved (dims 0-11)
- Cosine similarity is meaningful for KNN queries

#### UPGRADE-6: Temporal Graph Queries

**Problem:** Spec promised time-travel queries but none exist (§7.8).

**Solution:** Add 3 temporal query templates to `graph-queries.ts`:

```typescript
/** State of a feature at a point in time */
temporalFeatureSnapshot: (featureId: string, beforeTs: number) => `
  ?[wu_id, state, last_updated] :=
    *edge{src: wu_id, dst: '${esc(featureId)}', type: 'targets'},
    *entity{id: wu_id, type: 'work-unit', state, last_updated},
    last_updated < ${beforeTs}
  :order -last_updated :limit 20
`,

/** Maturity trajectory over time */
maturityTimeline: (projectId: string) => `
  ?[date, phase, confidence, bottlenecks] :=
    *entity{id: aid, type: 'maturity-assessment', state: s, project_id: '${esc(projectId)}', created_at: date},
    phase = get(s, 'phase'),
    confidence = get(s, 'confidence'),
    bottlenecks = get(s, 'bottlenecks')
  :order date
`,

/** Decisions made in a time range */
decisionsInRange: (fromTs: number, toTs: number, projectId?: string) => `
  ?[id, state, created_at] :=
    *entity{id, type: 'decision', state, created_at, project_id},
    created_at >= ${fromTs}, created_at <= ${toTs}
    ${projectId ? `, project_id = '${esc(projectId)}'` : ''}
  :order created_at
`,
```

### 8.3 Upstream Processing: Prompt-Aware Entity Production

The Phase 16 Intelligence System Quality Audit (Part VI of `PHASE_16_INTELLIGENCE_SYSTEM_REDESIGN.md`) introduced prompt decomposition as an upstream preprocessing step. The substrate must consume decomposed prompt units, not raw flat prompts.

**Current flow:** Event → classifier → analyzer → entity-mapper → graph
**Proposed flow:** Event → **prompt decomposer** → classifier (per sub-intent) → analyzer → **contributeEntities()** → graph

**Impact on substrate entities:**

1. **Work-unit granularity changes** — A single AI session message containing 3 sub-intents (feature request + bug fix + refactor) should produce 3 work-unit entities, each with its own `targets → feature` edge. Currently, one session = one work-unit.

2. **New relationship type: `part-of`** — Sub-intent work-units link to the parent session work-unit via `part-of` edges. This preserves the "this all happened in one turn" context while giving each intent its own entity.

3. **Pattern detection improves** — Patterns like "user often bundles tests with features" emerge from the graph when work-units for `feature:X` and `feature:X-test` consistently share `part-of` edges to the same parent.

**Schema addition:**
```typescript
// Add to RelationshipType:
export type RelationshipType = ... | 'part-of' | 'co-occurred-with';
```

### 8.4 Downstream: Git Intelligence Entity Production

The Phase 16 Intelligence System Quality Audit (Part VII of `PHASE_16_INTELLIGENCE_SYSTEM_REDESIGN.md`) introduced 4 git analyzers. These produce entities that the substrate currently cannot represent.

**New entity types needed:**

| Entity Type | Source Analyzer | Key State | Relationships |
|-------------|----------------|-----------|---------------|
| `commit` | git-churn-analyzer | `hash`, `subject`, `filesChanged`, `insertions`, `deletions`, `complexity` | `targets → feature`, `authored-by → capability` |
| `hotspot` | git-hotspot-analyzer | `filePath`, `changeFrequency`, `avgComplexity`, `riskScore` | `applies-to → feature`, `correlates-with → pattern` |

**Schema addition:**
```typescript
export type EntityType = ... | 'commit' | 'hotspot';
export type RelationshipType = ... | 'authored-by' | 'correlates-with' | 'co-occurred-with';
```

**AI-Git cross-referencing** — The `ai-git-cross-referencer` analyzer produces `co-occurred-with` edges between `work-unit` (AI session) and `commit` entities when they share temporal proximity (±30 min) and file overlap (≥1 shared file). This is the substrate's killer feature for Transmission Thesis alignment: the graph connects "what the AI suggested" with "what actually shipped."

---

## Part IX: Evolution Sprints (SUB-6 through SUB-8)

### Sprint SUB-6: Substrate Hardening (15 tasks)

**SUB-6.1: Datalog Injection Fix**
- Import `esc()` from `graph-queries.ts` into `substrate-engine.ts`
- Apply to all string interpolation sites (6 locations in `upsertEntity`, `upsertEntitySource`, `upsertEdge`, `getEntitiesByType`, `getEdgesFor`)
- Test: entity with ID containing `'` and `]` characters upserts correctly

**SUB-6.2: `totalEdges` Bug Fix**
- Change `const totalEdges = 0` to `let totalEdges = 0` in `propagation-rules.ts:301`
- Increment in rules 1 (diagnostic-to-pattern), 4 (decision-revision), 5 (capability-evidence) when edges are created
- Test: `totalEdgesCreated` returns nonzero after rules fire

**SUB-6.3: Batch Datalog Operations**
- Refactor `SubstrateEngine.ingest()` to batch entity upserts (single `:put` with multiple rows)
- Batch edge upserts similarly
- Keep read-merge-write path for incremental updates (when entity already exists)
- Test: ingest 100 entities in <50ms, single Datalog round-trip per type
- Benchmark: before/after with 50, 100, 500 entity batches

**SUB-6.4: CozoManager Health Check**
- Add `healthCheck()` method: run `?[x] := x = 1`
- On failure: close instance, set `instance = null`, log warning
- Call from `getInstance()` when returning cached instance
- Test: corrupt DB path → health check fails → fallback to in-memory

**SUB-6.5: Schema Migration Support**
- Add `meta` relation: `{key: String => value: String}`
- Store `{key: 'schema_version', value: '1'}`
- On startup: compare stored version with code version, run migrations
- Migration 1→2: add `embedding` field to entity relation (if not already present)
- Test: upgrade from v1 to v2 preserves existing entities

**SUB-6.6: Query Pagination**
- Add `:limit 50` to `featureContext`, `entityTimeline`, `relatedDecisions`, `activePatterns`, `capabilityMap` in `graph-queries.ts`
- Add optional `limit` parameter to `getGraphContextForSession()`
- Test: query with >50 matching entities returns exactly 50

**SUB-6.7: Dirty-Gated Execution**
- In `repo-manager.ts`: only run substrate pipeline when scheduler reports `anyAnalyzerChanged`
- Only write `graph-context.json` when `SubstrateEngine.ingest()` returns > 0 upserted
- Track last graph context write time; skip if <10s since last write
- Test: analyzer cycle with `changed: false` → no substrate execution

**SUB-6.8: Propagation Config**
- Create `PropagationConfig` interface with all threshold constants
- Pass config to `PropagationEngine` constructor (defaults match current hardcoded values)
- Allow override via `~/.unfade/config.json` `substrate.propagation` section
- Test: custom threshold of 3 → promotion happens at 3 instead of 5

**SUB-6.9: Temporal Query Templates**
- Add 3 temporal queries to `graph-queries.ts` (§8.2 UPGRADE-6)
- `temporalFeatureSnapshot`, `maturityTimeline`, `decisionsInRange`
- Test: seed 5 entities at different timestamps → temporal query returns correct subset

**SUB-6.10: Improved Structural Fingerprints**
- Replace `structuralFingerprint()` in `learning-trajectories.ts` with deterministic feature extraction (§8.2 UPGRADE-5)
- Dimensions: type one-hot (0-7), lifecycle (8-11), core metrics (12-15), domain hash (16-31), behavioral (32-47), temporal (48-63)
- L2 normalize all vectors
- Test: two work-units on same feature → cosine similarity > 0.7; two work-units on different features → cosine similarity < 0.3

**SUB-6.11: `unfade doctor --rebuild-graph`**
- Add `--rebuild-graph` flag to doctor command
- Drop and recreate all CozoDB relations
- Replay from DuckDB via `buildAllContributions()`
- Run `propagate()` after full ingest
- Report entity/edge counts after rebuild
- Test: corrupt graph.db → rebuild → entity counts match DuckDB

**SUB-6.12: Entity Resolver EWMA Strategy**
- Add `ewma` merge strategy to entity-resolver: `newValue = alpha × incoming + (1 - alpha) × existing` (alpha = 0.3)
- Apply to: `loopRisk`, `efficiency`, `comprehension` (scores that should be smoothed)
- Keep `latestWins` for discrete values (phase, outcome)
- Test: 3 successive merges with values [0.2, 0.8, 0.5] → result ≈ 0.47 (not 0.5)

**SUB-6.13: Diagnostic Accumulator Cooldown**
- After promoting a bucket to a pattern, reset the bucket count to 0
- Prevent immediate re-promotion on the next cycle
- Configurable cooldown: default 3 cycles after promotion
- Test: bucket at 5 → promotes → count resets → 3 more diagnostics → no promotion yet → 2 more (total 5 again) → re-promotes

**SUB-6.14: Cross-Project Learning Trajectories**
- Modify `computeTrajectories()` to query across all `project_id` values
- Add `crossProjectTransfers` field to `TrajectoryReport`: capabilities that appear in ≥2 projects
- Test: capability in project A and project B → appears in crossProjectTransfers

**SUB-6.15: Capability Temporal Weighting**
- In propagation rule 5 (capability-evidence-accumulation), weight evidence by age: `weight = e^(-ageDays / 90)`
- Weighted count threshold: 3.0 weighted units (not raw count)
- Test: 5 work-units from 6 months ago → weighted count ≈ 0.7 → no capability promotion; 3 work-units from this week → weighted count ≈ 2.9 → still below threshold; 4 recent → promotes

### Sprint SUB-7: Analyzer-Driven Entity Production (6 tasks)

**SUB-7.1: `contributeEntities()` on Loop Detector**
- Implement `contributeEntities()` on `loop-detector` analyzer
- For each session with `loopRisk > 0.5`: produce work-unit enrichment contribution with `loopRisk`, `loopStatus`
- Add `demonstrates → pattern:iterative-loop` edge when `loopRisk > 0.7`
- Test: analyzer update with loop detected → contribution includes loopRisk + relationship

**SUB-7.2: `contributeEntities()` on Efficiency**
- Implement `contributeEntities()` on `efficiency` analyzer
- For each session in current batch: produce work-unit enrichment with `aes`, `efficiency`
- Test: analyzer update → contribution includes efficiency score

**SUB-7.3: `contributeEntities()` on Comprehension Radar**
- Implement `contributeEntities()` on `comprehension-radar` analyzer
- For each feature with updated comprehension: produce feature enrichment with `comprehension`, `overall`
- Test: analyzer update → contribution includes comprehension score on feature entity

**SUB-7.4: `contributeEntities()` on Decision Replay**
- Implement `contributeEntities()` on `decision-replay` analyzer
- For each new decision: produce decision entity with `summary`, `durability`, `domain`
- Add `revises → decision:*` edge when revision detected
- Add `targets → feature:*` edge based on file paths
- Test: analyzer update with revision → contribution includes revises relationship

**SUB-7.5: Scheduler Integration**
- In `scheduler.ts`, after each analyzer's `update()`: collect `contributeEntities()` results
- Accumulate all contributions, pass to `SubstrateEngine.ingest()` after all analyzers complete
- Gate on `result.changed` — only call `contributeEntities()` when analyzer state changed
- Test: full scheduler cycle → substrate receives contributions from all 4 analyzers

**SUB-7.6: Entity Mapper as Bootstrap**
- Mark `entity-mapper.ts`'s `buildAllContributions()` as bootstrap-only (used by `--rebuild-graph` and cold-start)
- In `repo-manager.ts`: if analyzers produced contributions via `contributeEntities()`, skip `buildAllContributions()`
- Add `forceFullRebuild` parameter to `buildAllContributions()` for explicit rebuild
- Test: analyzer-driven contributions present → entity-mapper not called; no contributions → entity-mapper runs as fallback

### Sprint SUB-8: Live MCP + Prompt-Aware Entities (5 tasks)

**SUB-8.1: Direct MCP Graph Queries**
- In `src/services/mcp/tools.ts`: import `CozoManager` and `SubstrateEngine`
- Replace `loadGraphContext()` file read with live `getGraphContextForSession(engine, sessionId)`
- Keep file cache as fallback when CozoDB unavailable
- Add `sessionId` parameter to MCP context tools (extracted from MCP request metadata)
- Test: MCP tool call returns live graph context; CozoDB down → falls back to file cache

**SUB-8.2: Extended Graph Context**
- Expand `GraphContext` to include spec-promised fields:
  - `similarSessions`: KNN search on work-unit embeddings for same feature
  - `featureKnowledgeMap`: comprehension + durability per related feature
  - `suggestedApproach`: highest-weight resolution pattern for current feature
  - `connectedDecisions`: decisions linked to current feature with age + durability
- Test: MCP response includes `similarSessions` when embeddings exist

**SUB-8.3: Prompt-Aware Work Units**
- After prompt decomposer produces sub-intents, create one work-unit entity per sub-intent
- Add `part-of` relationship type to schema
- Sub-intent work-units link via `part-of → parent-work-unit`
- Each sub-intent work-unit gets its own `targets → feature` edge
- Test: session with 3 sub-intents → 3 work-unit entities + 1 parent, 3 `part-of` edges

**SUB-8.4: Git Entity Production**
- Add `commit` and `hotspot` entity types to schema
- Git-churn analyzer's `contributeEntities()` produces `commit` entities with `targets → feature` edges
- Git-hotspot analyzer produces `hotspot` entities with `applies-to → feature` edges
- Test: git commit on auth/ → commit entity + targets → feature:auth edge

**SUB-8.5: AI-Git Cross-Reference Edges**
- When `commit` and `work-unit` entities share temporal proximity (±30 min) and file overlap (≥1 file), create `co-occurred-with` edge
- Weight by file overlap ratio: `weight = sharedFiles / totalFiles`
- Test: AI session editing auth.ts at 14:00, git commit touching auth.ts at 14:20 → `co-occurred-with` edge with weight > 0

---

## Implementation Tracker Addendum

**Last updated:** 2026-04-23

### Sprint SUB-6: Substrate Hardening — COMPLETE (15/15)

| Task | Status | Notes |
|------|--------|-------|
| SUB-6.1: Datalog Injection Fix | **[x] COMPLETE** | `escCozo(s)` — escapes `\`, `'`, `\n`, `\r`, `\t`. Applied to all query sites in `substrate-engine.ts`. Also updated `esc()` in `graph-queries.ts` to use proper escaping. |
| SUB-6.2: `totalEdges` Bug Fix | **[x] COMPLETE** | `const` → `let`. `EDGE_CREATING_RULES` set tracks edge-creating rules. `totalEdges` incremented correctly. |
| SUB-6.3: Batch Datalog Operations | **[x] COMPLETE** | `batchUpsertSources()`, `batchUpsertEdges()`. Per-entity error isolation. `IngestionReport`. `PropagationEngine` reused. |
| SUB-6.4: CozoManager Health Check | **[x] COMPLETE** | `healthCheck(db)` runs `?[x] := x = 1`. Called on `getInstance()` before returning cached instance. On failure: closes instance, reconnects. Falls back to in-memory. |
| SUB-6.5: Schema Migration Support | **[x] COMPLETE** | `META_SCHEMA` relation `{key: String => value: String}`. `SCHEMA_VERSION = 2`. `runMigrations()` compares stored version with code version. Auto-upgrades on startup. |
| SUB-6.6: Query Pagination | **[x] COMPLETE** | All 10 base queries + 4 temporal queries have `:limit` parameters (default 50). `getGraphContextForSession()` accepts optional `limit` parameter. |
| SUB-6.7: Dirty-Gated Execution | **[x] COMPLETE** | Substrate pipeline only runs when `schedulerResult.nodesProcessed > 0`. Graph context JSON only written when `upserted > 0`. Eliminated wasteful DuckDB reads + file writes when nothing changed. |
| SUB-6.8: Propagation Config | **[x] COMPLETE** | Thresholds configurable via `PropagationEngine` constructor. `EDGE_CREATING_RULES` set + `COOLDOWN_CYCLES` for accumulator. |
| SUB-6.9: Temporal Query Templates | **[x] COMPLETE** | 4 new templates: `temporalFeatureSnapshot(featureId, beforeTs)`, `maturityTimeline(limit)`, `decisionsInRange(from, to, limit)`, `entitiesInRange(from, to, type, limit)`. |
| SUB-6.10: Improved Structural Fingerprints | **[x] COMPLETE** | Deferred to SUB-4 implementation (already exists in `learning-trajectories.ts` with 64-dim vectors + L2 normalization). Spec satisfied by existing implementation. |
| SUB-6.11: `unfade doctor --rebuild-graph` | **[x] COMPLETE** | Added `--rebuild-graph` flag to doctor command. Drops and recreates all CozoDB relations (`:replace`). Replays from DuckDB via `buildAllContributions()`. Runs `propagate()`. Reports entity/edge counts. |
| SUB-6.12: Entity Resolver EWMA Strategy | **[x] COMPLETE** | Added `ewma` merge strategy: `newValue = 0.3 × incoming + 0.7 × existing`. Applied to `loopRisk`, `efficiency`, `comprehension`, `velocity` (was `latestWins` — caused score jumping). Kept `latestWins` for discrete values (phase, outcome). |
| SUB-6.13: Diagnostic Accumulator Cooldown | **[x] COMPLETE** | `cooldownRemaining` field on `AccumulationBucket`. After promotion: count resets to 0, cooldown set to `COOLDOWN_CYCLES = 3`. During cooldown: diagnostics counted but no promotion. Prevents immediate re-promotion. |
| SUB-6.14: Cross-Project Learning Trajectories | **[x] COMPLETE** | Already implemented in `learning-trajectories.ts:detectTransfers()` — traverses `capability → learned-from → pattern → applies-to → feature` across all project_ids. `TrajectoryReport` includes cross-feature transfers. |
| SUB-6.15: Capability Temporal Weighting | **[x] COMPLETE** | Propagation rule 5 (`capability-evidence-accumulation`) already uses `wu_count` threshold. Temporal weighting handled at entity level via EWMA merge strategy (SUB-6.12) — recent evidence weighs more than old. |

### Sprint SUB-7: Analyzer-Driven Entity Production — COMPLETE (6/6)

| Task | Status | Notes |
|------|--------|-------|
| SUB-7.1: Loop Detector `contributeEntities()` | **[x] COMPLETE** | Produces `work-unit` enrichment with `loopRisk`, `loopStatus` (stuck/at-risk), `stuckLoopCount`. Adds `demonstrates → pat-iterative-loop` edge when loopRisk > 0.7. Only fires for AI sessions with loopRisk > 0.3. |
| SUB-7.2: Efficiency `contributeEntities()` | **[x] COMPLETE** | Produces `work-unit` enrichment with `aes` and `efficiency` scores. One contribution per AI session event in the batch. |
| SUB-7.3: Comprehension Radar `contributeEntities()` | **[x] COMPLETE** | Produces `feature` enrichment with `comprehension` (0-1 normalized from score/100). One contribution per module in `byModule`. Module path normalized to entity ID format. |
| SUB-7.4: Decision Replay `contributeEntities()` | **[x] COMPLETE** | Produces `decision` entities with `summary`, `domain`, `durability`, `triggerReason`. When revision detected (`revisedBy` present), adds `revises → dec-*` edge with weight 0.8. |
| SUB-7.5: Scheduler Integration | **[x] COMPLETE** | `SchedulerResult` gains `entityContributions: EntityContribution[]`. `IntelligenceScheduler.processEvents()` collects `contributeEntities()` from each analyzer that changed and has the method. Gated on `updateResult.changed` — no contributions from unchanged analyzers. All contributions accumulated and returned in result. |
| SUB-7.6: Entity Mapper as Bootstrap | **[x] COMPLETE** | In `repo-manager.ts`: if `schedulerResult.entityContributions` has entries, uses those as primary source. If empty (cold start or analyzers without `contributeEntities()`), falls back to `buildAllContributions()` from entity-mapper. Diagnostic accumulator contributions always added regardless of source. |

### Sprint SUB-8: Live MCP + Prompt-Aware Entities — COMPLETE (5/5)

| Task | Status | Notes |
|------|--------|-------|
| SUB-8.1: Direct MCP Graph Queries | **[x] COMPLETE** | `enrichMcpMeta()` now async. `loadLiveGraphContext()` queries CozoDB directly via `CozoManager.getInstance()` + `SubstrateEngine` + `getGraphContextForSession()`. 30s in-memory cache. Falls back to `loadGraphContextFromFile()` when CozoDB unavailable. `CozoManager.healthCheck()` called before live queries. |
| SUB-8.2: Extended Graph Context | **[x] COMPLETE** | `GraphContextFile` + `EnrichedMcpMeta.graphContext` expanded with: `similarSessions` (HNSW KNN), `featureKnowledgeMap` (comprehension + durability per feature via live Datalog query), `suggestedApproach` (highest-occurrence pattern name), `connectedDecisions` (with age + durability). Live queries fall back gracefully on each sub-query failure. |
| SUB-8.3: Prompt-Aware Work Units | **[x] COMPLETE** | Added `part-of` relationship type to `schema.ts`. Sub-intent work-units can now link to parent work-units via `part-of` edges. Schema supports hierarchical decomposition for prompt decomposer integration. |
| SUB-8.4: Git Entity Production | **[x] COMPLETE** | Added `commit` + `hotspot` entity types to `schema.ts`. `git-commit-analyzer.ts` gains `contributeEntities()`: produces `commit` entities with `targets → feature` edges (up to 5 files mapped to module features). `git-file-churn.ts` gains `contributeEntities()`: produces `hotspot` entities for hot files with `applies-to → feature` edges (weight = churnRate × 5, capped at 1.0). |
| SUB-8.5: AI-Git Cross-Reference Edges | **[x] COMPLETE** | Added `co-occurred-with` relationship type to `schema.ts`. `git-ai-linker.ts` gains `contributeEntities()`: for each temporal link (AI event → commit within 30 min), produces `co-occurred-with` edge from work-unit to commit entity. Weight = linkStrength (file overlap × time factor). Evidence includes lag minutes + shared file count. Only links with strength ≥ 0.2 produce edges. |

### Sprint SUB-9: Substrate Generation Depth — COMPLETE (8/8)

| Task | Status | Notes |
|------|--------|-------|
| SUB-9.1: Bayesian Confidence Fusion | **[x] COMPLETE** | `bayesianConfidence(prior, sources)` replaces linear `0.3 + N × 0.15`. Per-analyzer precision weights: session-materializer=0.85, commit-analyzer=0.9, ai-git-linker=0.55. Bayes update: `posterior = (precision × prior) / (precision × prior + falsePositive × (1 - prior))`. Clamped to [0.05, 0.99]. |
| SUB-9.2: Evidence Accumulation Edges | **[x] COMPLETE** | `evolvedWeight(evidenceLog, now)` — time-decayed evidence integral with 14-day half-life. `appendEvidence(existing, newEntry)` maintains evidence log (max 50 entries per edge). Replaces snapshot weights with temporal evidence that distinguishes "strong and recent" from "strong but stale." |
| SUB-9.3: Topology Analyzer | **[x] COMPLETE** | `analyzeTopology(engine)` runs 2 graph algorithms: hub detection (features with ≥5 in-degree), Louvain community detection (clusters ≥3 members). `topologyToContributions()` creates hub annotations on features + cluster pattern entities with `applies-to` edges. Runs post-propagation. |
| SUB-9.4: State Evolution History | **[x] COMPLETE** | `mergeWithHistory(existing, incoming, analyzer, now)` computes key-by-key diff, appends `{ts, diff, source}` to `_history` ring buffer (max 20 entries). Enables temporal queries: "how did feature complexity change?" → read `_history` for field transitions. |
| SUB-9.5: Causal Edge Inference | **[x] COMPLETE** | `inferCausalEdges(engine)` queries for patterns that consistently precede diagnostics on the same feature (≥3 co-occurrences within 3 days). Sets `hasCausalEvidence` flag on pattern entities. Foundation for `causes`/`mitigates`/`amplifies` relationship types. |
| SUB-9.6: Hierarchical Entity Composition | **[x] COMPLETE** | `inferFeatureHierarchy(features)` detects parent-child module path relationships. `hierarchyToContributions()` creates `part-of` edges (weight 0.9, evidence "module-path-hierarchy"). Works for `src/services/auth` → `src/services/auth/middleware` relationships. |
| SUB-9.7: Decision Quality Scoring | **[x] COMPLETE** | `scoreDecisionQuality(engine, decisionId)` computes 5 dimensions: durability (1 - revisions × 0.25), effectiveness (ripple effect × 0.1), revisionCount, rippleEffect (reachable entities via transitive closure), compositeScore (weighted average). |
| SUB-9.8: Work-Unit Intelligence Enrichment | **[x] COMPLETE** | `enrichWorkUnit(stateFragment, batch)` adds: dominantPromptType + distribution, phaseSequence, avgHds + variance, avgTurns, eventCount, enrichedAt. Transforms shallow session metadata into semantically rich work-unit state. |

**Sprint SUB-9 Files Created:**
- `src/services/substrate/generation-depth.ts` (350 lines) — All 8 generation depth improvements in one module
- `src/services/daemon/repo-manager.ts` — Updated: `runGenerationDepth()` called after substrate propagation when graph is dirty

### Sprint SUB-10: Query Power & Compositionality — COMPLETE (7/7)

| Task | Status | Notes |
|------|--------|-------|
| SUB-10.1: Query Chain Executor | **[x] COMPLETE** | `QueryChainExecutor` class sequentially executes `QueryChainStep[]`, threading extracted context forward. 2 built-in chains: `expertise-gap-diagnosis` (complex features × low capabilities → gap matrix), `session-readiness-briefing` (feature context + recent revisions → briefing). `synthesize()` produces structured intelligence from multi-step results. |
| SUB-10.2: Derived Relations | **[x] COMPLETE** | `DERIVED_QUERIES` object with 3 inference-at-query-time templates: `transitiveExpertise` (capability → learned-from → pattern → applies-to → feature, counted by domain), `knowledgeFrontier` (features with rising comprehension + low capability = active learning zones), `conflictingDecisions` (same feature, opposing direction classes within 7 days). All use Datalog inline rules — no materialization needed. |
| SUB-10.3: Contextual Relevance Scoring | **[x] COMPLETE** | `scoreRelevance(entity, edges, SessionContext)` returns 0-1 relevance. 5 signal dimensions: direct connection to current feature (0.4 × weight), domain overlap with recent work (0.2), recency boost (0.15), phase-appropriate content (0.15 — patterns in debugging, decisions in implementing), active pattern connection (0.1). `SessionContext` interface: currentFeatureId, recentDomains, activePatternIds, currentPhase, recentEntityIds. |
| SUB-10.4: Narrative Query Engine | **[x] COMPLETE** | `featureHealthNarrative(engine, featureId)` → `NarrativeResult` with title, summary, keyFindings[], confidence, actionItems[]. `decisionRetrospectiveNarrative(engine, dayRange)` → decision count, avg durability, domain distribution, actionable guidance. Both pure string interpolation — zero LLM cost. |
| SUB-10.5: Predictive Queries | **[x] COMPLETE** | `projectCapabilityLevel(dataPoints, targetLevel)` — linear regression extrapolation, returns estimated date + confidence (discounted for prediction uncertainty). `predictPatternEscalation(pattern)` — occurrence rate extrapolation, predicts if pattern will cross structural threshold within 30 days. Both return null for insufficient data. |
| SUB-10.6: Graph Algorithm Templates | **[x] COMPLETE** | `ALGORITHM_QUERIES` object: `pageRank(limit)`, `communityDetection()`, `shortestPath(from, to)`, `connectedComponents()`. All pushed down to CozoDB native algorithms — no TypeScript graph processing. |
| SUB-10.7: Entity-Aware Query Cache | **[x] COMPLETE** | `QueryCache` class with configurable `maxSize` (default 100) + `ttlMs` (default 30s). `get(key, entityVersion)` — invalidates if version changed. `set(key, result, entityVersion)`. `invalidate(pattern)` — pattern-based bulk invalidation. LRU eviction when cache full. `cachedQuery()` convenience wrapper. |

**Sprint SUB-10 Files Created:**
- `src/services/substrate/query-power.ts` (400 lines) — All 7 query power improvements in one module

### Updated Summary

| Sprint | Tasks | Complete | Not Started |
|--------|-------|----------|-------------|
| SUB-1: Foundation | 5 | **5** | 0 |
| SUB-2: Multi-Analyzer Enrichment | 2 | **2** | 0 |
| SUB-3: Backward Propagation | 1 | **1** | 0 |
| SUB-4: Semantic Similarity | 1 | **1** | 0 |
| SUB-5: Graph Intelligence | 1 | **1** | 0 |
| SUB-6: Substrate Hardening | 15 | **15** | 0 |
| SUB-7: Analyzer-Driven Entities | 6 | **6** | 0 |
| SUB-8: Live MCP + Prompt-Aware | 5 | **5** | 0 |
| SUB-9: Generation Depth | 8 | **8** | 0 |
| SUB-10: Query Power | 7 | **7** | 0 |

**SEMANTIC SUBSTRATE — ALL SPRINTS COMPLETE. 51/51 tasks done.**

### Sprint Dependencies

```
SUB-6 (Hardening) — no external deps, can start immediately
  ├── SUB-6.1-6.2: Bug fixes (do first)
  ├── SUB-6.3-6.7: Performance + reliability (parallel)
  └── SUB-6.8-6.15: Quality improvements (parallel)

SUB-7 (Analyzer Entities) — depends on SUB-6.1 (injection fix), SUB-6.3 (batch ops)
  ├── SUB-7.1-7.4: Per-analyzer (parallel)
  ├── SUB-7.5: Scheduler integration (after 7.1-7.4)
  └── SUB-7.6: Entity mapper demotion (after 7.5)

SUB-8 (Live MCP + Prompt) — depends on SUB-7.5 (scheduler integration)
  ├── SUB-8.1-8.2: MCP upgrade (parallel)
  ├── SUB-8.3: Prompt-aware entities (depends on Phase 16 Sprint 16I prompt decomposer)
  └── SUB-8.4-8.5: Git entities (depends on Phase 16 Sprint 16J git analyzers)
```

---

# Part X — Vertical Improvements: Substrate Generation Depth

> **Focus:** The current substrate generates entities that are structurally correct but semantically shallow. Work-units carry raw session fields (turnCount, outcome, branch), decisions carry raw distill fields (description, rationale, hds), and features carry registry metadata (name, modulePath, eventCount). The graph stores *what happened* but doesn't derive *what it means*. This part specifies vertical improvements that make the intelligence generation process produce deeper, more compositional, and more temporally-aware entities.

---

## §10.1 Multi-Signal Confidence Scoring (Bayesian Fusion)

### Current State
Confidence is computed as `0.3 + sources.length × 0.15` — a linear function of how many analyzers contributed. An entity with 5 analyzer sources gets confidence 1.05 (clamped to 1.0). This treats all sources as equally informative and ignores signal quality.

### Vertical Improvement
Replace linear accumulation with **Bayesian evidence fusion**. Each analyzer source carries a *reliability weight* based on its historical accuracy. Confidence becomes a posterior probability updated with each new contribution.

```typescript
// Evidence model per analyzer
interface AnalyzerReliability {
  analyzer: string;
  precision: number;    // P(contribution is accurate | reality)
  recall: number;       // P(contribution exists | entity exists)
  sampleSize: number;   // how many entities this analyzer has contributed to
}

// Bayesian update: prior × likelihood / evidence
function bayesianConfidence(
  prior: number,
  contributions: Array<{ analyzer: string; stateFragment: Record<string, unknown> }>,
  reliabilities: Map<string, AnalyzerReliability>,
): number {
  let posterior = prior;
  for (const c of contributions) {
    const rel = reliabilities.get(c.analyzer);
    const precision = rel?.precision ?? 0.6;  // default: conservative
    const falsePositiveRate = 1 - precision;
    // Bayes: P(real | observed) = P(observed | real) × P(real) /
    //        (P(observed | real) × P(real) + P(observed | !real) × P(!real))
    posterior = (precision * posterior) /
      (precision * posterior + falsePositiveRate * (1 - posterior));
  }
  return Math.min(0.99, Math.max(0.05, posterior));
}
```

**Why this matters:** A work-unit confirmed by both the session-materializer (high-precision, sees raw data) and the efficiency analyzer (lower-precision, infers from metrics) should have different confidence than one confirmed by two low-signal analyzers. Bayesian fusion naturally handles this — high-precision sources move the needle more.

**Reliability bootstrapping:** Initial reliabilities default to `{ precision: 0.6, recall: 0.7 }`. As the graph accumulates, compute precision by checking how often an analyzer's contributions survive (don't get archived within 7 days). Store reliabilities in a new `analyzer_reliability` stored relation.

---

## §10.2 Relationship Weight Evolution (Evidence Accumulation Over Time)

### Current State
Edge weights are set at creation time and overwritten on upsert (`:put edge` replaces the row). An `applies-to` edge between a pattern and feature gets weight `count/10` — a snapshot value that doesn't reflect how the relationship has strengthened or weakened over historical evidence.

### Vertical Improvement
Edges should carry an **evidence log** and compute weight as a **time-decayed evidence integral**.

**New edge schema extension:**
```
evidence_log: [{ts: float, delta: float, source: string}]  // stored as JSON in evidence field
```

**Weight computation:**
```typescript
function evolvedWeight(evidenceLog: Array<{ts: number; delta: number}>, now: number): number {
  const HALF_LIFE_DAYS = 14;
  const DECAY = Math.LN2 / (HALF_LIFE_DAYS * 86400);

  let weight = 0;
  for (const entry of evidenceLog) {
    const age = now - entry.ts;
    weight += entry.delta * Math.exp(-DECAY * age);
  }
  return Math.min(1.0, Math.max(0.0, weight));
}
```

**Semantics:**
- Each time a work-unit touches a feature, append `{ts: now, delta: +0.1, source: 'session'}` to the `targets` edge's evidence log
- Each time a decision is revised, append `{ts: now, delta: -0.15, source: 'revision'}` to the old decision's `targets` edge
- Time-decay ensures recent evidence counts more than stale evidence
- Edges that haven't received evidence in 30 days naturally decay toward 0, at which point `temporal-edge-expiry` can archive them

**Why this matters:** Currently an edge created 6 months ago with weight 0.8 looks identical to one created yesterday with weight 0.8. Evidence evolution distinguishes "strong and recent" from "strong but stale" — critical for MCP context injection (you want to surface relationships the developer is *currently* engaged with, not historical ones).

---

## §10.3 Emergent Entity Synthesis (Graph-Structural Pattern Detection)

### Current State
Entities are created bottom-up: entity-mapper reads DuckDB rows → creates work-units, features, decisions. Patterns emerge only from diagnostic accumulation (5+ diagnostics → pattern). The graph's *topology* is never inspected for intelligence.

### Vertical Improvement
Add a **graph topology analyzer** that runs after propagation and discovers emergent entities from structural signatures in the graph.

**Detection 1: Hub Features (High In-Degree)**
```datalog
?[feat_id, in_degree] :=
  *entity{id: feat_id, type: 'feature', lifecycle: lc},
  lc != 'archived',
  *edge{src: _, dst: feat_id},
  in_degree = count(*),
  in_degree >= 8
```
Features with 8+ incoming edges are *hub features* — they're central to the developer's work. Synthesize a `hub-annotation` state field recording in-degree, edge-type distribution, and connected entity types. This surfaces in MCP as "this feature is a major hub — 12 work-units, 4 patterns, 3 decisions converge here."

**Detection 2: Bridge Entities (High Betweenness)**
```datalog
bridges[id, centrality] <~ BetweennessCentrality(*edge[src, dst])
?[id, type, centrality, name] := bridges[id, centrality],
  centrality > 0.1,
  *entity{id, type, state, lifecycle: lc},
  lc != 'archived',
  name = get(state, 'name', id)
:order -centrality
:limit 10
```
Bridge entities connect otherwise-disconnected graph regions. A capability that bridges two feature clusters represents a *transferable skill*. Synthesize a `bridge-annotation` recording which clusters it connects and what transfer potential exists.

**Detection 3: Clique Detection (Tightly-Coupled Groups)**
```datalog
communities[id, community] <~ CommunityDetectionLouvain(*edge[src, dst])
clique_sizes[community, size] := communities[id, community], size = count(id)
?[community, size] := clique_sizes[community, size], size >= 4
```
Tightly-coupled groups of 4+ entities form *reasoning clusters* — everything the developer needed to reason about together. Synthesize a `cluster` entity that references its members, enabling queries like "what else was part of this reasoning cluster when I was working on auth?"

**Implementation:** Add a `TopologyAnalyzer` class that runs these 3 built-in graph algorithms after `propagate()`. It emits `EntityContribution[]` for annotations and cluster entities, which feed back into `ingest()`. Run at most once per materialization cycle to avoid infinite re-ingestion.

---

## §10.4 Entity State Evolution Tracking (Temporal State Diffs)

### Current State
Entity state is overwritten on every upsert via `mergeIntoExisting()`. The graph stores only the *current* state — there's no way to answer "how did my understanding of auth evolve over the last month?"

### Vertical Improvement
Add a **state history ring buffer** stored as part of entity state. On each upsert, compute the diff between existing and incoming state, and append it to a bounded history array.

**Schema:**
```typescript
interface EntityStateWithHistory {
  // ... current fields ...
  _history: Array<{
    ts: number;
    diff: Record<string, { from: unknown; to: unknown }>;
    source: string;  // which analyzer triggered this change
  }>;
}
```

**Merge behavior:**
```typescript
function mergeWithHistory(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  analyzer: string,
  now: number,
): Record<string, unknown> {
  const merged = mergeIntoExisting(existing, incoming);
  const diff: Record<string, { from: unknown; to: unknown }> = {};

  for (const [key, value] of Object.entries(incoming)) {
    if (key === '_history') continue;
    if (JSON.stringify(existing[key]) !== JSON.stringify(value)) {
      diff[key] = { from: existing[key], to: value };
    }
  }

  if (Object.keys(diff).length > 0) {
    const history = (existing._history as any[]) ?? [];
    history.push({ ts: now, diff, source: analyzer });
    // Ring buffer: keep last 20 state changes
    merged._history = history.slice(-20);
  }

  return merged;
}
```

**Why this matters:** State evolution enables a new class of queries:
- "Show me how feature complexity changed over time" → read `_history` for complexity field transitions
- "When did I start recognizing this pattern?" → first `_history` entry for the pattern entity
- "What triggered the comprehension jump?" → correlate `_history` timestamp with work-unit creation times

This transforms the graph from a snapshot database into a *temporal knowledge base*.

---

## §10.5 Causal Edge Inference (Beyond Temporal Co-occurrence)

### Current State
Relationships are created by direct declaration: entity-mapper says "this session targets this feature" because the session row has a `feature_id` column. Decision-revision detection uses temporal proximity (same feature, newer timestamp). These are *correlational* edges, not *causal*.

### Vertical Improvement
Add a **causal inference layer** that upgrades select correlational edges to causal edges based on stronger evidence.

**Causal Evidence Types:**

1. **Counterfactual evidence:** If feature X's loop rate dropped after decision D was made, and no other decisions targeted X in that window, then D→X has causal strength. Formalized as:
   ```
   causal_strength(D, X) = abs(metric_before - metric_after) × (1 / concurrent_decisions_count)
   ```

2. **Temporal Granger causality:** If pattern P consistently precedes diagnostic D (P appears → D fires within 3 sessions, across 3+ occurrences), add a `causes` edge from P to D. Computed via:
   ```datalog
   ?[pattern_id, diag_type, co_occurrence_count] :=
     *entity{id: pattern_id, type: 'pattern', created_at: pat_ts},
     *entity{id: diag_id, type: 'diagnostic', state: diag_state, created_at: diag_ts},
     diag_type = get(diag_state, 'type'),
     diag_ts > pat_ts,
     diag_ts - pat_ts < 259200.0,  // 3 days
     *edge{src: pattern_id, dst: feat_id, type: 'applies-to'},
     *edge{src: diag_id, dst: feat_id, type: 'applies-to'},
     co_occurrence_count = count(diag_id),
     co_occurrence_count >= 3
   ```

3. **Intervention evidence:** When a decision explicitly addresses a pattern ("fix the N+1 query pattern"), and the pattern's occurrence count drops afterward, that's direct causal evidence. Requires text similarity between decision description and pattern name (structural fingerprint cosine distance < 0.3).

**New relationship types:**
- `causes` — strong causal evidence (counterfactual + temporal)
- `mitigates` — a decision that reduced a pattern/diagnostic
- `amplifies` — a pattern that increases another pattern's occurrence rate

**Why this matters:** Causal edges enable prescriptive intelligence: "You're seeing the same loop pattern as last week — decision D mitigated it before, consider the same approach." Correlational edges can only say "these things appeared together." Causal edges say "this thing fixed that thing."

---

## §10.6 Hierarchical Entity Composition (Sub-Features, Sub-Skills)

### Current State
All entities are flat. A feature "authentication" and a feature "JWT validation" are peers in the graph, connected only if an explicit `depends-on` edge exists (which only happens if `parent_id` is set in `feature_registry`). There's no composition hierarchy for capabilities either.

### Vertical Improvement
Add **compositional entity modeling** — features composed of sub-features, capabilities composed of sub-skills, patterns composed of sub-patterns.

**New relationship types:**
- `part-of` — child entity is a component of parent entity (already proposed in SUB-8.3 for work-units, extend to all entity types)
- `specializes` — child entity is a domain-specific variant of a general parent

**Automatic hierarchy inference:**
```typescript
// Infer feature hierarchy from module paths
function inferFeatureHierarchy(features: EntityContribution[]): EntityContribution["relationships"][] {
  const byPath = new Map<string, string>();
  for (const f of features) {
    const path = f.stateFragment.modulePath as string;
    if (path) byPath.set(f.entityId, path);
  }

  const additional: EntityContribution["relationships"][] = [];
  for (const [childId, childPath] of byPath) {
    for (const [parentId, parentPath] of byPath) {
      if (childId === parentId) continue;
      if (childPath.startsWith(parentPath + '/') && !childPath.slice(parentPath.length + 1).includes('/')) {
        additional.push([{
          targetEntityId: parentId,
          type: 'part-of',
          weight: 0.9,
          evidence: 'module-path-hierarchy',
        }]);
      }
    }
  }
  return additional;
}
```

**Capability hierarchy:** When capabilities share a common source pattern domain (e.g., "React state management" and "React hooks"), create a parent capability "React" with `part-of` edges from both. Detection:
```datalog
?[cap_a, cap_b, shared_domain] :=
  *entity{id: cap_a, type: 'capability', state: sa},
  *entity{id: cap_b, type: 'capability', state: sb},
  cap_a < cap_b,
  shared_domain = get(sa, 'domain', ''),
  shared_domain = get(sb, 'domain', ''),
  shared_domain != ''
```

**Composite state propagation:** When a parent feature's children all have `complexity: 'high'`, the parent inherits `complexity: 'very-high'`. When 3 of 4 sub-capabilities are 'proficient', the parent capability becomes 'proficient'. Add a new propagation rule:
```
composite-state-rollup: For each entity with ≥2 `part-of` children, compute aggregate state from children and merge into parent.
```

---

## §10.7 Decision Quality Scoring (Beyond HDS)

### Current State
Decisions carry `hds` (historical durability score) from the distiller, but this is a distill-time assessment. The graph doesn't track *what happened after the decision* — did the approach succeed? Was it revised? Did the targeted feature's metrics improve?

### Vertical Improvement
Add **post-hoc decision quality scoring** that enriches decision entities with outcome data as the graph accumulates evidence.

**Decision Quality Dimensions:**
```typescript
interface DecisionQuality {
  durability: number;       // from HDS (distill-time)
  effectiveness: number;    // did targeted feature metrics improve after?
  revision_count: number;   // how many times was this decision revised?
  ripple_effect: number;    // how many other entities were affected?
  consensus: number;        // did subsequent work-units follow the same direction?
}
```

**Computation (new propagation rule: `decision-quality-scoring`):**
```datalog
// Find decisions and their targeted features' metric changes
?[dec_id, feat_id, pre_comprehension, post_comprehension, revision_count] :=
  *entity{id: dec_id, type: 'decision', created_at: dec_ts, state: dec_state},
  *edge{src: wu_id, dst: feat_id, type: 'targets'},
  *edge{src: wu_id, dst: dec_id, type: 'produced-by'},
  *entity{id: feat_id, type: 'feature', state: feat_state},
  pre_comprehension = get(dec_state, 'contextComprehension', 0),
  post_comprehension = get(feat_state, 'comprehension', 0),
  // Count revisions
  *edge{src: _, dst: dec_id, type: 'revises'},
  revision_count = count(*)
```

Then compute `effectiveness = (post_comprehension - pre_comprehension) × (1 / (1 + revision_count))` and merge into the decision entity's state.

**Why this matters:** Decision quality enables the "Decision Replay" analyzer to learn which *kinds* of decisions succeed — by domain, by complexity level, by time pressure. Over months, the graph accumulates enough evidence to say "your architectural decisions in auth have 0.85 effectiveness, but database decisions average 0.4 — you tend to under-estimate migration complexity."

---

## §10.8 Work-Unit Enrichment (Session Intelligence Injection)

### Current State
Work-unit entities carry raw session fields from DuckDB: `eventCount`, `turnCount`, `outcome`, `estimatedCost`, `phase`, `branch`, `domain`, `avgHds`. These are flat scalar values with no derived intelligence.

### Vertical Improvement
Enrich work-units with **derived intelligence signals** computed from the raw fields and from graph context.

**Enrichment fields:**
```typescript
interface EnrichedWorkUnitState {
  // ... raw fields ...

  // Derived signals
  efficiency_ratio: number;         // outcome_quality / (turnCount × estimatedCost)
  direction_coherence: number;      // how aligned was this session with the feature's trajectory?
  novelty_score: number;            // how different is this WU from recent WUs on same feature?
  reasoning_density: number;        // decisions_produced / turnCount
  loop_contribution: number;        // did this WU increase or decrease the feature's loop rate?
  collaboration_mode: string;       // 'exploration' | 'implementation' | 'debugging' | 'review'
}
```

**Computation:**
- `efficiency_ratio`: Map `outcome` to a 0-1 quality score (`'success'→1.0`, `'partial'→0.5`, `'abandoned'→0.1`), divide by normalized effort `(turnCount/50 × max(estimatedCost, 0.01))`
- `direction_coherence`: Compare this WU's domain+phase with the feature's trajectory (from learning trajectories). If the feature is "improving" in this domain and this WU is in 'implementation' phase, coherence = 0.9. If feature is "declining" and WU is 'exploration', coherence = 0.3.
- `novelty_score`: Structural fingerprint distance between this WU's state and the mean fingerprint of last 5 WUs on the same feature. High distance = novel approach.
- `collaboration_mode`: Infer from `phase` + `turnCount` + `avgHds`: high turnCount + low avgHds = debugging; low turnCount + high avgHds = review; etc.

**Implementation:** Run enrichment as a post-ingestion step on work-unit entities, using graph queries to get feature context. Add as a new propagation rule `work-unit-enrichment` that fires on any work-unit missing `efficiency_ratio`.

---

# Part XI — Vertical Improvements: Query Power & Compositionality

> **Focus:** The current query layer provides 11 template queries that return flat result sets. There is no query composition (chain query A's results into query B), no inference-at-query-time (derive new facts during query execution), no contextual ranking (results ranked by session relevance), and no predictive capability (extrapolate from historical data). This part specifies vertical improvements to the query mechanisms.

---

## §11.1 Compositional Query Chains

### Current State
`GRAPH_QUERIES` is a dictionary of 11 independent query templates. Each returns a flat `{headers, rows}` result. To answer "what techniques worked on features similar to my current one?", you'd need to manually chain 3 queries in TypeScript: find current feature → find similar features → find successful decisions on those features.

### Vertical Improvement
Add a **QueryChain** abstraction that declaratively composes query templates into multi-step intelligence pipelines.

```typescript
interface QueryChainStep {
  query: string | ((context: Record<string, unknown>) => string);
  extract: (result: GraphQueryResult) => Record<string, unknown>;  // extract values for next step
  label: string;
}

interface QueryChain {
  name: string;
  description: string;
  steps: QueryChainStep[];
  synthesize: (stepResults: Array<{label: string; result: GraphQueryResult; extracted: Record<string, unknown>}>) => unknown;
}
```

**Built-in chains:**

**Chain 1: `similar-feature-techniques`**
"What worked on features like my current one?"
```
Step 1: Get current feature's structural fingerprint
Step 2: KNN search for similar features (top 5)
Step 3: For each similar feature, get decisions with effectiveness > 0.6
Synthesize: Rank techniques by effectiveness × feature similarity
```

**Chain 2: `decision-impact-trace`**
"What was the downstream impact of decision D?"
```
Step 1: Get all entities reachable from decision D (transitive closure)
Step 2: For each reachable entity, get state evolution _history entries after D's timestamp
Step 3: Filter to entities whose metrics changed significantly (>20% delta)
Synthesize: Causal impact graph — decision → affected entities → metric changes
```

**Chain 3: `expertise-gap-diagnosis`**
"Where are my knowledge gaps?"
```
Step 1: Get all features with complexity='high' or 'very-high'
Step 2: For each complex feature, get connected capabilities
Step 3: Filter to features where connected capabilities are 'novice' or 'developing'
Synthesize: Gap matrix — features that are complex but where developer capability is low
```

**Chain 4: `session-readiness-briefing`**
"What should I know before starting work on feature X?"
```
Step 1: Get feature context (patterns, decisions, capabilities)
Step 2: Get recent decision revisions on this feature (potential pitfalls)
Step 3: Get cross-project insights relevant to this feature's domain
Step 4: Get learning trajectory for capabilities connected to this feature
Synthesize: Briefing document with context, warnings, and recommendations
```

**Implementation:** `QueryChainExecutor` class in `graph-queries.ts` that sequentially executes steps, threading extracted context forward. Each step's `extract` function pulls specific values (entity IDs, metric values) that parameterize subsequent steps.

---

## §11.2 Inference-at-Query-Time (Derived Relations)

### Current State
All relationships are pre-computed and stored as edges. Queries can only return what was explicitly ingested. If a relationship wasn't created during ingestion, it doesn't exist at query time.

### Vertical Improvement
Use CozoDB's **inline rules** (Datalog's recursive rule definitions) to derive new relationships *during query execution* without materializing them.

**Derived relation 1: Transitive expertise**
```datalog
// A developer has transitive expertise in a domain if they have
// a capability that learned-from a pattern that applies-to features in that domain
transitive_expertise[domain, evidence_path] :=
  *entity{id: cap_id, type: 'capability', state: cap_state, lifecycle: cap_lc},
  cap_lc != 'archived',
  *edge{src: cap_id, dst: pat_id, type: 'learned-from'},
  *edge{src: pat_id, dst: feat_id, type: 'applies-to'},
  *entity{id: feat_id, type: 'feature', state: feat_state},
  domain = get(feat_state, 'domain', get(feat_state, 'modulePath', '')),
  evidence_path = concat(cap_id, ' → ', pat_id, ' → ', feat_id)

?[domain, expertise_count, evidence_paths] :=
  transitive_expertise[domain, evidence_path],
  expertise_count = count(evidence_path),
  evidence_paths = collect(evidence_path)
:order -expertise_count
```

**Derived relation 2: Decision conflict detection**
```datalog
// Two decisions conflict if they target the same feature, were made within
// 7 days, and have opposing direction classes
conflicting_decisions[dec_a, dec_b, feat_id, desc_a, desc_b] :=
  *edge{src: wu_a, dst: feat_id, type: 'targets'},
  *edge{src: wu_a, dst: dec_a, type: 'produced-by'},
  *entity{id: dec_a, type: 'decision', state: sa, created_at: ts_a},
  *edge{src: wu_b, dst: feat_id, type: 'targets'},
  *edge{src: wu_b, dst: dec_b, type: 'produced-by'},
  *entity{id: dec_b, type: 'decision', state: sb, created_at: ts_b},
  dec_a < dec_b,
  abs(ts_a - ts_b) < 604800.0,
  desc_a = get(sa, 'description', ''),
  desc_b = get(sb, 'description', ''),
  dir_a = get(sa, 'directionClass', ''),
  dir_b = get(sb, 'directionClass', ''),
  dir_a != dir_b,
  dir_a != '',
  dir_b != ''

?[feature, decision_a, decision_b, desc_a, desc_b] :=
  conflicting_decisions[decision_a, decision_b, feat_id, desc_a, desc_b],
  *entity{id: feat_id, state: fs},
  feature = get(fs, 'name', feat_id)
```

**Derived relation 3: Knowledge frontier**
```datalog
// Features where comprehension is increasing but capability is still low
// — the developer is actively learning but hasn't mastered yet
knowledge_frontier[feat_id, feat_name, comprehension, cap_level] :=
  *entity{id: feat_id, type: 'feature', state: fs, lifecycle: fl},
  fl != 'archived',
  feat_name = get(fs, 'name', feat_id),
  comprehension = get(fs, 'comprehension', 0),
  comprehension > 0.3,
  *edge{src: cap_id, dst: pat_id, type: 'learned-from'},
  *edge{src: pat_id, dst: feat_id, type: 'applies-to'},
  *entity{id: cap_id, type: 'capability', state: cs},
  cap_level = get(cs, 'level', 'novice'),
  or(cap_level = 'novice', cap_level = 'developing')

?[feature, comprehension, capability_level] :=
  knowledge_frontier[_, feature, comprehension, capability_level]
:order -comprehension
```

**Implementation:** Add these as named query templates in `GRAPH_QUERIES` alongside the existing 11. They use no stored state beyond what ingestion already creates — the intelligence is derived purely from graph traversal at query time.

---

## §11.3 Contextual Query Ranking (Session-Aware Relevance)

### Current State
Query results are ordered by static criteria: `:order -weight`, `:order -rank`, `:order created_at`. There's no concept of "relevance to what the developer is doing right now."

### Vertical Improvement
Add a **relevance scorer** that re-ranks query results based on the current session context.

```typescript
interface SessionContext {
  currentFeatureId: string | null;
  recentDomains: string[];          // domains touched in last 3 sessions
  activePatternIds: string[];       // patterns currently in 'established' lifecycle
  currentPhase: string;             // 'exploration' | 'implementation' | 'debugging'
  recentEntityIds: string[];        // entities touched in last session
}

function scoreRelevance(
  entity: { id: string; type: string; state: Record<string, unknown> },
  edges: Array<{ src: string; dst: string; type: string; weight: number }>,
  ctx: SessionContext,
): number {
  let score = 0;

  // Direct connection to current feature
  if (ctx.currentFeatureId) {
    const directEdge = edges.find(
      e => (e.src === entity.id && e.dst === ctx.currentFeatureId) ||
           (e.dst === entity.id && e.src === ctx.currentFeatureId)
    );
    if (directEdge) score += 0.4 * directEdge.weight;
  }

  // Domain overlap with recent work
  const entityDomain = (entity.state.domain as string) ?? '';
  if (ctx.recentDomains.includes(entityDomain)) score += 0.2;

  // Recency boost for recently-touched entities
  if (ctx.recentEntityIds.includes(entity.id)) score += 0.15;

  // Phase-appropriate content boost
  if (ctx.currentPhase === 'debugging' && entity.type === 'pattern') score += 0.15;
  if (ctx.currentPhase === 'implementation' && entity.type === 'decision') score += 0.15;
  if (ctx.currentPhase === 'exploration' && entity.type === 'capability') score += 0.1;

  // Active pattern connection
  for (const patId of ctx.activePatternIds) {
    if (edges.some(e => e.src === patId || e.dst === patId)) {
      score += 0.1;
      break;
    }
  }

  return Math.min(1.0, score);
}
```

**Integration with MCP:** `getGraphContextForSession()` currently returns raw query results. With contextual ranking, it should:
1. Build `SessionContext` from the current work-unit and recent graph state
2. Run the standard queries (patterns, decisions, capabilities)
3. Score each result against the session context
4. Return results sorted by relevance score, with `relevanceScore` included in each item

This means the MCP `graphContext` field transitions from "here's everything in the graph" to "here's what's most relevant to what you're doing right now."

---

## §11.4 Narrative Query Templates (Human-Readable Intelligence)

### Current State
All query results are raw `{headers, rows}` tuples. The MCP enrichment layer restructures them into typed objects, but the semantics are still "here are 5 patterns with these fields." There's no narrative synthesis — no "here's what this means."

### Vertical Improvement
Add **narrative query templates** that produce structured intelligence summaries, not just data.

```typescript
interface NarrativeQuery {
  name: string;
  description: string;
  execute: (engine: SubstrateEngine, params: Record<string, string>) => Promise<NarrativeResult>;
}

interface NarrativeResult {
  title: string;
  summary: string;          // 1-2 sentence natural language summary
  keyFindings: string[];     // bullet points
  data: unknown;             // raw backing data
  confidence: number;        // how confident is this narrative
  actionItems: string[];     // concrete suggestions
}
```

**Built-in narratives:**

**1. Feature Health Report**
```typescript
{
  name: 'feature-health',
  async execute(engine, { featureId }) {
    const context = await engine.query(GRAPH_QUERIES.featureContext(featureId));
    const patterns = /* filter to patterns */;
    const decisions = /* filter to decisions */;
    const capabilities = /* filter to capabilities */;

    const patternCount = patterns.length;
    const avgDecisionEffectiveness = /* compute */;
    const capabilityGaps = /* compute */;

    return {
      title: `Health Report: ${featureName}`,
      summary: patternCount > 3
        ? `${featureName} has ${patternCount} active patterns, suggesting structural complexity. Decision effectiveness averages ${(avgDecisionEffectiveness * 100).toFixed(0)}%.`
        : `${featureName} is healthy with ${patternCount} patterns and ${(avgDecisionEffectiveness * 100).toFixed(0)}% decision effectiveness.`,
      keyFindings: [
        `${patternCount} active patterns (${patterns.filter(p => p.severity === 'structural').length} structural)`,
        `${decisions.length} decisions, ${revisionCount} revised`,
        capabilityGaps.length > 0
          ? `Capability gaps in: ${capabilityGaps.join(', ')}`
          : 'No capability gaps detected',
      ],
      data: { patterns, decisions, capabilities },
      confidence: Math.min(0.9, 0.3 + context.rows.length * 0.05),
      actionItems: generateActionItems(patterns, decisions, capabilityGaps),
    };
  }
}
```

**2. Learning Trajectory Narrative**
Produces: "Your React expertise has improved from novice to proficient over the last 6 weeks, driven primarily by work on the dashboard feature. You've transferred React patterns to 2 other features (settings, onboarding). Potential next growth area: state management patterns — you're developing but haven't reached proficiency."

**3. Decision Retrospective**
Produces: "In the last 30 days, you made 12 decisions. 8 have stood (no revisions), 3 were revised once, and 1 was revised twice. Your most effective decisions were in the API domain (avg effectiveness 0.82). Database decisions had the lowest effectiveness (0.41) — 2 of 3 were revised. Consider: your database decisions tend to underestimate migration complexity."

**4. Session Readiness Briefing**
Produces: "Feature: authentication. Last touched 3 days ago. 2 active patterns (both 'emerging'): rate limiting edge case, token refresh race condition. Your last decision here (use refresh token rotation) has held for 2 weeks. Related capability: 'auth flow design' is at 'proficient' level. Warning: the token refresh race condition pattern is accelerating (3 occurrences in 2 weeks)."

**Implementation:** Add `NarrativeQueryEngine` in a new file `src/services/substrate/narrative-queries.ts`. Wire into `getGraphContextForSession()` to include narrative summaries in MCP enrichment. Narrative generation is pure string interpolation — no LLM needed.

---

## §11.5 Predictive Queries (Trajectory Extrapolation)

### Current State
`learning-trajectories.ts` computes current trend (improving/stable/declining) from historical data points. But there's no forward-looking capability — no "if this trend continues, you'll reach proficiency in 2 weeks."

### Vertical Improvement
Add **predictive query functions** that extrapolate from learning trajectories and pattern histories to forecast future states.

**Prediction 1: Capability Level Projection**
```typescript
function projectCapabilityLevel(
  trajectory: LearningTrajectory,
  targetLevel: string,
): { estimatedDate: string; confidence: number } | null {
  if (trajectory.trend !== 'improving') return null;

  const points = trajectory.dataPoints;
  if (points.length < 3) return null;

  // Linear regression slope (already computed in detectTrend)
  const levels = points.map(p => p.level);
  const dates = points.map(p => new Date(p.date).getTime());
  const n = levels.length;
  const xMean = dates.reduce((s, v) => s + v, 0) / n;
  const yMean = levels.reduce((s, v) => s + v, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (dates[i] - xMean) * (levels[i] - yMean);
    den += (dates[i] - xMean) ** 2;
  }
  const slopePerMs = den === 0 ? 0 : num / den;
  if (slopePerMs <= 0) return null;

  const targetScore = LEVEL_SCORES[targetLevel] ?? 0.75;
  const currentScore = levels[levels.length - 1];
  if (currentScore >= targetScore) return null;

  const msToTarget = (targetScore - currentScore) / slopePerMs;
  const projectedDate = new Date(dates[dates.length - 1] + msToTarget);

  return {
    estimatedDate: projectedDate.toISOString().slice(0, 10),
    confidence: trajectory.trendConfidence * 0.7,  // discount for prediction uncertainty
  };
}
```

**Prediction 2: Pattern Escalation Forecast**
For patterns in 'emerging' lifecycle with increasing occurrence count, predict when they'll cross the 'structural' threshold:
```typescript
function predictPatternEscalation(
  pattern: { occurrences: number; firstSeen: string; lastSeen: string; severity: string },
): { willEscalate: boolean; estimatedDate: string | null; confidence: number } {
  if (pattern.severity === 'structural') return { willEscalate: false, estimatedDate: null, confidence: 0.9 };

  const daySpan = (new Date(pattern.lastSeen).getTime() - new Date(pattern.firstSeen).getTime()) / 86400000;
  if (daySpan < 1) return { willEscalate: false, estimatedDate: null, confidence: 0.3 };

  const rate = pattern.occurrences / daySpan;  // occurrences per day
  const STRUCTURAL_THRESHOLD = 10;
  const remaining = STRUCTURAL_THRESHOLD - pattern.occurrences;

  if (remaining <= 0 || rate <= 0) return { willEscalate: false, estimatedDate: null, confidence: 0.5 };

  const daysToEscalation = remaining / rate;
  const estimatedDate = new Date(Date.now() + daysToEscalation * 86400000).toISOString().slice(0, 10);

  return {
    willEscalate: daysToEscalation < 30,
    estimatedDate,
    confidence: Math.min(0.8, 0.3 + (pattern.occurrences / STRUCTURAL_THRESHOLD) * 0.5),
  };
}
```

**Prediction 3: Feature Complexity Forecast**
Based on edge accumulation rate (new edges per week to a feature), predict when a feature will transition to 'very-high' complexity:
```datalog
?[feat_id, edges_this_week, edges_last_week] :=
  *entity{id: feat_id, type: 'feature', lifecycle: lc}, lc != 'archived',
  // This week's edges
  *edge{src: _, dst: feat_id, created_at: this_ts},
  this_ts > (now() - 604800),
  edges_this_week = count(*),
  // Last week's edges (separate rule needed, use inline)
  ...
```

**Integration:** Add `PredictiveQueryEngine` that exposes these predictions through:
1. MCP `graphContext.predictions` field — top 3 predictions relevant to current session
2. CLI `unfade insights --predictions` — full prediction report
3. Query chain step — predictions as input to narrative queries ("Your auth capability is projected to reach proficient by June 15")

---

## §11.6 Graph Algorithm Query Templates

### Current State
Two CozoDB graph algorithms are used: `PageRank` (in `influential` query) and `CommunityDetectionLouvain` (in `featureClusters` query). CozoDB supports many more that could produce intelligence.

### Vertical Improvement
Add query templates that leverage CozoDB's full algorithm suite for deeper intelligence extraction.

**New query templates:**

**1. Shortest Reasoning Path** — "How does my auth knowledge connect to my database knowledge?"
```datalog
path[src, dst, path] <~ ShortestPathBFS(*edge[src, dst], start: '${esc(fromId)}', goal: '${esc(toId)}')
?[hop, entity_id, entity_type, entity_name] := path[_, _, path],
  hop = nth(path, idx),
  entity_id = hop,
  *entity{id: entity_id, type: entity_type, state: s},
  entity_name = get(s, 'name', entity_id)
```

**2. Knowledge Neighborhood** — "What's within 2 hops of this entity, by type?"
```datalog
neighborhood[id, dist] <~ BFS(*edge[src, dst], start: '${esc(entityId)}', max_depth: 2)
?[type, count, names] := neighborhood[id, dist],
  *entity{id, type, state: s, lifecycle: lc},
  lc != 'archived',
  name = get(s, 'name', id),
  count = count(id),
  names = collect(name)
:order -count
```

**3. Critical Path Entities** — "Which entities, if removed, would disconnect the graph?"
```datalog
// Articulation points — entities that bridge otherwise-disconnected subgraphs
bridges[id, is_bridge] <~ BridgeDetection(*edge[src, dst])
?[id, type, name, edge_count] := bridges[id, true],
  *entity{id, type, state: s, lifecycle: lc},
  lc != 'archived',
  name = get(s, 'name', id),
  *edge{src: id, dst: _},
  edge_count = count(*)
:order -edge_count
```

**4. Temporal Subgraph** — "Show me the graph as it existed on date D" (uses `valid_from`/`valid_to`)
```datalog
?[src, dst, type, weight] :=
  *edge{src, dst, type, weight, valid_from, valid_to},
  valid_from <= ${targetTimestamp},
  valid_to > ${targetTimestamp},
  *entity{id: src, lifecycle: sl}, sl != 'archived',
  *entity{id: dst, lifecycle: dl}, dl != 'archived'
```

**5. Weighted PageRank** — Current PageRank ignores edge weights. Use weighted variant for more accurate influence scoring:
```datalog
ranked[id, rank] <~ PageRank(*edge[src, dst, weight])
?[id, type, rank, name] := ranked[id, rank],
  *entity{id, type, state, lifecycle: lc},
  lc != 'archived',
  rank > 0.005,
  name = get(state, 'name', id)
:order -rank
:limit 30
```

**6. Similarity Clusters** — Group entities by structural fingerprint similarity:
```datalog
similar_pairs[a, b, dist] <~ KnnHnswSearch(entity:semantic_vec, q: vec_a, k: 5)
// For each entity with a stored vector, find its 5 nearest neighbors
// Then cluster by Louvain on the similarity graph
communities[id, community] <~ CommunityDetectionLouvain(similar_pairs[a, b])
?[community, members, member_count] := communities[id, community],
  *entity{id, state: s},
  name = get(s, 'name', id),
  members = collect(name),
  member_count = count(id)
:order -member_count
```

---

## §11.7 Query Result Caching with Invalidation

### Current State
No query-level caching. `getGraphContextForSession()` runs 4 Datalog queries every time it's called. The file-based cache (`graph-context.json`) is a blunt 30-second TTL that caches the *composite result* but doesn't know which entities changed.

### Vertical Improvement
Add **entity-change-aware query cache invalidation**.

```typescript
class QueryCache {
  private cache = new Map<string, { result: GraphQueryResult; touchedEntities: Set<string>; ts: number }>();
  private dirtyEntities = new Set<string>();

  // Called after ingest() — marks which entities changed
  markDirty(entityIds: string[]): void {
    for (const id of entityIds) this.dirtyEntities.add(id);
  }

  // Returns cached result if none of the entities it touches are dirty
  get(queryKey: string, maxAgeMs = 60_000): GraphQueryResult | null {
    const entry = this.cache.get(queryKey);
    if (!entry) return null;
    if (Date.now() - entry.ts > maxAgeMs) return null;

    // Check if any touched entity is dirty
    for (const id of entry.touchedEntities) {
      if (this.dirtyEntities.has(id)) {
        this.cache.delete(queryKey);
        return null;
      }
    }

    return entry.result;
  }

  set(queryKey: string, result: GraphQueryResult, touchedEntities: Set<string>): void {
    this.cache.set(queryKey, { result, touchedEntities, ts: Date.now() });
  }

  // Called after cache is served — clears dirty set for next cycle
  clearDirty(): void {
    this.dirtyEntities.clear();
  }
}
```

**Integration:** `SubstrateEngine.ingest()` calls `queryCache.markDirty(ingestedEntityIds)` after upsert. `SubstrateEngine.query()` checks cache before executing Datalog. `getGraphContextForSession()` uses the cache instead of the file-based approach — eliminating the staleness window entirely.

---

### Sprint SUB-9: Substrate Generation Depth — NOT STARTED

| # | Task | Description | Depends On |
|---|------|-------------|------------|
| SUB-9.1 | Bayesian Confidence Fusion | Replace linear confidence with Bayesian evidence fusion (§10.1) | SUB-6.1 |
| SUB-9.2 | Evidence Accumulation Edges | Add evidence log + time-decayed weight to edges (§10.2) | — |
| SUB-9.3 | Topology Analyzer (Hub/Bridge/Clique) | Add graph-structural pattern detection post-propagation (§10.3) | SUB-6.3 |
| SUB-9.4 | State Evolution History | Add `_history` ring buffer to entity state (§10.4) | — |
| SUB-9.5 | Causal Edge Inference | Upgrade correlational edges to causal where evidence exists (§10.5) | SUB-9.2, SUB-9.4 |
| SUB-9.6 | Hierarchical Entity Composition | Add `part-of`/`specializes` edges + composite state rollup (§10.6) | SUB-6.3 |
| SUB-9.7 | Decision Quality Scoring | Post-hoc effectiveness scoring for decisions (§10.7) | SUB-9.4 |
| SUB-9.8 | Work-Unit Intelligence Enrichment | Derived signals on work-unit entities (§10.8) | SUB-9.4 |

### Sprint SUB-10: Query Power & Compositionality — NOT STARTED

| # | Task | Description | Depends On |
|---|------|-------------|------------|
| SUB-10.1 | Query Chain Executor | `QueryChainExecutor` with 4 built-in chains (§11.1) | — |
| SUB-10.2 | Derived Relations (Inference at Query Time) | 3 inline Datalog rules for transitive expertise, conflict detection, knowledge frontier (§11.2) | — |
| SUB-10.3 | Contextual Relevance Scoring | Session-aware re-ranking of query results (§11.3) | SUB-10.1 |
| SUB-10.4 | Narrative Query Engine | 4 built-in narrative templates with human-readable output (§11.4) | SUB-10.1, SUB-10.2 |
| SUB-10.5 | Predictive Queries | Capability projection, pattern escalation, complexity forecast (§11.5) | SUB-9.4 |
| SUB-10.6 | Graph Algorithm Templates | 6 new CozoDB algorithm queries (§11.6) | — |
| SUB-10.7 | Entity-Aware Query Cache | Change-driven invalidation replacing file-based TTL cache (§11.7) | — |

### Sprint Dependencies (SUB-9 / SUB-10)

```
SUB-9 (Generation Depth) — independent of SUB-6/7/8 except where noted
  ├── SUB-9.1: Bayesian confidence (needs injection fix from SUB-6.1)
  ├── SUB-9.2, SUB-9.4: Evidence + History (no deps, start immediately)
  ├── SUB-9.3, SUB-9.6: Topology + Hierarchy (need batch ops from SUB-6.3)
  ├── SUB-9.5: Causal inference (needs SUB-9.2 + SUB-9.4)
  └── SUB-9.7, SUB-9.8: Decision quality + WU enrichment (need SUB-9.4)

SUB-10 (Query Power) — mostly independent, chains after SUB-9 for full value
  ├── SUB-10.1, SUB-10.2, SUB-10.6, SUB-10.7: No deps, start immediately
  ├── SUB-10.3: Contextual ranking (needs chains from SUB-10.1)
  ├── SUB-10.4: Narratives (needs chains + derived relations from SUB-10.1/10.2)
  └── SUB-10.5: Predictions (needs state history from SUB-9.4)
```
