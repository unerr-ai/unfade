# Layer 3: Intelligence Pipeline & CozoDB Substrate

Computes developer reasoning intelligence from raw events via 25 incremental analyzers orchestrated by a DAG scheduler, persists entity relationships in an embedded CozoDB graph database, and synthesizes human-readable narratives grounded in the Transmission Thesis.

---

## 1. Architecture Overview

Three concerns, three layers:

| Layer | Responsibility | Where |
|---|---|---|
| **Computation** | HOW intelligence is computed | `src/services/intelligence/` — DAG scheduler, incremental analyzers, classifiers |
| **Representation** | WHAT intelligence IS | `src/services/substrate/` — CozoDB entity graph, relationships, vector index |
| **Presentation** | HOW intelligence is consumed | Narrative engine, MCP queries, dashboard SSE, diagnostics |

Data flows top-down:

```
JSONL events (Layer 1)
  → DuckDB + SQLite (Layer 2 materializer)
    → Classification pipeline (prompt type, domain, decomposition)
      → 25 IncrementalAnalyzers in DAG topological order
        → intelligence/*.json output files
        → EntityContributions → SubstrateEngine → CozoDB graph
          → MCP graph queries, narrative synthesis, diagnostics
```

### Three-Database Architecture

```
~/.unfade/
├── cache/unfade.db          # SQLite — FTS, point lookups, event lineage
├── cache/unfade.duckdb      # DuckDB — time-series analytics, typed columns
├── intelligence/graph.db    # CozoDB (SQLite backend) — entity graph, vector HNSW
```

| Concern | Database | Query Language | Justification |
|---|---|---|---|
| Event storage & FTS | SQLite | SQL | Point lookups, full-text search, operational lineage |
| Time-series analytics | DuckDB | SQL | Columnar scans, typed columns, window aggregations |
| Intelligence graph | CozoDB | Datalog | Recursive traversal, fixed-point computation, graph algorithms, vector HNSW |

Rebuild path: JSONL is the ultimate source of truth. `unfade doctor --rebuild-cache` replays into DuckDB + SQLite. `unfade doctor --rebuild-graph` replays analyzer states into CozoDB.

---

## 2. IncrementalAnalyzer: The Core Abstraction

Every analyzer implements one interface (`src/services/intelligence/incremental-state.ts`):

```
IncrementalAnalyzer<TState, TOutput>:
  name: string                              # Unique ID, used for DAG edges
  outputFile: string                        # Writes to ~/.unfade/intelligence/<outputFile>
  eventFilter: { sources?, types?, requireFields? }
  dependsOn?: string[]                      # DAG edges to upstream analyzers
  minDataPoints: number                     # Skip until enough data exists

  initialize(ctx) → IncrementalState<TState>
  update(state, batch, ctx) → UpdateResult<TState>
  derive(state) → TOutput
  contributeEntities?(state, ctx) → EntityContribution[]   # Optional substrate hook
```

**State persistence**: `IncrementalState<T>` wraps `{ value: T, watermark: string, eventCount: number, updatedAt: string }`. Persisted as JSON in `~/.unfade/intelligence/state/<name>.state.json`. Enables resume-from-watermark on restart — no full-table replays.

**Event batching** (`buildEventBatch()`): Queries DuckDB for events after the global watermark. Returns `NewEventBatch { events, sessionUpdates, featureUpdates }`. Each analyzer gets a filtered view via `filterBatch()` matching its `eventFilter`.

**Update contract**: `f(state, delta) → state'` — pure incremental computation. State goes in, new events go in, updated state comes out. `changed: boolean` and `changeMagnitude: number` control cascade propagation.

---

## 3. DAG Scheduler

`IntelligenceScheduler` (`src/services/intelligence/engine.ts`) orchestrates all 25 analyzers using Kahn's algorithm topological sort.

### Processing Pipeline

```
ON new event batch:
  1. Mark dirty — for each analyzer, check if batch contains matching events
  2. FOR EACH analyzer in topological order:
       IF not dirty → skip
       IF no state → check minDataPoints, initialize if met
       Inject dependency states into enriched context
       Filter batch to this analyzer's eventFilter
       result = analyzer.update(state, filteredBatch, enrichedCtx)
       IF result.changed:
         output = analyzer.derive(state)
         Write output atomically (tmp → rename) to intelligence/<outputFile>
         Save state to intelligence/state/<name>.state.json
         Collect EntityContributions if contributeEntities() exists
         CASCADE: mark dependents dirty IF changeMagnitude > 0.05
  3. Return { results, entityContributions, nodesProcessed, nodesCascaded }
```

**Cascade throttling**: `CASCADE_MAGNITUDE_THRESHOLD = 0.05`. A small upstream change (e.g. efficiency shifted 0.01) does NOT trigger maturity model recomputation. This prevents the N-analyzer DAG from doing O(N) work on every tick.

**Rate limiting**: Minimum interval between runs (`minIntervalMs`, default 10s). Prevents thrashing during burst activity.

### Analyzer DAG

```
                        ┌─── tokenProxyAnalyzer
                        ├─── windowAggregatorAnalyzer
                        ├─── directionByFileAnalyzer
                        ├─── efficiencyAnalyzer
                        ├─── comprehensionRadarAnalyzer
                        ├─── costAttributionAnalyzer
 Leaf nodes             ├─── loopDetectorAnalyzer
 (no dependencies)      ├─── velocityTrackerAnalyzer
                        ├─── promptPatternsAnalyzer
                        ├─── blindSpotDetectorAnalyzer
                        ├─── decisionReplayAnalyzer
                        ├─── sessionIntelligenceAnalyzer
                        ├─── causalityChainAnalyzer
                        ├─── commitAnalyzer ────────────────┐
                        ├─── fileChurnAnalyzer               │ Git intelligence
                        ├─── aiGitLinkerAnalyzer              │ (leaf nodes)
                        └─── expertiseMapAnalyzer ───────────┘
                                    │
                     ┌──────────────┼──────────────────────────┐
                     ▼              ▼                           ▼
              summaryWriter   intelligenceSnapshot   profileAccumulator
              (window+token)  (window+efficiency     (efficiency+window)
                               +session)
                     │              │                           │
                     ▼              ▼                           ▼
              efficiencySurvival  dualVelocity          maturityModel
              (efficiency+churn   (AI+git velocity     (most analyzers)
               +decision-replay)   comparison)               │
                                                              ▼
                                                    maturityOwnership
                                                    (maturity+expertise)
                                                              │
                                                              ▼
                                                      narrativeEngine
                                                      (maturity → narrative)
```

**Registration** (`src/services/intelligence/analyzers/all.ts`): All 25 analyzers exported in `allAnalyzers[]`, ordered leaf-first. The scheduler's `rebuildTopology()` does the actual Kahn sort from `dependsOn` declarations.

---

## 4. Classification Pipeline

Three classifiers run before analyzers, enriching each event with typed metadata.

### 4.1 Prompt Decomposer

**File**: `src/services/intelligence/prompt-decomposer.ts`

Splits multi-intent prompts into segments BEFORE classification. A prompt like "fix the auth bug AND add rate limiting" becomes two segments classified independently.

```
decomposePrompt(text) → PromptDecomposition:
  Tier 1 — Heuristic segmentation (always-on, zero-cost):
    1. Numbered/lettered lists: \d+[.)]\s → each item = segment
    2. Markdown headers: #{1,3}\s → each section = segment
    3. Paragraph breaks: \n\n+ → each paragraph = segment
    4. Discourse markers: "also", "additionally", "separately", etc.
    5. Coordinating conjunctions + verbs: "and fix", "but add"
    6. Semicolons between independent clauses

  Tier 2 — LLM structured extraction (opt-in, batched during distill):
    When Tier 1 confidence < 0.5 or single segment > 200 tokens
    Cached by content SHA256 hash
```

### 4.2 Prompt Classifier

**File**: `src/services/intelligence/prompt-classifier.ts`

8 prompt types: `discovery | building | debugging | refactoring | review | explaining | testing | configuring`. 6 signal layers (verb patterns, question density, file-path specificity, branch context, code blocks, turn position) produce per-type scores. Softmax normalization ensures scores sum to 1.0.

```
classifyPrompt(content, ctx?) → PromptClassification:
  FOR EACH signal layer:
    score each PromptType based on pattern matches (all use \b word boundaries)
  Apply softmax: confidence_i = exp(score_i) / Σ exp(score_j)
  Map primary type → ExecutionPhase (planning|implementing|debugging|reviewing|exploring)
  Resolve targetedModules via feature registry PathTrie
  Return { primaryType, secondaryTypes, confidence, executionPhase, specificity, featureGroupId }
```

### 4.3 Domain Classifier

**File**: `src/services/intelligence/domain-classifier.ts`

10 domains with regex patterns + keyword scoring. Returns sorted domain scores (not first-match-wins). Word-boundary enforcement (`\b`) prevents false positives.

### 4.4 Prompt Chain Analyzer

**File**: `src/services/intelligence/prompt-chain.ts`

9 chain patterns detected across consecutive prompts in a session: `linear-refinement`, `iterative-correction`, `scope-expansion`, `hypothesis-testing`, `constraint-narrowing`, `pivot`, `context-building`, `debugging-spiral`, `completion-sprint`. Uses token Jaccard similarity for cross-turn overlap, Mann-Kendall trend test for monotonicity detection.

---

## 5. Analyzer Categories

### 5.1 Core AI Analyzers

| Analyzer | File | What It Computes |
|---|---|---|
| `efficiency` | `analyzers/efficiency.ts` | AES (AI Efficiency Score): composite of HDS, token efficiency, phase multiplier, rejection rate. EWMA smoothing (α=0.1). Wilson score confidence intervals |
| `comprehension-radar` | `analyzers/comprehension-radar.ts` | Per-module comprehension score: weighted average of decision count × HDS. Phase-adjusted baseline. Percentile-based blind spot detection |
| `loop-detector` | `analyzers/loop-detector.ts` | Greedy clustering by `domain::approach` key. Cosine similarity ≥ 0.7. Detects developers repeating the same approach without progress |
| `velocity-tracker` | `analyzers/velocity-tracker.ts` | Weekly aggregation by domain. Mann-Kendall trend test (τ + p-value). EWMA smoothing. Reports events-per-active-day |
| `cost-attribution` | `analyzers/cost-attribution.ts` | Token-based cost estimation per domain, tool, and session. Event count proxy when token data unavailable |
| `prompt-patterns` | `analyzers/prompt-patterns.ts` | Regex feature extraction (constraints, examples, schema references). Per-domain effectiveness comparison with statistical significance gating |
| `blind-spots` | `analyzers/blind-spots.ts` | Modules with high activity but low comprehension or declining HDS. Alert-based threshold detection |
| `decision-replay` | `analyzers/decision-replay.ts` | Domain drift (similarity 0.3–1.0) and echoed dead-end detection (similarity ≥ 0.5). Calibrated confidence = similarity × evidence_factor |

### 5.2 Git Intelligence Analyzers

| Analyzer | File | What It Computes |
|---|---|---|
| `git-commit-analyzer` | `git-commit-analyzer.ts` | Conventional commit parsing, diff size classification, file-type breakdown, hotspot detection, co-change coupling (Jaccard), temporal distribution |
| `git-file-churn` | `git-file-churn.ts` | Lines added then deleted/modified within 48h or 5 subsequent commits. Per-file churn rate. Mann-Kendall churn trend |
| `ai-git-linker` | `git-ai-linker.ts` | Temporal correlation: links AI sessions to commits within 60-min window with ≥0.3 file overlap. Tracks AI code survival rate over 30 days |
| `git-expertise-map` | `git-expertise-map.ts` | Per-directory expertise score from commit frequency + recency. Knowledge silo detection (ai-only vs git-only vs balanced) |

### 5.3 Cross-Source Analyzers

These fuse signals from AI and git analyzers to answer questions neither source can answer alone.

| Analyzer | File | What It Computes |
|---|---|---|
| `cross-efficiency-survival` | `cross-efficiency-survival.ts` | Fuses AES (efficiency) with code survival (churn) and decision durability. Quadrant classification: `effective-durable`, `effective-fragile`, `inefficient-durable`, `inefficient-fragile` |
| `cross-dual-velocity` | `cross-dual-velocity.ts` | Compares AI velocity (prompts/day) vs git velocity (commits/day). Detects divergence: high AI activity with low git output = "spinning wheels" |
| `cross-maturity-ownership` | `cross-maturity-ownership.ts` | Combines maturity score with file ownership from expertise map. Maps maturity dimensions to specific code areas |

### 5.4 Synthesis Analyzers

| Analyzer | File | What It Computes |
|---|---|---|
| `session-intelligence` | `session-intelligence.ts` | Per-session loop risk (with temporal decay: `risk *= exp(-minutesSinceLastEvent / 30)`), direction trend (EWMA α=0.3), suggested actions |
| `prompt-response-synthesis` | `prompt-response-synthesis.ts` | `effectiveness = hds × (1 - rejectionPenalty) × (1 + specificity × 0.3)`. Strategy profiles per-type and per-feature. Bayesian smoothing Beta(2,2) for small-sample stability |
| `window-aggregator` | `window-aggregator.ts` | Rolling time-window stats (1h, 8h, 24h, 7d) from DuckDB. Input to summary and snapshots |
| `token-proxy` | `token-proxy.ts` | Estimates token usage when upstream providers don't report it. Proxy for cost and efficiency calculations |
| `summary-writer` | `summary-writer.ts` | Composes the `summary.json` dashboard payload from window + token data. Emits onto eventBus for SSE push |
| `intelligence-snapshots` | `intelligence-snapshots.ts` | Periodic snapshots of intelligence state for trend analysis. Depends on window + efficiency + session |
| `cross-analyzer` | `cross-analyzer.ts` | Dynamic N² correlation discovery. Spearman rank correlation (non-parametric) with bootstrap confidence intervals. Multi-lag detection (0–3 days). Confidence decay for stale pairs |

### 5.5 Identity Analyzers

| Analyzer | File | What It Computes |
|---|---|---|
| `maturity-model` | `maturity-model.ts` | 7 weighted dimensions → composite phase score. Piecewise linear mapping to 4 phases (Bare Engine → First Gear → Multi-Gear → Tuned Vehicle). Bayesian smoothing. Mann-Kendall trends per dimension |
| `narrative-engine` | `narrative-engine.ts` | Template-based narrative synthesis from maturity assessment. 3 types: diagnostic, prescription, progress. Severity graduation (mild/moderate/severe). Vehicle-analogy language |
| `profile-accumulator` | `../personalization/profile-accumulator.ts` | Updates the global developer reasoning profile (reasoning_model.json) from efficiency + window data |

### 5.6 Operational Analyzers

| Analyzer | File | What It Computes |
|---|---|---|
| `file-direction` | `file-direction.ts` | Per-file HDS aggregation. Which files have high/low direction scores |
| `causality` | `causality.ts` | Causal chain detection across events. Links decisions to outcomes |
| `decision-durability` | `decision-durability.ts` | Tracks whether past decisions are revisited/reversed. Time-weighted replay penalty |
| `cross-project` | `cross-project.ts` | Loads per-project analyzer states, detects pattern transfer opportunities, efficiency gaps across projects |

---

## 6. Maturity Model

**File**: `src/services/intelligence/maturity-model.ts`

4 phases aligned with the Transmission Thesis vehicle analogy:

| Phase | Label | Composite Score | Analogy |
|---|---|---|---|
| 1 | `bare-engine` | 0.0–0.25 | Raw power, no control |
| 2 | `first-gear` | 0.25–0.50 | Basic gear engagement |
| 3 | `multi-gear` | 0.50–0.70 | Smooth shifting |
| 4 | `tuned-vehicle` | 0.70–1.00 | Fully optimized |

### 7 Dimensions

```
compositeScore = Σ(dimension.score × dimension.weight) / Σ(dimension.weight)

Dimensions:
  direction          — HDS trend over recent sessions
  efficiency         — AES from efficiency analyzer
  comprehension      — radar score from comprehension-radar
  loop-resilience    — resolved / (resolved + stuck), no loops = 0.5 neutral
  domain-consistency — coefficient of variation of per-domain effectiveness
  decision-durability — 1 - Σ(penalty × decay(time_to_replay))
  context-leverage   — prompts referencing prior decisions / total prompts
```

**Bayesian smoothing** (`bayesianSmooth()` from `utils/stats.ts`): Beta(2,2) prior stabilizes small-sample dimension scores.

**Trend detection**: Mann-Kendall test per dimension. Non-parametric, works with 5+ points, returns τ (direction/strength) and p-value.

**Bottleneck detection**: Per-phase thresholds. If a dimension is below its phase threshold, it's a bottleneck with `impact = requiredScore - currentScore`.

---

## 7. Diagnostic Stream

**File**: `src/services/intelligence/diagnostic-stream.ts`

Real-time diagnostic emission. Any analyzer can emit diagnostics during `update()`. Consumers: MCP tools, dashboard SSE, narrative engine.

```
DiagnosticStream (singleton):
  ring buffer: Diagnostic[] (MAX_ACTIVE = 100)
  listeners: Set<(d: Diagnostic) => void>

  emit(partial) → void:
    Assign id = sha256(analyzer + message + timestamp)[:12]
    Set TTL based on scope: event=5min, session=30min, hour=1h, day=24h
    Push to buffer, trim if > MAX_ACTIVE
    Notify all listeners

  subscribe(cb) → unsubscribe
  getActive() → Diagnostic[]  (filtered by expiresAt > now)
```

**Diagnostic types**: `observation` (neutral), `warning` (attention needed), `recommendation` (actionable suggestion).

**Scope-based TTL**: Event-scoped diagnostics expire in 5 minutes. Day-scoped persist 24 hours. Auto-pruned on next emit.

---

## 8. Feature Registry

**File**: `src/services/intelligence/feature-registry.ts`

Dynamic, unbounded feature discovery. No hardcoded feature list. Features are learned from:
- Directory structure (primary)
- Git commit frequency
- Branch naming conventions
- Prompt content references

### PathTrie

O(log n) prefix matching of file paths to features. Used by prompt classifier (`targetedModules`), comprehension radar (per-module scores), and substrate entity mapper.

```
PathTrie:
  insert("src/services/auth/middleware", "feat-auth-middleware")
  resolve("src/services/auth/middleware/jwt.ts") → "feat-auth-middleware"

  Implementation: trie of path segments. Longest-prefix match.
  Stored: ~/.unfade/intelligence/feature-registry.json
```

**Hierarchical**: Features have `parentId` and `children`, forming a tree. `src/services/auth` is parent of `src/services/auth/middleware`.

---

## 9. CozoDB Substrate

**Directory**: `src/services/substrate/`

Embedded Datalog graph database (CozoDB with SQLite backend) at `~/.unfade/intelligence/graph.db`. The substrate is the persistent, queryable semantic representation of computed intelligence.

### 9.1 Schema

**File**: `src/services/substrate/schema.ts`

Three stored relations:

```datalog
:create entity {
  id: String,
  type: String,              # work-unit | decision | feature | pattern | capability |
  project_id: String,        #   diagnostic | maturity-assessment | commit | hotspot
  created_at: Float,
  last_updated: Float,
  confidence: Float default 0.5,
  lifecycle: String default 'emerging',
  => state: Json,
     embedding: [Float; 64] default null
}

:create entity_source {
  entity_id: String,
  analyzer: String,
  => last_contributed: Float,
     contribution_count: Int default 1
}

:create edge {
  src: String,
  dst: String,
  type: String,              # produced-by | targets | demonstrates | evidences |
  => weight: Float default 1.0,    #   revises | accumulates-to | depends-on | applies-to |
     created_at: Float,            #   learned-from | assessed-at | bottlenecked-by |
     evidence: String default '',  #   narrated-by | part-of | co-occurred-with
     valid_from: Float,
     valid_to: Float default 9999999999.0
}
```

**HNSW Vector Index**: 64-dimensional embeddings on entities for semantic similarity search. Filter excludes archived entities.

```datalog
::hnsw create entity:semantic_vec {
  dim: 64, ef: 50, fields: [embedding],
  filter: lifecycle != 'archived'
}
```

**Entity lifecycle**: `emerging → established → confirmed → decaying → archived`. Active entities capped at ~500 via aging rules. Archived entities in separate relation for cold queries.

### 9.2 Connection Manager

**File**: `src/services/substrate/cozo-manager.ts`

Singleton with health check on cached instance return. Schema migration via `meta` relation with `schema_version`.

```
CozoManager.getInstance(cwd?):
  IF cached instance exists AND health check passes → return it
  ELSE:
    TRY open SQLite-backed CozoDB at ~/.unfade/intelligence/graph.db
    CATCH → fallback to in-memory CozoDB
    Run ensureSchema() → create all stored relations if missing
    Run runMigrations() → check meta.schema_version, apply upgrades
    Return instance

CozoManager.createTestInstance() → in-memory CozoDB (for tests)
```

### 9.3 Entity Resolution

**File**: `src/services/substrate/entity-resolver.ts`

Multiple analyzers contribute to the same entity. Entity resolution merges their contributions using configurable per-field merge strategies.

```
resolveContributions(contributions[]) → ResolvedEntity:
  Group contributions by entityId
  FOR EACH entity:
    FOR EACH field in stateFragment:
      Apply merge strategy:
        loopRisk, efficiency, comprehension, velocity → EWMA (α=0.3)
        directionTrend, phase, outcome, avgHds        → latestWins
        confidence, turnCount, totalSessions           → max
        techniques, applicableFeatures                 → arrayUnion
        occurrences, contributionCount                 → sum
    confidence += CONFIDENCE_PER_SOURCE (0.15) per contributing analyzer
    Track sources in entity_source relation
```

13 built-in strategies in `BUILTIN_STRATEGIES` map. Default for unknown fields: `latestWins`.

### 9.4 Backward Propagation

**File**: `src/services/substrate/propagation-rules.ts`

Declarative rules: Datalog trigger query paired with TypeScript apply function. Max depth 2 to prevent infinite loops. Dirty flag prevents re-entrant updates.

**Built-in rules** (`BUILTIN_RULES`):

| Rule | Trigger | Effect |
|---|---|---|
| `diagnostic-to-pattern-promotion` | 5+ active diagnostics on same feature | Create persistent pattern entity |
| `feature-complexity-update` | Feature has high loop rate + low comprehension | Update feature complexity state |
| `lifecycle-decay` | Entity not updated in 14+ days | Transition lifecycle toward `decaying` |
| `decision-revision-chain` | New decision targets same feature as prior decision | Create `revises` edge |
| `capability-evidence` | Pattern demonstrated 5+ times | Promote to capability entity |
| `temporal-edge-expiry` | Edge `valid_to` in the past | Archive expired relationship |

```
PropagationEngine.run(db, now):
  FOR EACH rule in BUILTIN_RULES:
    matches = db.run(rule.triggerQuery)
    IF matches.length > 0:
      applied = rule.apply(db, matches, now)
      Track { rule.name, matched, applied }
  Return { rulesEvaluated, totalEntitiesUpdated, totalEdgesCreated }
```

### 9.5 SubstrateEngine

**File**: `src/services/substrate/substrate-engine.ts`

Bridge between Phase 16 analyzers and CozoDB. Handles Datalog injection prevention (`escCozo()`), batch ingestion, error recovery.

```
SubstrateEngine(db: CozoDb):

  ingest(contributions: EntityContribution[]):
    resolved = resolveContributions(contributions)
    FOR EACH entity in resolved:
      Batch upsert: entity relation + entity_source relation + edge relations
      All string values escaped via escCozo()
      Failed entities don't block others
    Return IngestionReport { entitiesUpserted, edgesUpserted, sourcesTracked, errors }

  propagate(now):
    Return propagationEngine.run(db, now)

  query(datalogQuery):
    Return db.run(query)
```

### 9.6 Graph Queries

**File**: `src/services/substrate/graph-queries.ts`

Pre-built Datalog query templates for MCP and dashboard. All queries have `:limit` clauses (default 50). Temporal filtering via `valid_from`/`valid_to` on edges.

| Query | What It Returns |
|---|---|
| `sessionContext(sessionId)` | Features targeted by session, with comprehension, loop rate, decision count |
| `featureContext(featureId)` | All entities connected to a feature, ordered by edge weight |
| `capabilityMap(domain)` | Capabilities with level, evidence count, trend |
| `relatedDecisions(featureId)` | Decisions targeting a feature, with HDS and domain |

### 9.7 Supporting Modules

| File | Purpose |
|---|---|
| `entity-mapper.ts` | Maps analyzer outputs to `EntityContribution` objects for substrate ingestion |
| `diagnostic-accumulator.ts` | Accumulates diagnostics from the stream into substrate pattern entities |
| `learning-trajectories.ts` | Tracks capability growth trajectories as evidence-grounded entity chains |
| `generation-depth.ts` | Computes graph generation depth for entity provenance |
| `query-power.ts` | Exposes high-level semantic queries (e.g., "what patterns apply to this feature?") |

---

## 10. Narrative Synthesis

### 10.1 Narrative Engine

**File**: `src/services/intelligence/narrative-engine.ts`

Template-based narrative generation from maturity assessment. Three types: diagnostic (what's happening), prescription (what to do), progress (what improved). Vehicle-analogy language from the Transmission Thesis.

```
NarrativeTemplate:
  id: string
  type: "diagnostic" | "prescription" | "progress"
  condition: (ctx: NarrativeContext) → boolean
  generate: (ctx: NarrativeContext) → Narrative

NarrativeContext:
  maturity: MaturityAssessment
  dimensions: MaturityDimension[]
  eventCount: number
```

Example template: `"loose-steering"` — fires when direction dimension score < 0.3. Generates diagnostic: "Your steering is loose — prompts are shifting direction frequently without resolution."

**Severity graduation**: Each template has 3 severity variants selected by score ranges (mild/moderate/severe).

### 10.2 Narrative Templates

**File**: `src/services/intelligence/narrative-templates.ts`

Extended template library covering all 7 maturity dimensions + cross-dimension combinations. Variation via `hash(date + dimension)` for deterministic but non-repetitive output.

### 10.3 Narrative Synthesizer

**File**: `src/services/intelligence/narrative-synthesizer.ts`

Composes individual narratives into a coherent executive summary with temporal context ("dropped 15% this week" instead of just "low").

---

## 11. Supporting Intelligence Services

### 11.1 Statistical Utilities

**File**: `src/services/intelligence/utils/stats.ts`

| Function | Purpose |
|---|---|
| `bayesianSmooth(successes, trials)` | Beta(2,2) prior: `(k + 2) / (n + 4)`. Stabilizes small-sample estimates |
| `mannKendall(values)` | Non-parametric trend test. Returns `{ tau, pValue, trend }`. Works with 5+ points |
| `spearmanRank(x, y)` | Rank correlation for non-normal distributions |
| `wilsonScore(successes, trials)` | Confidence interval for proportions |

### 11.2 Text Similarity

**File**: `src/services/intelligence/utils/text-similarity.ts`

Token-level Jaccard similarity, cosine similarity for bag-of-words vectors. Used by loop detector, decision replay, chain analyzer.

### 11.3 Trend Detection

**File**: `src/services/intelligence/utils/trend.ts`

EWMA (exponential weighted moving average), linear regression, direction trend classification.

### 11.4 Lineage

**File**: `src/services/intelligence/lineage.ts`

Writes `event_insight_map` entries to SQLite: links events to the intelligence outputs they contributed to. Enables "why does this insight exist?" provenance queries.

### 11.5 Other Services

| File | Purpose |
|---|---|
| `cold-start.ts` | Special handling when < minDataPoints events exist |
| `first-run-trigger.ts` | Triggers initial intelligence computation on first `unfade` run |
| `first-run-analyzer.ts` | Lightweight analysis for immediate feedback on first run |
| `global-index.ts` | Cross-project intelligence index |
| `identity.ts` | Developer identity aggregation |
| `methodology.ts` | Methodology pattern detection |
| `debugging-arcs.ts` | Multi-turn debugging arc detection and analysis |
| `cost-quality.ts` | Cost vs quality tradeoff analysis |
| `value-receipt.ts` | Generates "value receipt" — summary of intelligence value delivered |
| `mcp-enrichment.ts` | Enriches MCP responses with intelligence context |
| `phase-baselines.ts` | Per-phase baseline scores for dimension normalization |
| `outcome-classifier.ts` | Classifies session outcomes (success/partial/abandoned) |
| `pipeline-verify.ts` | Verifies intelligence pipeline health |
| `intelligence-snapshots.ts` | Periodic state snapshots for historical analysis |
| `recent-insights.ts` | Ring buffer of recent insights for dashboard |
| `nudges.ts` | Contextual nudge generation for the developer |
| `presentation.ts` | Intelligence presentation formatting |
| `rdi.ts` | Reasoning Density Index computation |
| `snapshot.ts` | Point-in-time intelligence snapshot |
| `velocity.ts` | Velocity computation utilities |

---

## 12. Integration Points

### 12.1 Scheduler → Substrate

After the DAG scheduler completes a cycle, it returns `entityContributions[]`. The upstream caller (repo-manager) feeds these into `SubstrateEngine.ingest()`:

```
schedulerResult = scheduler.processEvents(ctx)
IF schedulerResult.entityContributions.length > 0:
  substrateEngine.ingest(schedulerResult.entityContributions)
  substrateEngine.propagate(Date.now())
```

### 12.2 Substrate → MCP

MCP tools query the graph for semantic context injection into AI conversations:

```
MCP "query_context" tool:
  graph_queries.sessionContext(sessionId)
    → "You're working on auth/middleware. Past sessions here had 25% loop rate.
       3 decisions exist. Comprehension is 72%."
```

### 12.3 Substrate → Dashboard SSE

Intelligence updates are emitted on the eventBus and pushed via SSE to the React dashboard:

```
summary-writer emits → eventBus.emitBus({ type: "summary", data })
                     → SSE route pushes to connected browsers
                     → React queryClient updates via src/ui/lib/sse.ts
```

### 12.4 Intelligence → Distill

The daily distill pipeline (`src/services/distill/distiller.ts`) consumes intelligence outputs for context-enriched synthesis:
- Analyzer outputs provide structured signal
- Feature registry maps files to features
- Maturity assessment provides developmental context

---

## 13. Design Decisions

### Why Incremental State, Not Full Recomputation?

Full SQL scans on every tick are O(N) where N = total events. With 1000+ events/day, this quickly becomes expensive. Incremental state is O(delta) — only new events are processed. State persistence enables restart without replay. Tradeoff: state files can diverge from source data. Mitigation: `unfade doctor --rebuild-cache` forces full recomputation from JSONL.

### Why a DAG Scheduler, Not Sequential Processing?

Analyzers have dependencies. Maturity model depends on efficiency, comprehension, loop detection, velocity, and more. Sequential execution either (a) runs all analyzers every tick even when only one changed, or (b) requires manual ordering that breaks when dependencies change. The DAG with dirty-marking and cascade throttling runs the minimum necessary computation each tick.

### Why CozoDB, Not Neo4j or Plain SQLite?

| Requirement | CozoDB | Neo4j | SQLite |
|---|---|---|---|
| Embedded (no server) | Yes (NAPI binding) | No (requires JVM server) | Yes |
| Recursive graph traversal | Datalog fixed-point | Cypher `MATCH` paths | Manual CTEs |
| Vector similarity (HNSW) | Built-in | Plugin (post-4.x) | External extension |
| Graph algorithms (PageRank) | Built-in | Plugin (GDS library) | Not available |
| Single file deployment | Yes (SQLite backend) | No | Yes |
| Datalog expressiveness | Full Datalog with aggregation | Cypher (different paradigm) | SQL only |

Fallback: if CozoDB maintenance stalls, Kuzu (Cypher, actively maintained, embedded NAPI) is a migration target. The `SubstrateEngine` abstraction isolates graph queries from the rest of the system.

### Why Entity Resolution, Not Separate Entity Stores?

Multiple analyzers observe the same real-world thing (a feature, a session, a decision) from different angles. Without entity resolution, the system has N fragmented views. With resolution, it has one unified entity enriched by all contributing analyzers. EWMA merge for scores (smooths noise), arrayUnion for lists (preserves diversity), max for counts (conservative estimate).

### Why Backward Propagation?

Statistical analyzers process events forward in time. But intelligence is often backward: discovering a pattern NOW should retroactively adjust how we interpret PAST sessions. Backward propagation rules are declarative (Datalog trigger + TypeScript apply), depth-limited (max 2), and auditable. They keep the graph coherent without requiring analyzers to be aware of each other.

### Why the Transmission Thesis?

Developer-AI collaboration is an emerging category with no established mental model. The vehicle analogy (engine = AI tool, transmission = intelligence layer, steering = developer direction) provides:
- Intuitive narrative language for diagnostics ("your steering is loose")
- Natural phase progression (bare engine → tuned vehicle)
- Grounding for maturity assessment dimensions

---

## 14. File Map

### Intelligence Pipeline (`src/services/intelligence/`)

| File | Lines | Purpose |
|---|---|---|
| `engine.ts` | ~200 | IntelligenceScheduler: DAG-based analyzer orchestration |
| `incremental-state.ts` | ~150 | IncrementalAnalyzer interface, state persistence, batch building |
| `analyzers/all.ts` | ~70 | Barrel export of all 25 analyzers |
| `analyzers/index.ts` | ~30 | AnalyzerContext and AnalyzerResult types |
| **Classifiers** | | |
| `prompt-classifier.ts` | ~300 | 8-type prompt classification with softmax |
| `prompt-decomposer.ts` | ~200 | Multi-intent prompt segmentation |
| `domain-classifier.ts` | ~200 | 10-domain classification with keyword scoring |
| `prompt-chain.ts` | ~250 | 9 chain pattern detection |
| **Core AI Analyzers** | | |
| `analyzers/efficiency.ts` | ~200 | AES composite metric |
| `analyzers/comprehension-radar.ts` | ~150 | Per-module comprehension scoring |
| `analyzers/loop-detector.ts` | ~200 | Repetitive-approach clustering |
| `analyzers/velocity-tracker.ts` | ~150 | Activity velocity with trend detection |
| `analyzers/cost-attribution.ts` | ~100 | Token/event cost estimation |
| `analyzers/prompt-patterns.ts` | ~200 | Prompt feature effectiveness |
| `analyzers/blind-spots.ts` | ~100 | Low-comprehension module detection |
| `analyzers/decision-replay.ts` | ~150 | Decision revisitation detection |
| **Git Intelligence** | | |
| `git-commit-analyzer.ts` | ~250 | Commit parsing, hotspots, coupling |
| `git-file-churn.ts` | ~150 | Code churn rate tracking |
| `git-ai-linker.ts` | ~200 | AI session → commit temporal linking |
| `git-expertise-map.ts` | ~150 | Per-directory expertise scoring |
| **Cross-Source** | | |
| `cross-efficiency-survival.ts` | ~120 | AES × code survival quadrant |
| `cross-dual-velocity.ts` | ~120 | AI vs git velocity comparison |
| `cross-maturity-ownership.ts` | ~120 | Maturity × file ownership |
| `cross-analyzer.ts` | ~200 | Dynamic N² correlation discovery |
| `cross-project.ts` | ~200 | Cross-project pattern transfer |
| **Synthesis** | | |
| `session-intelligence.ts` | ~150 | Per-session loop risk + direction |
| `prompt-response-synthesis.ts` | ~200 | Prompt→response effectiveness |
| `window-aggregator.ts` | ~150 | Rolling time-window stats |
| `token-proxy.ts` | ~100 | Token usage estimation |
| `summary-writer.ts` | ~150 | Dashboard summary.json + SSE emit |
| `intelligence-snapshots.ts` | ~100 | Periodic state snapshots |
| **Identity** | | |
| `maturity-model.ts` | ~300 | 7-dimension, 4-phase maturity assessment |
| `narrative-engine.ts` | ~250 | Template-based narrative synthesis |
| `narrative-templates.ts` | ~200 | Extended template library |
| `narrative-synthesizer.ts` | ~150 | Executive summary composition |
| **Infrastructure** | | |
| `feature-registry.ts` | ~300 | Dynamic feature discovery + PathTrie |
| `diagnostic-stream.ts` | ~100 | Ring buffer diagnostic emission |
| `lineage.ts` | ~80 | Event→insight provenance mapping |
| `file-direction.ts` | ~100 | Per-file HDS aggregation |
| `causality.ts` | ~150 | Causal chain detection |
| `decision-durability.ts` | ~150 | Decision revision tracking |
| **Utilities** | | |
| `utils/stats.ts` | ~150 | Bayesian smoothing, Mann-Kendall, Spearman, Wilson |
| `utils/text-similarity.ts` | ~80 | Jaccard + cosine similarity |
| `utils/trend.ts` | ~100 | EWMA, linear regression |

### Substrate (`src/services/substrate/`)

| File | Lines | Purpose |
|---|---|---|
| `substrate-engine.ts` | ~200 | Bridge: analyzer contributions → CozoDB. Batch ingestion, escaping |
| `schema.ts` | ~80 | Datalog stored relations: entity, edge, entity_source. HNSW index |
| `cozo-manager.ts` | ~100 | Singleton connection manager with health check + migration |
| `entity-resolver.ts` | ~100 | Multi-analyzer entity merge with 13 strategies |
| `propagation-rules.ts` | ~200 | 6 declarative backward propagation rules |
| `graph-queries.ts` | ~150 | Pre-built Datalog query templates for MCP |
| `entity-mapper.ts` | ~100 | Analyzer output → EntityContribution mapping |
| `diagnostic-accumulator.ts` | ~100 | DiagnosticStream → substrate pattern entities |
| `learning-trajectories.ts` | ~100 | Capability growth trajectory tracking |
| `generation-depth.ts` | ~80 | Graph generation depth for provenance |
| `query-power.ts` | ~100 | High-level semantic query interface |

---

## 15. Transmission Thesis Cross-Reference

How the intelligence layer implements each Transmission Thesis function:

| Transmission Function | Implementation |
|---|---|
| **Detect gear** | Prompt classifier → 8 types with softmax confidence. Chain analyzer → 9 patterns |
| **Shift gear** | Diagnostic stream → actionable recommendations. Grounded in past resolution patterns from graph traversal |
| **Learn driver habits** | Profile accumulator → reasoning_model.json. Learning trajectories as substrate entities with evidence chains |
| **Remember road conditions** | Feature registry PathTrie + substrate feature entities with comprehension, velocity, loop rate, decision history |
| **Predict road ahead** | Cross-analyzer correlations. Graph-derived: "this feature + this prompt type → this outcome" via multi-hop traversal |
| **Adapt to conditions** | Phase-normalized baselines. Backward propagation: feature complexity informs loop thresholds |
| **Transfer knowledge** | Cross-project analyzer + substrate entity matching via shared patterns/capabilities |
| **Explain decisions** | Full provenance: lineage mapping (event → insight) + graph chain (recommendation → pattern → evidence → events) |
| **Know thyself** | Maturity model → 4-phase assessment. Capability map via substrate PageRank |
| **Tell the story** | Narrative engine → vehicle-analogy diagnostics, prescriptions, progress. Graph-enhanced evidence chains |

---

## 16. Quality Audit Summary

Key algorithmic quality patterns implemented across the pipeline:

| Pattern | Where Applied | What It Does |
|---|---|---|
| **Softmax normalization** | Prompt classifier | Makes multi-type scores comparable and sum to 1.0 |
| **Bayesian smoothing Beta(2,2)** | Maturity model, prompt-response synthesis | Stabilizes small-sample score estimates |
| **Mann-Kendall trend test** | Velocity tracker, maturity dimensions, churn trend | Non-parametric trend detection (τ + p-value) |
| **EWMA (α=0.3)** | Entity resolution, session intelligence, efficiency | Exponential smoothing with recency bias |
| **Wilson score interval** | Efficiency analyzer | Confidence interval for proportions |
| **Spearman rank correlation** | Cross-analyzer | Non-parametric correlation for non-normal distributions |
| **Word boundary regex (`\b`)** | All classifiers | Prevents false-positive keyword matches |
| **Temporal decay** | Session intelligence loop risk, diagnostic TTL, entity lifecycle | Older signals naturally age out |
| **Cascade magnitude throttling** | DAG scheduler | Prevents small upstream changes from triggering full DAG recomputation |
| **Datalog injection prevention** | SubstrateEngine | `escCozo()` escapes all string interpolation in Datalog queries |
