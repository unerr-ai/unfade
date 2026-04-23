# Layer 2: Dual-Database Materializer (DuckDB + SQLite)

Transforms raw JSONL events into queryable analytical and operational stores. DuckDB for time-series analytics and intelligence. SQLite for full-text search and point lookups. Materializer is the single writer to both databases.

---

## 1. Why Dual Databases

### The Problem with SQLite-Only

Every intelligence analyzer does the same thing: pull events from SQLite, extract fields from a JSON blob via `json_extract(metadata, '$.field')`, aggregate by time window, write results back. This fights SQLite's architecture:

| What analyzers need | What SQLite gives | Pain |
|---|---|---|
| Rolling time windows (1h, 8h, 24h, 7d) | Manual `strftime` + `GROUP BY` | Hand-rolled `direction_windows` table with manual pruning |
| Dimensional slicing (by tool, model, domain, project) | `json_extract()` on every query | Full row scan to extract one field from JSON blob |
| Trend detection (linear regression, moving averages) | Nothing — computed in JS | Pull all rows into memory, regress in TypeScript |
| Temporal correlation (AI conversation → commit causality) | Self-join with timestamp comparison | Complex subqueries, slow on large tables |
| Columnar aggregation (AVG of one field across 10K rows) | Row-oriented read of entire row | Reads `content_detail` (KBs) just to get a 4-byte float |

### What DuckDB Adds

DuckDB is an embedded columnar analytical database. Same deployment model as SQLite (single file, no server), but optimized for the exact query patterns Unfade's intelligence layer needs:

| Capability | How it helps Unfade |
|---|---|
| **Columnar storage** | `AVG(human_direction_score)` reads only that column, skips `content_detail` entirely |
| **Native STRUCT types** | `metadata.ai_tool` is a typed column, not `json_extract(metadata, '$.ai_tool')` |
| **`time_bucket()`** | `GROUP BY time_bucket(INTERVAL '1 day', ts)` replaces manual date math |
| **Window functions** | `AVG(hds) OVER (ORDER BY ts ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)` — rolling averages in SQL |
| **`regr_slope()`** | Trend detection directly in SQL — no JS computation |
| **`ASOF JOIN`** | Temporal correlation: "find the AI conversation that preceded this commit" |
| **Batch-optimized inserts** | Columnar format is slow for single-row inserts but fast for batch loads (100-1000 rows) |
| **Parquet export** | `COPY events TO 'events.parquet'` — 10x compression, portable to external tools |

### Why Keep SQLite

| SQLite strength | DuckDB gap |
|---|---|
| **FTS5 full-text search** | DuckDB FTS extension is experimental, less mature |
| **Single-row point lookups** | DuckDB columnar format has higher per-row overhead for `SELECT * WHERE id = ?` |
| **Mature Node.js ecosystem** | `better-sqlite3` is battle-tested; `@duckdb/node-api` is newer |
| **WAL mode concurrent reads** | DuckDB has single-writer, but read concurrency is different model |
| **Low memory footprint** | DuckDB engine is ~30MB vs SQLite ~2MB |

### The Split

```
                    JSONL (source of truth)
                           │
                    ┌──────┴──────┐
                    │ Materializer │  (single writer to both)
                    └──────┬──────┘
                    ┌──────┴──────┐
                    │             │
              ┌─────▼─────┐ ┌────▼────┐
              │  DuckDB   │ │ SQLite  │
              │ (analytics)│ │ (operational)│
              └─────┬─────┘ └────┬────┘
                    │            │
         ┌──────────┤      ┌────┤
         │          │      │    │
    Intelligence  Distill  MCP  FTS Search
    (8 analyzers) pipeline tools  (query tool)
    Window agg.            HTTP API
    Trend detect           Point lookups
    Cost analysis          Event by ID
```

---

## 2. Database Responsibilities

### 2.1 DuckDB — Analytical Store (`~/.unfade/cache/unfade.duckdb`)

**Purpose**: All time-series queries, dimensional aggregations, trend computations, and intelligence analytics.

**Tables** (11 total):

| Table | Purpose | Key columns |
|---|---|---|
| `events` | All captured events with 37 typed metadata columns | `id, project_id, ts TIMESTAMP, source, type, ai_tool, session_id, human_direction_score, ...` |
| `sessions` | Aggregated AI sessions | `id, project_id, start_ts, end_ts, event_count, turn_count, outcome, estimated_cost, domain` |
| `direction_windows` | Rolling window aggregates | `window_size, window_end, project_id, direction_density, event_count, tool_mix` |
| `comprehension_proxy` | Per-event comprehension scores | `event_id, project_id, mod_depth, specificity, rejection, score` |
| `comprehension_by_module` | Per-module aggregated comprehension | `module, project_id, score, event_count` |
| `direction_by_file` | Direction density per file path | `path, project_id, direction_density, event_count` |
| `token_proxy_spend` | Token cost tracking | `date, model, project_id, count, estimated_cost` |
| `metric_snapshots` | Daily metric values | `date, project_id, rdi, dcs, aq, cwi, api_score, decisions_count` |
| `decisions` | Extracted decisions | `id, project_id, date, domain, description, rationale, alternatives_count, hds` |
| `decision_edges` | Decision graph edges | `from_id, to_id, relation, weight, match_type` |
| `event_links` | Temporal chains between events | `from_event, to_event, link_type` |

**Who reads**: Intelligence engine (8 analyzers), distiller, window aggregator, comprehension scorer, token proxy, file direction, session materializer, HTTP API routes for intelligence/decisions/metrics pages.

**Who writes**: Materializer only (batch inserts on tick).

### 2.2 SQLite — Operational Store (`~/.unfade/cache/unfade.db`)

**Purpose**: Full-text search, point lookups, event-by-ID retrieval, MCP tool queries.

**Tables** (5 + 1 virtual):

| Table | Purpose | Key columns |
|---|---|---|
| `events` | Lightweight event index for FTS and point lookups | `id, project_id, ts, source, type, content_summary, content_detail, git_branch, metadata` (JSON blob) |
| `events_fts` | FTS5 virtual table | `content_summary, content_detail` |
| `event_insight_map` | Bidirectional event-to-insight lineage | `event_id, insight_id, analyzer, contribution_weight` |
| `features` | Detected feature boundaries | `id, project_id, name, branch, first_seen, last_seen, status` |
| `event_features` | Event-to-feature associations | `event_id, feature_id` |
| `event_links` | Cross-event links (also in DuckDB) | `from_event, to_event, link_type, metadata` |

**Who reads**: MCP tools (`unfade_query` uses FTS, `unfade_context` uses point lookups), HTTP API for event detail, lineage drillthrough, search endpoints.

**Who writes**: Materializer (single-row upserts), intelligence engine (`event_insight_map` only).

### 2.3 Responsibility Split Rationale

| Query pattern | Database | Why |
|---|---|---|
| "Average HDS over last 7 days by tool" | DuckDB | Columnar scan of one field, `GROUP BY` with `time_bucket` |
| "Search events containing 'auth middleware'" | SQLite | FTS5 full-text index |
| "Get event by ID for lineage drillthrough" | SQLite | Single-row point lookup |
| "Direction density trend over 30 days" | DuckDB | `regr_slope()` window function |
| "Token spend by model this month" | DuckDB | Dimensional aggregation |
| "Recent 20 events for SSE stream" | SQLite | Simple `ORDER BY ts DESC LIMIT 20` |
| "Which AI tool has best direction scores?" | DuckDB | `GROUP BY ai_tool` on typed column (no json_extract) |
| "Cost per directed decision" | DuckDB | Join `events` + `decisions` with window functions |

---

## 3. DuckDB Schema — Typed Columns, No JSON Blobs

The core design change: metadata fields become first-class typed columns. This eliminates `json_extract()` calls in the intelligence layer. All DDL lives in `src/services/cache/duckdb-schema.ts`.

### 3.1 Events Table (37 typed columns)

```sql
CREATE TABLE IF NOT EXISTS events (
    id                      VARCHAR PRIMARY KEY,
    project_id              VARCHAR NOT NULL,
    ts                      TIMESTAMP NOT NULL,
    source                  VARCHAR NOT NULL,
    type                    VARCHAR NOT NULL,
    content_summary         VARCHAR,
    content_detail          VARCHAR,
    content_branch          VARCHAR,
    content_project         VARCHAR,
    content_files           VARCHAR[],
    git_repo                VARCHAR,
    git_branch              VARCHAR,
    git_commit_hash         VARCHAR,
    ai_tool                 VARCHAR,
    session_id              VARCHAR,
    conversation_id         VARCHAR,
    conversation_title      VARCHAR,
    turn_count              INTEGER,
    model_id                VARCHAR,
    environment             VARCHAR,
    prompt_count            INTEGER,
    human_direction_score   FLOAT,
    prompt_specificity      FLOAT,
    modification_after_accept BOOLEAN,
    course_correction       BOOLEAN,
    domain_injection        BOOLEAN,
    alternative_evaluation  BOOLEAN,
    rejection_count         INTEGER,
    execution_phase         VARCHAR,
    outcome                 VARCHAR,
    intent_summary          VARCHAR,
    tokens_in               INTEGER,
    tokens_out              INTEGER,
    estimated_cost          FLOAT,
    files_referenced        VARCHAR[],
    files_modified          VARCHAR[],
    metadata_extra          JSON
);
```

**Why typed columns**: `SELECT AVG(human_direction_score)` reads only 4 bytes per row; the equivalent SQLite query with `json_extract()` reads the entire row and parses JSON. At 10K events: DuckDB scans ~40KB vs SQLite scanning ~50MB.

**`metadata_extra`**: Overflow column for fields not yet promoted to typed columns. New metadata fields from future parsers land here automatically.

### 3.2 Intelligence Output Tables

```sql
-- Sessions (pre-aggregated from events)
CREATE TABLE IF NOT EXISTS sessions (
    id VARCHAR PRIMARY KEY, project_id VARCHAR NOT NULL,
    start_ts TIMESTAMP, end_ts TIMESTAMP, event_count INTEGER,
    turn_count INTEGER, outcome VARCHAR, estimated_cost FLOAT,
    execution_phases VARCHAR[], branch VARCHAR, domain VARCHAR,
    ai_tool VARCHAR, avg_hds FLOAT, feature_id VARCHAR, updated_at TIMESTAMP
);

-- Rolling window aggregates
CREATE TABLE IF NOT EXISTS direction_windows (
    window_size VARCHAR NOT NULL, window_end TIMESTAMP NOT NULL,
    project_id VARCHAR NOT NULL DEFAULT '',
    direction_density FLOAT, event_count INTEGER, tool_mix JSON,
    PRIMARY KEY (window_size, window_end, project_id)
);

-- Per-event comprehension scores
CREATE TABLE IF NOT EXISTS comprehension_proxy (
    event_id VARCHAR PRIMARY KEY, project_id VARCHAR NOT NULL DEFAULT '',
    mod_depth FLOAT, specificity FLOAT, rejection FLOAT, score FLOAT,
    ts TIMESTAMP
);

-- Per-module aggregated comprehension
CREATE TABLE IF NOT EXISTS comprehension_by_module (
    module VARCHAR, project_id VARCHAR NOT NULL DEFAULT '',
    score FLOAT, event_count INTEGER, updated_at TIMESTAMP,
    PRIMARY KEY (module, project_id)
);

-- Direction density per file
CREATE TABLE IF NOT EXISTS direction_by_file (
    path VARCHAR, project_id VARCHAR NOT NULL DEFAULT '',
    direction_density FLOAT, event_count INTEGER,
    PRIMARY KEY (path, project_id)
);

-- Token cost tracking
CREATE TABLE IF NOT EXISTS token_proxy_spend (
    date DATE NOT NULL, model VARCHAR NOT NULL,
    project_id VARCHAR NOT NULL DEFAULT '',
    count INTEGER DEFAULT 0, estimated_cost FLOAT DEFAULT 0,
    PRIMARY KEY (date, model, project_id)
);

-- Daily metric snapshots
CREATE TABLE IF NOT EXISTS metric_snapshots (
    date DATE, project_id VARCHAR NOT NULL DEFAULT '',
    rdi FLOAT, dcs FLOAT, aq FLOAT, cwi FLOAT,
    api_score FLOAT, decisions_count INTEGER, labels JSON,
    PRIMARY KEY (date, project_id)
);

-- Decision graph
CREATE TABLE IF NOT EXISTS decisions (
    id VARCHAR PRIMARY KEY, project_id VARCHAR NOT NULL DEFAULT '',
    date DATE, domain VARCHAR, description VARCHAR, rationale VARCHAR,
    alternatives_count INTEGER, hds FLOAT, direction_class VARCHAR
);

CREATE TABLE IF NOT EXISTS decision_edges (
    from_id VARCHAR NOT NULL, to_id VARCHAR NOT NULL,
    relation VARCHAR, weight FLOAT, match_type VARCHAR,
    PRIMARY KEY (from_id, to_id)
);

CREATE TABLE IF NOT EXISTS event_links (
    from_event VARCHAR NOT NULL, to_event VARCHAR NOT NULL,
    link_type VARCHAR NOT NULL, metadata JSON,
    PRIMARY KEY (from_event, to_event, link_type)
);
```

### 3.3 SQLite Schema (Operational Only)

SQLite keeps only operational tables. All intelligence/analytical tables live in DuckDB.

```sql
CREATE TABLE events (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, ts TEXT,
    source TEXT, type TEXT, content_summary TEXT, content_detail TEXT,
    git_repo TEXT, git_branch TEXT, metadata TEXT  -- JSON blob for backward compat
);
CREATE INDEX idx_events_project ON events(project_id);
CREATE INDEX idx_events_project_ts ON events(project_id, ts);
CREATE INDEX idx_events_ts ON events(ts);
CREATE INDEX idx_events_source ON events(source);

CREATE VIRTUAL TABLE events_fts USING fts5(content_summary, content_detail, tokenize='porter');

CREATE TABLE event_insight_map (
    event_id TEXT NOT NULL, insight_id TEXT NOT NULL, analyzer TEXT NOT NULL,
    contribution_weight REAL, computed_at TEXT,
    PRIMARY KEY (event_id, insight_id)
);

CREATE TABLE features (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
    branch TEXT, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
    event_count INTEGER DEFAULT 0, file_count INTEGER DEFAULT 0,
    session_count INTEGER DEFAULT 0, status TEXT DEFAULT 'active'
);

CREATE TABLE event_features (
    event_id TEXT NOT NULL, feature_id TEXT NOT NULL,
    PRIMARY KEY (event_id, feature_id)
);

CREATE TABLE event_links (
    from_event TEXT NOT NULL, to_event TEXT NOT NULL, link_type TEXT NOT NULL,
    metadata JSON, PRIMARY KEY (from_event, to_event, link_type)
);
```

---

## 4. CacheManager — Dual DB Lifecycle

`CacheManager` (`src/services/cache/manager.ts`) opens, manages, and closes both databases.

### 4.1 DbLike Interface

Both databases are wrapped in `DbLike` — a minimal interface that abstracts synchronous (SQLite) and asynchronous (DuckDB) access:

```typescript
interface DbLike {
  run(sql: string, params?: unknown[]): void;
  exec(sql: string, params?: unknown[]): Array<{columns: string[]; values: unknown[][]}> 
    | Promise<Array<{columns: string[]; values: unknown[][]}>>;
}
```

`run()` is fire-and-forget (DuckDB writes are queued and flushed via `flushDuckDb()`). `exec()` returns results — synchronously for SQLite, as a Promise for DuckDB. All callers `await` the result.

### 4.2 Initialization

```
CacheManager.initialize():
    1. mkdirSync(~/.unfade/cache/)
    2. SQLite: open better-sqlite3 at unfade.db
       → PRAGMA journal_mode = WAL
       → PRAGMA synchronous = NORMAL
       → Create operational tables
    3. DuckDB: DuckDBInstance.create(unfade.duckdb) [async]
       → connect()
       → Create all 11 analytical tables
       → If DuckDB unavailable: analytics = null (graceful degradation)
```

### 4.3 Access Patterns

| Handle | Database | Use for |
|---|---|---|
| `cache.operational` / `cache.getDb()` | SQLite | FTS, point lookups, lineage, feature boundaries |
| `cache.analytics` | DuckDB | Intelligence queries, time-series, aggregations |
| `cache.getDuckDbConnection()` | DuckDB (raw) | Operations needing direct async results |

### 4.4 Shutdown

```
CacheManager.close():
    1. SQLite: WAL checkpoint → close
    2. DuckDB: connection.closeSync() → instance.closeSync()
    3. Null all handles
```

### 4.5 DuckDB Async Bridge

DuckDB's Node API (`@duckdb/node-api`) is fully async. The `DbLike` wrapper bridges this:

- **`run()`**: Fires async operation, pushes Promise to pending queue. `flushDuckDb()` drains the queue.
- **`exec()`**: Returns a Promise. Calls `conn.runAndReadAll()`, extracts column names and row values from the result reader.

---

## 5. Materializer Pipeline

### 5.1 Tick Lifecycle

```
MaterializerDaemon.onTick():
    │
    ├── 1. Check .ingest.lock → skip if present
    │
    ├── 2. Tail JSONL files past cursor byte offset
    │      → Parse each line into CaptureEvent
    │
    ├── 3. Dual write to BOTH databases:
    │      │
    │      ├── SQLite: INSERT OR REPLACE per event + FTS refresh
    │      │
    │      └── DuckDB: INSERT OR REPLACE with typed column extraction
    │                  (37 columns extracted from metadata)
    │
    ├── 4. Materialize decisions (graph/decisions.jsonl → DuckDB)
    │
    ├── 5. Materialize metrics (metrics/daily.jsonl → DuckDB)
    │
    ├── 6. Save cursor to ~/.unfade/state/materializer.json
    │
    └── 7. Trigger intelligence pipeline (if newRows > 0)
           → IntelligenceEngine.run({ analytics: duckdb, operational: sqlite })
```

### 5.2 Typed Column Extraction

When writing to DuckDB, `extractTypedColumns(metadata)` maps 21 metadata fields to typed columns:

```
extractTypedColumns(meta):
    signals = meta.direction_signals ?? {}

    RETURN {
        ai_tool, session_id, conversation_id, conversation_title,
        turn_count, model_id, environment, prompt_count,
        human_direction_score, prompt_specificity,
        modification_after_accept, course_correction,
        domain_injection, alternative_evaluation, rejection_count,
        execution_phase, outcome, intent_summary,
        tokens_in, tokens_out, estimated_cost,
        files_referenced, files_modified,
        metadata_extra: remainingFields(meta, KNOWN_FIELDS)
    }
```

DuckDB writes use `$1`-style parameters with `::TIMESTAMP`/`::DATE` casts for proper type handling.

### 5.3 Rebuild / Repair

```
rebuildAll() — triggered by "unfade doctor --rebuild-cache":
    1. cache.resetDuckDbSchema()  — DROP + CREATE all 11 DuckDB tables
    2. SQLite: DELETE FROM events, events_fts
    3. Replay all ~/.unfade/events/*.jsonl
       → Dual write: SQLite upsert + DuckDB typed column insert
    4. Refresh FTS, reset cursor
```

---

## 6. Intelligence Layer Wiring

### 6.1 AnalyzerContext — Dual DB Handles

Every analyzer receives both databases via `AnalyzerContext`:

```typescript
interface AnalyzerContext {
    analytics: DbLike;    // DuckDB — for all analytical queries
    operational: DbLike;  // SQLite — for FTS, point lookups, lineage writes
    db: DbLike;           // @deprecated alias → analytics
    repoRoot: string;
    config: Record<string, unknown>;
}
```

### 6.2 Query Migration — json_extract Eliminated

All 8 intelligence analyzers, plus window-aggregator, comprehension scorer, token-proxy, file-direction, and session-materializer query DuckDB typed columns directly. 84 `json_extract()` calls were eliminated.

Only 6 `json_extract` calls remain — all correct, querying SQLite operational tables in `outcome-classifier.ts`, `feature-boundary.ts`, `intelligence.ts` route, `tag.ts`, and `history.ts`.

**Before (SQLite)**:
```sql
SELECT AVG(CAST(json_extract(metadata, '$.direction_signals.human_direction_score') AS REAL))
FROM events WHERE ts >= datetime('now', '-24 hours')
```

**After (DuckDB)**:
```sql
SELECT AVG(human_direction_score)
FROM events WHERE ts >= now() - INTERVAL '24 hours'
```

### 6.3 Queries Unlocked by DuckDB

These query patterns are impractical in SQLite but trivial in DuckDB:

**Rolling trend with daily granularity:**
```sql
SELECT time_bucket(INTERVAL '1 day', ts) as day,
       AVG(human_direction_score) as daily_hds
FROM events WHERE ts >= now() - INTERVAL '7 days'
GROUP BY day ORDER BY day
```

**Trend slope (linear regression in SQL):**
```sql
SELECT regr_slope(daily_hds, epoch(day)) as trend_slope
FROM (SELECT time_bucket(INTERVAL '1 day', ts) as day,
             AVG(human_direction_score) as daily_hds
      FROM events WHERE ts >= now() - INTERVAL '30 days' GROUP BY day)
```

**Temporal correlation — AI conversation → commit causality (ASOF JOIN):**
```sql
SELECT c.id, a.conversation_title, age(c.ts, a.ts) as time_gap
FROM events c ASOF JOIN events a ON c.project_id = a.project_id AND c.ts >= a.ts
WHERE c.source = 'git' AND a.source = 'ai-session'
  AND age(c.ts, a.ts) <= INTERVAL '2 hours'
```

**Cross-project comparison:**
```sql
SELECT project_id, COUNT(*) FILTER (WHERE source = 'git') as commits,
       AVG(human_direction_score) as avg_hds, SUM(estimated_cost) as total_cost
FROM events WHERE ts >= now() - INTERVAL '7 days' GROUP BY project_id
```

---

## 7. Upstream & Downstream Dependencies

### Layer 1 — Go Daemon: NO CHANGES

The Go daemon writes JSONL to `~/.unfade/events/`. It does not know about DuckDB or SQLite. Zero changes.

### Layer 3 — Intelligence Engine: Minimal

| Component | Integration |
|---|---|
| `engine.ts` | Receives `AnalyzerContext` with both handles. Checks min data on `analytics`. Writes lineage to `operational` |
| All 8 analyzers | Query `ctx.analytics` (DuckDB). Direct column access, no `json_extract` |
| Lineage (`event_insight_map`) | Written to `ctx.operational` (SQLite) — operational lookup pattern |

### Layer 4 — Distill Pipeline: Minimal

Reads events from DuckDB for richer signal extraction. File-based outputs (distills/*.md, decisions.jsonl) unchanged.

### Layer 5 — Surfaces: Minimal

| Component | Database |
|---|---|
| MCP `unfade_query` (FTS) | SQLite |
| MCP `unfade_tag` | SQLite |
| HTTP intelligence routes | Read from `~/.unfade/intelligence/` files |
| HTTP heatmap routes | DuckDB via `readDirectionByFile`, `readModuleComprehension` |
| HTTP lineage routes | SQLite (`event_insight_map`) |

---

## 8. Key Design Decisions

| Decision | Why |
|---|---|
| **DuckDB for analytics, SQLite for operational** | Each DB used for what it's best at. DuckDB columnar = fast aggregations. SQLite FTS5 = mature text search. No compromise on either |
| **Materializer writes to both** | Single writer. No sync jobs, no eventual consistency. Both DBs always at the same cursor position |
| **Typed columns in DuckDB, JSON blob in SQLite** | DuckDB benefits massively from typed columns (columnar scan). SQLite doesn't benefit as much (row-oriented), so keep JSON blob for backward compat |
| **JSONL remains source of truth** | Both databases are derived caches. `rebuildAll()` replays from JSONL. Schema changes don't require data migration |
| **`metadata_extra` overflow column** | New metadata fields work immediately (land in overflow), then get promoted to typed columns later |
| **Same `DbLike` interface** | Analyzers don't know which DB they're talking to. Swapping backends is transparent |
| **SQLite keeps `event_insight_map`** | Lineage is an operational lookup ("which insights came from this event?"). Point-lookup pattern — SQLite excels here |
| **DuckDB graceful degradation** | If `@duckdb/node-api` is unavailable, `cache.analytics` is null. Intelligence degrades but system runs |
| **Async `exec()` return type** | DuckDB Node API is fully async. `DbLike.exec()` returns `Array | Promise<Array>`. All callers `await` the result |

---

## Appendix: File Map

| File | Purpose |
|---|---|
| `src/services/cache/manager.ts` | CacheManager — dual DB init, `.analytics`/`.operational` handles, shutdown |
| `src/services/cache/duckdb-schema.ts` | DuckDB CREATE TABLE DDL (11 tables), `ALL_DUCKDB_DDL`, `KNOWN_METADATA_FIELDS` |
| `src/services/cache/materializer.ts` | Dual-write materialization, typed column extraction, rebuild |
| `src/services/cache/materializer-daemon.ts` | Tick scheduling, passes both DB handles to intelligence |
| `src/services/intelligence/engine.ts` | Intelligence orchestrator — runs analyzers with `AnalyzerContext` |
| `src/services/intelligence/analyzers/index.ts` | `AnalyzerContext` interface: `analytics` + `operational` + `db` |
| `src/services/intelligence/window-aggregator.ts` | Rolling windows → DuckDB `direction_windows` |
| `src/services/intelligence/comprehension.ts` | Comprehension scoring → DuckDB `comprehension_*` tables |
| `src/services/intelligence/token-proxy.ts` | Token cost → DuckDB `token_proxy_spend` |
| `src/services/intelligence/file-direction.ts` | Direction per file → DuckDB `direction_by_file` |
| `src/services/intelligence/session-materializer.ts` | Session aggregation → DuckDB `sessions` |
| `src/services/intelligence/lineage.ts` | Event↔insight lineage → SQLite `event_insight_map` |
| `src/services/intelligence/feature-boundary.ts` | Feature boundaries → SQLite `features`, `event_features` |
| `src/services/intelligence/analyzers/efficiency.ts` | AES composite metric — queries DuckDB typed columns |
| `src/services/mcp/tools.ts` | MCP tools — `unfade_query` uses SQLite FTS |
| `src/server/routes/heatmap.ts` | Heatmap API — reads DuckDB analytics |
| `src/server/routes/intelligence.ts` | Intelligence API — reads files + SQLite lineage |

---

## Appendix: Query Comparison Cheatsheet

| Operation | SQLite (old) | DuckDB (current) |
|---|---|---|
| Average HDS last 24h | `AVG(CAST(json_extract(metadata, '$.direction_signals.human_direction_score') AS REAL)) ... WHERE ts >= datetime('now', '-24 hours')` | `AVG(human_direction_score) ... WHERE ts >= now() - INTERVAL '24 hours'` |
| Tool breakdown | `json_extract(metadata, '$.ai_tool') as tool ... GROUP BY tool` | `ai_tool ... GROUP BY ai_tool` |
| Daily time bucket | `substr(ts, 1, 10) as date ... GROUP BY date` | `time_bucket(INTERVAL '1 day', ts) as date ... GROUP BY date` |
| Trend slope | Pull rows into JS → regress in TypeScript | `regr_slope(value, epoch(ts)) OVER (...)` |
| Session aggregation | `json_extract(metadata, '$.session_id') ... GROUP BY session_id` | `session_id ... GROUP BY session_id` |
| Temporal causality | Complex self-join with timestamp window | `ASOF JOIN events a ON c.ts >= a.ts` |
| Turn count average | `AVG(CAST(json_extract(metadata, '$.turn_count') AS REAL))` | `AVG(turn_count)` |
| Cost by model | `COALESCE(json_extract(metadata, '$.model'), json_extract(metadata, '$.ai_tool'))` | `COALESCE(model_id, ai_tool)` |
