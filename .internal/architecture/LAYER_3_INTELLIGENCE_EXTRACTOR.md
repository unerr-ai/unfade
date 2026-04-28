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

---

## 17. Knowledge-Grounded Intelligence — Integration Sprints (KGI)

Layer 2.5 (Temporal Knowledge Extraction) produces entities, facts, decisions, comprehension assessments, and metacognitive signals from actual conversation content. Layer 3's analyzers currently derive intelligence from DuckDB numeric columns independently. These sprints unify both layers so that Layer 3 analyzers **consume** Layer 2.5's extracted knowledge as their primary signal, with DuckDB metrics as a secondary/complementary source.

**Thesis:** Layer 2.5 is the knowledge foundation. Layer 3 becomes the analytics + synthesis layer OVER that knowledge. CozoDB is the unified meeting point.

### Analyzer Classification

| Group | Analyzers | Integration Strategy |
|---|---|---|
| **A: Pure Metrics** (7) | token-proxy, cost-attribution, window-aggregator, summary-writer, intelligence-snapshots, git-commit-analyzer, git-file-churn | No changes — pure event-metric accounting |
| **B: Knowledge-Overlapping** (4) | comprehension-radar, blind-spots, decision-replay, loop-detector | **Rewrite** — consume CozoDB extracted knowledge instead of re-deriving from HDS/similarity heuristics |
| **C: Behavioral** (6) | file-direction, session-intelligence, efficiency, velocity-tracker, prompt-patterns, causality | **Enhance** — read DuckDB metrics + CozoDB knowledge context |
| **D: Synthesis** (3) | maturity-model, narrative-engine, profile-accumulator | **Deepen** — ground outputs in actual extracted facts/decisions, not just numeric scores |
| **E: Cross-Source** (5) | git-ai-linker, git-expertise-map, cross-efficiency-survival, cross-dual-velocity, cross-maturity-ownership | **Enhance** — add entity-level linking and comprehension grounding |

### Sprint Dependency Graph

```
KGI-1: AnalyzerContext + Knowledge Query Layer
  │
  ├─► KGI-2: Rewrite comprehension-radar (Group B)
  │
  ├─► KGI-3: Rewrite blind-spots (Group B)
  │
  ├─► KGI-4: Rewrite decision-replay (Group B)
  │
  ├─► KGI-5: Rewrite loop-detector (Group B)
  │     │
  │     └──────────────────────────────────────┐
  │                                            │
  ├─► KGI-6: Enhance efficiency (Group C)      │
  │                                            │
  ├─► KGI-7: Enhance session-intelligence      │
  │          (Group C)                         │
  │                                            │
  ├─► KGI-8: Enhance velocity-tracker +        │
  │          causality + file-direction +       │
  │          prompt-patterns (Group C)          │
  │                                            ▼
  ├─► KGI-9: Deepen maturity-model (Group D)
  │     │
  │     └─► KGI-10: Deepen narrative-engine (Group D)
  │           │
  │           └─► KGI-11: Deepen profile-accumulator (Group D)
  │
  ├─► KGI-12: Enhance cross-source analyzers (Group E)
  │
  └─► KGI-13: E2E Integration Tests + DAG Verification
        │
        └─► KGI-14: Cleanup — Remove Dead Heuristic Code
```

**Parallelism:** After KGI-1, sprints KGI-2 through KGI-8 and KGI-12 can all run in parallel (independent analyzer rewrites). KGI-9 depends on Group B completion (maturity reads comprehension + loop + decision data). KGI-10 depends on KGI-9. KGI-13 depends on all prior sprints.

---

### KGI-1: AnalyzerContext + Knowledge Query Layer

**Goal:** Add CozoDB knowledge access to `AnalyzerContext` so any analyzer can query extracted knowledge. Build a thin query layer that abstracts common knowledge lookups.

**Day estimate:** ~6 hours. Context extension + query module + tests.

---

**KGI-1.1: Extend AnalyzerContext with Knowledge Handle**

**Modify:** `src/services/intelligence/analyzers/index.ts`

Add `knowledge` field to `AnalyzerContext`:

```typescript
export interface AnalyzerContext {
  analytics: DbLike;          // DuckDB — existing
  operational: DbLike;        // SQLite — existing
  repoRoot: string;           // existing
  config: Record<string, unknown>; // existing
  dependencyStates?: Map<string, IncrementalState<unknown>>; // existing
  knowledge: KnowledgeReader | null;  // NEW — CozoDB knowledge access
}
```

`KnowledgeReader` is a read-only interface (analyzers never write to CozoDB directly during their update cycle — that's Layer 2.5's job):

```typescript
export interface KnowledgeReader {
  /** Get comprehension assessments for entities in a module/domain. */
  getComprehension(opts: { domain?: string; module?: string; since?: string }): Promise<ComprehensionEntry[]>;
  /** Get extracted facts for a subject entity or domain. */
  getFacts(opts: { subject?: string; domain?: string; predicate?: string; activeOnly?: boolean }): Promise<FactEntry[]>;
  /** Get extracted decisions (facts with decision predicates). */
  getDecisions(opts: { domain?: string; since?: string }): Promise<FactEntry[]>;
  /** Get entity engagement stats (how often an entity appears in conversations). */
  getEntityEngagement(opts: { since?: string; minOccurrences?: number }): Promise<EntityEngagement[]>;
  /** Get comprehension decay state (FSRS stability + retrievability). */
  getDecayState(opts: { domain?: string; entity?: string }): Promise<DecayEntry[]>;
  /** Check if knowledge extraction data exists (for graceful degradation). */
  hasKnowledgeData(): Promise<boolean>;
}
```

**New file:** `src/services/intelligence/knowledge-reader.ts`

Implements `KnowledgeReader` by wrapping CozoDB Datalog queries. Each method is a focused Datalog query against the relations Layer 2.5 populates (fact, comprehension_assessment, entity, etc.).

**Critical design rule:** Every analyzer MUST gracefully degrade when `knowledge` is null (no CozoDB available) or when `hasKnowledgeData()` returns false (Layer 2.5 hasn't run yet). Analyzers fall back to their existing DuckDB-only logic. This ensures the system works before any LLM extraction has occurred.

**Modify:** `src/services/daemon/repo-manager.ts`

In the `onTick` callback where `AnalyzerContext` is constructed, inject the `knowledge` field:

```typescript
const knowledgeReader = cozo ? createKnowledgeReader(cozo) : null;
const ctx: AnalyzerContext = {
  analytics, operational, repoRoot, config,
  knowledge: knowledgeReader,
};
```

---

**KGI-1.2: Knowledge Query Layer Tests**

**New file:** `test/services/intelligence/knowledge-reader.test.ts`

- In-memory CozoDB with Layer 2.5 relations populated
- `getComprehension()` returns assessments filtered by domain/module/since
- `getFacts()` returns active facts, filters by predicate
- `getDecisions()` returns only decision-predicate facts
- `getEntityEngagement()` aggregates entity occurrence counts
- `getDecayState()` returns FSRS stability/retrievability
- `hasKnowledgeData()` returns false on empty graph, true after population
- Null safety: all methods return empty arrays when graph is empty

---

### KGI-2: Rewrite comprehension-radar

**Goal:** Replace HDS-averaging heuristic with actual comprehension assessments from CozoDB. The radar becomes a thin reader over Layer 2.5's extracted comprehension data with FSRS decay applied.

**Day estimate:** ~5 hours. Rewrite core + retain DuckDB fallback + tests.

**Depends on:** KGI-1

---

**KGI-2.1: Rewrite comprehension-radar Core**

**Modify:** `src/services/intelligence/analyzers/comprehension-radar.ts`

Current approach (remove): Queries DuckDB `domain_comprehension` table, averages HDS per module, applies phase-normalized baselines, percentile-based blind spot detection.

New approach:
1. Query `knowledge.getComprehension({ since: watermark })` for all recent assessments
2. Query `knowledge.getDecayState({})` for FSRS decay-adjusted scores per entity/domain
3. Group by module (using entity's module association from CozoDB edges)
4. Per-module score = weighted average of decay-adjusted comprehension across entities in that module
5. Overall score = weighted average across modules (weight = entity count per module)
6. Blind spots = modules where decay-adjusted comprehension < 40 AND entity count > 3

**Fallback:** If `ctx.knowledge === null || !await ctx.knowledge.hasKnowledgeData()`, fall back to existing DuckDB HDS-average logic (preserve current code as `computeRadarFromHDS()`). This ensures the analyzer works before Layer 2.5 has produced any data.

**State shape change:** Add `source: 'knowledge' | 'hds-fallback'` to state so downstream analyzers know which signal they're getting.

---

**KGI-2.2: comprehension-radar Tests**

**Modify:** `test/services/intelligence/analyzers/comprehension-radar.test.ts` (or create if missing)

- Knowledge-grounded path: mock KnowledgeReader with comprehension + decay data → correct per-module scores
- Fallback path: null knowledge → falls back to DuckDB HDS averages
- Mixed path: some modules have knowledge data, some don't → blend appropriately
- Blind spot detection from low decay-adjusted comprehension
- Entity count threshold: modules with < 3 entities not flagged as blind spots

---

### KGI-3: Rewrite blind-spots

**Goal:** Replace sustained-low-HDS alert heuristic with knowledge-gap detection from CozoDB. A real blind spot = entity where comprehension is decaying AND the developer keeps accepting AI output without pushback.

**Day estimate:** ~5 hours. Rewrite + tests.

**Depends on:** KGI-1

---

**KGI-3.1: Rewrite blind-spots Core**

**Modify:** `src/services/intelligence/analyzers/blind-spots.ts`

Current approach (remove): Monitors acceptance rate, comprehension, and direction trends with phase-normalized baselines. Generates max 2 alerts/week when thresholds sustained 2+ weeks.

New approach:
1. Query `knowledge.getDecayState({})` for all entities with stability data
2. Query `knowledge.getComprehension({ since: twoWeeksAgo })` for recent assessments
3. Query `knowledge.getFacts({ predicate: 'uses', activeOnly: true })` for active usage patterns
4. Blind spot criteria (ALL must be true):
   - Entity comprehension retrievability < 0.4 (FSRS: knowledge is fading)
   - Entity was referenced in recent events (still active, not abandoned)
   - Assessment shows low pushback count (developer accepting without questioning)
   - At least 3 assessments exist for this entity (sufficient evidence)
5. Alert severity: `retrievability < 0.2` = severe, `< 0.3` = moderate, `< 0.4` = mild
6. Keep max 2 alerts/week rate limit

**Fallback:** Same graceful degradation — if no knowledge data, fall back to current HDS + acceptance rate heuristic.

---

**KGI-3.2: blind-spots Tests**

- Knowledge path: decaying comprehension + high acceptance → alert generated
- No alert when comprehension is stable (retrievability > 0.5)
- No alert when entity abandoned (not in recent events)
- Severity graduation: retrievability thresholds
- Rate limiting: max 2 alerts/week
- Fallback path: null knowledge → HDS-based alerts

---

### KGI-4: Rewrite decision-replay

**Goal:** Replace heuristic domain-drift detection with monitoring of actual extracted decisions from CozoDB. Decision replay triggers when a fact contradicts or supersedes a prior decision.

**Day estimate:** ~5 hours. Rewrite + tests.

**Depends on:** KGI-1

---

**KGI-4.1: Rewrite decision-replay Core**

**Modify:** `src/services/intelligence/analyzers/decision-replay.ts`

Current approach (remove): Domain drift via cosine similarity (0.3–1.0), echoed dead-end detection via string similarity (≥ 0.5). Heuristic confidence scoring.

New approach:
1. Query `knowledge.getDecisions({ since: watermark })` for newly extracted decisions
2. For each new decision, query `knowledge.getFacts({ subject: decision.subject, predicate: 'decided' })` for prior decisions on the same entity
3. Check Layer 2.5's contradiction detection results: if a new fact was classified as CONTRADICTORY or SUPERSEDES relative to a prior decision fact → trigger replay
4. Replay recommendation includes:
   - The original decision (fact text + episode source)
   - The contradicting/superseding fact
   - The confidence from contradiction detection
   - Time elapsed since original decision
5. Keep max 2 replays/week rate limit

**Fallback:** If no knowledge data, fall back to current string-similarity approach.

---

**KGI-4.2: decision-replay Tests**

- New decision contradicting prior → replay triggered with both facts
- New decision superseding prior → replay triggered
- Consistent decisions → no replay
- Rate limiting: max 2/week
- Fallback: null knowledge → similarity-based detection

---

### KGI-5: Rewrite loop-detector

**Goal:** Replace cosine-similarity clustering with entity-repetition-without-progress detection from CozoDB. A real loop = same entity discussed repeatedly without new facts being extracted.

**Day estimate:** ~5 hours. Rewrite + tests.

**Depends on:** KGI-1

---

**KGI-5.1: Rewrite loop-detector Core**

**Modify:** `src/services/intelligence/analyzers/loop-detector.ts`

Current approach (remove): Greedy clustering by `domain::approach` key, cosine similarity ≥ 0.7. Flags 3+ similar low-direction sessions as stuck.

New approach:
1. Query `knowledge.getEntityEngagement({ since: oneWeekAgo, minOccurrences: 3 })` for frequently discussed entities
2. For each high-engagement entity, query `knowledge.getFacts({ subject: entity, since: oneWeekAgo })` to count new facts
3. Loop detection criteria:
   - Entity discussed in 3+ sessions this week
   - Fewer than 1 new fact per session for that entity (low knowledge progress)
   - Direction scores in those sessions below 0.5 (developer not steering effectively)
4. Loop risk score = `sessions_without_progress / total_sessions` per entity
5. Stuck loop = entity with risk score > 0.7

**Fallback:** If no knowledge data, fall back to current cosine-similarity clustering.

---

**KGI-5.2: loop-detector Tests**

- Entity discussed 5 times, 1 fact extracted → loop detected
- Entity discussed 5 times, 5 facts extracted → no loop
- Entity discussed 2 times → below threshold, no loop
- Risk score calculation
- Fallback: null knowledge → similarity-based clustering

---

### KGI-6: Enhance efficiency

**Goal:** Add comprehension improvement rate to the AES composite metric. "Efficiency" should account for whether the developer is actually learning, not just steering.

**Day estimate:** ~4 hours. Add dimension + tests.

**Depends on:** KGI-1

---

**KGI-6.1: Add Comprehension Efficiency Dimension**

**Modify:** `src/services/intelligence/analyzers/efficiency.ts`

Add a 6th sub-metric to the AES composite: **ComprehensionEfficiency** (10% weight, reduce others proportionally):
- `comprehensionDelta = (latest_comprehension - earliest_comprehension_in_window) / tokens_spent`
- Measures: how much comprehension improved per token invested
- High value = developer is learning efficiently. Low value = tokens spent without understanding gain.
- Source: `knowledge.getComprehension({ since: windowStart })` grouped by domain

When knowledge data unavailable, this dimension contributes 0 with weight 0 (effectively excluded from composite). Existing 5 sub-metrics retain their relative proportions.

---

**KGI-6.2: efficiency Tests**

- With knowledge: comprehension delta contributes to AES
- Without knowledge: AES unchanged from current behavior
- Edge case: no comprehension change → dimension score = 0.5 (neutral)

---

### KGI-7: Enhance session-intelligence

**Goal:** Add "what was learned in this session" from extracted facts to session intelligence output. Session diagnostics should reference actual knowledge gained, not just phase transitions.

**Day estimate:** ~4 hours. Enhancement + tests.

**Depends on:** KGI-1

---

**KGI-7.1: Add Knowledge Progress to Session Intelligence**

**Modify:** `src/services/intelligence/session-intelligence.ts`

After existing phase/loop/direction computation, add knowledge progress section:
1. Query `knowledge.getFacts({ since: sessionStartTime })` filtered to this session's events
2. Count facts extracted, entities encountered, decisions made
3. Add to output: `knowledgeProgress: { factsExtracted, entitiesEngaged, decisionsRecorded, comprehensionDelta }`
4. Enhance `suggestedActions`: if factsExtracted = 0 after 5+ turns → "Consider asking deeper questions about the topic"

**Fallback:** `knowledgeProgress` is null when no knowledge data. Existing diagnostics unchanged.

---

**KGI-7.2: session-intelligence Tests**

- Session with facts → knowledgeProgress populated
- Session without facts after many turns → action suggested
- No knowledge data → knowledgeProgress null, existing output unchanged

---

### KGI-8: Enhance Remaining Group C Analyzers

**Goal:** Add knowledge context to velocity-tracker, causality, file-direction, and prompt-patterns. Lighter-touch enhancements than the Group B rewrites.

**Day estimate:** ~6 hours. Four small enhancements + tests.

**Depends on:** KGI-1

---

**KGI-8.1: velocity-tracker — Real Velocity Validation**

**Modify:** `src/services/intelligence/analyzers/velocity-tracker.ts`

Add `velocityQuality` field to per-domain output:
- `hollowVelocity`: high turns-to-acceptance speed BUT comprehension delta ≤ 0 (fast acceptance without learning)
- `genuineVelocity`: fast acceptance AND positive comprehension delta
- Source: cross-reference velocity data with `knowledge.getComprehension()` delta per domain

---

**KGI-8.2: causality — Fact-Chain Causality**

**Modify:** `src/services/intelligence/causality.ts`

Enhance causal chain detection: when Layer 2.5 fact supersession chains exist (fact A superseded by fact B), use those as high-confidence causal links instead of heuristic phase-transition matching. Query `knowledge.getFacts({ predicate: 'replaced-by' })`.

---

**KGI-8.3: file-direction — Entity Annotation**

**Modify:** `src/services/intelligence/file-direction.ts`

For each file/directory in the direction map, annotate with entities from that module: `knowledge.getEntityEngagement({ module: dirPath })`. Output gains `entities: string[]` per entry.

---

**KGI-8.4: prompt-patterns — Topic Context**

**Modify:** `src/services/intelligence/analyzers/prompt-patterns.ts`

Add entity/topic context to prompt pattern clusters. When knowledge data is available, tag each cluster with the primary entities discussed (from extraction). This enables "prompts about auth are more effective than prompts about testing" instead of just structural pattern correlation.

---

**KGI-8.5: Group C Tests**

One test file per enhanced analyzer, covering: knowledge-enhanced path, fallback path, edge cases.

---

### KGI-9: Deepen maturity-model

**Goal:** Ground maturity assessment in actual comprehension trajectory from Layer 2.5, not just HDS distributions. Maturity phases should reflect genuine understanding growth.

**Day estimate:** ~6 hours. Dimension rewiring + tests.

**Depends on:** KGI-1, KGI-2 (comprehension-radar rewrite provides knowledge-grounded comprehension)

---

**KGI-9.1: Knowledge-Grounded Maturity Dimensions**

**Modify:** `src/services/intelligence/maturity-model.ts`

Rewire 3 of the 7 dimensions to use knowledge-grounded data:

1. **comprehension** dimension: Read from rewritten comprehension-radar (which now uses CozoDB data). No change to maturity-model code, but the input is now knowledge-grounded.

2. **loop-resilience** dimension: Read from rewritten loop-detector (which now uses entity-repetition-without-progress). Resolved loops = entities that were stuck but now have new facts.

3. **decision-durability** dimension: Read from rewritten decision-replay. Durable decisions = extracted decisions not superseded or contradicted. `durability = 1 - (superseded_decisions / total_decisions)`.

The other 4 dimensions (direction, efficiency, domain-consistency, context-leverage) remain DuckDB-metric-based. They provide complementary behavioral signal.

Add `knowledgeGrounded: boolean` flag to maturity assessment output indicating whether knowledge data was available for the grounded dimensions.

---

**KGI-9.2: maturity-model Tests**

- Knowledge-grounded path: comprehension + loop + decision dimensions use CozoDB data
- Mixed path: some dimensions grounded, others use DuckDB metrics
- Fallback: all dimensions use DuckDB metrics when no knowledge data
- Phase transitions still work correctly with knowledge-grounded inputs

---

### KGI-10: Deepen narrative-engine

**Goal:** Generate narratives from actual extracted facts and decisions, not just maturity score templates. "You decided X on Monday, but your comprehension of that area is declining" instead of "Your direction density in auth was 0.72."

**Day estimate:** ~6 hours. Template system overhaul + tests.

**Depends on:** KGI-9 (maturity provides knowledge-grounded assessment)

---

**KGI-10.1: Knowledge-Grounded Narrative Templates**

**Modify:** `src/services/intelligence/narrative-engine.ts`

Extend `NarrativeContext` with knowledge data:

```typescript
interface NarrativeContext {
  maturity: MaturityAssessment;   // existing
  dimensions: MaturityDimension[]; // existing
  eventCount: number;              // existing
  // NEW: knowledge-grounded context
  recentDecisions?: FactEntry[];      // last 7 days
  contradictions?: FactEntry[];       // superseded/contradicted facts
  comprehensionTrends?: { domain: string; delta: number; direction: 'improving' | 'declining' | 'stable' }[];
  stuckEntities?: { name: string; sessions: number; factsGained: number }[];
}
```

Add new template categories:
- **decision-insight**: "You made {N} decisions about {domain} this week. {contradictions} contradicted earlier decisions."
- **comprehension-trajectory**: "Your understanding of {domain} has {improved/declined} from {score_then} to {score_now}."
- **stuck-loop-narrative**: "You've discussed {entity} in {N} sessions without gaining new knowledge."
- **knowledge-velocity**: "This week you extracted {N} new facts across {M} domains."

Existing vehicle-analogy templates remain for dimensions that aren't knowledge-grounded. Knowledge templates take priority when data is available.

---

**KGI-10.2: narrative-engine Tests**

- Knowledge-grounded narrative: references actual decisions and comprehension
- Mixed narrative: some knowledge templates, some vehicle-analogy templates
- Fallback: all vehicle-analogy templates when no knowledge data
- Contradiction narrative: correctly references superseded decision

---

### KGI-11: Deepen profile-accumulator

**Goal:** Build the developer reasoning profile from entity graph data (domains, comprehension levels, decision patterns), not just efficiency averages.

**Day estimate:** ~5 hours. Profile enrichment + tests.

**Depends on:** KGI-10 (narrative feeds profile)

---

**KGI-11.1: Knowledge-Enriched Profile**

**Modify:** `src/services/personalization/profile-accumulator.ts`

Add to profile output:
- `domainExpertise`: map of domain → { comprehensionScore, factCount, decisionCount, trend } from CozoDB
- `knowledgeVelocity`: facts extracted per day over last 30 days
- `decisionPatterns`: { totalDecisions, superseded, contradicted, durable } counts
- `topEntities`: most-engaged entities with comprehension and fact counts

Existing efficiency + window-based profile data retained as behavioral complement.

---

**KGI-11.2: profile-accumulator Tests**

- Profile includes domain expertise from CozoDB
- Profile includes decision pattern stats
- Fallback: existing profile shape when no knowledge data

---

### KGI-12: Enhance Cross-Source Analyzers

**Goal:** Add entity-level linking and comprehension grounding to the 5 cross-source analyzers.

**Day estimate:** ~6 hours. Five small enhancements + tests.

**Depends on:** KGI-1

---

**KGI-12.1: git-ai-linker — Entity-Level Linking**

**Modify:** `src/services/intelligence/git-ai-linker.ts`

When linking AI sessions to commits, also link at entity level: "AI session discussed entity `useAuth` → commit modified `src/auth/useAuth.ts`". Query `knowledge.getEntityEngagement()` for entities mentioned in the AI session, cross-reference with commit file paths.

---

**KGI-12.2: git-expertise-map — Comprehension Overlay**

**Modify:** `src/services/intelligence/git-expertise-map.ts`

Add comprehension overlay to expertise classification:
- `deep` + high comprehension = genuine expertise
- `deep` + low comprehension = ownership risk (owns the code but understanding is fading)
- `ai-dependent` + high comprehension = assisted expertise (AI helps but developer understands)
- `ai-dependent` + low comprehension = dangerous dependency

---

**KGI-12.3: cross-efficiency-survival — Fact Durability**

**Modify:** `src/services/intelligence/cross-efficiency-survival.ts`

Replace code-survival (file churn) with fact-durability: survival = decisions not superseded within N days. `durable = 1 - (superseded / total)`. This measures whether the developer's decisions survive, not just their code.

---

**KGI-12.4: cross-maturity-ownership — Comprehension Genuineness**

**Modify:** `src/services/intelligence/cross-maturity-ownership.ts`

Genuineness classification uses actual comprehension scores from CozoDB instead of just file ownership patterns. `genuine` = maturity phase matches comprehension level. `hollow` = high maturity phase but low extracted comprehension.

---

**KGI-12.5: Cross-Source Tests**

One test per enhanced analyzer covering: knowledge-enhanced output, fallback, edge cases.

---

### KGI-13: E2E Integration Tests + DAG Verification

**Goal:** Verify the full unified pipeline: events → materialization → Layer 2.5 extraction → Layer 3 knowledge-grounded analysis → substrate → narrative. Verify DAG topology still sorts correctly.

**Day estimate:** ~6 hours. Integration tests.

**Depends on:** All prior KGI sprints

---

**KGI-13.1: DAG Topology Verification**

**New file:** `test/integration/unified-dag.test.ts`

- Register all 25 analyzers → topological sort succeeds
- No circular dependencies introduced
- Dependency declarations match actual data flow
- Group B analyzers correctly consume KnowledgeReader

---

**KGI-13.2: Full Pipeline Integration Test**

**New file:** `test/integration/knowledge-grounded-pipeline.test.ts`

- Ingest 10 AI-session events with conversation content
- Run Layer 2.5 extraction (with mock LLM returning structured extraction results)
- Run Layer 3 analyzer DAG
- Verify: comprehension-radar reads from CozoDB, not HDS
- Verify: blind-spots detects decaying comprehension entities
- Verify: decision-replay triggers on contradicting facts
- Verify: loop-detector identifies entities with repeated engagement but no new facts
- Verify: narrative references actual decisions
- Verify: maturity-model dimensions are knowledge-grounded

---

### KGI-14: Cleanup — Remove Dead Heuristic Code

**Goal:** Remove the old heuristic codepaths from Group B analyzers that have been replaced by knowledge-grounded implementations. The fallback paths remain, but the old primary logic is deleted.

**Day estimate:** ~3 hours. Code deletion + verification.

**Depends on:** KGI-13 (tests pass)

---

**KGI-14.1: Remove Old Primary Codepaths**

For each Group B analyzer:
- `comprehension-radar`: Remove HDS-averaging as primary path. Rename `computeRadarFromHDS()` to private fallback.
- `blind-spots`: Remove sustained-low-HDS alert generation as primary path. Rename to fallback.
- `decision-replay`: Remove cosine-similarity domain-drift detection as primary path. Rename to fallback.
- `loop-detector`: Remove greedy clustering as primary path. Rename to fallback.

Remove any unused imports, dead helper functions, and test code that tested the old primary paths.

---

**KGI-14.2: Final Verification**

- `pnpm typecheck` — zero errors
- `pnpm test` — all tests pass
- `pnpm build` — clean build
- Verify no analyzer references DuckDB comprehension/direction data when CozoDB data is available

---

### Implementation Tracker

| Sprint | Task | Status | Files |
|---|---|---|---|
| KGI-1 | KGI-1.1: Extend AnalyzerContext + KnowledgeReader | ✅ Complete | `src/services/intelligence/knowledge-reader.ts` (~250 lines), `src/services/intelligence/analyzers/index.ts` (knowledge field), `src/services/daemon/repo-manager.ts` (CozoDB injection) |
| KGI-1 | KGI-1.2: Knowledge query layer tests | ✅ Complete | `test/services/intelligence/knowledge-reader.test.ts` (17 tests, CozoDB integration) |
| KGI-2 | KGI-2.1: Rewrite comprehension-radar | ✅ Complete | `src/services/intelligence/analyzers/comprehension-radar.ts` (knowledge-grounded + HDS fallback + source tag) |
| KGI-2 | KGI-2.2: comprehension-radar tests | ✅ Complete | `test/services/intelligence/analyzers/comprehension-radar.test.ts` (12 tests) |
| KGI-3 | KGI-3.1: Rewrite blind-spots | ✅ Complete | `src/services/intelligence/analyzers/blind-spots.ts` (FSRS retrievability + pushback + rate limiting + HDS fallback) |
| KGI-3 | KGI-3.2: blind-spots tests | ✅ Complete | `test/services/intelligence/analyzers/blind-spots.test.ts` (10 tests) |
| KGI-4 | KGI-4.1: Rewrite decision-replay | ✅ Complete | `src/services/intelligence/analyzers/decision-replay.ts` (contradiction + supersession detection from CozoDB facts + HDS fallback), `src/schemas/intelligence/replays.ts` (extended triggerReason enum) |
| KGI-4 | KGI-4.2: decision-replay tests | ✅ Complete | `test/services/intelligence/analyzers/decision-replay.test.ts` (9 tests) |
| KGI-5 | KGI-5.1: Rewrite loop-detector | ✅ Complete | `src/services/intelligence/analyzers/loop-detector.ts` (entity-repetition-without-progress + intent fallback) |
| KGI-5 | KGI-5.2: loop-detector tests | ✅ Complete | `test/services/intelligence/analyzers/loop-detector.test.ts` (10 tests) |
| KGI-6 | KGI-6.1: Add comprehension efficiency dimension | ✅ Complete | `src/services/intelligence/analyzers/efficiency.ts` (6th sub-metric + dynamic weight redistribution), `src/schemas/intelligence/efficiency.ts` (optional comprehensionEfficiency) |
| KGI-6 | KGI-6.2: efficiency tests | ✅ Complete | `test/services/intelligence/analyzers/efficiency.test.ts` (10 tests) |
| KGI-7 | KGI-7.1: Add knowledge progress to session-intelligence | ✅ Complete | `src/services/intelligence/session-intelligence.ts` (knowledgeProgress + comprehensionDelta + knowledge-grounded suggestions) |
| KGI-7 | KGI-7.2: session-intelligence tests | ✅ Complete | `test/services/intelligence/session-intelligence.test.ts` (8 tests) |
| KGI-8 | KGI-8.1: velocity-tracker real velocity validation | ✅ Complete | `src/services/intelligence/analyzers/velocity-tracker.ts` (velocityQuality), `src/schemas/intelligence/velocity.ts` |
| KGI-8 | KGI-8.2: causality fact-chain enhancement | ✅ Complete | `src/services/intelligence/causality.ts` (enrichWithFactChains) |
| KGI-8 | KGI-8.3: file-direction entity annotation | ✅ Complete | `src/services/intelligence/file-direction.ts` (entities[] per entry) |
| KGI-8 | KGI-8.4: prompt-patterns topic context | ✅ Complete | `src/services/intelligence/analyzers/prompt-patterns.ts` (entities[]), `src/schemas/intelligence/prompt-patterns.ts` |
| KGI-8 | KGI-8.5: Group C tests | ✅ Complete | `test/services/intelligence/group-c-enhancements.test.ts` (9 tests) |
| KGI-9 | KGI-9.1: Knowledge-grounded maturity dimensions | ✅ Complete | `src/services/intelligence/maturity-model.ts` (3 dimensions rewired + knowledgeGrounded flag + isKnowledgeGrounded()) |
| KGI-9 | KGI-9.2: maturity-model tests | ✅ Complete | `test/services/intelligence/maturity-model.test.ts` (9 tests) |
| KGI-10 | KGI-10.1: Knowledge-grounded narrative templates | ✅ Complete | `src/services/intelligence/narrative-engine.ts` (4 knowledge templates + extended NarrativeContext + gatherKnowledgeContext) |
| KGI-10 | KGI-10.2: narrative-engine tests | ✅ Complete | `test/services/intelligence/narrative-engine.test.ts` (8 tests) |
| KGI-11 | KGI-11.1: Knowledge-enriched profile | ✅ Complete | `src/services/personalization/profile-accumulator.ts` (domainExpertise + knowledgeVelocity + decisionPatterns + topEntities) |
| KGI-11 | KGI-11.2: profile-accumulator tests | ✅ Complete | `test/services/personalization/profile-accumulator.test.ts` (8 tests) |
| KGI-12 | KGI-12.1: git-ai-linker entity-level linking | ✅ Complete | `src/services/intelligence/git-ai-linker.ts` (linkedEntities[] per link) |
| KGI-12 | KGI-12.2: git-expertise-map comprehension overlay | ✅ Complete | `src/services/intelligence/git-expertise-map.ts` (comprehensionQuality: genuine/risk/assisted/dangerous) |
| KGI-12 | KGI-12.3: cross-efficiency-survival fact durability | ✅ Complete | `src/services/intelligence/cross-efficiency-survival.ts` (factDurability = 1 - superseded/total) |
| KGI-12 | KGI-12.4: cross-maturity-ownership comprehension genuineness | ✅ Complete | `src/services/intelligence/cross-maturity-ownership.ts` (knowledge-grounded genuineness) |
| KGI-12 | KGI-12.5: Cross-source tests | ✅ Complete | `test/services/intelligence/cross-source-enhancements.test.ts` (10 tests) |
| KGI-13 | KGI-13.1: DAG topology verification | ✅ Complete | `test/integration/unified-dag.test.ts` (10 tests — topo sort, cycles, deps, Group B, maturity deps) |
| KGI-13 | KGI-13.2: Full pipeline integration test | ✅ Complete | `test/integration/knowledge-grounded-pipeline.test.ts` (10 tests — all Group B knowledge-grounded + fallback + narrative + maturity flag) |
| KGI-14 | KGI-14.1: Remove old heuristic primary codepaths | ✅ Complete | Group B analyzers already clean (old imports removed during KGI-2/3/4/5 rewrites). No phase-baselines, cosineSimilarity, or getWorkerPool references remain. |
| KGI-14 | KGI-14.2: Final verification | ✅ Complete | 438 tests pass across 34 test files. All Group B analyzers use knowledge-grounded primary paths with clean HDS fallbacks. |
