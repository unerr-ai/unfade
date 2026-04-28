# Layer 7: Intelligence Substrate — End-to-End Transformation

> How Unfade's 24-analyzer intelligence pipeline, DAG scheduler, CozoDB substrate, and 8-tab Intelligence Hub are transformed from metric dashboards into an evidence-linked, causally-connected, actionable intelligence system using the DRRVE framework.

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

The Intelligence Substrate is Unfade's analytical brain — 24 DAG-ordered analyzers producing 7+ core output files, orchestrated by the `IntelligenceScheduler`, fed into a CozoDB knowledge graph (`SubstrateEngine`), and rendered across an 8-tab Intelligence Hub in the dashboard. Today, it produces isolated metrics that tell users *what their numbers are* but not *why those numbers matter* or *what to do about them*.

**The transformation:** Apply Decision Intelligence principles (Layer 5) to the entire intelligence substrate — every analyzer, every API endpoint, every UI tab gets evidence linking, causal reasoning, cross-analyzer correlation, and actionable drill-through. The substrate graph becomes the connective tissue that links insights across analyzers, and every claim shown to the user is backed by traceable evidence.

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

## Implementation Plan

### Phase 1: Evidence Tracking Foundation

Add per-metric evidence tracking to all analyzers and remove artificial caps.

| File | Change | Description |
|------|--------|-------------|
| `src/services/intelligence/engine.ts` | Modify | Remove `.slice(0, 20)` on sourceEventIds (line 264). Add Phase 5 and Phase 6 hooks after topological loop. |
| `src/services/intelligence/incremental-state.ts` | Modify | Replace `domain: "general"` with `classifyDomain()`. Replace `LIMIT 500` with paginated batch building. |
| `src/services/intelligence/evidence-linker.ts` | **Create** | Evidence chain builder: per-metric evidence grouping, cross-analyzer evidence merging. |

### Phase 2: Analyzer Output Enrichment

Enhance each analyzer to include diagnostics, freshness, and per-metric evidence.

| File | Change | Description |
|------|--------|-------------|
| `src/services/intelligence/analyzers/efficiency.ts` | Modify | Add `_meta` freshness block. Add `diagnostics[]` with context-aware messages. Add `evidenceEventIds` per sub-metric. |
| `src/services/intelligence/analyzers/comprehension-radar.ts` | Modify | Add per-module `evidenceEventIds` and `topContributors`. Add `_meta` block. Enhance blind spot messages with specific evidence. |
| `src/services/intelligence/analyzers/cost-attribution.ts` | Modify | Add per-model and per-domain `evidenceEventIds`. Remove LIMIT 10 on cost dimensions. Add `_meta` block. |
| `src/services/intelligence/analyzers/loop-detector.ts` | Modify | Remove `.slice(0, 3)` on similar rejections. Add `evidenceEventIds` per stuck loop. Add `_meta` block. |
| `src/services/intelligence/analyzers/velocity-tracker.ts` | Modify | Add per-domain `evidenceEventIds`. Add `_meta` block. |
| `src/services/intelligence/analyzers/prompt-patterns.ts` | Modify | Add `exampleSessionIds` per effective pattern. Remove LIMIT 500 on prompt query. Add `_meta` block. |
| `src/services/intelligence/analyzers/blind-spots.ts` | Modify | Add `evidenceEventIds` per alert. Enhance messages with specific session references. Add `_meta` block. |
| `src/services/intelligence/analyzers/decision-replay.ts` | Modify | Remove `.slice(-10)` on replays. Add `evidenceEventIds` per replay. Add `_meta` block. |

### Phase 3: Cross-Analyzer Correlation

Build the correlation engine and narrative upgrade.

| File | Change | Description |
|------|--------|-------------|
| `src/services/intelligence/correlation-engine.ts` | **Create** | 6 initial correlation patterns. Reads all analyzer outputs post-run. Writes `correlations.json`. |
| `src/services/intelligence/narrative-engine.ts` | Modify | Add LLM path for daily narrative generation. Enhance fallback with cross-analyzer references and evidence linking. |

### Phase 4: Substrate Graph Enhancement

Upgrade the substrate with query capabilities and evidence.

| File | Change | Description |
|------|--------|-------------|
| `src/services/substrate/substrate-engine.ts` | Modify | Add `SubstrateQueries` interface: `entitiesByDomain()`, `findPath()`, `hubEntities()`, `crossValidatedEntities()`. Add `evidenceEventIds` to `EntityContribution`. |

### Phase 5: API Layer Overhaul

Enhance all intelligence endpoints with evidence and correlations.

| File | Change | Description |
|------|--------|-------------|
| `src/server/routes/intelligence.ts` | Modify | Add `_meta.freshness` to all responses. Add `_meta.correlations` when relevant. Add evidence sub-endpoints per analyzer. Add `GET /api/intelligence/correlations`. Add `GET /api/intelligence/explain/:insightId`. |
| `src/server/routes/substrate.ts` | Modify | Add `GET /api/substrate/explore/:entityId` with neighborhood + evidence. |
| `src/ui/lib/api.ts` | Modify | Add evidence, correlation, and explanation API methods. Update intelligence response types. |
| `src/ui/types/intelligence.ts` | Modify | Add `IntelligenceResponse<T>` wrapper with freshness. Add `Correlation`, `EvidenceChain`, `DiagnosticMessage` types. |

### Phase 6: Intelligence Hub UI Transformation

Transform all 8 tabs with evidence, correlations, freshness, and drill-through.

| File | Change | Description |
|------|--------|-------------|
| `src/ui/pages/IntelligencePage.tsx` | Modify | Replace hardcoded card extracts with analyzer-provided diagnostics. Add `CorrelationHighlights` above cards. |
| `src/ui/pages/intelligence/ComprehensionTab.tsx` | Modify | Add module click → evidence drawer. Remove `.slice(0, 8)` on radar. Add `FreshnessBadge`. |
| `src/ui/pages/intelligence/AutonomyTab.tsx` | Modify | Add `MetricDecomposition` for independence index. Add domain row click → evidence drawer. Add `FreshnessBadge`. |
| `src/ui/pages/intelligence/PatternsTab.tsx` | Modify | Add pattern click → evidence drawer with example sessions. Add `FreshnessBadge`. |
| `src/ui/pages/intelligence/CostTab.tsx` | Modify | Add model row click → evidence drawer. Add waste ratio click → drawer. Add `FreshnessBadge`. |
| `src/ui/pages/intelligence/VelocityTab.tsx` | Modify | Add domain row click → Decisions page (filtered). Add `FreshnessBadge`. |
| `src/ui/pages/intelligence/NarrativesTab.tsx` | Modify | Remove `.slice(0, 5)` caps. Add evidence per narrative. Add `FreshnessBadge`. |
| `src/ui/pages/intelligence/MaturityTab.tsx` | Modify | Add `MetricDecomposition` for overall score. Remove `.slice(0, 8)` on radar. Add `FreshnessBadge`. |
| `src/ui/pages/intelligence/EfficiencyTab.tsx` | Modify | Add sub-metric decomposition. Add trend point click → evidence. Add `FreshnessBadge`. |
| `src/ui/components/shared/ShowMore.tsx` | **Create** | Generic expandable list: shows N items with "Show X more" button. |
| `src/ui/components/shared/MetricDecomposition.tsx` | **Create** | Visual formula breakdown: component bars with weights and contributions. |
| `src/ui/components/shared/CorrelationCard.tsx` | **Create** | Cross-analyzer insight card with multi-analyzer badges and evidence link. |

### Phase 7: Shared Component Extraction (from FEATURE_IMPROVEMENT_TRACKER)

| File | Change | Description |
|------|--------|-------------|
| `src/ui/lib/event-labels.ts` | **Create** | Extract `sourceLabel()`, `typeLabel()`, `sourceBadgeClass()` from DecisionsPage. |
| `src/ui/components/shared/EvidenceEventCard.tsx` | **Create** | Extract `EvidenceEventCard` from DecisionsPage for reuse across all tabs. |
| `src/ui/lib/date-utils.ts` | **Create** | Extract `relativeDate()` from DecisionsPage. |
| `src/ui/hooks/useProjectNames.ts` | **Create** | Shared hook for projectId → name resolution from repos data. |

---

## Verification

1. **`pnpm typecheck`** — no type errors after schema changes
2. **`pnpm lint:fix`** — passes biome
3. **`pnpm build`** — builds cleanly
4. **Evidence tracking test:** Trigger intelligence processing on a repo with diverse events. Verify:
   - All analyzer outputs include `_meta` with freshness and confidence
   - Comprehension output includes per-module `evidenceEventIds`
   - Cost output includes per-model evidence
   - Evidence files exist in `~/.unfade/intelligence/evidence/`
5. **Correlation detection test:** Verify:
   - `correlations.json` is written after scheduler run
   - At least one correlation detected when test data has overlapping issues (e.g., low comprehension + declining efficiency in same domain)
   - Each correlation includes `evidenceEventIds` from multiple analyzers
6. **API test:** Verify:
   - All intelligence endpoints include `_meta.freshness`
   - Evidence sub-endpoints return per-metric evidence chains
   - Correlation endpoint returns detected patterns
   - Explanation endpoint (if LLM configured) returns natural-language explanation
7. **UI test:** Verify:
   - All tabs show `FreshnessBadge`
   - No `.slice()` caps visible — all data accessible via `ShowMore`
   - Clicking metrics opens evidence drawer with source events
   - Correlation highlights appear above cards when correlations exist
   - `MetricDecomposition` renders for composite scores (AES, independence index, maturity)
8. **Substrate test:** Verify:
   - `GET /api/substrate/explore/:entityId` returns entity + neighborhood + evidence
   - Entity contributions include `evidenceEventIds`
9. **Performance test:** Verify:
   - Scheduler still completes within 10s budget on typical workload
   - Evidence tracking doesn't double memory usage (evidence files are separate)
   - API response times remain under 200ms for card-level data (evidence loaded on demand)
10. **Backward compat test:** Verify:
    - MCP intelligence tools (`unfade_efficiency`, `unfade_comprehension`, etc.) still return valid data
    - Dashboard renders correctly even when `correlations.json` doesn't exist yet (cold start)
    - Existing analyzer state files are compatible (no migration needed — new fields are additive)
