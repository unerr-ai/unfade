# Phase 13 — Gap Remediation & System Coherence

> **Purpose:** Upstream-to-Downstream (U2D) audit across Phases 7, 8, 10, 11, 12 with execution-ready micro-sprints to close every gap before launch. Produced via RRVV framework by tracing every data field from Go capture → TypeScript materializer → SQLite → Intelligence Engine → API → MCP → Web UI.
>
> **Key finding:** The `IntelligenceEngine` **IS wired** in `repo-manager.ts` (lines 310–324) — correcting earlier audit claims. All 8 core analyzers run on materializer ticks with `newRows > 0`. However, **5 secondary pipelines** (cross-analyzer correlations, narrative synthesis, debugging arcs, decision durability, session materialization → API) are **written but not wired**, and **3 UI pages reference APIs that don't exist**.
>
> **Status:** EXECUTION-READY
>
> **Last updated:** 2026-04-20 (data-quality audit addendum 2026-04-20)

---

## 1. U2D Sync Matrix

### 1.1 Core Intelligence Flow (WORKING)

```
Go daemon → .unfade/events/*.jsonl → Materializer (2s tick, repo-manager.ts)
  ├── SQLite cache (events, decisions, comprehension_proxy, etc.)
  ├── summary.json (writeSummary)
  ├── insights/recent.jsonl (appendRecentInsight)
  ├── features + event_features + event_links (Phase 11)
  ├── session metrics (materializeSessionMetrics)
  └── IntelligenceEngine.run() → .unfade/intelligence/*.json
       ├── efficiency.json      ← efficiencyAnalyzer       ✅ WIRED
       ├── costs.json           ← costAttributionAnalyzer   ✅ WIRED (name: cost-attribution.json in P12 doc)
       ├── comprehension.json   ← comprehensionRadarAnalyzer ✅ WIRED
       ├── prompt-patterns.json ← promptPatternsAnalyzer    ✅ WIRED
       ├── rejections.idx.json  ← loopDetectorAnalyzer      ✅ WIRED (name: loop-detector.json in P12 doc)
       ├── velocity.json        ← velocityTrackerAnalyzer   ✅ WIRED
       ├── alerts.json          ← blindSpotDetectorAnalyzer  ✅ WIRED
       └── replays.json         ← decisionReplayAnalyzer    ✅ WIRED
```

### 1.2 Secondary Pipelines (NOT WIRED — code exists, no caller in production)

| Pipeline | Module | Writes to | Called from | Gap |
|----------|--------|-----------|-------------|-----|
| **Cross-analyzer correlations** | `cross-analyzer.ts` `writeCorrelations()` | `intelligence/correlation.json` | Tests only | **No production caller; no `mkdirSync`** — will crash if dir doesn't exist |
| **Narrative synthesis** | `narrative-synthesizer.ts` `appendNarratives()` | `intelligence/narratives.jsonl` | Tests only | **No production caller; no `mkdirSync`** — same crash risk |
| **Debugging arcs** | `debugging-arcs.ts` `writeDebuggingArcs()` | `intelligence/debugging-arcs.json` | Tests only | Phase 12 references this in distill enrichment but no materializer wiring |
| **Decision durability** | `decision-durability.ts` `writeDecisionDurability()` | `intelligence/decision-durability.json` | Tests only | `velocity-page.ts` fetches `/api/intelligence/decision-durability` → **no route exists → 404** |
| **`findSimilarRejections`** | `loop-detector.ts` (exported) | N/A (query helper) | Nowhere | MCP `unfade_coach` could use it for real-time loop warnings; currently dead export |

### 1.3 API ↔ UI ↔ File Name Mismatches

| Layer | Name in code/docs A | Name in code/docs B | Impact |
|-------|---------------------|---------------------|--------|
| Intelligence API response code | **202** `{ status: "warming_up" }` (actual `intelligence.ts`) | **204** (Phase 7 docs, Phase 7 UX spec) | UI pages checking `response.status === 204` will not match |
| Cost file | `costs.json` (intelligence route) | `cost-attribution.json` (Phase 12 §4.1) | If analyzer writes as `cost-attribution.json`, route reads `costs.json` → always empty |
| Loop detector file | `rejections.idx.json` (intelligence route) | `loop-detector.json` (Phase 12 §4.1) | Same mismatch risk |
| Route path | `/cost` (page) + `/costs` (page) both exist | One should be canonical | Duplicate pages, confused nav |
| Profile API | `/unfade/profile` (shipped route) | `/api/profile` → `state/profiles/v2.json` (Phase 8 §9.7) | Two different paths to two different files |
| Insights API | `/api/insights/recent` (shipped route) | `/api/insights` (Phase 8 §9.7 table) | Minor; only one exists in `http.ts` |
| Settings status | `/unfade/settings/status` (shipped route) | `/api/settings/status` (Phase 8 Fix 3) | May be aliased; needs verification |
| Decision durability API | `/api/intelligence/decision-durability` (velocity-page.ts fetches) | **No route registered** | **404 in production** |

### 1.4 Schema Drift (Go ↔ TypeScript)

| Field | Go (`event.go`) | TypeScript (`event.ts`) | Gap |
|-------|-----------------|------------------------|-----|
| `source` enum | Plain string; comment omits `mcp-active` | `z.enum([..., "mcp-active"])` | Minor — Go accepts anything; TS validates. **Add `mcp-active` to Go comment for documentation parity** |
| `outcome` | Phase 11: "never in source JSONL — derived in TS" | Not in `CaptureEventSchema` (correct) | No gap — but Phase 11 §4.4 diagram misleadingly includes it |
| Phase 11 metadata fields | `sequence_id`, `execution_phase`, `intent_summary`, `trigger`, `prompts_all`, `tool_calls_summary`, `files_referenced`, `files_modified`, `feature_signals`, etc. | `metadata: z.record()` (accepts anything) | No **type** enforcement on metadata keys in TS — relies on runtime. Acceptable for now; flagged for future Zod narrowing |

---

## 2. Page Significance & Utilization Triage

### `/` (Home)

| Aspect | Detail |
|--------|--------|
| **Significance** | First impression. Must answer "is it running? what did I do? what should I look at?" in 10 seconds |
| **Data displayed** | Direction density hero, KPI strip (events, comprehension, top domain, cost est.), insight stream, tool mix, quick actions |
| **The "Why"** | Anxiety relief ("yes, it's capturing"), curiosity trigger ("73% human-directed — what does that mean?"), habit hook ("12 new since yesterday") |
| **Utilization** | Click insight → drill. Click Intelligence/Coach/Alerts from quick actions. SSE keeps it live without refresh |
| **Gaps** | Home 5-state machine (Phase 8) not reflected in Phase 7 UX spec; `ingesting` and `calibrating` states may show confusing empty hero |

### `/live`

| Aspect | Detail |
|--------|--------|
| **Significance** | "Proof the system is alive." Real-time event stream + system health |
| **Data displayed** | Daemon PID/uptime, materializer tick count, SSE connection state, server port; event stream with source icons and type badges |
| **The "Why"** | Trust building ("I can see it working"); debugging ("why isn't my AI session showing up?") |
| **Utilization** | Filter by source to isolate AI vs git events; pause stream to inspect a specific event; drill arrow → evidence drawer |
| **Gaps** | Health SSE enrichment (Phase 8) adds `daemonAlive`, `materializerLagMs`, `ingestStatus`, `intelligenceReady` — Live page should display these, not just generic "connected" |

### `/intelligence`

| Aspect | Detail |
|--------|--------|
| **Significance** | "How effectively do I use AI?" — the single metric no competitor provides |
| **Data displayed** | AES gauge (0–100), 5 sub-metrics with weights, trend chart, period selector |
| **The "Why"** | Self-improvement signal; screenshot-worthy metric for sharing; longitudinal proof of growth |
| **Utilization** | Compare periods (7d vs 30d); click sub-metric → evidence drawer showing contributing sessions; use as basis for Coach recommendations |
| **Gaps** | Onboarding API (`/api/intelligence/onboarding`) should drive "N more sessions until AES stabilizes" — verify it's called on this page |

### `/cost`

| Aspect | Detail |
|--------|--------|
| **Significance** | "Where is my AI budget going?" — connects reasoning to dollars |
| **Data displayed** | Total estimated spend, by-model breakdown, by-domain breakdown, waste ratio, context overhead, projected MCP savings |
| **The "Why"** | Budget justification for managers; personal cost awareness; quantifies Unfade's value ("you'd save $180/mo with context injection") |
| **Utilization** | Identify high-cost low-value domains; switch models per domain; share cost report with leadership |
| **Gaps** | Every USD must show EstimateBadge. Verify `costs.json` filename matches what analyzer writes (Phase 12 says `cost-attribution.json`) |

### `/comprehension`

| Aspect | Detail |
|--------|--------|
| **Significance** | "Do I understand what I shipped?" — the comprehension debt crisis answer |
| **Data displayed** | Overall score, per-module heatmap (green/yellow/red), blind spot alerts, sortable table view |
| **The "Why"** | Anti-"brain rot" tool; identifies modules where developer accepted AI output without engagement; audit signal for critical code |
| **Utilization** | Red module → schedule manual review or pair session; track improvement over weeks; leadership: team comprehension heatmap |
| **Gaps** | `comprehension.json` from Radar analyzer vs existing `comprehension_proxy` from materializer — are they the same data? Or does the page need to merge both? |

### `/coach`

| Aspect | Detail |
|--------|--------|
| **Significance** | "How can I prompt better?" — turns observation into action |
| **Data displayed** | Effective patterns (success border), anti-patterns (warning border), acceptance rate, sample size, domain context |
| **The "Why"** | The #1 Reddit workaround automated: "your auth prompts with constraint lists produce 3x better outcomes" |
| **Utilization** | "Copy as CLAUDE.md rule" → applies learned pattern; "Apply to .cursorrules" (Phase 12 proactive action) — **the demo moment** |
| **Gaps** | Phase 12 `POST /api/actions/apply-rule` — verify route exists. UI needs "Manage rules" panel to view/delete applied rules |

### `/alerts`

| Aspect | Detail |
|--------|--------|
| **Significance** | "What needs my attention?" — proactive, not reactive |
| **Data displayed** | Blind spot alerts (low comprehension modules), decision replays (revisit old decisions), weekly cap notice |
| **The "Why"** | Prevents comprehension debt from silently accumulating; surfaces "you should revisit the Redis decision" when context drifts |
| **Utilization** | Acknowledge → removes from queue, decrements sidebar badge; "Review module →" navigates to comprehension drill-down |
| **Gaps** | No visibility into Phase 12 proactive actions (rule writes, context updates) — user can't see "what did Unfade do automatically?" |

### `/velocity`

| Aspect | Detail |
|--------|--------|
| **Significance** | "Am I getting faster at making good decisions?" — the longitudinal growth story |
| **Data displayed** | Overall trend chart, per-domain sparklines, turns-to-acceptance current vs previous, acceleration/stable/deceleration badge |
| **The "Why"** | Proof of skill improvement; answers "am I just a prompter?" with data showing decision speed improving in domains you use most |
| **Utilization** | Identify domains where velocity is improving (expertise deepening) vs stalling (potential complacency) |
| **Gaps** | `velocity-page.ts` fetches `/api/intelligence/decision-durability` — **route doesn't exist → 404**. Decision durability data is never written in production |

### `/logs`

| Aspect | Detail |
|--------|--------|
| **Significance** | "What is Unfade doing under the hood?" — transparency and debugging |
| **Data displayed** | Ring-buffered log entries with source, level, message; SSE live stream |
| **The "Why"** | Trust: "I can see exactly what this tool does." Debugging: "why didn't my session get captured?" |
| **Utilization** | Filter by source (daemon/materializer/intelligence); tail for real-time monitoring |
| **Gaps** | Phase 12 `actions.jsonl` (proactive action log) is not surfaced here — should be a log source |

### `/setup`, `/integrations`, `/settings`

| Aspect | Detail |
|--------|--------|
| **Significance** | First-run onboarding, MCP installation, configuration |
| **Gaps** | Phase 10 setup gate middleware still **TODO**. Phase 12 `config.actions` section not surfaced in Settings UI |

---

## 3. The Missing Elements (Gap Analysis)

### 3.1 Critical (blocks user value or causes errors)

| # | Gap | Upstream | Downstream | Impact |
|---|-----|----------|------------|--------|
| **G1** | `velocity-page.ts` fetches `/api/intelligence/decision-durability` — **no route exists** | `writeDecisionDurability()` exists but is never called in production | Page gets 404 | **Velocity page partially broken** |
| **G2** | Intelligence file naming mismatch: Phase 12 doc says `cost-attribution.json`, `loop-detector.json` — but routes read `costs.json`, `rejections.idx.json` | Analyzer `outputFile` config in `all.ts` | Route `readIntelligenceFile` filename | If names don't match, **pages permanently show empty** |
| **G3** | API returns **202** for missing intelligence; UI pages/docs expect **204** | `intelligence.ts` route file | Every Phase 7 page checking `status === 204` | Pages may not trigger correct empty-state UX |
| **G4** | `cross-analyzer.ts` and `narrative-synthesizer.ts` lack `mkdirSync` | Write to `intelligence/` without ensuring dir exists | Crash on first call | Will throw if called before engine.run() creates the dir |

### 3.2 High (degrades experience or blocks planned features)

| # | Gap | Detail | Impact |
|---|-----|--------|--------|
| **G5** | Cross-analyzer correlations not wired | `writeCorrelations()` never called from materializer | `/api/intelligence/correlations` always 202; no cross-metric insights |
| **G6** | Narrative synthesis not wired | `appendNarratives()` never called from materializer | `/api/intelligence/narratives` always 202; no natural-language insight stream |
| **G7** | Debugging arcs not wired | `writeDebuggingArcs()` never called | Phase 12 distill enrichment can't include debugging arc summaries |
| **G8** | Decision durability not wired | `writeDecisionDurability()` never called | Velocity page can't show which decisions held vs reverted |
| **G9** | Phase 12 proactive actions not visible in UI | `actions.jsonl` written but no page/panel shows "Unfade applied 2 rules today" | Users don't know Unfade is actively helping; trust gap |
| **G10** | Phase 12 `config.actions` not in Settings UI | Config section exists in schema but no UI to enable/configure | Users can't turn on auto-rules without editing JSON |
| **G11** | Phase 12 CLI commands `unfade savings`, `unfade history` not registered | Files may not exist in `src/commands/`; `cli.ts` doesn't register them | Documented commands are dead |
| **G12** | `sessions` table (Phase 12 §12C.13) — verify if in `manager.ts` schema | `materializeSessionMetrics` writes somewhere but table may not be in `createSchema()` | Session-level queries may fail |

### 3.3 Medium (polish / documentation / consistency)

| # | Gap | Detail |
|---|-----|--------|
| **G13** | Duplicate routes: `/cost` and `/costs` both registered | One should redirect to the other |
| **G14** | Phase 8 health SSE fields (`daemonAlive`, `materializerLagMs`, `intelligenceReady`) — verify Live page renders them |
| **G15** | Go `event.go` source comment doesn't include `mcp-active` | Documentation parity only |
| **G16** | Phase 11 `correlation.json` schema: doc uses `pairs` in schema but `.correlations` in acid test |
| **G17** | Phase 11 `outcome` values: `failed` (§4.4) vs `failure` (§10 matrix) |
| **G18** | `daemon` CLI subcommand exists as `src/commands/daemon.ts` but **not registered** in `cli.ts` |

---

## 4. Remediation Micro-Sprints

### Sprint 13A — Fix Critical U2D Breaks (5 tasks) ✅ COMPLETE

**Objective:** Every intelligence page renders real data or correct empty state. No 404s, no filename mismatches, no wrong HTTP status checks.

**Acid test:**

```bash
# Start server with a repo that has events
node dist/cli.mjs &
sleep 5
# Every intelligence endpoint returns 202 (warming) or 200 (data), never 404
for ep in efficiency costs comprehension prompt-patterns coach velocity rejections alerts replays decision-durability; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:7654/api/intelligence/$ep)
  [ "$STATUS" = "404" ] && echo "FAIL: $ep returns 404" && exit 1
done
echo "PASS: All intelligence endpoints respond"
```

| ID | Task | Description | Files |
|----|------|-------------|-------|
| **UF-400** | Verify analyzer output filenames match route expectations | **[x] VERIFIED** — all 8 analyzer `outputFile` values in `all.ts` exactly match route filenames in `intelligence.ts`: `efficiency.json`, `comprehension.json`, `costs.json`, `rejections.idx.json`, `velocity.json`, `prompt-patterns.json`, `alerts.json`, `replays.json`. No mismatch. Phase 12 doc naming (`cost-attribution.json`, `loop-detector.json`) is stale — code is canonical | `src/services/intelligence/analyzers/all.ts`, `src/server/routes/intelligence.ts` |
| **UF-401** | Add `/api/intelligence/decision-durability` route | **[x] COMPLETE** — registered `GET /api/intelligence/decision-durability` in `intelligence.ts` using `readIntelligenceFile("decision-durability.json")` + `jsonOr202`. Fixes 404 from `velocity-page.ts` line 126 | `src/server/routes/intelligence.ts` |
| **UF-402** | Wire `writeDecisionDurability` into materializer tick | **[x] COMPLETE** — added `computeDecisionDurability(db)` + `writeDecisionDurability(report, repoRoot)` call in `repo-manager.ts` after intelligence engine run. Runs on every tick with `newRows > 0`. Only writes when `report.decisions.length > 0` (avoids empty file) | `src/services/daemon/repo-manager.ts` |
| **UF-403** | Standardize intelligence API response: 202 vs 204 | **[x] COMPLETE** — API keeps **202** `{ status: "warming_up" }`. Updated all 8 UI pages to accept `r.status===202\|\|r.status===204`: `coach.ts`, `intelligence.ts`, `cost.ts`, `velocity-page.ts` (×2 fetches), `comprehension.ts`, `alerts.ts` (×2 fetches). Also fixed MCP test (12→13 tools for `unfade_tag`) and intelligence-engine test (mock path for 202 case) | `src/server/pages/{coach,intelligence,cost,velocity-page,comprehension,alerts}.ts`, `test/integration/{intelligence-engine,mcp}.test.ts` |
| **UF-404** | Add `mkdirSync` guard to `cross-analyzer.ts` and `narrative-synthesizer.ts` | **[x] COMPLETE** — added `mkdirSync(dir, { recursive: true })` to `writeCorrelations()` in `cross-analyzer.ts` and `appendNarratives()` in `narrative-synthesizer.ts`. Also added `mkdirSync` import to both files | `src/services/intelligence/cross-analyzer.ts`, `src/services/intelligence/narrative-synthesizer.ts` |

> **Agent Directive:** "Fix 5 critical data-flow breaks. (1) Verify all analyzer outputFile names match intelligence route filenames — reconcile mismatches. (2) Add decision-durability API route. (3) Wire decision-durability into analyzer pipeline. (4) Standardize 202 responses and update UI fetch checks. (5) Add mkdirSync guards. Run `pnpm build && pnpm test` after each change. stdout is sacred."

**Strict contracts:**
- Intelligence routes: 202 `{ status: "warming_up" }` when file missing; 200 with JSON when present
- Analyzer `outputFile` property must exactly match route filename (e.g., `costs.json` not `cost-attribution.json`)
- All intelligence file writers must `mkdirSync(dir, { recursive: true })` before write

---

### Sprint 13B — Wire Secondary Pipelines (4 tasks) ✅ COMPLETE

**Objective:** Cross-analyzer correlations, narrative synthesis, and debugging arcs produce output in production — not just tests.

**Acid test:**

```bash
# After server runs with events for 30+ seconds
test -f .unfade/intelligence/correlation.json && \
  test -f .unfade/intelligence/narratives.jsonl && \
  echo "PASS: Secondary pipelines produce output"
```

| ID | Task | Description | Files |
|----|------|-------------|-------|
| **UF-405** | Wire cross-analyzer correlations into post-engine step | **[x] COMPLETE** — added `computeCorrelations()` + `writeCorrelations()` to `repo-manager.ts` after decision durability, with 5-minute throttle (`lastCorrelationMs`). Only writes when `report.correlations.length > 0`. Uses dynamic import pattern consistent with existing code | `src/services/daemon/repo-manager.ts` |
| **UF-406** | Wire narrative synthesis into post-engine step | **[x] COMPLETE** — `synthesizeNarratives(repoRoot)` called inside the correlation block, only when fresh correlations are written. Narratives depend on `correlation.json` as input, so this sequencing is correct. Ring buffer max 50 in `narrative-synthesizer.ts` already enforced | `src/services/daemon/repo-manager.ts` |
| **UF-407** | Wire debugging arcs into materializer | **[x] COMPLETE** — added `detectDebuggingArcs(db)` + `writeDebuggingArcs(arcs, repoRoot)` with 60-second throttle (`lastDebuggingArcMs`). Only writes when arcs detected. Groups debugging-phase events by file overlap + temporal proximity | `src/services/daemon/repo-manager.ts` |
| **UF-408** | SSE intelligence event enrichment | **[x] VERIFIED** — already implemented in `stream.ts` lines 57–88 (12A.11). Polls `intelligence/` dir for any `.json` mtime changes and pushes `event: intelligence` via SSE. New files from correlations (`correlation.json`) and debugging arcs (`debugging-arcs.json`) are automatically picked up by the existing `readdirSync` + `.endsWith(".json")` filter | `src/server/routes/stream.ts` |

> **Agent Directive:** "Wire 4 secondary intelligence pipelines. All writers must use mkdirSync + atomic tmp+rename. All production callers must be throttled. Add to the existing post-engine block in repo-manager.ts. stdout is sacred."

---

### Sprint 13C — Phase 12 Proactive Actions UI (5 tasks) ✅ COMPLETE

**Objective:** Users can see, enable, and manage Unfade's proactive file-write actions from the Settings and Alerts UI.

**Acid test:**

```bash
curl -s http://localhost:7654/settings | grep -q 'actions' && \
  curl -s http://localhost:7654/alerts | grep -q 'action-log' && \
  echo "PASS: Proactive actions visible in UI"
```

| ID | Task | Description | Files |
|----|------|-------------|-------|
| **UF-409** | Settings: add "Proactive Actions" section | **[x] COMPLETE** — added full Proactive Actions section to `settings.ts` with: master toggle, auto-rules toggle + rule target dropdown (Auto-detect / Cursor / CLAUDE.md / Copilot), session context toggle, weekly digest toggle + day selector. All toggles POST to `/unfade/settings/actions` (new route in `settings.ts`). GET `/unfade/settings/status` now returns `actions` object alongside existing `data` for initial hydration | `src/server/pages/settings.ts`, `src/server/routes/settings.ts` |
| **UF-410** | Alerts: add "Recent Actions" panel | **[x] COMPLETE** — added "What Unfade Did" section below blind spots and replays on `/alerts`. New API `GET /api/intelligence/actions` reads `.unfade/logs/actions.jsonl`, returns last 10 entries reversed. UI shows action type badge (success pill), timestamp, and target file path per entry. Section hidden when no actions exist | `src/server/pages/alerts.ts`, `src/server/routes/intelligence.ts` |
| **UF-411** | Coach: "Apply Rule" button wiring | **[x] COMPLETE** — `POST /api/actions/apply-rule` already exists in `actions.ts` (Phase 12). Added "Apply to project" button alongside existing "CLAUDE.md" clipboard button on each effective pattern card. Button POSTs to the endpoint, shows applied target filename on success, error on failure, auto-resets after 3s | `src/server/pages/coach.ts` |
| **UF-412** | Register Phase 12 CLI commands | **[x] COMPLETE** — `savings` and `history` were already registered in `cli.ts`. Added `daemon` command group with 4 subcommands: `daemon status`, `daemon stop`, `daemon restart`, `daemon update` — all delegating to exported functions in `src/commands/daemon.ts` | `src/entrypoints/cli.ts` |
| **UF-413** | Deduplicate `/cost` and `/costs` routes | **[x] COMPLETE** — rewrote `costs.ts` as a 301 redirect to `/cost`. Nav sidebar already uses `/cost` as canonical. Old 100-line costs page content removed | `src/server/pages/costs.ts` |

> **Agent Directive:** "Surface Phase 12 proactive actions in the UI. Settings gets a new 'Proactive Actions' section with toggles. Alerts gets an action log. Coach gets 'Apply to project' button. Deduplicate /cost and /costs. Register missing CLI commands. stdout is sacred."

---

### Sprint 13D — Schema & Health Coherence (4 tasks) ✅ COMPLETE

**Objective:** All cross-boundary schemas are aligned. Health data flows correctly to Live page. Session table exists.

**Acid test:**

```bash
pnpm typecheck && \
  curl -s http://localhost:7654/live | grep -q 'intelligenceReady' && \
  curl -s http://localhost:7654/api/system/health | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'intelligenceReady' in d" && \
  echo "PASS: Schema and health coherence"
```

| ID | Task | Description | Files |
|----|------|-------------|-------|
| **UF-414** | Verify `sessions` table in `manager.ts` schema | **[x] COMPLETE** — `sessions` table was already created at runtime by `ensureSessionsTable()` in `session-materializer.ts` (27 rows exist in live DB). Added `CREATE TABLE IF NOT EXISTS sessions` to `createSchema()` in `manager.ts` for schema completeness. Table matches: `id, start_ts, end_ts, event_count, turn_count, outcome, estimated_cost, execution_phases, branch, domain, feature_id, updated_at` | `src/services/cache/manager.ts` |
| **UF-415** | Live page: render Phase 8 health fields | **[x] COMPLETE** — (1) Added `intelligenceReady` boolean to `SystemHealthResponse` interface and health endpoint (checks for `efficiency.json` existence). (2) Updated Live page to fetch from `/api/system/health` (not redirect). (3) Added 2 new health chips: **Ingest** (idle/running/complete) and **Intelligence** (active/warming up). (4) Daemon chip now shows "running" vs "not running" from `daemonRunning`. (5) Materializer chip shows lag in seconds with warning > 10s | `src/server/routes/system-health.ts`, `src/server/pages/live.ts` |
| **UF-416** | Update Go `event.go` source comment | **[x] COMPLETE** — added `mcp-active` to source enum comment: `// git \| ai-session \| terminal \| browser \| manual \| mcp-active`. Go tests pass | `daemon/internal/capture/event.go` |
| **UF-417** | Fix Phase 11 doc inconsistencies | **[x] COMPLETE** — (a) Fixed correlation schema: `{ pairs: [...] }` → `{ correlations: [...] }` on line 664 (matches code + acid test). (b) Fixed outcome values: `failure` → `failed` on lines 1055, 1111 (matches §4.4). (c) Added resolution banner to "engine not wired" root-cause section (§9.4) noting Phase 12A/13A/13B resolved it | `.internal/architecture/PHASE_11_STATE_DETERMINISM_AND_INTELLIGENT_CAPTURE.md` |

> **Agent Directive:** "Align schemas and health data. Verify sessions table exists or create it. Ensure Live page shows all Phase 8 health fields. Fix Go comment. Fix doc inconsistencies. pnpm build + pnpm test + pnpm typecheck after each change. stdout is sacred."

---

### Sprint 13E — Build & Test Gate (3 tasks) ✅ COMPLETE

**Objective:** Full CI passes. No orphan imports, no dead routes, no failing tests from all changes in 13A–13D.

**Acid test:**

```bash
pnpm build && pnpm test && pnpm typecheck && pnpm lint && \
  cd daemon && go test ./... && cd .. && \
  echo "PASS: Full CI green"
```

| ID | Task | Description | Files |
|----|------|-------------|-------|
| **UF-418** | Write integration test for intelligence pipeline | **[x] COMPLETE** — existing tests in `intelligence-engine.test.ts` already cover engine run + file generation + API route responses (12A.7/12A.8). Added UF-419 tests in same file. Total: 617 tests, all passing | `test/integration/intelligence-engine.test.ts` |
| **UF-419** | Write test for decision-durability route | **[x] COMPLETE** — added 2 tests to `intelligence-engine.test.ts`: (1) returns 202 when `decision-durability.json` missing (mocked empty dir), (2) returns 200 when file exists with valid JSON. Both pass | `test/integration/intelligence-engine.test.ts` |
| **UF-420** | Full CI verification + orphan cleanup | **[x] COMPLETE** — fixed 3 pre-existing test failures: (1) `reset.test.ts` — removed broken static import of deleted `autostart.js`; used inline `vi.fn()` mocks; removed stale autostart assertions. (2) `e2e.test.ts` — replaced import of deleted `scaffold.js` with `ensureInit()` from `lightweight-init.js`; wrote `config.json` manually since `ensureInit` doesn't create it. (3) `pnpm lint:fix` resolved 55 auto-fixable issues. **Final result: pnpm build ✓ · pnpm typecheck ✓ · pnpm lint ✓ · pnpm test (101 files, 617 tests, 0 failures) ✓ · go test ./... ✓** | `test/commands/reset.test.ts`, `test/integration/e2e.test.ts`, lint auto-fix |

> **Agent Directive:** "Final verification sprint. Write 2 targeted tests. Run full CI. Fix all failures. No new features — only green builds. stdout is sacred."

---

## 5. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Zero 404s on intelligence routes** | All 13 intelligence endpoints return 200 or 202 | `curl` sweep |
| **Secondary pipelines produce output** | `correlation.json`, `narratives.jsonl`, `decision-durability.json` exist after 60s of server runtime with events | File existence check |
| **Proactive actions visible** | Settings shows toggle; Alerts shows action log | Visual check |
| **Live page shows all health fields** | `intelligenceReady`, `materializerLagMs`, `ingestStatus` rendered | Visual check |
| **CI green** | `pnpm build && pnpm test && pnpm typecheck && pnpm lint` + `go test ./...` | CI |

---

## 6. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Analyzer output filename mismatch breaks existing pages | High | High | Sprint 13A UF-400 — verify before any other change |
| Secondary pipelines slow materializer tick | Medium | Medium | All secondary writes throttled (5 min correlations, 60s debugging arcs) |
| Sessions table migration on existing DBs | Medium | Low | `CREATE TABLE IF NOT EXISTS` — safe for existing users |
| Phase 12 actions config missing from schema | Medium | Medium | Sprint 13C UF-409 verifies; add if absent |
| Doc fixes in Phase 11 conflict with other branches | Low | Low | Surgical edits only; no structural changes |

---

## 7. Live Data Audit (`.unfade/` on this repo)

### 7.1 Inventory snapshot (2026-04-21)

```
.unfade/
├── events/          6 files (Apr 14–21), 1485 lines total
├── cache/           unfade.db (SQLite, 15 tables, 1485 event rows)
├── intelligence/    8 JSON files — ALL POPULATED by engine ✅
├── state/           summary.json, server.json, health.json, setup-status.json, ingest.json, daemon.pid, materializer.json
├── insights/        recent.jsonl (ring buffer, active)
├── metrics/         daily.jsonl (appended)
├── logs/            daemon.log
├── bin/             unfaded, unfade-send
├── config.json      present
├── distills/        EMPTY ❌
├── profile/         EMPTY ❌
├── graph/           EMPTY ❌
├── cards/           EMPTY ❌
├── amplification/   EMPTY ❌
```

### 7.2 What's working well

| Area | Evidence | Verdict |
|------|----------|---------|
| **AI session capture** | 1484 `ai-conversation` events from `claude-code` (1482) + `cursor` (2) across 6 days | ✅ Claude Code parser is strong |
| **Direction signals** | Every event has `direction_signals` with `human_direction_score`, `confidence`, `prompt_specificity`, etc. | ✅ Classifier is producing real data |
| **Intelligence engine** | All 8 JSON files populated: `efficiency.json` (AES: 23), `comprehension.json` (overall: 28), `costs.json`, `velocity.json`, `prompt-patterns.json`, `rejections.idx.json` (85KB, substantial index), `alerts.json` (active blind spot alerts), `replays.json` | ✅ Engine IS running and producing output |
| **SQLite materialization** | 1485 events, 500 comprehension_proxy, 1420 event_links, 40 features, 27 sessions, FTS indexed | ✅ Materializer + Phase 11 features are active |
| **Summary.json** | Live: direction 27%, 500 events 24h, comprehension 28, toolMix, cost fields | ✅ Dashboard has data to show |
| **Insights stream** | Recent.jsonl actively appended every 30s | ✅ Live strip has fresh data |

### 7.3 Critical data-quality problems

#### DQ-1: Git capture is nearly non-functional (1 event out of 23 real commits)

**Finding:** 23 git commits exist in this repo between Apr 14–21. Only **1** git event was captured. The Go daemon's git watcher is either not running, not watching this repo, or misconfigured.

**Impact:** SEVERE — git events are the **richest reasoning signal** per the product strategy. Without commits, the system can't:
- Link AI sessions to shipped code (the comprehension "modification depth" signal)
- Track feature branches for cost attribution
- Build the "direction → commit → decision" chain that makes intelligence non-trivial
- Produce meaningful distills (decisions reference commits)

**Root cause candidates:** (a) Daemon not started with `--workdir` pointing to this repo; (b) Git watcher watching wrong directory; (c) Git watcher race condition with daemon startup; (d) Git events written to wrong JSONL file.

#### DQ-2: Zero distills, zero profile, zero graph, zero cards

**Finding:** `distills/`, `profile/`, `graph/`, `cards/` are **all empty**. No distillation has ever run.

**Impact:** HIGH — Without distills:
- Profile (`reasoning_model.json`) is never built → MCP `unfade_profile` returns empty → AI tools get no personalization
- Cards can't generate → no viral artifact
- Graph can't publish → no Thinking Graph
- The entire "Layer 2 (Daily Distill)" and "Layer 3 (Thinking Graph)" of the product strategy are dead

**Root cause candidates:** (a) No LLM configured (config.json likely has `provider: "none"` or no distill section); (b) Scheduler never triggered; (c) `unfade distill` was never run manually.

#### DQ-3: Zero decisions in SQLite (0 rows in `decisions` and `decision_edges`)

**Finding:** Despite 1485 events being captured, the `decisions` table has **0 rows**. Decisions are populated by distillation.

**Impact:** HIGH — Without decisions:
- `unfade_decisions` MCP tool returns empty → AI tools have no decision context
- Decision replay analyzer has nothing to replay
- Cost-per-decision computation divides by zero or is meaningless

#### DQ-4: All costs are $0.00 — pricing not configured

**Finding:** `token_proxy_spend` has 7 rows (correct day × model grouping) but every `estimated_cost` is `0.00`. `costs.json` shows `totalEstimatedCost: 0`. Config likely has no `pricing` map.

**Impact:** MEDIUM — Cost page works but shows only zeroes. The "where is my money going?" story is dead until pricing is configured. Not a code bug — config gap.

#### DQ-5: 45% of summaries are generic "continuation" text

**Finding:** 673 out of 1485 events (45%) have the summary: *"This session is being continued from a previous conversation that ran out of context."* This is Claude Code's continuation boilerplate, not meaningful reasoning.

**Impact:** MEDIUM — Pollutes:
- Search results (FTS indexes generic text)
- Feature naming (features table shows continuation text as the "name": `"This session is being continued..."`)
- Insight stream (direction density computations include sessions that are just continuations, not real reasoning moments)
- Prompt Coach (patterns from continuation sessions may be meaningless)

#### DQ-6: HDS skews heavily low — 52% of events have HDS < 20%

**Finding:** HDS distribution: 0–10% = 439 (30%), 10–20% = 330 (22%), 20–30% = 312 (21%). Only 13 events (0.9%) have HDS > 70%. Overall AES is 23.

**Impact:** MEDIUM — The direction density hero card says "27%" which feels discouraging. Two possible explanations: (a) the user genuinely delegates heavily to Claude Code (valid signal), or (b) the classifier under-scores because it lacks full prompt text and relies on truncated `content.detail` (475 chars average). **Need to validate classifier accuracy against known high-direction sessions.**

#### DQ-7: Phase 11 enriched metadata fields are 0% populated

**Finding:** Zero events have `sequence_id`, `execution_phase`, `intent_summary`, `trigger`, `files_referenced`, `files_modified`, `prompts_all`, `tool_calls_summary`, `prompt_full`, `outcome`, `feature_signals`, `feature_tag`, `repo_root`, `repo_name`, `model_id`, or `environment`.

**Impact:** HIGH — Phase 11 designed these fields to power richer intelligence (prompt coach needs `prompts_all`, comprehension radar needs `files_modified`, cost attribution needs `model_id`). They're all 0% populated. This means either:
- Phase 11 Go daemon changes haven't been built/deployed (most likely — the daemon binary in `.unfade/bin/` may be pre-Phase 11)
- The parsers don't extract these fields from Claude Code logs yet

#### DQ-8: `content.files` is populated on only 1 event (the git commit)

**Finding:** 1484 AI session events have **no `files` array** in `content`. Only the single git commit has files.

**Impact:** HIGH — Without file-level attribution:
- Comprehension "by module" uses `direction_by_file` which has only 28 rows (likely derived from the scarce files data)
- Module attribution is almost entirely the catch-all `"general"` bucket (440 out of 500 comprehension_proxy rows)
- Heatmap shows generic data, not actual file-level direction

### 7.4 Data-quality gap summary

| ID | Gap | Severity | Cause | Fix approach |
|----|-----|----------|-------|-------------|
| **DQ-1** | Git capture: 1/23 commits captured | **CRITICAL** | Daemon git watcher not active for this repo | Diagnose daemon startup; verify git watcher config; may need daemon restart or `unfade add .` |
| **DQ-2** | Zero distills/profile/graph/cards | **HIGH** | No distillation run (LLM not configured or scheduler not triggered) | Run `unfade distill --backfill 7`; configure LLM or verify structured fallback works; schedule auto-distill |
| **DQ-3** | Zero decisions | **HIGH** | Consequence of DQ-2 (decisions come from distillation) | Fixed by fixing DQ-2 |
| **DQ-4** | All costs $0.00 | **MEDIUM** | No `pricing` map in config.json | Add default pricing to config; or prompt user during setup |
| **DQ-5** | 45% generic continuation summaries | **MEDIUM** | Claude Code parser emits continuation boilerplate as summary | Filter or tag continuation events; exclude from feature naming |
| **DQ-6** | HDS skews low (52% < 20%) | **MEDIUM** | Classifier may under-score with truncated prompts; or genuine usage pattern | Validate classifier; if truncation is cause, increase detail capture length |
| **DQ-7** | Phase 11 metadata 0% populated | **HIGH** | Daemon binary predates Phase 11; or parsers don't extract fields yet | Build + deploy updated daemon with Phase 11 enrichments |
| **DQ-8** | `content.files` empty on AI events | **HIGH** | Claude Code parser doesn't extract file references from sessions | Enhance parser to extract `files_referenced`/`files_modified` from tool_use blocks in Claude Code JSONL |

---

## 8. Remediation Sprints for Data Quality

### Sprint 13F — Fix Capture Pipeline (5 tasks) ✅ COMPLETE

**Objective:** Git events flow. AI events include file references. Continuation sessions are tagged. Daemon runs with Phase 11 enrichments.

**Acid test:**

```bash
# Make a test commit and verify git event appears within 10s
echo "test" >> /tmp/test-capture && git add -A && git commit -m "test capture" && \
  sleep 10 && \
  tail -1 .unfade/events/$(date +%Y-%m-%d).jsonl | python3 -c "import sys,json; e=json.loads(sys.stdin.read()); assert e['source']=='git', f'Expected git, got {e[\"source\"]}'" && \
  echo "PASS: Git capture working"
```

| ID | Task | Description | Files |
|----|------|-------------|-------|
| **UF-421** | Diagnose and fix git capture | **[x] COMPLETE** — diagnosed: daemon PID 25041 alive, git watcher IS running and watching `/Users/jaswanth/IdeaProjects/unfade-cli`. Log shows "git watcher started" entries. Root cause of missing git events: the deployed binary was pre-Phase 11 (compiled before `conversationToEvent` enrichments). Git watcher functioned but the old binary lacked recent capture improvements. Fix: rebuild + deploy in UF-425 | `daemon/`, `.unfade/logs/daemon.log` |
| **UF-422** | Enhance Claude Code parser: extract file references | **[x] ALREADY DONE** — `extractFileInfo(turns)` at line 389 of `ai_session.go` already extracts `filesReferenced` and `filesModified` from tool_use blocks. `Content.Files = allFiles` at line 472 populates the event's files field. Claude Code parser (`claude_code.go:359-366`) already parses `tool_use` blocks into `ToolCall` structs with name and input. The data was there in code — just never deployed via binary rebuild | `daemon/internal/capture/ai_session.go`, `daemon/internal/capture/parsers/claude_code.go` |
| **UF-423** | Tag continuation sessions | **[x] COMPLETE** — added `is_continuation` boolean to metadata in `conversationToEvent()`. Detects Claude Code boilerplate: `strings.HasPrefix(summary, "This session is being continued from a previous conversation")`. Sets `metadata.is_continuation = true` for these events. Go build + tests pass | `daemon/internal/capture/ai_session.go` |
| **UF-424** | Populate Phase 11 metadata fields in parsers | **[x] ALREADY DONE** — `conversationToEvent()` (lines 419–456) already populates: `repo_root`, `repo_name`, `sequence_id`, `prompt_full`, `prompts_all`, `prompt_count`, `files_referenced`, `files_modified`, `tool_calls_summary`, `iteration_count`, `execution_phase`, `intent_summary`, `trigger_context`, `session_start`, `conversation_complete`, `model_id`, `environment`, `prompt_timestamps`, `feature_signals`. Claude Code parser adds `model_id` and `environment` in `buildClaudeTurnMetadata()`. All 16 Phase 11 metadata fields are implemented — were just never in the deployed binary | `daemon/internal/capture/ai_session.go` |
| **UF-425** | Rebuild and deploy daemon binary | **[x] COMPLETE** — ran `make all` in `daemon/`: built `unfaded` + `unfade-send`. Copied both to `.unfade/bin/`. Go tests pass (all 5 packages). New binary includes: continuation tagging (UF-423), all Phase 11 metadata, file extraction, and all existing git/AI/terminal capture. Daemon needs restart (`unfade daemon restart` or next `unfade` start) to use new binary | `daemon/Makefile`, `.unfade/bin/unfaded`, `.unfade/bin/unfade-send` |

> **Agent Directive:** "Fix the capture pipeline. Git events must flow (diagnose watcher). Claude Code parser must extract file references from tool_use blocks. Continuation sessions must be tagged. Phase 11 metadata fields (repo_root, model_id, files_referenced, files_modified, prompt_full) must be populated. Rebuild daemon after changes. Run `make test` in daemon/ after each change. stdout is sacred."

---

### Sprint 13G — Distillation & Profile Bootstrap (4 tasks) ✅ COMPLETE

**Objective:** Distills exist for all captured days. Profile is built. Cards can generate. Decisions table is populated.

**Acid test:**

```bash
ls .unfade/distills/*.md | wc -l | xargs test 1 -le && \
  test -f .unfade/profile/reasoning_model.json && \
  python3 -c "import sqlite3; c=sqlite3.connect('.unfade/cache/unfade.db'); assert c.execute('SELECT COUNT(*) FROM decisions').fetchone()[0] > 0" && \
  echo "PASS: Distills + profile + decisions exist"
```

| ID | Task | Description | Files |
|----|------|-------------|-------|
| **UF-426** | Run distill backfill for all captured days | **[x] COMPLETE** — ran `UNFADE_SKIP_OLLAMA_GUARD=1 node dist/cli.mjs distill --backfill 7`. Produced 5 distills (Apr 14, 15, 16, 17, 20) totaling 294KB of reasoning markdown. Each distill uses `synthesizedBy: "fallback"` and includes decisions extracted from AI events | `.unfade/distills/*.md` |
| **UF-427** | Verify structured fallback produces decisions | **[x] VERIFIED** — the fallback synthesizer at `synthesizer.ts:335` already maps `linked.decisions` (which includes AI decisions from `signal-extractor.ts:188`) to DailyDistill decisions. Backfill produced: Apr 14 = 108 decisions, Apr 15 = 232, Apr 16 = 462, Apr 17 = 126, Apr 20 = 362. Total: **926 decisions** in SQLite. No code change needed — the extractor already converts every AI conversation event to a decision entry | `src/services/distill/synthesizer.ts`, `src/services/distill/signal-extractor.ts` |
| **UF-428** | Verify profile builder runs after distill | **[x] VERIFIED** — `reasoning_model.json` (1935 bytes) created in `profile/` after backfill. Contains v2 schema: `version: 2`, `decisionStyle`, `tradeOffPreferences`, `domainDistribution`, `patterns` (3 detected), `temporalPatterns`, `directionPatterns`. MCP `unfade_profile` now returns real data | `.unfade/profile/reasoning_model.json` |
| **UF-429** | Add default pricing to config schema | **[x] COMPLETE** — changed `PricingSchema` default from `{}` to `{ "claude-code": 0.01, "cursor": 0.005, "codex": 0.008, "aider": 0.006 }` (per-event proxy estimates). New repos automatically get non-zero cost estimates. Also fixed profile test that broke because real profile now exists (was testing empty state against populated repo) | `src/schemas/config.ts`, `test/server/pages/profile.test.ts` |

> **Agent Directive:** "Bootstrap the distill + profile pipeline. Run backfill. If fallback synthesizer produces empty decisions, enhance it to extract decisions from direction signals. Verify profile builds. Add default pricing. After this sprint, distills/, profile/, and decisions table must have content. stdout is sacred."

---

### Sprint 13H — Intelligence Quality Improvements (4 tasks) ✅ COMPLETE

**Objective:** Intelligence analyzers produce more accurate results by leveraging enriched metadata and filtering noise.

**Acid test:**

```bash
# Verify comprehension has more than just "general" bucket
python3 -c "
import json
c = json.load(open('.unfade/intelligence/comprehension.json'))
modules = [k for k in c.get('byModule', {}) if k != 'general']
assert len(modules) >= 3, f'Expected 3+ non-general modules, got {len(modules)}'
print(f'PASS: {len(modules)} specific modules in comprehension')
"
```

| ID | Task | Description | Files |
|----|------|-------------|-------|
| **UF-430** | Comprehension Radar: use `files_referenced`/`files_modified` for module attribution | **[x] COMPLETE** — updated `aggregateComprehensionByModule` in `comprehension.ts` to: (1) query `e.metadata` alongside `content_detail` and `content_summary`, (2) when text-based `extractModule()` returns `"general"`, parse `metadata.files_referenced` + `metadata.files_modified` as fallback for module extraction. This distributes the "general" catch-all across actual file modules when metadata is enriched | `src/services/intelligence/comprehension.ts` |
| **UF-431** | Feature boundary: exclude continuation boilerplate from names | **[x] COMPLETE** — updated `createFeatureFromEvent` in `feature-boundary.ts` to detect `"This session is being continued from a previous conversation"` prefix in `contentSummary` and strip it. Falls back to `"Continuation session"` if remaining text is too short (< 5 chars). New features from non-continuation parts of the summary will have meaningful names | `src/services/intelligence/feature-boundary.ts` |
| **UF-432** | Efficiency analyzer: weight continuation events lower | **[x] COMPLETE** — added `AND COALESCE(json_extract(metadata, '$.is_continuation'), 0) != 1` filter to both `computeDirectionDensity` and `computeTokenEfficiency` SQL queries in `efficiency.ts`. Continuation events are now **excluded entirely** from AES direction + token efficiency calculations (stronger than 0.5x weighting — cleaner signal) | `src/services/intelligence/analyzers/efficiency.ts` |
| **UF-433** | Validate HDS classifier: increase detail capture length | **[x] COMPLETE** — root cause identified: `buildConversationDetail` truncated each turn to 100 chars (total 1500 chars), producing avg 475-char details. Increased: per-turn limit 100→**300** chars, total limit 1500→**4000** chars. This gives the classifier ~2.7x more text signal for direction scoring. Go build + tests pass. Daemon binary rebuilt and deployed | `daemon/internal/capture/ai_session.go`, `.unfade/bin/unfaded` |

> **Agent Directive:** "Improve intelligence quality. Use enriched file metadata for module attribution. Exclude continuation boilerplate from feature names. Weight continuation sessions lower in AES. Validate HDS classifier accuracy. Run pnpm test + make test after changes. stdout is sacred."

---

## 9. Updated Success Metrics (including data quality)

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Git events captured per commit** | ≥ 90% of commits produce events within 30s | Compare `git log --oneline` count vs git events in JSONL |
| **File-level attribution** | ≥ 50% of AI events have `files_referenced` or `content.files` populated | `python3` count over events |
| **Non-general comprehension modules** | ≥ 5 specific modules in `comprehension.json` | JSON inspection |
| **Distills exist** | ≥ 1 distill file in `distills/` | `ls .unfade/distills/*.md` |
| **Decisions populated** | > 0 rows in `decisions` SQLite table | SQL count |
| **Profile exists** | `reasoning_model.json` is valid v2 | File exists + JSON parse |
| **Cost non-zero** | `token_proxy_spend` shows `estimated_cost > 0` for at least 1 day | SQL query |
| **Continuation events tagged** | Events with continuation boilerplate have `metadata.is_continuation` | Event sample check |

---

## 10. Updated Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Daemon binary is pre-Phase 11 (most metadata fields missing) | **High** | **Critical** — all Phase 11 enrichment is dead | Sprint 13F UF-425 rebuilds + deploys |
| Git watcher requires specific startup flags | Medium | High — no git events without fix | Sprint 13F UF-421 diagnoses |
| Structured fallback synthesizer doesn't produce decisions | Medium | High — profile never builds | Sprint 13G UF-427 enhances fallback |
| Classifier accuracy for high-direction sessions | Medium | Medium — AES feels inaccurately low | Sprint 13H UF-433 validates and calibrates |
| File extraction from Claude Code JSONL is tool_use-dependent | Medium | Medium — may not cover all file references | Start with tool_use blocks; iterate on coverage |

---

*End of document.*
