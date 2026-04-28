# Layer 4: Intelligence Presentation — Evidence, Correlation & Actionable Intelligence

> Builds on top of Layer 2.5 (knowledge extraction: entities, facts, comprehension, FSRS decay) and Layer 3 (25 DAG-ordered analyzers + KGI integration sprints that ground analyzers in extracted knowledge). Transforms the intelligence pipeline from metric dashboards into an evidence-linked, cross-analyzer correlated, actionable intelligence system with full drill-through to source events.

---

## Table of Contents

1. [Overview](#overview)
2. [Deep Research — Current State Inventory](#deep-research--current-state-inventory)
3. [Root Cause Analysis — Why Intelligence Falls Short](#root-cause-analysis--why-intelligence-falls-short)
4. [Reconstructed Architecture](#reconstructed-architecture)
5. [Analyzer Quality Transformation](#analyzer-quality-transformation)
6. [DAG Scheduler Enhancements](#dag-scheduler-enhancements)
7. [Substrate Graph Enrichment](#substrate-graph-enrichment)
8. [Intelligence API Overhaul](#intelligence-api-overhaul)
9. [Intelligence Hub UI Transformation](#intelligence-hub-ui-transformation)
10. [Cross-Analyzer Correlation Engine](#cross-analyzer-correlation-engine)
11. [Evidence Provenance System](#evidence-provenance-system)
12. [Enhanced Schema Definitions](#enhanced-schema-definitions)
13. [Design Decisions & Trade-offs](#design-decisions--trade-offs)
14. [Implementation Plan](#implementation-plan)

---

## Overview

Layer 4 sits on top of a complete knowledge + intelligence stack:

- **Layer 2.5** (`LAYER_2.5_TEMPORAL_KNOWLEDGE_EXTRACTION.md`) — extracts entities, facts, decisions, comprehension assessments, metacognitive signals, and FSRS decay from developer-AI conversations. Writes to CozoDB + DuckDB.
- **Layer 3** (`LAYER_3_INTELLIGENCE_EXTRACTOR.md`) — 25 DAG-ordered `IncrementalAnalyzer` instances, orchestrated by the `IntelligenceScheduler`, producing intelligence output files. **KGI sprints (KGI-1 through KGI-14)** rewrite analyzers to consume Layer 2.5's extracted knowledge as primary signal.
- **Layer 4** (this doc) — adds evidence linking, cross-analyzer correlation, enriched API responses, and UI transformation. Every metric shown to the user becomes traceable to source events.

Today, the intelligence pipeline produces isolated metrics that tell users *what their numbers are* but not *why those numbers matter* or *what to do about them*. Layer 4 transforms every analyzer output, API endpoint, and UI tab with evidence linking, causal reasoning, cross-analyzer correlation, and actionable drill-through. The substrate graph becomes the connective tissue that links insights across analyzers, and every claim shown to the user is backed by traceable evidence.

### Current state vs. target state

| Dimension | Current | Target |
|-----------|---------|--------|
| **Analyzer output** | Isolated metrics per analyzer (efficiency score, cost breakdown, velocity trend) | Cross-linked insights: "Your efficiency dropped 15% because loop-detector found 3 stuck sessions in the auth domain, which comprehension-radar shows is a blind spot" |
| **Evidence chain** | Lineage API exists but no UI renders it; claims have no visible provenance | Every metric, diagnostic, and insight is clickable → evidence drawer showing source events, analyzer chain, confidence score |
| **Cross-analyzer reasoning** | Each analyzer is independent; no analyzer reads another's output except via dependency injection | Correlation engine detects multi-analyzer patterns: declining velocity + rising cost + blind spot in same domain = actionable alert |
| **Narrative quality** | `NarrativesTab` shows generic diagnostics/prescriptions sliced to 5 | Evidence-backed narratives: each claim links to the specific sessions, commits, and analyzer computations that produced it |
| **UI drill-through** | All tabs render final metrics with no click-through to source data | Every card, chart, and table row is clickable → evidence drawer or filtered view of source data |
| **Data caps** | Multiple `.slice(0, N)` caps hide data: 5 narratives, 20 files, 10 actions, 8 radar modules | All caps removed or replaced with "show more" / pagination. Users see complete data. |
| **Freshness** | Only ComprehensionTab shows freshness/confidence; other tabs show nothing | Every tab shows data age via `FreshnessBadge`, confidence level, and last-updated timestamp |
| **Composite metrics** | Autonomy's `independenceIndex` is a black box weighted formula | Transparent decomposition: show formula, component weights, and which component is dragging the score |
| **LLM integration** | Zero LLM calls in any analyzer — all pure computation | Strategic LLM calls for high-value analysis: pattern explanation, narrative generation, anomaly interpretation |
| **Substrate utilization** | CozoDB graph built but only served via 3 basic API endpoints with no UI | Graph powers cross-analyzer queries, entity neighborhood exploration, and causal path visualization in the UI |

### Principles

1. **Every claim has evidence** — No metric, diagnostic, or narrative appears without a traceable chain to source events. If we can't prove it, we don't show it.
2. **Cross-analyzer > isolated metrics** — A single efficiency score is a number. Efficiency + comprehension + velocity correlated in a domain tells a story. The substrate graph enables this.
3. **Quality over cost** — Strategic LLM calls for narrative generation, pattern explanation, and anomaly interpretation. Pure computation for everything that can be computed.
4. **Transparent computation** — Users can see how every composite score is calculated. No black-box formulas.
5. **Progressive disclosure** — Card summary → expanded tab → evidence drawer → raw data. Four layers, each adds detail.
6. **No artificial caps** — Replace all `.slice(0, N)` with pagination, "show more", or dynamic rendering. Users own their data.

### Files involved

| File | Role |
|------|------|
| `src/services/intelligence/engine.ts` | DAG scheduler — orchestrates 24 analyzers in topological order |
| `src/services/intelligence/incremental-state.ts` | State management — watermarks, batching, persistence |
| `src/services/intelligence/analyzers/all.ts` | Analyzer registry — 24 analyzers in execution order |
| `src/services/intelligence/analyzers/*.ts` | 8 core analyzers (efficiency, comprehension, cost, loop, velocity, patterns, blind-spots, decision-replay) |
| `src/services/intelligence/correlation-engine.ts` | **New** — cross-analyzer pattern detection |
| `src/services/intelligence/evidence-linker.ts` | **New** — evidence chain builder for all analyzer outputs |
| `src/services/substrate/substrate-engine.ts` | CozoDB graph — entity ingestion, propagation, queries |
| `src/server/routes/intelligence.ts` | API routes — 10 endpoints serving intelligence data |
| `src/server/routes/substrate.ts` | API routes — 3 substrate endpoints |
| `src/ui/pages/IntelligencePage.tsx` | Intelligence Hub — 8-card layout with expandable tabs |
| `src/ui/pages/intelligence/*.tsx` | 8 tab components (Maturity, Efficiency, Comprehension, Autonomy, Velocity, Cost, Patterns, Narratives) + GitExpertise |
| `src/ui/types/intelligence.ts` | TypeScript type definitions for all intelligence responses |

---

## Deep Research — Current State Inventory

### The 24 Analyzers

The intelligence pipeline consists of 24 `IncrementalAnalyzer` instances organized in a DAG:

#### Tier 0: Leaf nodes (17 analyzers, no dependencies)

| # | Analyzer | Output File | What It Computes | Event Filter |
|---|----------|-------------|------------------|-------------|
| 1 | `directionByFileAnalyzer` | `file-direction.json` | Per-file HDS (Human Direction Score) aggregation | ai-session |
| 2 | `tokenProxyAnalyzer` | `token-proxy.json` | Token usage estimation from session metadata | ai-session |
| 3 | `windowAggregatorAnalyzer` | `window-aggregator.json` | Rolling time-window metrics (24h, 7d, 30d) | ai-session, git |
| 4 | `efficiencyAnalyzer` | `efficiency.json` | AES (AI Efficiency Score) 0-100 weighted composite | ai-session |
| 5 | `comprehensionRadarAnalyzer` | `comprehension.json` | Per-module comprehension scores with phase-normalized HDS baselines | ai-session |
| 6 | `costAttributionAnalyzer` | `cost-attribution.json` | Cost estimation by model, domain, branch using configurable pricing | ai-session |
| 7 | `loopDetectorAnalyzer` | `rejections.json` | Stuck loop detection via cosine similarity ≥0.7 on session content | ai-session |
| 8 | `velocityTrackerAnalyzer` | `velocity.json` | Turns-to-acceptance trend per domain, weekly averages | ai-session |
| 9 | `promptPatternsAnalyzer` | `prompt-patterns.json` | Prompt structural feature extraction and effectiveness correlation | ai-session |
| 10 | `blindSpotDetectorAnalyzer` | `alerts.json` | Multi-factor alerts: high acceptance, low comprehension, declining direction | ai-session |
| 11 | `decisionReplayAnalyzer` | `decision-replay.json` | Past decision echoes via similarity matching against current signals | ai-session |
| 12 | `sessionIntelligenceAnalyzer` | `sessions.json` | Per-session metrics: duration, turns, direction, files touched | ai-session |
| 13 | `causalityChainAnalyzer` | `causality.json` | Event continuity chains: which events likely caused which | ai-session, git |
| 14 | `commitAnalyzer` | `commit-analysis.json` | Commit pattern analysis: frequency, size, timing | git |
| 15 | `fileChurnAnalyzer` | `file-churn.json` | File modification frequency and hotspot detection | git |
| 16 | `aiGitLinkerAnalyzer` | `ai-git-links.json` | Links between AI sessions and subsequent git commits | ai-session, git |
| 17 | `expertiseMapAnalyzer` | `expertise-map.json` | File ownership classification: deep / familiar / ai-dependent | ai-session, git |

#### Tier 1: First-order dependents (3 analyzers)

| # | Analyzer | Output File | Depends On |
|---|----------|-------------|------------|
| 18 | `summaryWriterAnalyzer` | `summary.json` | window-aggregator, token-proxy |
| 19 | `intelligenceSnapshotAnalyzer` | `snapshots.json` | window-aggregator, efficiency, session-intelligence |
| 20 | `profileAccumulatorAnalyzer` | `reasoning_model.json` | efficiency, window-aggregator |

#### Tier 2: Cross-source integration (2 analyzers)

| # | Analyzer | Output File | Depends On |
|---|----------|-------------|------------|
| 21 | `efficiencySurvivalAnalyzer` | `efficiency-survival.json` | AI + git analyzers |
| 22 | `dualVelocityAnalyzer` | `dual-velocity.json` | AI + git analyzers |

#### Tier 3: Higher-order (3 analyzers)

| # | Analyzer | Output File | Depends On |
|---|----------|-------------|------------|
| 23 | `maturityModelAnalyzer` | `maturity.json` | Most analyzers |
| 24 | `maturityOwnershipAnalyzer` | `maturity-ownership.json` | maturity, expertise-map |
| 25 | `narrativeEngineAnalyzer` | `narratives.json` | maturity (terminal node) |

### The DAG Scheduler

**File:** `src/services/intelligence/engine.ts`

The `IntelligenceScheduler` orchestrates all analyzers:

1. **Event batch construction:** Queries DuckDB for events newer than global watermark (`WHERE ts > $watermark LIMIT 500`)
2. **Dirty marking:** All nodes with matching events OR dependencies are marked dirty
3. **Topological processing:** Kahn's algorithm sorts analyzers by dependency order; only dirty nodes execute
4. **Cascade propagation:** If an analyzer's `changeMagnitude ≥ 0.05`, all its dependents are marked dirty for next run
5. **Entity contribution:** Each analyzer optionally contributes entities to the substrate graph via `contributeEntities()`
6. **State persistence:** Atomic write (tmp + rename) of `{analyzer}.state.json` per analyzer
7. **Throttling:** Minimum 10s between scheduler runs

### The CozoDB Substrate

**File:** `src/services/substrate/substrate-engine.ts`

A functional knowledge graph built on CozoDB (SQLite backend):

- **Entities:** Graph nodes contributed by analyzers (patterns, diagnostics, metrics, sessions)
- **Relationships:** Edges with weight and evidence (e.g., pattern → session, diagnostic → domain)
- **Confidence scoring:** Base 0.3 + 0.15 per contributing analyzer (capped at 1.0)
- **Lifecycle:** `emerging` → `established` (≥0.5) → `confirmed` (≥0.7)
- **Propagation:** `PropagationEngine` runs backward rules (e.g., diagnostic → pattern promotion)
- **Injection prevention:** `escCozo()` escapes all string interpolation
- **API:** 3 endpoints (topology, trajectories, entity neighborhood) — all return 202 while warming up

### The Intelligence Hub UI

**File:** `src/ui/pages/IntelligencePage.tsx` + `src/ui/pages/intelligence/*.tsx`

8 intelligence cards arranged in a grid, each expandable to a detail tab:

| Card | Metric Shown | Tab Component | Key Issues |
|------|-------------|---------------|------------|
| Vehicle Maturity | Phase 1-4 | `MaturityTab` | No evidence for phase transitions |
| Efficiency (AES) | 0-100 score | `EfficiencyTab` | Sub-metrics visible but no source sessions |
| Comprehension | Overall % | `ComprehensionTab` | Blind spots listed but not clickable |
| Steering (Autonomy) | Independence index | `AutonomyTab` | Good diagnostics but no session drill-through |
| Velocity | Decisions/day | `VelocityTab` | Trend shown but no evidence for changes |
| Cost | $/directed decision | `CostTab` | Model breakdown but no session cost detail |
| Patterns | Top pattern % | `PatternsTab` | Patterns listed but no example sessions |
| Narratives | Count | `NarrativesTab` | Sliced to 5; no evidence backing claims |

Plus a 9th tab `GitExpertiseTab` (conditionally rendered).

---

## Root Cause Analysis — Why Intelligence Falls Short

### Problem 1: Analyzers are computation islands

**Where:** All 17 leaf analyzers in `src/services/intelligence/analyzers/`

Every analyzer reads from DuckDB independently and writes an isolated JSON file. No analyzer knows what other analyzers found. The only cross-analyzer communication is:

1. **Dependency injection:** Tier 1+ analyzers receive upstream states via `dependencyStates` map in `AnalyzerContext`
2. **Substrate contribution:** Analyzers optionally contribute entities to CozoDB, but no analyzer *reads* the graph

**Why it fails:** The most valuable intelligence insights are *cross-analyzer*:

- "Your efficiency dropped because you're in a blind spot domain" (efficiency + comprehension)
- "Velocity is declining because loop-detector found stuck sessions" (velocity + loop-detector)
- "High cost in auth domain correlates with low comprehension there" (cost + comprehension)

None of these exist today. Each analyzer produces a standalone number.

**Root cause:** The DAG was designed for cascade (upstream changes trigger downstream re-computation) but not for correlation (peer analyzers informing each other). The substrate graph was supposed to be the correlation layer, but analyzers only *write* to it — none *read*.

### Problem 2: No evidence linking from metrics to source events

**Where:** All analyzer outputs + all API endpoints + all UI tabs

The efficiency analyzer computes AES = 72. But which sessions drove that score? The comprehension analyzer says "blind spot in auth." But which sessions showed low comprehension? The cost analyzer says "waste ratio 0.23." But which sessions were wasted?

The lineage API exists (`GET /api/intelligence/lineage/:insightId`, `intelligence.ts` lines 105-167) with source events, contribution weights, and analyzer chains. **But no UI component renders it.** The feature was built backend-only and never surfaced.

**Root cause:** Analyzers compute aggregate metrics from DuckDB queries but don't track which specific events drove each metric. The `sourceEventIds` field exists in `AnalyzerResult` but is limited to 20 events (`.slice(0, 20)` in `engine.ts` line 264) and isn't propagated to the output JSON files.

### Problem 3: Hardcoded interpretation thresholds in UI

**Where:** `IntelligencePage.tsx` lines 48-178 (card-level extracts)

Each card's `extract()` function uses hardcoded thresholds for interpretation:

```typescript
// Autonomy card (lines 81-87)
extract: (d) => {
  const idx = d?.independenceIndex ?? 0;
  if (idx > 75) return "Steering with precision";
  if (idx > 40) return "Transmission engaging";
  return "Engine running without steering";
}
```

Meanwhile, `AutonomyTab` has `buildSteeringDiagnostics()` (lines 15-67) that generates *context-aware* diagnostics by examining acceptance rate, comprehension, alternatives, and modification rate together. The card ignores all of this and shows a simplistic 3-bucket label.

**Root cause:** The card-level extract was designed for a quick glance (single metric → label). But the extract function can't access the rich diagnostic logic that lives in the tab component. The interpretation logic is duplicated and inconsistent between card and tab levels.

### Problem 4: Artificial data caps hide insights

**Where:** Multiple tabs and API endpoints

| Location | Cap | What's hidden |
|----------|-----|---------------|
| `NarrativesTab.tsx` | `.slice(0, 5)` diagnostics, `.slice(0, 5)` prescriptions | All narratives beyond the first 5 |
| `GitExpertiseTab.tsx` | First 20 files (ownership), first 10 (churn) | Complete file ownership map |
| `ComprehensionTab.tsx` | `.slice(0, 8)` for radar chart modules | Modules beyond 8 |
| `MaturityTab.tsx` | `.slice(0, 8)` for radar dimensions | Dimensions beyond 8 |
| `intelligence.ts` line 78 | Last 10 actions, reversed | Full action history |
| `engine.ts` line 264 | `.slice(0, 20)` source event IDs | Full evidence chain |

**Root cause:** Caps were added to keep response sizes small and UI layouts clean. But they were hardcoded without "show more" controls, so users don't know data is hidden.

### Problem 5: Autonomy's black-box composite score

**Where:** `intelligence.ts` line 265

```typescript
const independenceIndex = hds * 0.3 + modRate * 0.25 + ctxLeverage * 0.2 + compTrend * 0.25;
```

The user sees "Independence Index: 62" but has no way to know:
- Which component is highest/lowest
- What the weights mean
- Which component to improve first
- What events drove each component's value

**Root cause:** The formula was designed for a single-number summary. No decomposition or explanation is provided. The `AutonomyTab` shows the breakdown components as KPI cards, but doesn't show the weights or how they combine.

### Problem 6: Zero LLM usage in the entire intelligence pipeline

**Where:** All 24 analyzers

Every analyzer uses pure computation: weighted formulas, regex extraction, cosine similarity, trend detection. Zero LLM calls anywhere in the intelligence pipeline.

**Why it matters:** Some intelligence outputs would dramatically benefit from LLM reasoning:

- **Narrative generation:** The narrative engine currently produces template-driven diagnostic/prescription strings. An LLM could produce natural-language explanations connecting multiple metrics.
- **Pattern explanation:** Prompt patterns are detected by regex feature extraction. An LLM could explain *why* a pattern is effective by analyzing the actual conversation content.
- **Anomaly interpretation:** When efficiency drops suddenly, an LLM could examine the surrounding sessions and explain the likely cause.

**Root cause:** The intelligence pipeline was designed for zero-cost, instant operation (runs every daemon tick). LLM calls would add latency and cost. But the quality ceiling of pure computation is real — some insights require reasoning that heuristics can't produce.

### Problem 7: Substrate graph built but underutilized

**Where:** `substrate-engine.ts` + `substrate.ts` API routes + no UI

The CozoDB substrate is fully functional:
- Analyzers contribute entities and relationships
- Confidence scoring and lifecycle management work
- Propagation rules run
- 3 API endpoints serve graph data

But:
- **No UI renders the graph** — the topology, trajectories, and neighborhood endpoints exist but no component calls them
- **No analyzer reads the graph** — analyzers write entities but never query the graph for cross-analyzer connections
- **No user-facing insight is graph-derived** — the graph is an invisible backend artifact

**Root cause:** The substrate was built as infrastructure for future features. The "future" never arrived. The graph accumulates entities silently, with no consumer giving them value.

### Problem 8: Inconsistent freshness and confidence communication

**Where:** All tabs

Only `ComprehensionTab` shows freshness and confidence info. `CostTab` has an optional disclaimer. All other tabs show metrics with no indication of:
- When the data was last updated
- How many data points back the metric
- Whether the metric has sufficient data to be reliable

**Root cause:** Freshness and confidence were added to the comprehension analyzer (which needs phase normalization and has complex confidence logic) but never standardized across all analyzers. There's no shared `FreshnessBadge` or `ConfidenceIndicator` pattern in the tab components.

---

## Reconstructed Architecture

```
CaptureEvents (DuckDB analytical cache)
       │
       ▼
┌────────────────────────────────────────────────────────────────┐
│  IntelligenceScheduler (DAG-based)                            │
│                                                                │
│  Phase 1: Dirty marking (event-driven + dependency-driven)     │
│  Phase 2: Topological processing (Kahn's algorithm)            │
│  Phase 3: Cascade propagation (magnitude ≥ 0.05)               │
│  Phase 4: Entity contribution → SubstrateEngine                │
│  Phase 5: Cross-analyzer correlation (NEW)                     │
│  Phase 6: Evidence chain building (NEW)                        │
│                                                                │
│  ┌─ Tier 0 ──────────────────────────────────────────────────┐ │
│  │ 17 leaf analyzers (enhanced with evidence tracking)        │ │
│  │ efficiency, comprehension, cost, velocity, patterns,       │ │
│  │ loop-detector, blind-spots, decision-replay,               │ │
│  │ session-intelligence, causality, commit, file-churn,       │ │
│  │ ai-git-linker, expertise-map, direction-by-file,           │ │
│  │ token-proxy, window-aggregator                             │ │
│  └────────────────────────────────────────────────────────────┘ │
│                        │                                        │
│  ┌─ Tier 1 ──────────┐│┌─ Tier 2 ────────────┐                │
│  │ summary-writer     │││ efficiency-survival  │                │
│  │ intel-snapshot     │││ dual-velocity        │                │
│  │ profile-accum.     │││                      │                │
│  └────────────────────┘│└─────────────────────-┘                │
│                        │                                        │
│  ┌─ Tier 3 ──────────┐│                                        │
│  │ maturity-model     ││                                        │
│  │ maturity-ownership ││                                        │
│  │ narrative-engine   ││                                        │
│  └────────────────────┘│                                        │
│                        │                                        │
│  ┌─ NEW ─────────────────────────────────────────────────────┐ │
│  │ Correlation Engine (reads all tier 0-3 outputs)            │ │
│  │ Evidence Linker (maps metrics → source events)             │ │
│  │ Narrative Synthesizer (LLM-powered narrative generation)   │ │
│  └────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
       │
       ├──► Intelligence JSON outputs (evidence-enriched)
       ├──► SubstrateEngine (CozoDB graph, cross-linked entities)
       ├──► Correlations JSON (cross-analyzer patterns)
       └──► Evidence chains (per-analyzer provenance maps)
              │
              ▼
┌────────────────────────────────────────────────────────────────┐
│  Intelligence API Layer                                        │
│                                                                │
│  Enhanced endpoints:                                           │
│  - All existing endpoints + evidenceEventIds + freshness       │
│  - /api/intelligence/:analyzer/evidence/:metric (NEW)          │
│  - /api/intelligence/correlations (NEW)                        │
│  - /api/intelligence/explain/:insightId (NEW, LLM-powered)    │
│  - /api/substrate/explore/:entityId (NEW)                      │
└────────────────────────────────────────────────────────────────┘
              │
              ▼
┌────────────────────────────────────────────────────────────────┐
│  Intelligence Hub UI (8 tabs, all enhanced)                    │
│                                                                │
│  Every tab gains:                                              │
│  - FreshnessBadge (data age + confidence)                      │
│  - Evidence drill-through (click metric → drawer)              │
│  - Correlation highlights (cross-analyzer insights)            │
│  - No artificial caps (show more / pagination)                 │
│  - Transparent computation (show formula + weights)            │
└────────────────────────────────────────────────────────────────┘
```

---

## Analyzer Quality Transformation

### Enhancement 1: Evidence tracking in every analyzer

**Change:** Every analyzer's `update()` method now returns `sourceEventIds` that are written into the output JSON (not just the AnalyzerResult).

Currently, `sourceEventIds` is collected in `AnalyzerResult` but capped at 20 (`.slice(0, 20)`) and used only for lineage mapping. The new approach:

1. **Remove the `.slice(0, 20)` cap** — track all contributing event IDs
2. **Embed evidence in output JSON** — each metric in the output carries `evidenceEventIds` showing which specific events drove that metric
3. **Per-metric evidence, not per-analyzer** — instead of one list of events for the whole analyzer, each sub-metric (e.g., each domain's velocity, each module's comprehension) tracks its own evidence

Example — comprehension analyzer output before and after:

```json
// BEFORE: comprehension.json
{
  "overall": 72,
  "byModule": [
    { "module": "src/auth", "score": 34, "sessions": 8, "trend": "declining" }
  ],
  "blindSpots": [
    { "module": "src/auth", "reason": "High AI reliance", "severity": "warning" }
  ]
}

// AFTER: comprehension.json
{
  "overall": 72,
  "byModule": [
    {
      "module": "src/auth",
      "score": 34,
      "sessions": 8,
      "trend": "declining",
      "evidenceEventIds": ["9ec6...", "a3f4...", "b7d2...", ...],
      "topContributors": [
        { "eventId": "9ec6...", "contribution": -12, "summary": "Accepted AI auth refactor without modification" },
        { "eventId": "a3f4...", "contribution": -8, "summary": "Low HDS session on JWT implementation" }
      ]
    }
  ],
  "blindSpots": [
    {
      "module": "src/auth",
      "reason": "8 sessions with HDS < 0.3 in the last 7 days; no manual modifications to AI-generated auth code",
      "severity": "warning",
      "evidenceEventIds": ["9ec6...", "a3f4...", ...],
      "sustainedWeeks": 2
    }
  ],
  "freshness": { "updatedAt": "2026-04-26T14:30:00Z", "dataPoints": 47, "confidence": "high" }
}
```

### Enhancement 2: Freshness and confidence on every output

**Change:** Every analyzer output gains a `_meta` block:

```typescript
interface AnalyzerOutputMeta {
  updatedAt: string;         // ISO timestamp
  dataPoints: number;        // events that contributed
  confidence: "high" | "medium" | "low";  // high ≥ 10 events, medium ≥ 5, low < 5
  watermark: string;         // last processed event timestamp
  staleness: number;         // seconds since last update
}
```

The API layer passes this through. The UI renders it as `FreshnessBadge` + `ConfidenceBadge` on every tab.

### Enhancement 3: Specific diagnostic messages (not generic thresholds)

**Change:** Replace hardcoded interpretation thresholds in card extracts with context-aware diagnostics generated by the analyzers themselves.

Currently, interpretations are split between:
- **Card extracts** in `IntelligencePage.tsx` — simplistic 3-bucket thresholds
- **Tab diagnostics** in individual tab components — richer but inconsistent

The new approach: each analyzer output includes a `diagnostics` array with context-aware messages. The card extract uses the first diagnostic. The tab shows all.

```typescript
interface DiagnosticMessage {
  severity: "info" | "warning" | "critical";
  message: string;           // Human-readable: "Steering is loose in auth domain"
  evidence: string;          // What data backs this: "8 of 12 sessions had HDS < 0.3"
  actionable: string;        // What to do: "Review AI-generated auth code before accepting"
  relatedAnalyzers?: string[];  // Cross-references to other relevant analyzers
}
```

Example — the efficiency analyzer currently outputs:

```json
{ "aes": 72, "confidence": "high", "trend": "declining" }
```

After enhancement:

```json
{
  "aes": 72,
  "confidence": "high",
  "trend": "declining",
  "diagnostics": [
    {
      "severity": "warning",
      "message": "Efficiency declining: 3 stuck sessions detected in auth domain",
      "evidence": "AES dropped from 81→72 over 7 days. Loop detector found 3 sessions with similarity ≥0.7 in src/auth/",
      "actionable": "Break the loop pattern: try a different approach to auth implementation or consult documentation",
      "relatedAnalyzers": ["loop-detector", "comprehension-radar"]
    }
  ],
  "freshness": { "updatedAt": "...", "dataPoints": 47, "confidence": "high" }
}
```

### Enhancement 4: LLM-powered narrative engine

**Change:** The `narrativeEngineAnalyzer` (currently the terminal DAG node) gains an optional LLM path.

**Current behavior:** Produces template-driven diagnostic/prescription strings from maturity model state.

**New behavior (dual path):**

1. **LLM path** (scheduled, daily): Takes all analyzer outputs from the current run + substrate graph topology → sends to LLM with a structured narrative prompt → produces evidence-linked narrative claims with specific sessions, domains, and metrics referenced.

2. **Fallback path** (every tick): Enhanced template engine that:
   - Reads all tier 0-3 analyzer outputs (not just maturity)
   - Generates diagnostics that reference specific metrics and domains
   - Links each diagnostic to evidence event IDs from the relevant analyzer
   - Produces prescriptions with specific, actionable suggestions (not generic "improve your efficiency")

**LLM narrative prompt:**

```
You are Unfade's intelligence narrative engine. You receive the current state of 24 intelligence analyzers and must produce evidence-backed narrative claims about the developer's work patterns.

RULES:
1. Every claim MUST reference specific data: "Your efficiency dropped 15% (81→72) over the past week" not "Your efficiency is declining"
2. Every claim MUST be backed by specific evidence: name the domain, the sessions, the metrics
3. Cross-analyzer claims are highest value: connect insights from different analyzers
4. Prescriptions MUST be actionable: "Review the 3 auth sessions flagged by loop-detector" not "Improve your workflow"
5. Maximum 10 diagnostics, 5 prescriptions. Quality over quantity.

INPUT:
{analyzer_outputs_summary}

OUTPUT SCHEMA:
{ narratives: [{ type, claim, evidence, confidence, estimatedImpact, relatedAnalyzers, evidenceEventIds }] }
```

---

## DAG Scheduler Enhancements

### Enhancement 1: Post-processing phases

**File:** `src/services/intelligence/engine.ts`

After the topological processing loop completes, add two new phases:

#### Phase 5: Cross-analyzer correlation

After all analyzers have run, invoke the `CorrelationEngine` (new) which reads all analyzer outputs and detects multi-analyzer patterns. See [Cross-Analyzer Correlation Engine](#cross-analyzer-correlation-engine).

#### Phase 6: Evidence chain building

After correlations are detected, invoke the `EvidenceLinker` (new) which builds complete evidence chains from each metric to its source events. See [Evidence Provenance System](#evidence-provenance-system).

### Enhancement 2: Unbounded source event tracking

**File:** `src/services/intelligence/engine.ts` line 264

**Before:** `sourceEventIds: (updateResult.sourceEventIds ?? []).slice(0, 20)`

**After:** `sourceEventIds: updateResult.sourceEventIds ?? []`

The 20-event cap was added for response size. With the new per-metric evidence tracking, the AnalyzerResult-level list is used only for lineage mapping (not API responses), and can be unlimited.

### Enhancement 3: Domain-aware event classification

**File:** `src/services/intelligence/incremental-state.ts` line 233

**Before:** All events assigned `domain: "general"`

**After:** Derive domain from event content:

```typescript
function classifyDomain(event: AnalyzerEvent): string {
  // Use files touched to classify domain
  if (event.files?.length) {
    const topDir = event.files[0].split("/").slice(0, 2).join("/");
    return topDir;  // e.g., "src/auth", "src/ui", "daemon/cmd"
  }
  // Use metadata domain if available
  if (event.domain) return event.domain;
  // Fall back to general
  return "general";
}
```

This enables domain-scoped analytics across all analyzers without requiring each analyzer to implement its own domain classification.

### Enhancement 4: Batch size increase with pagination

**File:** `src/services/intelligence/incremental-state.ts` line 175

**Before:** `LIMIT 500` hardcoded

**After:** Process in pages: fetch 500, process, advance watermark, repeat until no more events. This ensures no events are missed during high-activity periods.

```typescript
async function buildEventBatch(ctx, watermark): Promise<NewEventBatch> {
  const PAGE_SIZE = 500;
  let allEvents: AnalyzerEvent[] = [];
  let cursor = watermark;

  while (true) {
    const page = await ctx.analytics.all(`SELECT ... WHERE ts > ? ORDER BY ts LIMIT ?`, [cursor, PAGE_SIZE]);
    if (page.length === 0) break;
    allEvents.push(...page);
    cursor = page[page.length - 1].ts;
    if (page.length < PAGE_SIZE) break;  // last page
  }

  return { events: allEvents, highWatermark: cursor, ... };
}
```

---

## Substrate Graph Enrichment

### Enhancement 1: Graph-powered cross-analyzer queries

**Change:** The `SubstrateEngine` gains query methods that analyzers and the correlation engine can call:

```typescript
interface SubstrateQueries {
  /** Find all entities related to a domain */
  entitiesByDomain(domain: string): SubstrateEntity[];

  /** Find the path between two entities (e.g., pattern → session) */
  findPath(fromId: string, toId: string, maxHops: number): GraphPath[];

  /** Find entities with declining confidence (potential issues) */
  decliningEntities(since: string): SubstrateEntity[];

  /** Find the most connected entities (hub nodes = most important patterns/insights) */
  hubEntities(topK: number): SubstrateEntity[];

  /** Find entities contributed by multiple analyzers (high confidence, cross-validated) */
  crossValidatedEntities(): SubstrateEntity[];
}
```

### Enhancement 2: Entity enrichment with evidence

**Change:** Every `EntityContribution` now includes `evidenceEventIds`:

```typescript
interface EntityContribution {
  entityId: string;
  entityType: string;
  projectId?: string;
  analyzerName: string;
  stateFragment: Record<string, unknown>;
  relationships: EntityRelationship[];
  evidenceEventIds: string[];    // NEW — source events that produced this entity
}
```

### Enhancement 3: UI-facing graph exploration

**Change:** New API endpoint and UI component:

- `GET /api/substrate/explore/:entityId` — returns the entity, its neighborhood (1-hop), evidence events, and contributing analyzers
- `SubstrateExplorer` component in the UI — renders entity neighborhood as an interactive graph (nodes + edges) with evidence drawer on click

This transforms the substrate from an invisible backend artifact into a user-facing exploration tool.

---

## Intelligence API Overhaul

### Enhancement 1: Evidence endpoints for every analyzer

**New pattern:** `GET /api/intelligence/:analyzer/evidence`

Each analyzer's API endpoint gains an evidence sub-resource:

```typescript
// GET /api/intelligence/comprehension/evidence/src%2Fauth
{
  metric: "comprehension",
  scope: "src/auth",
  value: 34,
  events: [
    {
      id: "9ec6...",
      timestamp: "2026-04-25T14:30:00Z",
      source: "ai-session",
      type: "ai-conversation",
      summary: "Accepted AI auth refactor without modification",
      contribution: -12,  // how much this event affected the score
      branch: "feat/auth-refactor",
      files: ["src/auth/middleware.ts", "src/auth/jwt.ts"]
    },
    // ...more events
  ],
  totalEvents: 8,
  confidence: "high"
}
```

### Enhancement 2: Correlation endpoint

**New:** `GET /api/intelligence/correlations`

Returns cross-analyzer patterns detected by the correlation engine:

```typescript
{
  correlations: [
    {
      id: "corr-001",
      type: "efficiency-blind-spot",
      severity: "warning",
      title: "Efficiency declining in blind spot domain",
      explanation: "AES dropped 12% in src/auth (81→72). Comprehension radar shows src/auth as a blind spot (score: 34). Loop detector found 3 stuck sessions there.",
      analyzers: ["efficiency", "comprehension-radar", "loop-detector"],
      domain: "src/auth",
      evidenceEventIds: ["9ec6...", "a3f4...", "b7d2..."],
      actionable: "Break the loop: try a different auth approach or consult documentation before the next session",
      detectedAt: "2026-04-26T14:30:00Z"
    }
  ]
}
```

### Enhancement 3: LLM explanation endpoint

**New:** `GET /api/intelligence/explain/:insightId`

On-demand LLM explanation for any intelligence insight. The endpoint:

1. Loads the insight's evidence chain (from lineage or from analyzer output)
2. Loads the relevant analyzer states
3. Sends to LLM with a focused explanation prompt
4. Returns a natural-language explanation with evidence citations

```typescript
{
  insightId: "eff-decline-auth",
  explanation: "Your AI Efficiency Score dropped from 81 to 72 over the past week, primarily driven by three sessions in the auth domain where you accepted AI-generated code without modification. The comprehension radar confirms auth is a blind spot (score: 34/100 with 8 sessions). The loop detector flagged these sessions as similar — you may be approaching the same auth problem from the same angle repeatedly.",
  evidence: [
    { eventId: "9ec6...", role: "primary", summary: "..." },
    { eventId: "a3f4...", role: "corroborating", summary: "..." }
  ],
  suggestions: [
    "Review the JWT implementation in src/auth/jwt.ts manually before the next AI session",
    "Try a different approach: session-based auth instead of JWT refresh tokens"
  ],
  confidence: 0.85
}
```

### Enhancement 4: Enriched existing endpoints

All existing endpoints gain:
- `_meta.freshness` — data age and confidence
- `_meta.evidenceAvailable` — boolean indicating whether evidence drill-through is available
- Evidence event IDs on sub-metrics where applicable

---

## Intelligence Hub UI Transformation

### Universal enhancements (all 8 tabs)

Every tab gains these components:

1. **`FreshnessBadge`** — shows data age, confidence level, data point count. Reuses the existing `FreshnessBadge` component from `src/ui/components/shared/FreshnessBadge.tsx`.

2. **`EvidenceDrawer` integration** — clicking any metric, chart segment, table row, or diagnostic opens the evidence drawer showing:
   - Source events with timestamps and source badges
   - Contribution weight per event (how much each event affected the metric)
   - Analyzer chain (which analyzers contributed to this insight)
   - Raw data toggle

3. **`CorrelationHighlights`** — if the correlation engine detected insights involving this tab's analyzer, they're shown as highlighted cards at the top of the tab.

4. **`ShowMore` pattern** — all `.slice(0, N)` caps replaced with expandable sections:
   ```tsx
   <ShowMore items={diagnostics} initialCount={5} renderItem={(d) => <DiagnosticCard {...d} />} />
   ```

5. **`MetricDecomposition`** — for composite scores (AES, independence index, maturity), a visual breakdown showing component weights and values:
   ```
   Independence Index: 62
   ├── HDS (30%): ████████░░ 78  → contributes 23.4
   ├── Modification Rate (25%): ██████░░░░ 52  → contributes 13.0
   ├── Context Leverage (20%): █████░░░░░ 45  → contributes 9.0
   └── Comprehension Trend (25%): ██████░░░░ 66  → contributes 16.5
   ```

### Tab-specific enhancements

#### ComprehensionTab

| Before | After |
|--------|-------|
| Blind spots listed as text | Blind spots clickable → evidence drawer showing low-HDS sessions in that module |
| Radar chart capped at 8 modules | Full radar with "show all" toggle; table view for 8+ modules |
| No session drill-through | Click any module → see specific sessions with comprehension contribution |

#### AutonomyTab

| Before | After |
|--------|-------|
| Independence index as single number | `MetricDecomposition` showing formula, weights, and each component |
| Domain steering map with no drill-through | Click any domain row → evidence drawer showing sessions in that domain |
| `buildSteeringDiagnostics()` in tab only | Diagnostics generated by analyzer, shown in both card extract and tab |

#### PatternsTab

| Before | After |
|--------|-------|
| Pattern list with effectiveness % | Click any pattern → evidence drawer showing example sessions using that pattern |
| Anti-patterns listed without evidence | Anti-pattern clickable → sessions exhibiting the anti-pattern |
| No explanation of why a pattern works | LLM explanation available on-demand: "This pattern works because..." |

#### CostTab

| Before | After |
|--------|-------|
| Model cost breakdown bars | Click any model row → drawer showing most expensive sessions for that model |
| Waste ratio as a number | Click waste ratio → drawer showing abandoned/looping sessions |
| No per-session cost visibility | Cost table with per-session estimates, sortable by cost |

#### VelocityTab

| Before | After |
|--------|-------|
| Domain velocity bars | Click domain row → navigate to Decisions page filtered by domain + time period |
| Trend shown as arrow | Trend line with data points; click any point → events from that time period |

#### NarrativesTab

| Before | After |
|--------|-------|
| `.slice(0, 5)` cap per category | `ShowMore` with all narratives available |
| Claims without evidence | Each narrative card shows evidence event count; click → evidence drawer |
| No cross-analyzer context | Correlation-based narratives highlighted with multi-analyzer badges |

#### MaturityTab

| Before | After |
|--------|-------|
| Phase label with score | `MetricDecomposition` for overall score showing all dimension contributions |
| Radar chart capped at 8 | Full dimension rendering |
| Next phase requirements as checklist | Each requirement clickable → evidence of current state for that dimension |

#### EfficiencyTab

| Before | After |
|--------|-------|
| AES score with trend | Sub-metric decomposition showing all 5 weights and contributions |
| Trend line | Click any trend point → events from that time period |
| No explanation for changes | Correlation highlights: "AES dropped because..." with linked analyzers |

---

## Cross-Analyzer Correlation Engine

**File:** `src/services/intelligence/correlation-engine.ts` — **new file**

### Purpose

The correlation engine detects meaningful patterns that span multiple analyzers. No single analyzer can see these patterns because each analyzer only has access to its own state.

### Architecture

The correlation engine runs as Phase 5 of the scheduler, after all individual analyzers complete. It reads all analyzer output files and detects predefined correlation patterns.

### Correlation patterns

#### Pattern 1: Efficiency-Blind-Spot Correlation

**Detects:** Efficiency declining in a domain where comprehension is low

```
IF efficiency.trend == "declining"
AND comprehension.blindSpots contains domain D
AND efficiency.topContributingDomain == D
THEN emit correlation:
  "Efficiency declining in blind spot domain {D}: AES {old}→{new} while comprehension is {score}/100"
```

**Severity:** warning (becomes critical if efficiency drop > 20%)

#### Pattern 2: Cost-Loop Correlation

**Detects:** High cost driven by stuck sessions

```
IF cost.wasteRatio > 0.2
AND loopDetector.stuckLoops.length > 0
AND cost.topCostDomain overlaps loopDetector.stuckDomains
THEN emit correlation:
  "High waste ({wasteRatio}%) driven by {N} stuck sessions in {domain}"
```

**Severity:** warning

#### Pattern 3: Velocity-Comprehension Correlation

**Detects:** Velocity declining in domains with low comprehension

```
IF velocity.byDomain[D].trend == "decelerating"
AND comprehension.byModule[D].score < 50
THEN emit correlation:
  "Slowing down in {D}: velocity declining while comprehension is only {score}/100"
```

**Severity:** info (natural: you slow down when learning)

#### Pattern 4: Pattern-Efficiency Correlation

**Detects:** Effective prompt patterns correlating with high efficiency

```
IF promptPatterns.effective[P].avgDirectionScore > 0.7
AND efficiency.trend == "improving"
THEN emit correlation:
  "Pattern '{P}' correlating with efficiency improvement: direction score {score}%"
```

**Severity:** info (positive reinforcement)

#### Pattern 5: Expertise-Cost Correlation

**Detects:** High cost in domains with deep expertise (potential waste)

```
IF cost.byDomain[D].cost > 2x average
AND expertiseMap[D].classification == "deep"
THEN emit correlation:
  "High AI cost in {D} despite deep expertise — consider reducing AI reliance here"
```

**Severity:** warning

#### Pattern 6: Blind-Spot-Acceptance Correlation

**Detects:** High AI acceptance rate in blind spot domains (dangerous)

```
IF comprehension.blindSpots contains D
AND autonomy.dependencyMap[D].acceptanceRate > 80
THEN emit correlation:
  "CRITICAL: Accepting 80%+ AI output in blind spot domain {D} — high risk of undetected errors"
```

**Severity:** critical

### Extensibility

Correlation patterns are defined declaratively:

```typescript
interface CorrelationPattern {
  id: string;
  name: string;
  analyzers: string[];          // which analyzer outputs to read
  detect: (outputs: Map<string, unknown>) => CorrelationResult | null;
  severity: "info" | "warning" | "critical";
}
```

New patterns can be added by defining a new `CorrelationPattern` object and registering it. The engine iterates all registered patterns after each scheduler run.

---

## Evidence Provenance System

**File:** `src/services/intelligence/evidence-linker.ts` — **new file**

### Purpose

Every metric shown to the user should be traceable to source events. The evidence linker builds these traces.

### How it works

1. **Analyzer-level evidence:** Each analyzer's `update()` already returns `sourceEventIds`. The evidence linker reads these from each analyzer output.

2. **Per-metric evidence:** For analyzers with sub-metrics (comprehension by module, cost by model, velocity by domain), the evidence linker groups source events by the sub-metric dimension (module, model, domain) using the event's files/metadata.

3. **Cross-analyzer evidence:** When the correlation engine detects a cross-analyzer pattern, the evidence linker merges evidence from all involved analyzers into a unified chain.

4. **Evidence chain format:**

```typescript
interface EvidenceChain {
  /** What this chain backs */
  metric: string;           // "comprehension.byModule.src/auth"
  scope?: string;           // "src/auth"

  /** Ordered events, most impactful first */
  events: EvidenceEntry[];

  /** Which analyzers contributed */
  analyzers: string[];

  /** Confidence in this chain */
  confidence: number;
}

interface EvidenceEntry {
  eventId: string;
  timestamp: string;
  source: string;         // "ai-session" | "git" | "terminal"
  type: string;           // "ai-conversation" | "commit" | ...
  summary: string;
  contribution: number;   // how much this event affected the metric (-100 to +100)
  role: "primary" | "corroborating" | "context";
}
```

5. **Storage:** Evidence chains are written to `~/.unfade/intelligence/evidence/` as per-analyzer JSON files. The API serves them on demand — they're not embedded in the main output files to keep those lightweight.

---

## Enhanced Schema Definitions

### AnalyzerOutputBase (shared across all analyzer outputs)

```typescript
const AnalyzerOutputMeta = z.object({
  updatedAt: z.string(),
  dataPoints: z.number(),
  confidence: z.enum(["high", "medium", "low"]),
  watermark: z.string(),
  staleness: z.number(),  // seconds
});

const DiagnosticMessage = z.object({
  severity: z.enum(["info", "warning", "critical"]),
  message: z.string(),
  evidence: z.string(),
  actionable: z.string(),
  relatedAnalyzers: z.array(z.string()).default([]),
  evidenceEventIds: z.array(z.string()).default([]),
});
```

### Correlation schema

```typescript
const CorrelationSchema = z.object({
  id: z.string(),
  type: z.string(),
  severity: z.enum(["info", "warning", "critical"]),
  title: z.string(),
  explanation: z.string(),
  analyzers: z.array(z.string()),
  domain: z.string().optional(),
  evidenceEventIds: z.array(z.string()).default([]),
  actionable: z.string(),
  detectedAt: z.string(),
});
```

### Enhanced intelligence types (UI)

```typescript
// Added to all intelligence response types
interface IntelligenceResponse<T> {
  data: T;
  _meta: {
    tool: string;
    durationMs: number;
    freshness: {
      updatedAt: string;
      dataPoints: number;
      confidence: "high" | "medium" | "low";
    };
    evidenceAvailable: boolean;
    correlations?: Correlation[];  // if any cross-analyzer insights involve this metric
  };
}
```

---

## Design Decisions & Trade-offs

### Why a separate correlation engine instead of cross-dependencies?

**Chose:** Standalone `CorrelationEngine` that runs after all analyzers
**Over:** Making analyzers depend on each other's outputs (more DAG edges)
**Rationale:** Adding cross-dependencies between leaf analyzers (e.g., efficiency depends on comprehension) would create cycles or require restructuring the entire DAG. The correlation engine reads *output files* (read-only) after all analyzers finish, keeping the DAG structure clean. It also means correlations can be added or removed without touching any analyzer code.

### Why per-metric evidence instead of per-analyzer evidence?

**Chose:** Each sub-metric (e.g., comprehension for src/auth) tracks its own evidence events
**Over:** One flat list of evidence events per analyzer
**Rationale:** When a user clicks "comprehension: 34% for src/auth," they want to see the auth sessions, not all 47 sessions across all modules. Per-metric evidence enables precise drill-through. The cost is more complex evidence tracking in each analyzer, but the UX improvement is dramatic.

### Why strategic LLM usage (narrative only) instead of LLM-powered analyzers?

**Chose:** LLM calls only in the narrative engine and on-demand explanation endpoint
**Over:** LLM-powered versions of all analyzers
**Rationale:** The intelligence pipeline runs every 10 seconds (daemon tick). LLM calls take 2-10 seconds each and cost tokens. Running LLM on every analyzer tick would make the pipeline slow and expensive. Instead, LLM is used where it adds the most value: (1) daily narrative generation (1 call/day), and (2) on-demand explanation when the user clicks "explain" (1 call per user action). All other computation remains pure computation for instant, zero-cost operation.

### Why remove all `.slice()` caps instead of increasing them?

**Chose:** Remove all hardcoded caps; use `ShowMore` components and pagination
**Over:** Increasing caps (e.g., 5→20) or making them configurable
**Rationale:** Any cap hides data without the user knowing. A `ShowMore` component shows the first N items (preserving the clean layout) with a clear "Show 15 more" button. This gives users the same clean default view while making the full data accessible. The performance cost is negligible — React virtualizes long lists.

### Why keep the substrate as CozoDB instead of switching to a simpler graph?

**Chose:** Keep CozoDB with enhanced queries and UI
**Over:** Replacing with a simpler in-memory graph
**Rationale:** CozoDB is already built, functional, and hardened (injection prevention, batch isolation, atomic writes). It supports Datalog queries with recursive traversal — capabilities that an in-memory adjacency list can't match. The problem isn't the substrate implementation; it's that nobody consumes the graph. Adding consumers (correlation engine, UI explorer, cross-analyzer queries) gives the existing infrastructure its intended purpose.

### Why 6 initial correlation patterns instead of ML-based anomaly detection?

**Chose:** 6 hand-crafted correlation patterns with clear semantics
**Over:** ML-based automatic correlation detection
**Rationale:** With the current data volume (dozens to hundreds of events per day), ML-based detection would be unreliable and opaque. Hand-crafted patterns have clear semantics ("efficiency declining in blind spot domain"), are debuggable, and produce actionable output. As data volume grows, patterns can be replaced with learned models, but the output format (correlation with evidence) stays the same.

### Why evidence chains stored separately from analyzer outputs?

**Chose:** Evidence in `~/.unfade/intelligence/evidence/` as separate files
**Over:** Embedding full evidence in each analyzer's output JSON
**Rationale:** A comprehension output with embedded evidence for 50 modules, each with 10+ events, would be 50KB+ instead of 2KB. Most API consumers (cards, summaries) don't need evidence — only the evidence drawer does. Separate storage keeps the main outputs lightweight for fast card rendering while making evidence available on demand.

### Why transparent formula decomposition?

**Chose:** Show formula, weights, and component contributions for composite scores
**Over:** Showing only the final number with a verbal interpretation
**Rationale:** "Independence Index: 62" is meaningless without knowing what drives it. "Independence Index: 62 — HDS contributes 23.4 (30%), modification rate contributes 13.0 (25%), context leverage contributes 9.0 (20%), comprehension trend contributes 16.5 (25%)" tells the user exactly which component to improve. This follows the Decision Intelligence principle that every claim should be backed by transparent computation.

---

## Implementation Plan — Intelligence Presentation Sprints (IP)

Layer 3 (KGI sprints) unifies knowledge extraction into analyzers. These sprints build the **presentation, evidence, and correlation** layer on top — transforming isolated metrics into an evidence-linked, cross-analyzer, actionable intelligence system.

**Prerequisite:** KGI-1 through KGI-14 must be complete. Layer 4 reads analyzer outputs and CozoDB knowledge that KGI sprints produce.

### Sprint Dependency Graph

```
IP-1: Schemas + Evidence Linker Foundation
  │
  ├─► IP-2: Engine Hooks — Remove Caps + Add Post-Run Phases
  │     │
  │     ├─► IP-3: Analyzer Output Enrichment — Group A (efficiency, comprehension-radar, cost-attribution, loop-detector)
  │     │
  │     ├─► IP-4: Analyzer Output Enrichment — Group B (velocity-tracker, prompt-patterns, blind-spots, decision-replay)
  │     │     │
  │     │     └──────────────────────────────────────────────┐
  │     │                                                    │
  │     ├─► IP-5: Cross-Analyzer Correlation Engine          │
  │     │     │                                              │
  │     │     └─► IP-6: LLM Narrative Enhancement            │
  │     │                                                    │
  │     └─► IP-7: Substrate Query Layer                      │
  │                                                          ▼
  ├─► IP-8: Shared UI Components (ShowMore, MetricDecomposition, CorrelationCard, EvidenceEventCard)
  │     │
  │     └─► IP-9: API Layer — Evidence + Correlation Endpoints
  │           │
  │           ├─► IP-10: Intelligence Hub UI — Comprehension + Autonomy + Patterns + Cost Tabs
  │           │
  │           ├─► IP-11: Intelligence Hub UI — Velocity + Narratives + Maturity + Efficiency Tabs
  │           │     │
  │           │     └─► IP-12: Intelligence Hub UI — Overview + Correlation Highlights
  │           │
  │           └─► IP-13: Substrate Explorer UI
  │
  └─► IP-14: E2E Verification + Performance Budget
```

**Parallelism:** After IP-1, sprints IP-2 and IP-8 can run in parallel (backend vs frontend foundations). After IP-2, sprints IP-3 through IP-7 are all independent. IP-9 requires IP-3/IP-4/IP-5 complete (needs enriched outputs to serve). IP-10 and IP-11 are independent tab batches. IP-14 depends on all prior sprints.

**Total estimate:** ~14 sprints, ~56 hours (~7 working days).

---

### IP-1: Schemas + Evidence Linker Foundation

**Goal:** Define all shared types (evidence chains, correlations, diagnostics, analyzer output meta) and build the evidence linker module that groups source events by metric and analyzer.

**Day estimate:** ~4 hours. Schema definitions + evidence linker + tests.

**Depends on:** KGI-14 (all analyzer rewrites complete).

---

**IP-1.1: Define Shared Schemas**

**Create:** `src/schemas/intelligence-presentation.ts`

All types used across Layer 4 sprints. Single source of truth — analyzers, API, and UI all import from here.

```typescript
import { z } from "zod";

// ─── Analyzer Output Meta (added to every analyzer output) ──────────

export const AnalyzerOutputMetaSchema = z.object({
  updatedAt: z.string(),
  dataPoints: z.number(),
  confidence: z.enum(["high", "medium", "low"]),
  watermark: z.string(),
  stalenessMs: z.number(),
});
export type AnalyzerOutputMeta = z.infer<typeof AnalyzerOutputMetaSchema>;

// ─── Diagnostic Message (per-analyzer actionable insights) ──────────

export const DiagnosticMessageSchema = z.object({
  severity: z.enum(["info", "warning", "critical"]),
  message: z.string(),
  evidence: z.string(),
  actionable: z.string(),
  relatedAnalyzers: z.array(z.string()).default([]),
  evidenceEventIds: z.array(z.string()).default([]),
});
export type DiagnosticMessage = z.infer<typeof DiagnosticMessageSchema>;

// ─── Evidence Chain (per-metric drill-through) ──────────────────────

export const EvidenceEntrySchema = z.object({
  eventId: z.string(),
  timestamp: z.string(),
  source: z.string(),
  type: z.string(),
  summary: z.string(),
  contribution: z.number(),
  role: z.enum(["primary", "corroborating", "context"]),
});
export type EvidenceEntry = z.infer<typeof EvidenceEntrySchema>;

export const EvidenceChainSchema = z.object({
  metric: z.string(),
  scope: z.string().optional(),
  events: z.array(EvidenceEntrySchema),
  analyzers: z.array(z.string()),
  confidence: z.number(),
});
export type EvidenceChain = z.infer<typeof EvidenceChainSchema>;

// ─── Correlation (cross-analyzer insight) ───────────────────────────

export const CorrelationSchema = z.object({
  id: z.string(),
  type: z.string(),
  severity: z.enum(["info", "warning", "critical"]),
  title: z.string(),
  explanation: z.string(),
  analyzers: z.array(z.string()),
  domain: z.string().optional(),
  evidenceEventIds: z.array(z.string()).default([]),
  actionable: z.string(),
  detectedAt: z.string(),
});
export type Correlation = z.infer<typeof CorrelationSchema>;
```

---

**IP-1.2: Build Evidence Linker**

**Create:** `src/services/intelligence/evidence-linker.ts`

Reads analyzer output files and groups source events into per-metric evidence chains. Three responsibilities:

1. **Per-metric grouping:** For analyzers with sub-metrics (comprehension by module, cost by model), groups `sourceEventIds` by the sub-metric dimension using event metadata (files, domain tags).

2. **Cross-analyzer merging:** When correlation engine detects a cross-analyzer pattern, merges evidence from all involved analyzers into a unified chain.

3. **Evidence file persistence:** Writes per-analyzer evidence JSON to `~/.unfade/intelligence/evidence/<analyzerName>.json`. Separate from main output to keep card rendering fast.

```typescript
import type { EvidenceChain, EvidenceEntry } from "../../schemas/intelligence-presentation.js";

export interface EvidenceLinkerConfig {
  intelligenceDir: string;  // ~/.unfade/intelligence/
  analytics: DbLike;        // DuckDB — for event metadata lookups
}

/**
 * Build evidence chains for a single analyzer's output.
 * Reads the analyzer's sourceEventIds + sub-metric breakdown,
 * enriches each event ID with metadata from DuckDB, and groups by metric.
 */
export async function buildEvidenceChains(
  analyzerName: string,
  output: AnalyzerOutputWithEvidence,
  config: EvidenceLinkerConfig,
): Promise<EvidenceChain[]> { ... }

/**
 * Merge evidence chains from multiple analyzers into a cross-analyzer chain.
 * Used by the correlation engine when a pattern involves 2+ analyzers.
 */
export function mergeEvidenceChains(
  chains: EvidenceChain[],
  correlationType: string,
): EvidenceChain { ... }

/**
 * Persist evidence chains to disk. Written after each scheduler run.
 * File: ~/.unfade/intelligence/evidence/<analyzerName>.json
 */
export async function writeEvidenceFile(
  analyzerName: string,
  chains: EvidenceChain[],
  intelligenceDir: string,
): Promise<void> { ... }

/**
 * Load evidence chains for a specific analyzer (API serves on demand).
 */
export async function loadEvidenceFile(
  analyzerName: string,
  intelligenceDir: string,
): Promise<EvidenceChain[]> { ... }
```

---

**IP-1.3: Evidence Linker Tests**

**Create:** `test/services/intelligence/evidence-linker.test.ts`

- `buildEvidenceChains()` — groups events by sub-metric dimension, assigns contribution scores, orders by impact
- `mergeEvidenceChains()` — deduplicates shared events across analyzers, preserves highest contribution
- `writeEvidenceFile()` / `loadEvidenceFile()` — round-trip serialization, handles missing directory
- Edge case: empty sourceEventIds → empty chain (no error)
- Edge case: event IDs not found in DuckDB → gracefully excluded from chain

---

### IP-2: Engine Hooks — Remove Caps + Add Post-Run Phases

**Goal:** Remove all artificial data caps from the intelligence engine and add Phase 5 (correlation) and Phase 6 (evidence persistence) hooks to the scheduler's post-run flow.

**Day estimate:** ~3 hours. Engine modifications + incremental-state cleanup + tests.

**Depends on:** IP-1 (schemas and evidence linker).

---

**IP-2.1: Remove Caps from Engine**

**Modify:** `src/services/intelligence/engine.ts`

- Remove `.slice(0, 20)` on `sourceEventIds` in the topological processing loop. Source event IDs must flow through untruncated so evidence linker can build per-metric chains.
- Add `Phase 5: Correlation` hook after all analyzers complete: calls `runCorrelations()` (IP-5) with all analyzer outputs.
- Add `Phase 6: Evidence` hook after correlation: calls `buildAndPersistEvidence()` (IP-1) for each analyzer + any correlation-generated chains.

```typescript
// After existing Phase 4 (topological analyzer loop)

// Phase 5: Cross-analyzer correlation (added by IP-5, no-op until then)
if (this.correlationEngine) {
  const correlations = await this.correlationEngine.detect(analyzerOutputs);
  await writeCorrelations(correlations, this.intelligenceDir);
}

// Phase 6: Evidence persistence
if (this.evidenceLinker) {
  for (const [name, output] of analyzerOutputs) {
    const chains = await buildEvidenceChains(name, output, this.evidenceConfig);
    await writeEvidenceFile(name, chains, this.intelligenceDir);
  }
}
```

---

**IP-2.2: Remove Caps from Incremental State**

**Modify:** `src/services/intelligence/incremental-state.ts`

- Replace `LIMIT 500` in batch building queries with paginated iteration (process in batches of 500 but don't stop at 500).
- Replace `domain: "general"` fallback with `classifyDomain()` from the domain classification pipeline.
- Ensure `sourceEventIds` from each analyzer's `update()` call are stored without truncation.

---

**IP-2.3: Engine Hook Tests**

**Create:** `test/services/intelligence/engine-hooks.test.ts`

- Verify Phase 5 hook is called after all analyzers complete
- Verify Phase 6 hook writes evidence files for each analyzer
- Verify `sourceEventIds` pass through without truncation (mock analyzer returning 100 IDs, assert all 100 appear in output)
- Verify engine still completes when correlation/evidence hooks are null (backward compat)

---

### IP-3: Analyzer Output Enrichment — Group A

**Goal:** Add `_meta` freshness block, `diagnostics[]`, and per-metric `evidenceEventIds` to efficiency, comprehension-radar, cost-attribution, and loop-detector analyzers.

**Day estimate:** ~5 hours. 4 analyzer modifications + tests.

**Depends on:** IP-2 (engine caps removed, evidence hooks in place).

---

**IP-3.1: Enrich efficiency analyzer**

**Modify:** `src/services/intelligence/analyzers/efficiency.ts`

- Add `_meta: AnalyzerOutputMeta` to output with `updatedAt`, `dataPoints`, `confidence`, `watermark`, `stalenessMs`.
- Add `diagnostics: DiagnosticMessage[]` — context-aware messages like "AES declining in auth domain — 3 sessions showed low direction scores" with `evidenceEventIds` pointing to those sessions.
- Add `evidenceEventIds` per sub-metric: each dimension of the AES composite score tracks which events contributed to it.
- Remove any remaining `.slice()` caps on trend data.

---

**IP-3.2: Enrich comprehension-radar analyzer**

**Modify:** `src/services/intelligence/analyzers/comprehension-radar.ts`

- Add `_meta: AnalyzerOutputMeta`.
- Add per-module `evidenceEventIds` — each module's comprehension score links to the sessions that contributed to it.
- Add `topContributors` per module — top 3 events by comprehension impact.
- Enhance blind spot messages: "src/auth is a blind spot — only 2 sessions in 14 days, HDS 34/100" with `evidenceEventIds`.

---

**IP-3.3: Enrich cost-attribution analyzer**

**Modify:** `src/services/intelligence/analyzers/cost-attribution.ts`

- Add `_meta: AnalyzerOutputMeta`.
- Add per-model `evidenceEventIds` — which sessions used each model.
- Add per-domain `evidenceEventIds` — which sessions drove cost in each domain.
- Remove `LIMIT 10` on cost dimensions — let all dimensions flow through.

---

**IP-3.4: Enrich loop-detector analyzer**

**Modify:** `src/services/intelligence/analyzers/loop-detector.ts`

- Add `_meta: AnalyzerOutputMeta`.
- Remove `.slice(0, 3)` on similar rejections — all rejection instances available via evidence.
- Add `evidenceEventIds` per stuck loop — sessions where the loop was detected.

---

**IP-3.5: Group A Enrichment Tests**

**Modify:** `test/services/intelligence/analyzers/efficiency.test.ts`, `comprehension-radar.test.ts`, `cost-attribution.test.ts`, `loop-detector.test.ts`

For each analyzer:
- Verify output includes `_meta` with all required fields
- Verify `diagnostics` array is populated when conditions met (e.g., declining trend, blind spot detected)
- Verify `evidenceEventIds` per sub-metric are non-empty when events exist
- Verify no `.slice()` truncation — mock 50 items, assert all 50 appear in output

---

### IP-4: Analyzer Output Enrichment — Group B

**Goal:** Add `_meta`, `diagnostics[]`, and per-metric `evidenceEventIds` to velocity-tracker, prompt-patterns, blind-spots, and decision-replay analyzers.

**Day estimate:** ~5 hours. 4 analyzer modifications + tests.

**Depends on:** IP-2 (engine caps removed, evidence hooks in place).

---

**IP-4.1: Enrich velocity-tracker analyzer**

**Modify:** `src/services/intelligence/analyzers/velocity-tracker.ts`

- Add `_meta: AnalyzerOutputMeta`.
- Add per-domain `evidenceEventIds` — events driving velocity in each domain.

---

**IP-4.2: Enrich prompt-patterns analyzer**

**Modify:** `src/services/intelligence/analyzers/prompt-patterns.ts`

- Add `_meta: AnalyzerOutputMeta`.
- Add `exampleSessionIds` per effective pattern — sessions that used this pattern successfully.
- Remove `LIMIT 500` on prompt query — paginated batch processing.

---

**IP-4.3: Enrich blind-spots analyzer**

**Modify:** `src/services/intelligence/analyzers/blind-spots.ts`

- Add `_meta: AnalyzerOutputMeta`.
- Add `evidenceEventIds` per alert — sessions in blind spot domains.
- Enhance messages with specific session references: "3 sessions in src/auth, all with HDS < 40".

---

**IP-4.4: Enrich decision-replay analyzer**

**Modify:** `src/services/intelligence/analyzers/decision-replay.ts`

- Add `_meta: AnalyzerOutputMeta`.
- Remove `.slice(-10)` on replays — full replay history accessible.
- Add `evidenceEventIds` per replay — sessions where each decision was made.

---

**IP-4.5: Group B Enrichment Tests**

**Modify:** `test/services/intelligence/analyzers/velocity-tracker.test.ts`, `prompt-patterns.test.ts`, `blind-spots.test.ts`, `decision-replay.test.ts`

Same pattern as IP-3.5: `_meta` present, `diagnostics` populated, `evidenceEventIds` per sub-metric, no truncation.

---

### IP-5: Cross-Analyzer Correlation Engine

**Goal:** Build the correlation engine that detects meaningful patterns spanning multiple analyzers. Runs as Phase 5 of the scheduler, after all individual analyzers complete.

**Day estimate:** ~5 hours. New module + 6 patterns + scheduler integration + tests.

**Depends on:** IP-2 (Phase 5 hook in engine).

---

**IP-5.1: Build Correlation Engine**

**Create:** `src/services/intelligence/correlation-engine.ts`

```typescript
import type { Correlation } from "../../schemas/intelligence-presentation.js";

export interface CorrelationPattern {
  id: string;
  name: string;
  analyzers: string[];
  detect: (outputs: Map<string, unknown>) => Correlation | null;
}

export class CorrelationEngine {
  private patterns: CorrelationPattern[] = [];

  register(pattern: CorrelationPattern): void { ... }

  /**
   * Run all registered patterns against the current analyzer outputs.
   * Called by the engine's Phase 5 hook after all analyzers complete.
   */
  async detect(outputs: Map<string, unknown>): Promise<Correlation[]> {
    const results: Correlation[] = [];
    for (const pattern of this.patterns) {
      const hasAllOutputs = pattern.analyzers.every(a => outputs.has(a));
      if (!hasAllOutputs) continue;
      const result = pattern.detect(outputs);
      if (result) results.push(result);
    }
    return results;
  }
}
```

**IP-5.2: Implement 6 Initial Correlation Patterns**

**Create:** `src/services/intelligence/correlation-patterns.ts`

Each pattern is a pure function that reads specific analyzer outputs and returns a `Correlation` or null:

1. **Efficiency-Blind-Spot:** Efficiency declining in domain where comprehension is low → warning/critical.
2. **Cost-Loop:** High waste ratio + stuck loops in same domain → warning.
3. **Velocity-Comprehension:** Velocity decelerating in low-comprehension domain → info.
4. **Pattern-Efficiency:** Effective prompt pattern correlating with efficiency improvement → info (positive reinforcement).
5. **Expertise-Cost:** High cost in deep-expertise domain → warning (potential over-reliance on AI).
6. **Blind-Spot-Acceptance:** High AI acceptance rate in blind spot domain → critical (dangerous uncritical acceptance).

Each pattern sets `severity`, `evidenceEventIds` (merged from both analyzers), and an `actionable` recommendation.

---

**IP-5.3: Correlation Persistence**

**Add to:** `src/services/intelligence/correlation-engine.ts`

```typescript
/**
 * Write detected correlations to ~/.unfade/intelligence/correlations.json.
 * Replaces previous file (correlations are recomputed each tick).
 */
export async function writeCorrelations(
  correlations: Correlation[],
  intelligenceDir: string,
): Promise<void> { ... }

export async function loadCorrelations(
  intelligenceDir: string,
): Promise<Correlation[]> { ... }
```

---

**IP-5.4: Correlation Engine Tests**

**Create:** `test/services/intelligence/correlation-engine.test.ts`

- Each of 6 patterns tested: provide mock analyzer outputs that trigger the pattern, verify correlation emitted with correct severity, analyzers, evidenceEventIds
- Negative test for each pattern: provide outputs that don't trigger, verify null
- `detect()` with missing analyzer output → pattern skipped (no error)
- `writeCorrelations()` / `loadCorrelations()` round-trip
- Multiple patterns triggered in same run → all returned

---

### IP-6: LLM Narrative Enhancement

**Goal:** Upgrade narrative-engine to use LLM for daily narrative generation with a template fallback. Narratives reference cross-analyzer correlations and include evidence linking.

**Day estimate:** ~4 hours. Narrative engine dual path + tests.

**Depends on:** IP-5 (correlation engine provides cross-analyzer insights for narrative context).

---

**IP-6.1: Add LLM Path to Narrative Engine**

**Modify:** `src/services/intelligence/narrative-engine.ts`

Add dual-path narrative generation:

1. **LLM path (daily):** Once per day, synthesize all analyzer outputs + correlations into natural-language narratives. The LLM receives: analyzer summaries, correlation insights, evidence highlights. Produces narratives grouped by category (comprehension, efficiency, patterns, cost, growth).

2. **Template fallback (per-tick):** Enhanced templates that reference correlation data and include evidence counts. Used when no LLM is configured or between daily runs.

```typescript
export interface NarrativeEngineConfig {
  llmConfig: LLMConfig | null;  // null = template-only mode
  correlations: Correlation[];   // from correlation engine
  intelligenceDir: string;
}

/**
 * Generate narratives. Uses LLM if configured and last LLM run > 24h ago.
 * Falls back to enhanced templates with correlation awareness.
 */
export async function generateNarratives(
  analyzerOutputs: Map<string, unknown>,
  config: NarrativeEngineConfig,
): Promise<NarrativeOutput> { ... }
```

---

**IP-6.2: Narrative Tests**

**Modify:** `test/services/intelligence/narrative-engine.test.ts`

- LLM path: mock LLM call, verify narratives include correlation references
- Template fallback: verify enhanced templates generate without LLM
- Template with correlations: verify cross-analyzer insights appear in output
- Evidence linking: verify narrative entries include `evidenceEventIds`
- Graceful degradation: LLM call fails → falls back to template (no error)

---

### IP-7: Substrate Query Layer

**Goal:** Add high-level query methods to SubstrateEngine for evidence-linked entity exploration, and add `evidenceEventIds` to `EntityContribution`.

**Day estimate:** ~3 hours. Substrate modifications + tests.

**Depends on:** IP-2 (enriched analyzer outputs with evidence).

---

**IP-7.1: Add SubstrateQueries Interface**

**Modify:** `src/services/substrate/substrate-engine.ts`

```typescript
export interface SubstrateQueries {
  /** Entities in a domain, ranked by engagement frequency. */
  entitiesByDomain(domain: string, limit?: number): Promise<EntityWithEvidence[]>;
  /** Shortest path between two entities in the knowledge graph. */
  findPath(fromEntity: string, toEntity: string): Promise<GraphPath | null>;
  /** Hub entities — highest degree centrality in the graph. */
  hubEntities(limit?: number): Promise<EntityWithEvidence[]>;
  /** Entities validated by multiple sources (git + AI session). */
  crossValidatedEntities(limit?: number): Promise<EntityWithEvidence[]>;
}

interface EntityWithEvidence {
  id: string;
  name: string;
  type: string;
  domain: string;
  evidenceEventIds: string[];
  engagement: number;
}
```

Each method is a Datalog query against CozoDB. `evidenceEventIds` comes from joining the entity with the `fact` relation's `episode_id` field.

---

**IP-7.2: Add Evidence to EntityContribution**

**Modify:** `src/services/substrate/substrate-engine.ts`

In the existing `contributeEntities()` flow, add `evidenceEventIds` to each `EntityContribution` so the substrate graph tracks which events support each entity relationship.

---

**IP-7.3: Substrate Query Tests**

**Create:** `test/services/substrate/substrate-queries.test.ts`

- `entitiesByDomain()` — returns entities with evidence, ordered by engagement
- `findPath()` — returns path between connected entities, null for disconnected
- `hubEntities()` — returns high-centrality nodes
- `crossValidatedEntities()` — only returns entities with both git and AI-session evidence
- Edge: empty graph → empty results (no error)

---

### IP-8: Shared UI Components

**Goal:** Build the 4 shared React components needed across all Intelligence Hub tabs: ShowMore, MetricDecomposition, CorrelationCard, EvidenceEventCard. Also extract shared utilities.

**Day estimate:** ~5 hours. 4 components + 3 utility modules + tests.

**Depends on:** IP-1 (schema types for props).

---

**IP-8.1: ShowMore Component**

**Create:** `src/ui/components/shared/ShowMore.tsx`

Generic expandable list. Replaces all `.slice(0, N)` patterns across the UI.

```tsx
interface ShowMoreProps<T> {
  items: T[];
  initialCount: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  label?: string;  // "Show {N} more {label}"
}

export function ShowMore<T>({ items, initialCount, renderItem, label = "items" }: ShowMoreProps<T>) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, initialCount);
  const remaining = items.length - initialCount;

  return (
    <>
      {visible.map((item, i) => renderItem(item, i))}
      {!expanded && remaining > 0 && (
        <Button variant="ghost" onClick={() => setExpanded(true)}>
          Show {remaining} more {label}
        </Button>
      )}
    </>
  );
}
```

---

**IP-8.2: MetricDecomposition Component**

**Create:** `src/ui/components/shared/MetricDecomposition.tsx`

Visual formula breakdown showing component weights and contributions for composite scores (AES, independence index, maturity).

```tsx
interface MetricComponent {
  name: string;
  weight: number;     // 0-1 (e.g., 0.30 for 30%)
  value: number;      // raw value (0-100)
  contribution: number; // weight * value
}

interface MetricDecompositionProps {
  label: string;            // "Independence Index"
  totalScore: number;       // 62
  components: MetricComponent[];
  onComponentClick?: (component: MetricComponent) => void;
}
```

Renders as horizontal bars with weight labels and contribution values. Clicking a component triggers evidence drawer for that sub-metric.

---

**IP-8.3: CorrelationCard Component**

**Create:** `src/ui/components/shared/CorrelationCard.tsx`

Cross-analyzer insight card shown at the top of Intelligence Hub tabs when correlations involve that tab's analyzer.

```tsx
interface CorrelationCardProps {
  correlation: Correlation;
  onEvidenceClick?: (eventIds: string[]) => void;
}
```

Renders severity badge, multi-analyzer badges (shows which analyzers detected the pattern), explanation text, and actionable recommendation. Click opens evidence drawer.

---

**IP-8.4: EvidenceEventCard + Shared Utilities**

**Create:** `src/ui/components/shared/EvidenceEventCard.tsx`

Reusable event card for evidence drawers — shows event summary, timestamp, source badge, contribution weight. Extracted from DecisionsPage pattern.

**Create:** `src/ui/lib/event-labels.ts`

Extract `sourceLabel()`, `typeLabel()`, `sourceBadgeClass()` from DecisionsPage for reuse.

**Create:** `src/ui/lib/date-utils.ts`

Extract `relativeDate()` from DecisionsPage.

**Create:** `src/ui/hooks/useProjectNames.ts`

Shared hook for `projectId` → display name resolution from repos data.

---

**IP-8.5: Shared Component Tests**

**Create:** `test/ui/components/ShowMore.test.tsx`, `MetricDecomposition.test.tsx`, `CorrelationCard.test.tsx`, `EvidenceEventCard.test.tsx`

- ShowMore: renders `initialCount` items, click "Show N more" renders all, handles 0 items
- MetricDecomposition: renders all components with weights, total matches sum, click triggers callback
- CorrelationCard: renders severity badge, analyzer badges, explanation text
- EvidenceEventCard: renders event summary, source badge, contribution weight, relative date

---

### IP-9: API Layer — Evidence + Correlation Endpoints

**Goal:** Add evidence and correlation endpoints to the intelligence API. Enhance all existing intelligence responses with `_meta.freshness` and `_meta.evidenceAvailable`.

**Day estimate:** ~5 hours. Route modifications + API client + types + tests.

**Depends on:** IP-3/IP-4 (enriched analyzer outputs), IP-5 (correlations.json).

---

**IP-9.1: Add Evidence + Correlation Routes**

**Modify:** `src/server/routes/intelligence.ts`

New endpoints:

```
GET /api/intelligence/evidence/:analyzerName
  → Returns EvidenceChain[] for a specific analyzer (loaded from evidence/ dir)

GET /api/intelligence/evidence/:analyzerName/:metric
  → Returns EvidenceChain for a specific metric within an analyzer

GET /api/intelligence/correlations
  → Returns Correlation[] (loaded from correlations.json)

GET /api/intelligence/explain/:insightId
  → LLM-generated natural language explanation of a specific insight
  → Returns { explanation: string, evidenceEventIds: string[] }
  → Falls back to template if no LLM configured
```

---

**IP-9.2: Enrich Existing Intelligence Responses**

**Modify:** `src/server/routes/intelligence.ts`

All existing endpoints (`/api/intelligence/efficiency`, `/api/intelligence/comprehension`, etc.) gain:

```typescript
{
  data: { /* existing analyzer output */ },
  _meta: {
    tool: "intelligence",
    durationMs: number,
    freshness: {
      updatedAt: string,
      dataPoints: number,
      confidence: "high" | "medium" | "low",
    },
    evidenceAvailable: true,  // enables "view evidence" in UI
    correlations: Correlation[],  // correlations involving this analyzer
  }
}
```

---

**IP-9.3: Substrate Explore Endpoint**

**Modify:** `src/server/routes/substrate.ts`

```
GET /api/substrate/explore/:entityId
  → Returns entity details + 1-hop neighborhood + evidenceEventIds
  → Uses SubstrateQueries from IP-7
```

---

**IP-9.4: API Client + Types**

**Modify:** `src/ui/lib/api.ts`

Add methods:
- `fetchEvidence(analyzerName: string, metric?: string): Promise<EvidenceChain[]>`
- `fetchCorrelations(): Promise<Correlation[]>`
- `fetchExplanation(insightId: string): Promise<{ explanation: string; evidenceEventIds: string[] }>`
- `fetchSubstrateEntity(entityId: string): Promise<EntityExploreResult>`

**Modify:** `src/ui/types/intelligence.ts`

Add `IntelligenceResponse<T>` wrapper type, `Correlation`, `EvidenceChain`, `DiagnosticMessage` types — all derived from the shared Zod schemas in `src/schemas/intelligence-presentation.ts`.

---

**IP-9.5: API Tests**

**Create:** `test/server/routes/intelligence-evidence.test.ts`

- Evidence endpoint returns chains for valid analyzer name
- Evidence endpoint returns 404 for unknown analyzer
- Correlation endpoint returns detected correlations
- Correlation endpoint returns empty array on cold start (no correlations.json)
- All existing intelligence endpoints include `_meta.freshness`
- Explain endpoint returns explanation when LLM configured
- Explain endpoint returns template fallback when no LLM

---

### IP-10: Intelligence Hub UI — Comprehension + Autonomy + Patterns + Cost Tabs

**Goal:** Transform 4 of the 8 Intelligence Hub tabs with evidence drill-through, FreshnessBadge, ShowMore, MetricDecomposition, and CorrelationHighlights.

**Day estimate:** ~5 hours. 4 tab component modifications.

**Depends on:** IP-8 (shared components), IP-9 (API endpoints).

---

**IP-10.1: ComprehensionTab Enhancement**

**Modify:** `src/ui/pages/intelligence/ComprehensionTab.tsx`

- Add `FreshnessBadge` using `_meta.freshness` from API response.
- Replace `.slice(0, 8)` on radar modules with `ShowMore` + full radar toggle.
- Module click → opens EvidenceDrawer showing sessions with comprehension contribution for that module.
- Blind spot click → EvidenceDrawer showing low-HDS sessions in that module.
- Add `CorrelationHighlights` at top if any correlations involve comprehension analyzer.

---

**IP-10.2: AutonomyTab Enhancement**

**Modify:** `src/ui/pages/intelligence/AutonomyTab.tsx`

- Add `FreshnessBadge`.
- Add `MetricDecomposition` for independence index (HDS weight, modification rate, context leverage, comprehension trend).
- Domain steering map row click → EvidenceDrawer showing sessions in that domain.
- Diagnostics from analyzer shown instead of hardcoded.

---

**IP-10.3: PatternsTab Enhancement**

**Modify:** `src/ui/pages/intelligence/PatternsTab.tsx`

- Add `FreshnessBadge`.
- Pattern click → EvidenceDrawer showing example sessions using that pattern (via `exampleSessionIds`).
- Anti-pattern click → EvidenceDrawer showing sessions exhibiting the anti-pattern.
- Add `CorrelationHighlights` for pattern-efficiency correlation.

---

**IP-10.4: CostTab Enhancement**

**Modify:** `src/ui/pages/intelligence/CostTab.tsx`

- Add `FreshnessBadge`.
- Model row click → EvidenceDrawer showing most expensive sessions for that model.
- Waste ratio click → EvidenceDrawer showing abandoned/looping sessions.
- Add per-session cost visibility with sortable table.
- Add `CorrelationHighlights` for cost-loop and expertise-cost correlations.

---

### IP-11: Intelligence Hub UI — Velocity + Narratives + Maturity + Efficiency Tabs

**Goal:** Transform the remaining 4 Intelligence Hub tabs.

**Day estimate:** ~5 hours. 4 tab component modifications.

**Depends on:** IP-8 (shared components), IP-9 (API endpoints).

---

**IP-11.1: VelocityTab Enhancement**

**Modify:** `src/ui/pages/intelligence/VelocityTab.tsx`

- Add `FreshnessBadge`.
- Domain row click → navigate to Decisions page filtered by domain + time period.
- Trend line with data points; click any point → events from that time period.
- Add `CorrelationHighlights` for velocity-comprehension correlation.

---

**IP-11.2: NarrativesTab Enhancement**

**Modify:** `src/ui/pages/intelligence/NarrativesTab.tsx`

- Add `FreshnessBadge`.
- Remove all `.slice(0, 5)` caps → `ShowMore` with all narratives.
- Each narrative card shows evidence event count; click → EvidenceDrawer.
- Correlation-based narratives highlighted with multi-analyzer badges.

---

**IP-11.3: MaturityTab Enhancement**

**Modify:** `src/ui/pages/intelligence/MaturityTab.tsx`

- Add `FreshnessBadge`.
- Add `MetricDecomposition` for overall maturity score showing all dimension contributions.
- Remove `.slice(0, 8)` on radar → full dimension rendering.
- Next phase requirements clickable → EvidenceDrawer showing current state evidence for each dimension.

---

**IP-11.4: EfficiencyTab Enhancement**

**Modify:** `src/ui/pages/intelligence/EfficiencyTab.tsx`

- Add `FreshnessBadge`.
- Add `MetricDecomposition` for AES showing all 5 sub-metric weights and contributions.
- Trend point click → events from that time period.
- Add `CorrelationHighlights` for efficiency-blind-spot correlation.

---

### IP-12: Intelligence Hub UI — Overview + Correlation Highlights

**Goal:** Transform the Intelligence Hub overview page (card layout) to use analyzer-provided diagnostics and show correlation highlights prominently.

**Day estimate:** ~3 hours. Overview page + correlation integration.

**Depends on:** IP-10 and IP-11 (all tabs enhanced).

---

**IP-12.1: IntelligencePage Overview Enhancement**

**Modify:** `src/ui/pages/IntelligencePage.tsx`

- Replace hardcoded card extract logic with analyzer-provided `diagnostics[]` — each card shows the analyzer's own diagnostic messages instead of the overview page computing them.
- Add `CorrelationHighlights` section above the card grid — shows all active correlations with severity badges, enabling users to spot cross-analyzer issues at a glance.
- Each card shows `FreshnessBadge` inline.
- Card click → navigates to tab with evidence drawer pre-armed if correlation exists.

---

**IP-12.2: Correlation Panel Component**

**Create:** `src/ui/components/shared/CorrelationPanel.tsx`

A panel component that fetches correlations and renders them as a prioritized list (critical → warning → info). Used on the overview page and optionally on individual tabs.

```tsx
interface CorrelationPanelProps {
  filterAnalyzer?: string;  // show only correlations involving this analyzer
  maxVisible?: number;      // default 5
}
```

---

### IP-13: Substrate Explorer UI

**Goal:** Add a substrate entity explorer to the dashboard — users can browse the knowledge graph, see entity neighborhoods, and drill through to evidence.

**Day estimate:** ~4 hours. New page/panel + substrate API integration.

**Depends on:** IP-7 (SubstrateQueries), IP-9 (substrate explore endpoint).

---

**IP-13.1: Entity Explorer Component**

**Create:** `src/ui/pages/intelligence/SubstrateExplorerTab.tsx`

A new tab (or sub-panel) in the Intelligence Hub showing:

- **Entity search:** Type-ahead search across all entities in the knowledge graph.
- **Entity detail:** Selected entity shows type, domain, engagement score, related facts, and `evidenceEventIds`.
- **Neighborhood view:** 1-hop connections from the selected entity — related entities, shared facts, co-occurrence in sessions.
- **Hub entities:** Top entities by centrality — the most connected concepts in the user's knowledge graph.
- **Cross-validated entities:** Entities confirmed by multiple sources (git + AI session) — highest confidence knowledge.

---

**IP-13.2: Substrate Explorer Tests**

**Create:** `test/ui/pages/SubstrateExplorerTab.test.tsx`

- Entity search renders results
- Entity detail shows facts and evidence
- Empty graph state renders message (not error)
- Hub entities render with engagement scores

---

### IP-14: E2E Verification + Performance Budget

**Goal:** End-to-end verification that the full pipeline (analyzer → evidence → correlation → API → UI) works correctly and within the 10s timing budget.

**Day estimate:** ~4 hours. Integration tests + performance assertions.

**Depends on:** All prior sprints (IP-1 through IP-13).

---

**IP-14.1: Pipeline Integration Test**

**Create:** `test/integration/intelligence-presentation.test.ts`

- Seed DuckDB with diverse test events (git commits, AI sessions across multiple domains).
- Run full scheduler cycle (all analyzers + correlation + evidence).
- Verify: all analyzer outputs include `_meta`, evidence files exist for each analyzer, correlations.json exists.
- Verify: at least one correlation detected with overlapping test data (low comprehension + declining efficiency in same domain).
- Verify: evidence chains link back to source events correctly (event IDs exist in DuckDB).

---

**IP-14.2: API Integration Test**

**Create:** `test/integration/intelligence-api.test.ts`

- Start test server with seeded intelligence data.
- Verify all intelligence endpoints return `_meta.freshness`.
- Verify evidence endpoints return per-metric chains.
- Verify correlation endpoint returns detected patterns.
- Verify substrate explore endpoint returns entity + neighborhood.

---

**IP-14.3: Performance Budget Assertions**

**Add to:** `test/integration/intelligence-presentation.test.ts`

- Full scheduler cycle (25 analyzers + correlation + evidence) completes within 10s on test workload.
- Evidence file writes add < 500ms to total cycle time.
- API response for card-level data (no evidence) returns within 200ms.
- Evidence endpoint (single analyzer) returns within 500ms.
- Correlation detection (6 patterns) completes within 100ms.

---

**IP-14.4: Cold Start Verification**

- Fresh install (no intelligence data, no correlations.json, no evidence files).
- Dashboard renders all tabs without errors.
- FreshnessBadge shows "No data" state.
- Correlation panel shows empty state.
- Evidence drawer shows "No evidence available" when opened.

---

### Implementation Tracker

| Sprint | Task | Status | Files |
|---|---|---|---|
| IP-1 | IP-1.1: Define shared schemas | ☐ Not started | `src/schemas/intelligence-presentation.ts` |
| IP-1 | IP-1.2: Build evidence linker | ☐ Not started | `src/services/intelligence/evidence-linker.ts` |
| IP-1 | IP-1.3: Evidence linker tests | ☐ Not started | `test/services/intelligence/evidence-linker.test.ts` |
| IP-2 | IP-2.1: Remove caps from engine | ☐ Not started | `src/services/intelligence/engine.ts` |
| IP-2 | IP-2.2: Remove caps from incremental state | ☐ Not started | `src/services/intelligence/incremental-state.ts` |
| IP-2 | IP-2.3: Engine hook tests | ☐ Not started | `test/services/intelligence/engine-hooks.test.ts` |
| IP-3 | IP-3.1: Enrich efficiency analyzer | ☐ Not started | `src/services/intelligence/analyzers/efficiency.ts` |
| IP-3 | IP-3.2: Enrich comprehension-radar analyzer | ☐ Not started | `src/services/intelligence/analyzers/comprehension-radar.ts` |
| IP-3 | IP-3.3: Enrich cost-attribution analyzer | ☐ Not started | `src/services/intelligence/analyzers/cost-attribution.ts` |
| IP-3 | IP-3.4: Enrich loop-detector analyzer | ☐ Not started | `src/services/intelligence/analyzers/loop-detector.ts` |
| IP-3 | IP-3.5: Group A enrichment tests | ☐ Not started | `test/services/intelligence/analyzers/*.test.ts` |
| IP-4 | IP-4.1: Enrich velocity-tracker analyzer | ☐ Not started | `src/services/intelligence/analyzers/velocity-tracker.ts` |
| IP-4 | IP-4.2: Enrich prompt-patterns analyzer | ☐ Not started | `src/services/intelligence/analyzers/prompt-patterns.ts` |
| IP-4 | IP-4.3: Enrich blind-spots analyzer | ☐ Not started | `src/services/intelligence/analyzers/blind-spots.ts` |
| IP-4 | IP-4.4: Enrich decision-replay analyzer | ☐ Not started | `src/services/intelligence/analyzers/decision-replay.ts` |
| IP-4 | IP-4.5: Group B enrichment tests | ☐ Not started | `test/services/intelligence/analyzers/*.test.ts` |
| IP-5 | IP-5.1: Build correlation engine | ☐ Not started | `src/services/intelligence/correlation-engine.ts` |
| IP-5 | IP-5.2: Implement 6 correlation patterns | ☐ Not started | `src/services/intelligence/correlation-patterns.ts` |
| IP-5 | IP-5.3: Correlation persistence | ☐ Not started | `src/services/intelligence/correlation-engine.ts` |
| IP-5 | IP-5.4: Correlation engine tests | ☐ Not started | `test/services/intelligence/correlation-engine.test.ts` |
| IP-6 | IP-6.1: Add LLM path to narrative engine | ☐ Not started | `src/services/intelligence/narrative-engine.ts` |
| IP-6 | IP-6.2: Narrative tests | ☐ Not started | `test/services/intelligence/narrative-engine.test.ts` |
| IP-7 | IP-7.1: Add SubstrateQueries interface | ☐ Not started | `src/services/substrate/substrate-engine.ts` |
| IP-7 | IP-7.2: Add evidence to EntityContribution | ☐ Not started | `src/services/substrate/substrate-engine.ts` |
| IP-7 | IP-7.3: Substrate query tests | ☐ Not started | `test/services/substrate/substrate-queries.test.ts` |
| IP-8 | IP-8.1: ShowMore component | ☐ Not started | `src/ui/components/shared/ShowMore.tsx` |
| IP-8 | IP-8.2: MetricDecomposition component | ☐ Not started | `src/ui/components/shared/MetricDecomposition.tsx` |
| IP-8 | IP-8.3: CorrelationCard component | ☐ Not started | `src/ui/components/shared/CorrelationCard.tsx` |
| IP-8 | IP-8.4: EvidenceEventCard + utilities | ☐ Not started | `src/ui/components/shared/EvidenceEventCard.tsx`, `src/ui/lib/event-labels.ts`, `src/ui/lib/date-utils.ts`, `src/ui/hooks/useProjectNames.ts` |
| IP-8 | IP-8.5: Shared component tests | ☐ Not started | `test/ui/components/*.test.tsx` |
| IP-9 | IP-9.1: Evidence + correlation routes | ☐ Not started | `src/server/routes/intelligence.ts` |
| IP-9 | IP-9.2: Enrich existing intelligence responses | ☐ Not started | `src/server/routes/intelligence.ts` |
| IP-9 | IP-9.3: Substrate explore endpoint | ☐ Not started | `src/server/routes/substrate.ts` |
| IP-9 | IP-9.4: API client + types | ☐ Not started | `src/ui/lib/api.ts`, `src/ui/types/intelligence.ts` |
| IP-9 | IP-9.5: API tests | ☐ Not started | `test/server/routes/intelligence-evidence.test.ts` |
| IP-10 | IP-10.1: ComprehensionTab enhancement | ☐ Not started | `src/ui/pages/intelligence/ComprehensionTab.tsx` |
| IP-10 | IP-10.2: AutonomyTab enhancement | ☐ Not started | `src/ui/pages/intelligence/AutonomyTab.tsx` |
| IP-10 | IP-10.3: PatternsTab enhancement | ☐ Not started | `src/ui/pages/intelligence/PatternsTab.tsx` |
| IP-10 | IP-10.4: CostTab enhancement | ☐ Not started | `src/ui/pages/intelligence/CostTab.tsx` |
| IP-11 | IP-11.1: VelocityTab enhancement | ☐ Not started | `src/ui/pages/intelligence/VelocityTab.tsx` |
| IP-11 | IP-11.2: NarrativesTab enhancement | ☐ Not started | `src/ui/pages/intelligence/NarrativesTab.tsx` |
| IP-11 | IP-11.3: MaturityTab enhancement | ☐ Not started | `src/ui/pages/intelligence/MaturityTab.tsx` |
| IP-11 | IP-11.4: EfficiencyTab enhancement | ☐ Not started | `src/ui/pages/intelligence/EfficiencyTab.tsx` |
| IP-12 | IP-12.1: IntelligencePage overview enhancement | ☐ Not started | `src/ui/pages/IntelligencePage.tsx` |
| IP-12 | IP-12.2: CorrelationPanel component | ☐ Not started | `src/ui/components/shared/CorrelationPanel.tsx` |
| IP-13 | IP-13.1: Entity explorer component | ☐ Not started | `src/ui/pages/intelligence/SubstrateExplorerTab.tsx` |
| IP-13 | IP-13.2: Substrate explorer tests | ☐ Not started | `test/ui/pages/SubstrateExplorerTab.test.tsx` |
| IP-14 | IP-14.1: Pipeline integration test | ☐ Not started | `test/integration/intelligence-presentation.test.ts` |
| IP-14 | IP-14.2: API integration test | ☐ Not started | `test/integration/intelligence-api.test.ts` |
| IP-14 | IP-14.3: Performance budget assertions | ☐ Not started | `test/integration/intelligence-presentation.test.ts` |
| IP-14 | IP-14.4: Cold start verification | ☐ Not started | `test/integration/intelligence-presentation.test.ts` |
