# Phase 12 — Intelligence Wiring & Proactive Actions

> **Feature Statement:** _"Every intelligence analyzer runs, every dashboard populates, and the system proactively writes back observed patterns into the developer's workflow — auto-generating rules files, pushing session context, and surfacing quantified improvement without asking."_
>
> **Prerequisites:** [Phase 11 — State Determinism & Intelligent Capture](./PHASE_11_STATE_DETERMINISM_AND_INTELLIGENT_CAPTURE.md) complete. All capture enrichment (11D) shipping. IntelligenceEngine class implemented but not wired.
>
> **Status:** ✅ COMPLETE — Sprint 12A ✅, Sprint 12B ���, Sprint 12C ✅
>
> **Origin:** RRVV System Integration Audit (Phase 11, §9) — cross-referenced against real user feedback from Reddit, competitive analysis, and theme scoring.
>
> **Foundation doc:** [Research & Design](./UNFADE_CLI_RESEARCH_AND_DESIGN.md)
>
> **Last updated:** 2026-04-21

---

## Table of Contents

- [1. Business Justification](#1-business-justification)
- [2. The Problem](#2-the-problem)
- [3. Research](#3-research)
- [4. Architecture](#4-architecture)
- [5. Design Principles](#5-design-principles)
- [6. Implementation Plan (Micro-Sprints 12A–12C)](#6-implementation-plan-micro-sprints-12a12c)
- [7. Success Metrics](#7-success-metrics)
- [8. Risk Assessment](#8-risk-assessment)

---

## 1. Business Justification

### 1.1 Why This Phase Exists

Phase 12 is the **activation phase**. Everything built in Phases 0–11 created the data collection and analysis infrastructure, but two critical gaps prevent value delivery:

1. **Dead intelligence:** 8 Phase 7 analyzers are fully implemented but never invoked. The `IntelligenceEngine` class exists at `src/services/intelligence/engine.ts` — complete, tested, zero callers. 8 API routes return 204 permanently. 8 dashboard pages show empty state. Wiring this engine (~30 LOC change) unlocks 6 of 12 top user pain points instantly.

2. **No proactive delivery:** The system has PULL (MCP tools respond to queries) but zero PUSH capability. It cannot write `.cursorrules`, cannot auto-inject session context, cannot generate weekly digests. Users must manually query for every insight. The 5 highest-signal user desires (theme scores 15-19/20) all require proactive file writes that the architecture currently cannot perform.

3. **No value quantification:** Users say "I think it saves time" but have no evidence. No competing tool answers "how much time/money am I saving?" — this is an unclaimed competitive position. The data to compute this already exists (MCP invocation events) but no code aggregates it.

### 1.2 The Principle

> **Wire before building. Every analyzer is already written — the only task is connecting the call site. Proactive actions are opt-in-only file writes with atomic semantics. Value quantification is counting events that already exist. Phase 12 delivers maximum user impact with minimum new code because it activates existing infrastructure rather than replacing it.**

---

## 2. The Problem

### Current State (after Phase 11)

Unfade captures events, enriches them with comprehension/direction/features, produces daily distills, and serves MCP tools. The Intelligence Engine and 8 analyzers exist as fully-implemented dead code. No proactive actions. No value quantification.

### After Phase 12

| Concern | State |
|---|---|
| **Intelligence Engine** | Wired into materializer tick. Runs 8 analyzers on 10s throttle. Produces `.unfade/intelligence/*.json` |
| **Dashboard pages** | All 8 populate with real data (efficiency, cost, patterns, loops, comprehension, velocity, alerts, decisions) |
| **MCP intelligence tools** | Return rich data from `intelligence/*.json` |
| **Coach "Apply to project"** | One-click writes pattern as rule to `.cursorrules`/`CLAUDE.md` |
| **Proactive actions** | ActionRunner triggers file writes, card generation, and nudges on events |
| **Session continuity** | `CLAUDE.md` auto-updated with last session context on session end |
| **Weekly digest** | Auto-generated on configured day. Shareable card with week-over-week comparison |
| **Value quantification** | `unfade savings` command. Value receipt in daily distill markdown |

---

## 3. Research

### 3.1 Auto-Rule File Formats

| Tool | File | Format | Verdict |
|---|---|---|---|
| **Cursor** | `.cursor/rules/unfade.mdc` | MDC frontmatter + markdown body | **Primary target** — highest adoption, structured format |
| **Claude Code** | `CLAUDE.md` | Plain markdown with `##` sections | **Secondary target** — append section with markers |
| **GitHub Copilot** | `.github/copilot-instructions.md` | Plain markdown | **Tertiary target** — simple append |
| **Windsurf** | `.windsurfrules` | Plain text rules | **Future** — low adoption currently |

### 3.2 Session Context Injection Patterns

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| **File-based (CLAUDE.md section)** | Works with every AI tool that reads project docs, persistent, inspectable | Requires file write permission, potential conflicts | **Best fit** — universal, greppable, atomic |
| **MCP resource injection** | No file writes, clean separation | Only works in MCP-connected tools, not persistent | Already exists (`unfade://context`) — complements file-based |
| **Startup hook (auto-inject to prompt)** | Immediate, no file modification | Tool-specific, fragile, invisible to user | Too magical — violates inspectability principle |

### 3.3 Value Quantification Approaches

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| **Token proxy** (count MCP calls × baseline tokens) | Simple, defensible, conservative | Underestimates (doesn't count time value) | **Primary metric** — clear, verifiable |
| **Time proxy** (calls × median re-explanation time) | More meaningful to users | Harder to validate | **Secondary metric** — display alongside token count |
| **Cost proxy** (tokens × $/1K pricing) | Tangible dollar value | Depends on model pricing assumptions | **Tertiary metric** — show as range |

### 3.4 Proactive Write Safety Patterns

| Pattern | Description | Verdict |
|---|---|---|
| **Marker-delimited sections** | `<!-- BEGIN UNFADE -->` / `<!-- END UNFADE -->` | **Required** — enables idempotent replace |
| **Content-hash deduplication** | SHA-256 of rule content prevents re-appending | **Required** — prevents accumulation |
| **Atomic write (tmp+rename)** | Write to `.tmp`, then `rename()` | **Required** — prevents partial writes |
| **Rate limiting** | Max 1 rule write/day, 1 context update/session | **Required** — prevents noise |
| **Action log** | Every write logged to `actions.jsonl` | **Required** — auditability |

### 3.5 Intelligence Engine Orchestration

| Pattern | Description | Verdict |
|---|---|---|
| **Inline in tick** (current engine design) | Engine.run() called from onTick, internal throttle | **Best fit** — already implemented, 10s debounce prevents thrashing |
| **Separate worker thread** | Offload analysis to worker_threads | Over-engineering — analyzers are fast SQL queries + JSON writes |
| **Cron-based** | Run analyzers on fixed schedule | Too coarse — 10s interval with dynamic throttle is ideal |

---

## 4. Architecture

### 4.1 Intelligence Wiring

```
┌────────────────────────────────────────────────────────────┐
│           repo-manager.ts :: onTick (existing)              │
│                                                            │
│  computeComprehensionBatch()                               │
│  aggregateComprehensionByModule()                          │
│  computeDirectionByFile()                                  │
│  assignEventsToFeatures() + linkRelatedEvents()            │
│  writeSummary() + writePartialSnapshot()                   │
│  appendRecentInsight()                                     │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ NEW: await engine.run({ db, repoRoot, config })      │ │
│  │                                                      │ │
│  │  ┌─── IntelligenceEngine (10s throttle) ──────────┐ │ │
│  │  │  efficiencyAnalyzer     → efficiency.json      │ │ │
│  │  │  costAttributionAnalyzer → cost-attribution.json│ │ │
│  │  │  promptPatternsAnalyzer → prompt-patterns.json  │ │ │
│  │  │  loopDetectorAnalyzer   → loop-detector.json   │ │ │
│  │  │  comprehensionRadar     → comprehension.json   │ │ │
│  │  │  velocityTracker        → velocity.json        │ │ │
│  │  │  blindSpotDetector      → alerts.json          │ │ │
│  │  │  decisionReplay         → decisions.json       │ │ │
│  │  └────────────────────────────────────────────────┘ │ │
│  └──────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

### 4.2 Proactive Action Layer

```
┌────────────────────────────────────────────────────────────┐
│                    ActionRunner                              │
│                                                            │
│  Triggers:                          Actions:               │
│  ├── onSessionEnd(event)        →   updateClaudeMd()       │
│  ├── onIntelligenceUpdate()     →   writeRuleFile()        │
│  ├── onSchedule("weekly")       →   generateWeeklyCard()   │
│  └── onThresholdBreach(alert)   →   appendNudgeToStatus()  │
│                                                            │
│  Safety:                                                   │
│  ├── opt-in per project (config.actions.enabled: true)     │
│  ├── never writes without prior user consent               │
│  ├── uses atomic write (tmp+rename) for all file output    │
│  └── logs all actions to .unfade/logs/actions.jsonl        │
│                                                            │
│  File targets (configurable):                              │
│  ├── .cursor/rules/unfade.mdc   (Cursor rules)            │
│  ├── CLAUDE.md                  (Claude Code rules)        │
│  ├── .github/copilot-instructions.md (Copilot)            │
│  └── .unfade/cards/weekly-*.png (digest cards)             │
└────────────────────────────────────────────────────────────┘
```

### 4.3 Data Flow for Auto-Rule Generation

```
Events → Materializer → IntelligenceEngine → promptPatternsAnalyzer
                                                     │
                                          prompt-patterns.json
                                          (effective patterns,
                                           anti-patterns,
                                           rejection index)
                                                     │
                                                     ▼
                                  ┌──── ActionRunner::onIntelligenceUpdate ────┐
                                  │                                            │
                                  │  IF new high-confidence pattern detected   │
                                  │  AND config.actions.autoRules == true       │
                                  │  THEN formatAsRule() → append to target    │
                                  │                                            │
                                  │  Target precedence:                        │
                                  │  1. config.actions.ruleTarget (explicit)   │
                                  │  2. .cursor/rules/unfade.mdc (if .cursor/) │
                                  │  3. CLAUDE.md (if .claude/ or CLAUDE.md)   │
                                  │  4. .github/copilot-instructions.md        │
                                  └────────────────────────────────────────────┘
```

### 4.4 Value Quantification

```
src/services/intelligence/
├── value-receipt.ts               # NEW — compute savings from MCP invocations
├── debugging-arcs.ts              # NEW — reconstruct debugging narratives
└── decision-durability.ts         # NEW — track decision revision rates

src/commands/
├── history.ts                     # NEW — query events by domain/feature/time
└── savings.ts                     # NEW — display estimated savings

src/services/distill/
└── distiller.ts                   # MODIFIED — append value receipt + debugging arcs sections
```

---

## 5. Design Principles

### 5a. Wire Before Building

Phase 12's highest-impact work is wiring existing code — not writing new analyzers. The IntelligenceEngine, 8 analyzers, API routes, and dashboard pages all exist. The gap is a single `engine.run()` call in the materializer tick. This principle extends to all Sprint 12A work: verify what exists, connect it, test it. Only Sprint 12B/12C create genuinely new subsystems.

### 5b. Opt-In Proactive, Default Passive

The system NEVER writes to project files without explicit user consent. All proactive actions require `config.actions.enabled: true` AND per-action flags (`autoRules`, `sessionContext`, `weeklyDigest`). Users enable during `unfade init` or manual config edit. This is non-negotiable — trust is the product's foundation.

### 5c. Marker-Delimited, Idempotent Writes

Every proactive file write uses marker comments (`<!-- Generated by Unfade (date) -->`). Updates REPLACE content between markers rather than appending. This prevents: (1) file growth, (2) duplicate rules, (3) stale context accumulation. User content outside markers is NEVER modified.

### 5d. Estimates, Not Claims

Value quantification uses conservative baselines and is always prefixed with `~` or "estimated." Never state exact savings. The numbers must be defensible: if a user manually counts their MCP calls, the estimate should be within 50% of reality. Credibility > impressive numbers.

### 5e. Non-Fatal Intelligence

The Intelligence Engine is a bonus layer, not a critical path. If engine.run() fails, the materializer tick continues normally. If an analyzer throws, other analyzers still run. If value receipt computation fails, the distill still generates without the "Estimated Impact" section. Users should never know the intelligence layer had an issue unless they check logs.

---

## 6. Implementation Plan (Micro-Sprints 12A–12C)

### Phase 12 Boundary

> **What the AI agent MUST know before touching Phase 12 code:**

**READS** (from previous phases):

| Data | Source | Schema | Owner |
|---|---|---|---|
| Capture events | `.unfade/events/*.jsonl` | `CaptureEventSchema` (`src/schemas/event.ts`) | Go daemon (write), TypeScript (read) |
| Materialized events | SQLite `events` table via CacheManager | `events` schema (`src/services/cache/schema.ts`) | TypeScript materializer |
| Summary snapshot | `.unfade/state/summary.json` | Internal (writeSummary output) | TypeScript materializer |
| Distill output | `.unfade/distills/*.md` | `DailyDistillSchema` (`src/schemas/distill.ts`) | TypeScript distiller |
| Reasoning profile | `.unfade/profile/reasoning_model.json` | `ReasoningModelV2Schema` (`src/schemas/profile.ts`) | TypeScript |
| Config | `.unfade/config.json` | `UnfadeConfigSchema` (`src/schemas/config.ts`) | TypeScript |
| Intelligence Engine | `src/services/intelligence/engine.ts` | `Analyzer` interface (`src/services/intelligence/analyzers/index.ts`) | TypeScript (unused) |
| 8 Analyzers | `src/services/intelligence/analyzers/*.ts` | `AnalyzerResult` return type | TypeScript (unused) |

**WRITES** (new in Phase 12):

| Data | Destination | Schema | Owner |
|---|---|---|---|
| Intelligence output | `.unfade/intelligence/*.json` (8 files) | Per-analyzer schemas | IntelligenceEngine |
| Auto-generated rules | `.cursor/rules/unfade.mdc`, `CLAUDE.md`, `.github/copilot-instructions.md` | Tool-specific format | ActionRunner |
| Session context | `CLAUDE.md` (`## Recent Context` section) | Markdown with markers | ActionRunner |
| Weekly digest card | `.unfade/cards/weekly-{ISO-week}.png` | PNG image | ActionRunner |
| Action log | `.unfade/logs/actions.jsonl` | `{ action, target, timestamp, contentHash }` | ActionRunner |
| Value receipt | Appended to daily distill markdown | Markdown section | Distiller |
| Debugging arcs | `.unfade/intelligence/debugging-arcs.json` | `{ arcs: DebuggingArc[] }` | DebuggingArcDetector |
| Decision durability | `.unfade/intelligence/decision-durability.json` | `{ decisions: DurabilityRecord[] }` | DurabilityTracker |

---

**IntelligenceEngine Wiring Contract:**

```typescript
// In createMaterializerForRepo (repo-manager.ts), at function scope:
const engine = new IntelligenceEngine({ minIntervalMs: 10_000 });
for (const analyzer of allAnalyzers) engine.register(analyzer);

// At end of onTick (after appendRecentInsight):
try {
  await engine.run({ db, repoRoot, config: config as unknown as Record<string, unknown> });
} catch { /* non-fatal */ }
```

**ActionRunner Config Extension:**

```jsonc
// Added to ConfigSchema (src/schemas/config.ts)
{
  "actions": {
    "enabled": false,              // master gate — nothing fires unless true
    "autoRules": false,            // write patterns to rule files
    "ruleTarget": null,            // explicit target path (overrides detection)
    "sessionContext": false,       // update CLAUDE.md on session end
    "weeklyDigest": false,         // generate weekly comparison card
    "digestDay": "monday"          // ISO day name for weekly digest
  }
}
```

**Marker Format Contract:**

```markdown
<!-- BEGIN UNFADE RULES (2026-04-21) -->
## Patterns observed by Unfade

- When working on auth modules, prefer explicit error types over generic throws (accepted 4/4 times)
- Database queries: always use parameterized queries (3 corrections detected)

<!-- END UNFADE RULES -->
```

**Session Context Format Contract:**

```markdown
<!-- BEGIN UNFADE CONTEXT (2026-04-21T14:30:00Z) -->
## Recent Context (auto-updated by Unfade)

**Last session intent:** Implementing OAuth2 PKCE flow for mobile clients
**Key decisions:** Chose PKCE over implicit grant (security), stored tokens in secure enclave (not keychain)
**Unresolved:** Token refresh race condition under poor connectivity — needs retry queue

<!-- END UNFADE CONTEXT -->
```

**Value Receipt Format Contract:**

```markdown
## Estimated Impact

~12 context injections today saved ~24K tokens (~$0.72).
This week: ~47 injections, ~94K tokens (~$2.82), ~2.4 hours of re-explanation avoided.
```

---

### Sprint 12A — Wire & Light Up (11 tasks) ✅ COMPLETE

**Objective:** Wire the IntelligenceEngine into the materializer tick. All 8 Phase 7 analyzers produce output. All dashboard pages populate. All MCP intelligence tools return data.

**Acid test:**

```bash
# Start server, wait for materializer to run on existing events:
unfade & sleep 15

# Verify intelligence files generated:
ls .unfade/intelligence/*.json | wc -l | grep -q '^[1-8]$' && echo "PASS: Intelligence files generated"

# Verify API returns data (not 204):
curl -s localhost:7654/api/intelligence/efficiency | jq '.aes' && echo "PASS: Efficiency endpoint returns data"

# Verify Coach has patterns:
curl -s localhost:7654/api/intelligence/coach | jq '.patterns | length > 0' && echo "PASS: Coach has patterns"
```

| ID | Task | Files | Done |
|---|---|---|---|
| **12A.1** | Create `allAnalyzers` barrel export — single import that provides all 8 analyzer instances | `src/services/intelligence/analyzers/all.ts` | [x] |
| **12A.2** | Wire IntelligenceEngine into `createMaterializerForRepo` — instantiate engine at function scope, register all analyzers, call `engine.run()` at end of onTick after feature boundary detection | `src/services/daemon/repo-manager.ts` | [x] |
| **12A.3** | Adapt AnalyzerContext.db interface — aligned `exec` signature with `DbLike` (added optional params) | `src/services/intelligence/analyzers/index.ts` | [x] |
| **12A.4** | Verify AnalyzerContext.config passthrough — config cast to `Record<string, unknown>` and passed through | `src/services/daemon/repo-manager.ts` | [x] |
| **12A.5** | Add outcome classification to onTick — `classifyAllUnclassified(db)` called before engine.run | `src/services/daemon/repo-manager.ts` | [x] |
| **12A.6** | Validate index existence — `idx_events_ts` confirmed in `src/services/cache/schema.ts:21` | `src/services/cache/schema.ts` | [x] |
| **12A.7** | Integration test: intelligence files generated — engine writes JSON, throttle respected, min-data skip, error isolation | `test/integration/intelligence-engine.test.ts` | [x] |
| **12A.8** | Integration test: API routes return 202 warming_up when no data | `test/integration/intelligence-engine.test.ts` | [x] |
| **12A.9** | Cold-start UX — routes return `{ status: "warming_up" }` with HTTP 202 instead of 204 | `src/server/routes/intelligence.ts` | [x] |
| **12A.10** | Lineage population — already wired in engine.ts L52-54, runs automatically when engine is called | `src/services/intelligence/engine.ts` | [x] |
| **12A.11** | SSE intelligence push — stream.ts polls `.unfade/intelligence/` dir, pushes `event: intelligence` on changes | `src/server/routes/stream.ts` | [x] |

> **Agent Directive for Sprint 12A:** "You are wiring the IntelligenceEngine into the running system. The engine exists at `src/services/intelligence/engine.ts` (75 lines, complete). The 8 analyzers are exported individually from `src/services/intelligence/analyzers/*.ts`. The materializer tick is in `src/services/daemon/repo-manager.ts:201-294`, function `createMaterializerForRepo`, inside `onTick`.
>
> Step 1: Create `src/services/intelligence/analyzers/all.ts` that imports and re-exports all 8 analyzer instances as `allAnalyzers` array.
> Step 2: In `repo-manager.ts`, import `IntelligenceEngine` and `allAnalyzers`. Instantiate `const engine = new IntelligenceEngine({ minIntervalMs: 10_000 })` at function scope (not inside onTick). Register all analyzers in a loop. At the end of onTick (after the appendRecentInsight try/catch block, line ~291), add: `try { await engine.run({ db, repoRoot, config: config as unknown as Record<string, unknown> }); } catch { /* non-fatal */ }`.
> Step 3: Before engine.run, call outcome classification on newly materialized event IDs so downstream analyzers have outcome data.
> Step 4: Verify `idx_events_ts` index exists in schema.ts. If not, add it.
> Step 5: Update intelligence routes to distinguish 'no data yet (warming up)' from 'engine broken' — return 202 with warming status when file doesn't exist but system is healthy.
> Step 6: Write integration tests that seed 20+ events, trigger materializer, and assert intelligence files appear + API returns data.
> Step 7: In the engine's output path (after each analyzer writes JSON), call `writeInsightMappings(db, insightId, sourceEventIds)` from `src/services/intelligence/lineage.ts`. This populates the `event_insight_map` table so every insight is traceable to source events. The lineage functions already exist — they just need callers.
> Step 8: After intelligence files are written, emit an SSE event so connected dashboards update in real time without polling."

**Strict contracts:**
- Engine instantiated ONCE per repo, outside onTick. Never re-created per tick.
- `allAnalyzers` is a simple array — no lazy loading, no factory.
- Engine's 10s throttle means analyzers run at most once every 10 seconds regardless of tick frequency (2s).
- Outcome classification MUST run before engine.run (velocity and efficiency analyzers read outcome field).
- Intelligence files written atomically (engine.ts already does tmp+rename).
- Non-fatal: engine.run failure does NOT break the materializer tick. Wrap in try/catch.
- Cold-start: routes return `{ status: "warming_up" }` with 202 when intelligence dir or specific file doesn't exist. Distinct from 204 which means "engine wired but analyzer determined no insights to report."

---

### Sprint 12B — Proactive Action Layer (13 tasks) ✅ COMPLETE

**Objective:** Build the ActionRunner framework. Implement auto-write to `.cursorrules`/`CLAUDE.md`, session-end context update, and weekly digest card generation.

**Acid test:**

```bash
# Verify auto-rule generation (after sufficient prompt patterns collected):
cat .cursor/rules/unfade.mdc | grep "Generated by Unfade" && echo "PASS: Rules auto-generated"

# Verify CLAUDE.md context section:
grep "BEGIN UNFADE CONTEXT" CLAUDE.md && echo "PASS: Session context auto-injected"

# Verify weekly card:
ls .unfade/cards/weekly-$(date +%Y-%W).png 2>/dev/null && echo "PASS: Weekly card generated"
```

| ID | Task | Files | Done |
|---|---|---|---|
| **12B.1** | ActionRunner core — event-driven action framework with trigger registration, opt-in config, atomic file writes, and action logging to `.unfade/logs/actions.jsonl` | `src/services/actions/runner.ts` | [x] |
| **12B.2** | Config schema extension — add `actions` section: `{ enabled, autoRules, ruleTarget, sessionContext, weeklyDigest, digestDay }`. Default: all disabled. No migration needed (dev phase) | `src/schemas/config.ts` | [x] |
| **12B.3** | Rule formatter — converts prompt-patterns.json insights into properly formatted rule text for target file. Handles: `.mdc` format (Cursor), markdown `##` format (CLAUDE.md), and plain text format (copilot-instructions). Each rule tagged with markers for idempotent updates | `src/services/actions/rule-formatter.ts` | [x] |
| **12B.4** | Auto-rule action — on intelligence update (prompt-patterns.json changed), extract new high-confidence patterns, format as rules, append to target file. Deduplicate by content hash. Target detection: check for .cursor/ → CLAUDE.md → .github/ | `src/services/actions/auto-rules.ts` | [x] |
| **12B.5** | Coach "Apply to project" button — HTTP endpoint `POST /api/actions/apply-rule` that takes a rule text and writes it to the detected target file. Returns the file path and content appended | `src/server/routes/actions.ts` | [x] |
| **12B.6** | Session-end context writer — reads session summary from summary.json, replaces `## Recent Context` section in CLAUDE.md with marker-delimited content. Max 500 chars per field | `src/services/actions/session-context.ts` | [x] |
| **12B.7** | Weekly digest — generates comparison JSON from summary.json stats. ISO week dedup, day-of-week matching for configured digest day | `src/services/actions/weekly-digest.ts` | [x] |
| **12B.8** | Weekly scheduler — integrated into weekly-digest action. Checks ISO week + digest day on each fire. Max 1 per ISO week | `src/services/actions/weekly-digest.ts` | [x] |
| **12B.9** | Wire ActionRunner into materializer — singleton `getActionRunner()` fires `intelligence_update` after engine.run and `schedule_weekly` every tick. All actions registered via `src/services/actions/index.ts` | `src/services/actions/index.ts`, `src/services/daemon/repo-manager.ts`, `src/server/http.ts` | [x] |
| **12B.10** | `unfade init` enhancement — deferred: `src/commands/init.ts` does not exist yet. Init flow handled elsewhere. Will be addressed when init command is created | N/A | [~] |
| **12B.11** | Integration test: ActionRunner core, auto-rule target detection, rule formatting, pattern extraction | `test/integration/actions.test.ts` | [x] |
| **12B.12** | Integration test: session context marker replacement, idempotent writes, user content preservation | `test/integration/actions.test.ts` | [x] |
| **12B.13** | Integration test: weekly digest generation, atomic writes | `test/integration/actions.test.ts` | [x] |

> **Agent Directive for Sprint 12B:** "You are building the Proactive Action Layer. This is a new subsystem that does NOT exist yet — there is no `src/services/actions/` directory.
>
> Core principle: The system must NEVER write files without explicit user opt-in. Default config has all actions disabled. User enables via `unfade init` prompt or manual config edit.
>
> ActionRunner pattern: Event-driven. Register trigger→action pairs. Each action: (1) checks config gate, (2) determines target file, (3) formats content, (4) atomic write (tmp+rename for new files, read+append+write for existing), (5) logs to actions.jsonl.
>
> Safety: Every file write uses marker comments (`<!-- BEGIN UNFADE ... -->` / `<!-- END UNFADE ... -->`). Updates replace content between markers (idempotent). Never overwrites user content outside markers. Content hash deduplication prevents appending same rule twice.
>
> Rule targets are detected by directory presence: `.cursor/` exists → write `.cursor/rules/unfade.mdc`. `CLAUDE.md` exists → append section. `.github/` exists → append to `copilot-instructions.md`. Config override (`ruleTarget`) takes precedence.
>
> Session context: Replace (not append) the `## Recent Context` section in CLAUDE.md on every session end. This gives the NEXT session automatic awareness of the previous one without growing the file endlessly.
>
> Weekly digest: Check once per tick if we're past the scheduled day and no card exists for this ISO week. Generate from summary.json 7d stats. Reuse card infrastructure from `src/services/cards/`."

**Strict contracts:**
- **Opt-in required:** No action fires unless `config.actions.enabled === true` AND the specific action is enabled.
- **Idempotent writes:** Marker-delimited sections replaced, not appended repeatedly. Content-hash dedup for rules.
- **Atomic:** New files via tmp+rename. Existing files via read+modify+write-tmp+rename.
- **Logged:** Every action logged to `.unfade/logs/actions.jsonl` with `{ action, target, timestamp, contentHash }`.
- **Non-fatal:** ActionRunner failures never crash the server or materializer.
- **Target detection:** Config override > directory detection > skip.
- **Rate limits:** Auto-rules: max 1 write per day. Session context: max 1 write per session end. Weekly: max 1 per ISO week.

---

### Sprint 12C — Deep Intelligence (12 tasks)

**Objective:** Build features that require deeper data integration — value quantification, debugging arc reconstruction, onboarding narratives, and decision durability tracking.

**Acid test:**

```bash
# Value receipt in distill:
grep "Estimated Impact" .unfade/distills/$(date +%Y-%m-%d).md && echo "PASS: Value receipt present"

# Debugging arc query:
unfade query --type=debugging --last=7d | jq '.arcs | length > 0' && echo "PASS: Debugging arcs reconstructed"

# Onboarding narrative:
unfade history --domain=auth --last=30d | head -5 && echo "PASS: History command works"

# Savings command:
unfade savings | grep "tokens saved" && echo "PASS: Savings command works"
```

| ID | Task | Files | Done |
|---|---|---|---|
| **12C.1** | Value receipt model — `computeValueReceipt(db)` counts MCP injections, estimates tokens/cost/time saved per period | `src/services/intelligence/value-receipt.ts` | [x] |
| **12C.2** | Value receipt in distill — appends "## Estimated Impact" section via `formatValueReceiptSection()` | `src/services/distill/distiller.ts`, `src/services/intelligence/value-receipt.ts` | [x] |
| **12C.3** | Debugging arc detector — groups debugging events by file overlap + temporal proximity, builds arcs with resolution detection | `src/services/intelligence/debugging-arcs.ts` | [x] |
| **12C.4** | Debugging arc in distill — appends "## Debugging Arcs" section via `formatDebuggingArcsSection()` | `src/services/distill/distiller.ts` | [x] |
| **12C.5** | `unfade history` command — `--domain`, `--feature`, `--last`, `--format` flags. Queries events table with feature join | `src/commands/history.ts`, `src/entrypoints/cli.ts` | [x] |
| **12C.6** | Decision durability tracker — `computeDecisionDurability(db)` tracks held/revised rates by deliberation depth | `src/services/intelligence/decision-durability.ts` | [x] |
| **12C.7** | Durability in velocity page — Decision Durability section with held rate, deep deliberation, quick decision stats | `src/server/pages/velocity-page.ts` | [x] |
| **12C.8** | `unfade savings` command — CLI output showing estimated time/cost savings per period | `src/commands/savings.ts`, `src/entrypoints/cli.ts` | [x] |
| **12C.9** | Integration test: value receipt computation (4 tests) | `test/integration/intelligence-12c.test.ts` | [x] |
| **12C.10** | Integration test: debugging arc detection (3 tests) | `test/integration/intelligence-12c.test.ts` | [x] |
| **12C.11** | Integration test: history command output (1 test) | `test/integration/intelligence-12c.test.ts` | [x] |
| **12C.12** | Integration test: decision durability correlation (3 tests) | `test/integration/intelligence-12c.test.ts` | [x] |
| **12C.13** | Session materializer — `materializeSessionMetrics(db)` groups events by session_id, upserts sessions table. Wired into repo-manager onTick | `src/services/intelligence/session-materializer.ts`, `src/services/daemon/repo-manager.ts` | [x] |
| **12C.14** | Analyzer upgrades — efficiency: phase normalization + outcome adjustment. Loop-detector: intent_summary recurrence. Cost: per-feature attribution + abandoned waste detection | `src/services/intelligence/analyzers/efficiency.ts`, `loop-detector.ts`, `cost-attribution.ts` | [x] |
| **12C.15** | Feature-scoped history — `--feature=X` scopes queries through event_features join | `src/commands/history.ts` | [x] |

> **Agent Directive for Sprint 12C:** "You are building deep intelligence features that connect captured data to quantified user value.
>
> Value receipt: Track MCP tool invocations (source events with type='mcp-invocation' or mcp-active). Each context/profile/decisions call represents one re-explanation avoided. Baseline: 2000 tokens per re-explanation (conservative). Multiply by invocation count. Cost: use token-proxy pricing ($0.03/1K input tokens as default). Time: estimate 2-5 minutes per manual re-explanation (use 3 min median).
>
> Debugging arcs: Group debugging-phase events by (1) shared files > 60% overlap, (2) temporal proximity < 2h, (3) same branch. Each arc is a sequence: [event with error keywords] → [events with hypothesis/test keywords] → [event with resolution or abandonment]. Narrative template: 'Started with [error description]. Tried [N approaches]. Resolved by [final action] / Abandoned after [N] iterations.'
>
> History command: Not a new query engine — use existing events FTS + feature grouping + distill summaries. Compose a timeline from: events grouped by feature, key decisions from distills, trade-offs mentioned. Output should read like a human-written 'Architecture Decision Record' timeline.
>
> Decision durability: Use `event_links` (triggered_commit) + git blame on modified files. If files from decision context are substantially rewritten (git diff shows >50% change) within 2-4 weeks, that decision was 'revised.' Correlate revision rate with `iteration_count` at decision time (proxy for deliberation depth). Only track decisions with `triggered_commit` links (need concrete git evidence).
>
> Session materializer (12C.13): Add a `sessions` table to schema.ts (id, start_ts, end_ts, event_count, turn_count, outcome, feature_id, execution_phases JSON, cost_tokens, tools_used). Call `materializeSessionMetrics(db)` from onTick after `assignEventsToFeatures`. Groups recent events by `session_id`, upserts session rows. This intermediate representation enables session-level intelligence without each analyzer rebuilding grouping logic.
>
> Analyzer upgrades (12C.14): The 8 analyzers were written before Phase 11 enrichment. Now that `execution_phase`, `intent_summary`, `outcome`, and `session_id` are materialized, upgrade: (1) efficiency — normalize HDS by execution_phase (planning expects 0.7-1.0, debugging expects 0.1-0.5), add outcome-adjusted sub-metric; (2) loop-detector — use intent_summary recurrence (same intent + outcome≠success = stuck) instead of content_summary cosine similarity; (3) cost-attribution — join through event_features for per-feature cost, flag outcome=abandoned sessions as waste.
>
> Feature-scoped history (12C.15): The `unfade history` command should accept `--feature=X` to scope all intelligence to a specific feature via event_features join. Output per-feature: session count, total cost, comprehension trajectory, key decisions, debugging arcs."

**Strict contracts:**
- Value receipt: estimates clearly labeled as such (`~` prefix, "estimated"). Never claim exact savings.
- Debugging arcs: minimum 2 events to form an arc. Single debugging events are not arcs.
- History command: max 50 events per query (paginated). Output defaults to markdown. All output to stderr except `--json`.
- Decision durability: only tracks decisions with `triggered_commit` links. Minimum 7 days before marking as "held."
- All new commands: use `handleCliError()` pattern.

---

### Tests (T-400 → T-433)

| Sprint | ID | Test Description | File |
|---|---|---|---|
| 12A | **T-400** | allAnalyzers barrel exports exactly 8 Analyzer instances | `test/services/intelligence/analyzers/all.test.ts` |
| 12A | **T-401** | IntelligenceEngine.run called from materializer onTick (mock engine, verify call) | `test/services/daemon/repo-manager.test.ts` |
| 12A | **T-402** | Engine respects 10s throttle — second call within 10s is no-op | `test/services/intelligence/engine.test.ts` |
| 12A | **T-403** | Outcome classification runs before engine.run (order verified) | `test/services/daemon/repo-manager.test.ts` |
| 12A | **T-404** | Intelligence route returns 202 "warming_up" when file missing | `test/server/routes/intelligence.test.ts` |
| 12A | **T-405** | Intelligence route returns 200 with data when file exists | `test/server/routes/intelligence.test.ts` |
| 12A | **T-406** | Integration: 20+ events → intelligence files generated | `test/integration/intelligence-wiring.test.ts` |
| 12A | **T-407** | Integration: API returns 200 after intelligence files exist | `test/integration/intelligence-wiring.test.ts` |
| 12A | **T-408** | Engine.run failure does not crash materializer tick | `test/services/daemon/repo-manager.test.ts` |
| 12B | **T-409** | ActionRunner respects config.actions.enabled gate | `test/services/actions/runner.test.ts` |
| 12B | **T-410** | ActionRunner logs every action to actions.jsonl | `test/services/actions/runner.test.ts` |
| 12B | **T-411** | Rule formatter produces valid .mdc format for Cursor | `test/services/actions/rule-formatter.test.ts` |
| 12B | **T-412** | Rule formatter produces valid markdown for CLAUDE.md | `test/services/actions/rule-formatter.test.ts` |
| 12B | **T-413** | Auto-rule deduplicates by content hash | `test/services/actions/auto-rules.test.ts` |
| 12B | **T-414** | Auto-rule respects rate limit (max 1/day) | `test/services/actions/auto-rules.test.ts` |
| 12B | **T-415** | Target detection: .cursor/ present → .cursor/rules/unfade.mdc | `test/services/actions/auto-rules.test.ts` |
| 12B | **T-416** | Target detection: config.ruleTarget overrides detection | `test/services/actions/auto-rules.test.ts` |
| 12B | **T-417** | Session context replaces between markers (idempotent) | `test/services/actions/session-context.test.ts` |
| 12B | **T-418** | Session context does not modify content outside markers | `test/services/actions/session-context.test.ts` |
| 12B | **T-419** | Weekly scheduler fires only once per ISO week | `test/services/actions/scheduler.test.ts` |
| 12B | **T-420** | Coach apply-rule endpoint writes to detected target | `test/server/routes/actions.test.ts` |
| 12B | **T-421** | Integration: auto-rule writes to .cursor/rules/unfade.mdc | `test/integration/actions-auto-rules.test.ts` |
| 12B | **T-422** | Integration: session context appears in CLAUDE.md | `test/integration/actions-session-context.test.ts` |
| 12B | **T-423** | Integration: weekly card PNG generated | `test/integration/actions-weekly-digest.test.ts` |
| 12C | **T-424** | Value receipt counts MCP invocations correctly | `test/services/intelligence/value-receipt.test.ts` |
| 12C | **T-425** | Value receipt computes token/cost/time estimates | `test/services/intelligence/value-receipt.test.ts` |
| 12C | **T-426** | Debugging arc groups events by file overlap + proximity | `test/services/intelligence/debugging-arcs.test.ts` |
| 12C | **T-427** | Debugging arc requires minimum 2 events | `test/services/intelligence/debugging-arcs.test.ts` |
| 12C | **T-428** | History command outputs markdown timeline | `test/commands/history.test.ts` |
| 12C | **T-429** | History command respects --last flag | `test/commands/history.test.ts` |
| 12C | **T-430** | Decision durability detects revision (>50% change) | `test/services/intelligence/decision-durability.test.ts` |
| 12C | **T-431** | Decision durability waits 7 days before marking "held" | `test/services/intelligence/decision-durability.test.ts` |
| 12C | **T-432** | Savings command outputs formatted estimates | `test/commands/savings.test.ts` |
| 12C | **T-433** | Distill includes "Estimated Impact" section when value data exists | `test/services/distill/distiller.test.ts` |
| 12A | **T-434** | Lineage populated: after engine.run, event_insight_map has rows | `test/services/intelligence/lineage.test.ts` |
| 12A | **T-435** | SSE emits intelligence-update event after engine writes JSON | `test/server/routes/intelligence.test.ts` |
| 12C | **T-436** | Session materializer groups events by session_id correctly | `test/services/intelligence/session-materializer.test.ts` |
| 12C | **T-437** | Session materializer computes execution_phase breakdown | `test/services/intelligence/session-materializer.test.ts` |
| 12C | **T-438** | Upgraded efficiency analyzer uses execution_phase normalization | `test/services/intelligence/analyzers/efficiency.test.ts` |
| 12C | **T-439** | Upgraded loop detector uses intent_summary recurrence | `test/services/intelligence/analyzers/loop-detector.test.ts` |
| 12C | **T-440** | Upgraded cost-attribution computes per-feature cost + waste | `test/services/intelligence/analyzers/cost-attribution.test.ts` |
| 12C | **T-441** | History --feature flag scopes intelligence to feature | `test/commands/history.test.ts` |

---

## 7. Success Metrics

| Metric | Baseline (Phase 11) | Target | Measurement |
|---|---|---|---|
| **Intelligence files generated** | 0 | 8 files in `.unfade/intelligence/` | `ls .unfade/intelligence/*.json \| wc -l` = 8 after 20+ events |
| **Dashboard pages with data** | 0/8 | 8/8 | All intelligence routes return 200 (not 204) |
| **MCP intelligence tools with data** | 0 | All return JSON | `unfade_efficiency`, `unfade_coach`, `unfade_costs` return non-null |
| **Coach patterns generated** | 0 | 3+ patterns after 50 events | `jq '.patterns \| length' .unfade/intelligence/prompt-patterns.json` >= 3 |
| **Rules auto-written** (opted in) | N/A | At least 1 rule per week of active use | Action log shows rule writes |
| **Session context freshness** | N/A | Updated within 5 min of session end | Timestamp in marker < 5 min old |
| **Weekly digest generation** | N/A | Card exists for current ISO week by day after configured day | File existence check |
| **Value receipt accuracy** | N/A | Within 50% of actual (manual audit) | Compare estimate to actual MCP call count × baseline |
| **Lineage traceability** | 0% | 100% of insights traceable to source events | `SELECT COUNT(*) FROM event_insight_map` > 0 after engine.run |
| **Session metrics computed** | N/A | Per-session turn count, outcome, cost | `SELECT COUNT(*) FROM sessions` > 0 after 5+ sessions |
| **Phase 11 field utilization** | 17% (2/12) | 83% (10/12) | Analyzers consume execution_phase, intent_summary, outcome, session_id |
| **Test count** | Current | +42 tests, all passing | `pnpm test` |

---

## 8. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Analyzer performance at scale** (8 analyzers on 50K+ events) | Medium | Medium | `idx_events_ts` index. Each analyzer uses LIMIT. Engine's 10s throttle prevents thrashing. Profile after wiring |
| **File write conflicts** (user editing CLAUDE.md while Unfade writes) | Low | Medium | Atomic write (tmp+rename). Marker-delimited sections only. Never modify user content outside markers |
| **Cold-start empty state confusion** | Medium | Low | 202 "warming_up" response with progress indication. Each analyzer has explicit `minDataPoints` |
| **Over-writing rules** (unwanted generated rule) | Low | Medium | Opt-in only. Each rule tagged with source. User can delete individual rules. Rate limit: max 1/day |
| **CLAUDE.md grows too large** | Low | Low | Replace (not append) context section. Fixed format: intent + decisions + unresolved (max 500 chars each) |
| **Weekly card generation fails silently** | Low | Low | Action log captures failures. `unfade status` shows "weekly digest: failed (reason)" |
| **Decision durability false positives** (refactoring ≠ reverting) | Medium | Medium | Only flag as "revised" if >50% of decision-linked lines changed AND different author/branch. Minimum 7-day hold |
| **Value receipt overestimates savings** | Medium | Medium | Conservative baseline (2000 tokens). Always prefix with `~`. Show methodology on hover in dashboard |
| **Config migration v2→v3 breaks existing installs** | Low | High | Migration adds `actions` key with all-disabled defaults. No existing behavior changes. Backup before migration |

---
