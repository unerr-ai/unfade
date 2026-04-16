# Phase 2 — Hooks API & MCP Server

> **Feature Statement:** _"When a developer installs Unfade's MCP server, their AI automatically knows what they were working on yesterday. Zero config. The 'telepathic AI' experience — but through the universal MCP protocol, not custom integrations. One install, every MCP-compatible tool gets smarter."_
>
> **Prerequisites:** [Phase 1 — Capture & Distill](./PHASE_1_CAPTURE_AND_DISTILL.md) complete (daemon running, events flowing, distills generating, personalization seed)
>
> **Status:** AWAITING REVIEW
>
> **Inspired by:** unerr-cli's MCP proxy architecture (stdio transport, query router, stdout sacred), Claude Code's MCP server implementation, OpenClaw's skill ecosystem
>
> **Foundation doc:** [Research & Design](./UNFADE_CLI_RESEARCH_AND_DESIGN.md)
>
> **Last updated:** 2026-04-15

---

## Table of Contents

- [1. Business Justification](#1-business-justification)
- [2. The Problem](#2-the-problem)
- [3. Research](#3-research)
- [4. Architecture](#4-architecture)
- [5. Design Principles](#5-design-principles)
- [6. Implementation Plan (Micro-Sprints 2A–2E)](#6-implementation-plan-micro-sprints-2a2e)
- [7. Success Metrics](#7-success-metrics)
- [8. Risk Assessment](#8-risk-assessment)

---

## 1. Business Justification

### 1.1 Why This Phase Exists

Phase 2 transforms Unfade from a standalone CLI into an **infrastructure layer** that makes every AI tool smarter. The MCP server and HTTP API are the ecosystem multipliers — they create daily practical value (AI tools that remember yesterday), build switching cost (every tool depends on Unfade's context), and open the door to the entire agent ecosystem (13,000+ MCP servers, OpenClaw's 354K-star community).

### 1.2 The Principle

> **One MCP server serves every current and future MCP-compatible tool automatically. This is not a collection of plugins — it is protocol-level integration that scales with the ecosystem, not with Unfade's engineering effort.**

### 1.3 Why MCP Ships Here, Not Later

The agent ecosystem is the highest-leverage distribution channel. OpenClaw's community is actively searching for memory solutions. The MCP Registry is how tools discover each other. Shipping MCP early means Unfade rides the agent adoption wave from the start rather than building its own audience in isolation.

---

## 2. The Problem

### Current State (after Phase 1)

Unfade captures events and generates distills — but the reasoning data is locked inside `.unfade/` files. No external tool can access it programmatically. Developers still have to re-explain context to every AI tool.

### After Phase 2

| Concern | State |
|---|---|
| **HTTP API** | Local server on `localhost:7654` with `/context`, `/query`, `/decisions`, `/profile` endpoints |
| **MCP Server** | Full MCP server (Resources + Tools + Prompts) over stdio transport |
| **Context Injection** | Any MCP-compatible agent (Claude Code, Cursor, etc.) auto-discovers Unfade and gets structured reasoning context |
| **Query API** | `GET /unfade/query?q=caching` — search across distills and events |
| **Profile API** | `GET /unfade/profile` — reasoning fingerprint accessible programmatically |
| **Server auto-start** | Server starts automatically with daemon via `unfade init`, always available on `localhost:7654` |
| **Web UI** | HTML pages served by Hono — dashboard, distill viewer, profile, settings — powered by htmx |
| **`unfade mcp` hidden command** | Starts MCP stdio server for IDE integration. Not listed in `--help`. Called by IDE configs: `{ "command": "npx", "args": ["unfade", "mcp"] }` |
| **Connect AI Tools** | Web UI Settings page includes copy-paste MCP config snippets for Claude Code, Cursor, Windsurf |
| **Terminology** | All user-facing strings say "capture engine" not "daemon" (per Zero-Knowledge UX Plan) |

---

## 3. Research

### 3.1 MCP Server Patterns

| Pattern | Claude Code | unerr-cli | Unfade Choice | Rationale |
|---|---|---|---|---|
| **Transport** | Stdio + HTTP | Stdio (PID lock → credentials → DB init → MCP server) | Stdio (primary) + HTTP (secondary) | Stdio for IDE integration, HTTP for web UI (primary visual interface), CLI, and custom scripts |
| **Boot sequence** | — | PID lock → credentials → DB init → MCP server → file watchers | PID check → config load → file access → MCP server | No database. Direct file reads |
| **Resources** | Multiple tool descriptions | — | 5 read-only context resources | Read-heavy server — agents mostly query context |
| **Tools** | 50+ tools (Bash, FileRead, etc.) | 15 tools (11 local, 4 cloud) | 5 executable queries | Focused tool set: query, distill, profile, context, decisions |
| **Prompts** | — | — | 3 reasoning frameworks | Reusable prompts for code review, architecture, debugging |
| **stdout sacred** | Yes | Yes (critical) | Yes (non-negotiable) | MCP JSON-RPC only on stdout. All diagnostics to stderr |
| **Response envelope** | — | Every response has `_meta` + `_context` | Every response has `_meta` | Consistent error handling, degradation status |

### 3.2 HTTP API Patterns

| Pattern | Choice | Rationale |
|---|---|---|
| **Framework** | Hono | Lightweight, fast, TypeScript-first. No Express overhead |
| **Port** | `localhost:7654` | High port, unlikely to conflict. Configurable via `mcp.httpPort` |
| **Auth** | None (localhost only) | Local-only server. No auth needed for v1 |
| **Response format** | JSON with `_meta` envelope | Consistent with MCP tool responses |
| **Web UI** | htmx (~14KB JS) + server-rendered HTML | No JS build step. Hono renders templates. htmx handles interactivity (`hx-get`, `hx-post`, `hx-trigger`) |
| **Consumers** | Web UI (htmx), CLI, custom scripts | HTTP serves three distinct consumer types |

---

## 4. Architecture

### 4.1 MCP Server — Resources, Tools, Prompts

#### Resources (Read-Only Context)

| Resource URI | Description | Returns |
|---|---|---|
| `unfade://context/recent` | Last 2 hours of reasoning events | Structured events with summaries |
| `unfade://context/today` | Today's complete reasoning context | All events + distill (if available) |
| `unfade://profile` | Developer's reasoning profile | Decision style, domains, patterns |
| `unfade://decisions/recent` | Recent decisions with alternatives and trade-offs | Structured decision data |
| `unfade://distill/latest` | Most recent Daily Distill | Full Markdown distill |

#### Tools (Executable Queries)

| Tool Name | Description | Input | Output |
|---|---|---|---|
| `unfade_query` | Semantic search across reasoning history | `{ query: string, dateRange?: { from, to }, limit?: number }` | Matching events and distill excerpts |
| `unfade_distill` | Trigger manual distillation | `{ date?: string }` | Generated distill content |
| `unfade_profile` | Get reasoning profile | `{}` | Full reasoning model |
| `unfade_context` | Get recent reasoning context | `{ scope: 'last_2h' \| 'today' \| 'this_week', project?: string }` | Contextualized event summary |
| `unfade_decisions` | List recent decisions | `{ limit?: number, domain?: string }` | Structured decision list |

#### Prompts (Reasoning Frameworks)

| Prompt Name | Description | Arguments |
|---|---|---|
| `unfade_code_review` | Code review informed by developer's reasoning patterns | `{ diff: string }` |
| `unfade_architecture` | Architecture decision informed by past decisions and trade-off preferences | `{ question: string }` |
| `unfade_debug` | Debugging approach informed by past dead ends and exploration patterns | `{ error: string, context?: string }` |

### 4.2 HTTP API Routes

#### JSON API (for CLI, scripts, programmatic access)

```
GET  /unfade/context?scope=last_2h|today|this_week
GET  /unfade/query?q=<search>&from=<date>&to=<date>&limit=<n>
GET  /unfade/decisions?limit=<n>&domain=<domain>
GET  /unfade/profile
POST /unfade/distill             # Trigger manual distillation
GET  /unfade/distill/latest      # Get most recent distill
GET  /unfade/distill/:date       # Get distill for specific date
GET  /unfade/health              # Server health check
```

#### Web UI Pages (server-rendered HTML + htmx)

```
GET  /                           # Dashboard — activity feed, recent distill, quick stats
GET  /distill                    # Distill viewer — history, full content, re-generate button
GET  /profile                    # Reasoning profile visualization — decision style, domains, patterns
GET  /settings                   # Daemon control, LLM config, capture source toggles
```

Technology: Hono renders HTML templates server-side. htmx (~14KB) handles interactivity — navigation, dynamic updates (re-distill button via `hx-post="/distill"`), search filtering. No JS build step required.

### 4.3 Context Shaper

The context shaper personalizes MCP context delivery based on the developer's reasoning profile:

```typescript
// src/services/personalization/context-shaper.ts
export interface ContextShaper {
  /**
   * Shape context for the developer's information processing style.
   * - High exploration depth → include more alternatives and trade-offs
   * - High AI acceptance → shorter context, focus on recommendations
   * - Domain-specific depth → expand context for deep domains, compress for shallow
   */
  shape(rawContext: CaptureEvent[], profile: ReasoningModel): ShapedContext;
}
```

### 4.4 MCP + HTTP Architecture

The server layer auto-starts with the daemon via `unfade init`. There is no standalone `unfade serve` command — the server is always available when the daemon is running.

```
┌─────────────────────────────────────────────────────────────────┐
│            Unfade Server Layer (auto-starts with daemon)          │
│                                                                  │
│  ┌────────────────────┐    ┌─────────────────────────────────┐  │
│  │  MCP Server        │    │  HTTP Server (Hono)              │  │
│  │  (stdio transport) │    │  (localhost:7654)                 │  │
│  │  via server.json   │    │                                   │  │
│  │                    │    │  JSON API:                        │  │
│  │  Resources:        │    │   GET /unfade/context             │  │
│  │   unfade://context │    │   GET /unfade/query               │  │
│  │   unfade://profile │    │   GET /unfade/decisions           │  │
│  │   unfade://decisions│   │   GET /unfade/profile             │  │
│  │   unfade://distill │    │   POST /unfade/distill            │  │
│  │                    │    │   GET /unfade/health              │  │
│  │  Tools:            │    │                                   │  │
│  │   unfade_query     │    │  Web UI (htmx):                   │  │
│  │   unfade_distill   │    │   GET /          (dashboard)      │  │
│  │   unfade_context   │    │   GET /distill   (distill viewer) │  │
│  │   unfade_profile   │    │   GET /profile   (profile viz)    │  │
│  │   unfade_decisions │    │   GET /settings  (daemon config)  │  │
│  │                    │    │                                   │  │
│  │  Prompts:          │    │                                   │  │
│  │   code_review      │    │                                   │  │
│  │   architecture     │    │                                   │  │
│  │   debug            │    │                                   │  │
│  └────────┬───────────┘    └──────────┬────────────────────────┘  │
│           │                           │                           │
│           └───────────┬───────────────┘                           │
│                       │                                           │
│              ┌────────▼────────┐                                  │
│              │ Context Shaper  │  (personalization-aware)          │
│              └────────┬────────┘                                  │
│                       │                                           │
│              ┌────────▼────────┐                                  │
│              │ .unfade/ files  │  (direct reads, no database)     │
│              │ events/ distills/│                                  │
│              │ profile/ graph/ │                                  │
│              └─────────────────┘                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 4.5 MCP Zod Schemas

```typescript
// src/schemas/mcp.ts
import { z } from 'zod';

export const QueryInputSchema = z.object({
  query: z.string().describe('Search query for reasoning history'),
  dateRange: z.object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  }).optional(),
  limit: z.number().min(1).max(50).default(10),
});

export const ContextInputSchema = z.object({
  scope: z.enum(['last_2h', 'today', 'this_week']).default('today'),
  project: z.string().optional(),
});

export const DecisionsInputSchema = z.object({
  limit: z.number().min(1).max(50).default(10),
  domain: z.string().optional(),
});
```

---

## 5. Design Principles

1. **MCP is the primary integration surface.** Every capability exposed via HTTP is also available via MCP. The MCP server is not an afterthought — it is the primary way agents interact with Unfade.

2. **Stdout is sacred.** In MCP stdio mode, only MCP JSON-RPC goes to stdout. All diagnostics, logs, and errors go to stderr. This is non-negotiable and enforced by the logger.

3. **Read-heavy, not write-heavy.** The MCP server and HTTP API are overwhelmingly read operations. Agents query context; they don't modify Unfade's data. The only write operation is `unfade_distill` (trigger manual distillation).

4. **Context is shaped, not dumped.** The context shaper personalizes responses based on the developer's reasoning profile. High-exploration developers get more alternatives. Domain experts get deeper context in their specialty areas.

5. **No database for v1.** Both servers read directly from `.unfade/` files. JSONL scans are fast enough for local-only, single-user operation. This keeps the architecture simple and the data inspectable.

6. **One server, multiple transports.** The daemon auto-starts both MCP (stdio, configured via `server.json`) and HTTP (port 7654) servers. Same data, same context shaping, multiple access patterns. The web UI is the primary visual interface — htmx-powered HTML pages served alongside the JSON API. HTTP serves three consumers: web UI (htmx), CLI, and custom scripts.

---

## 6. Implementation Plan (Micro-Sprints 2A–2E)

> **Phase 2 Boundary:**
> Phase 2 is TypeScript-only — no Go daemon changes. All data is read from `.unfade/` files written by the Phase 1 daemon.
>
> ```
> TypeScript READS from:  .unfade/events/YYYY-MM-DD.jsonl  (query, context, decisions)
>                          .unfade/distills/YYYY-MM-DD.md   (query, distill serving)
>                          .unfade/graph/decisions.jsonl     (decisions tool)
>                          .unfade/graph/domains.json        (domains resource)
>                          .unfade/profile/reasoning_model.json (profile tool, context shaper)
>                          .unfade/state/daemon.pid          (health check)
>                          .unfade/state/health.json         (server status)
>
> TypeScript WRITES to:   .unfade/state/server.json         (atomic: tmp + rename)
> ```
>
> **Query Engine consistency model:**
> - Single-file consistency: atomic writes (tmp + rename for JSON, O_APPEND for JSONL)
> - Cross-file eventual consistency: seconds of staleness acceptable
> - Every response includes `last_updated` timestamp (file mtime)
> - No read locks — read whatever is on disk

---

### 6.1 Sprint 2A — Shared Read Services & Schemas

**Objective:** Build the query engine and read services that both HTTP and MCP servers consume. All `.unfade/` file reading logic lives here — neither transport implements its own file reading.

**Acid Test:**
```bash
pnpm test -- --grep "query-engine|context-reader|decisions|profile-reader|mcp-schema"
# All tests pass

# In code:
import { queryEvents } from './tools/unfade-query'
queryEvents({ query: 'caching', limit: 10 })  # → matching events from JSONL
import { getRecentContext } from './tools/unfade-context'
getRecentContext({ scope: 'today' })           # → today's events
import { getProfile } from './tools/unfade-profile'
getProfile()                                    # → reasoning model JSON
```

| Task | Description | File | Status |
|---|---|---|---|
| **UF-046** | MCP Zod schemas: input/output schemas for all MCP tools — `QueryInputSchema`, `ContextInputSchema`, `DecisionsInputSchema`, `ProfileOutputSchema`, `ContextOutputSchema`, `DecisionsOutputSchema`, `QueryResultSchema`. Each exports both schema AND inferred type | `src/schemas/mcp.ts` | [x] |
| **UF-052** | Query engine: keyword + date range search over JSONL events and Markdown distills — returns ranked results with relevance scores. Reads daily JSONL files for date range, scans distill Markdown for matching sections. No database — pure file reads | `src/tools/unfade-query.ts` | [x] |
| **UF-053** | Context reader: recent context retrieval with scope filtering (`last_2h`, `today`, `this_week`) and optional project filter. Reads events from appropriate date files, groups by temporal proximity | `src/tools/unfade-context.ts` | [x] |
| **UF-054** | Decisions reader: list recent decisions with domain filter, alternatives count, trade-off summaries. Reads from `graph/decisions.jsonl` | `src/tools/unfade-decisions.ts` | [x] |
| **UF-055** | Profile reader: retrieve full reasoning profile — decision style, domain distribution, patterns with confidence. Reads from `profile/reasoning_model.json` | `src/tools/unfade-profile.ts` | [x] |

**Agent Directive (Sprint 2A):**

> "Build 5 modules. (1) `src/schemas/mcp.ts`: define Zod schemas for all MCP tool inputs and outputs — `QueryInputSchema` (query string, optional dateRange with from/to, limit with default 10), `ContextInputSchema` (scope enum: last_2h/today/this_week, optional project), `DecisionsInputSchema` (limit, optional domain), plus output schemas wrapping response data with `_meta` envelope. Export both schema and inferred type for each. (2) `src/tools/unfade-query.ts`: export `queryEvents(input: QueryInput): QueryResult[]` — read `.unfade/events/YYYY-MM-DD.jsonl` files within date range, keyword-match on event content fields, scan `.unfade/distills/YYYY-MM-DD.md` files for matching sections. Score by keyword frequency + recency. Return ranked results with `last_updated` (most recent file mtime). (3) `src/tools/unfade-context.ts`: export `getRecentContext(input: ContextInput): ContextOutput` — for `last_2h`: read today's events, filter by timestamp. For `today`: read all today's events. For `this_week`: read last 7 days. Include distill if available. (4) `src/tools/unfade-decisions.ts`: export `getDecisions(input: DecisionsInput): DecisionsOutput` — read `graph/decisions.jsonl`, filter by domain if specified, limit results, return with alternatives count. (5) `src/tools/unfade-profile.ts`: export `getProfile(): ProfileOutput` — read `profile/reasoning_model.json`, return full profile. Handle missing file gracefully (return empty profile with `degraded: true` in `_meta`)."

**Strict Contracts:**
- All read functions return data + `_meta` envelope with `last_updated`, `degraded`, `durationMs`
- Missing files return empty results with `degraded: true` — never throw
- Query engine scans only files within the requested date range — no full scan
- All schemas export BOTH `XxxSchema` AND `type Xxx = z.infer<typeof XxxSchema>`

---

### 6.2 Sprint 2B — HTTP Server & JSON API

**Objective:** Hono HTTP server running on `localhost:7654` with all JSON API endpoints, context shaping, and server lifecycle management.

**Acid Test:**
```bash
# Start server (assumes daemon running from Phase 1)
unfade server &

curl http://localhost:7654/unfade/health | jq .
# → { "status": "ok", "version": "0.1.0", "daemon": "running" }

curl http://localhost:7654/unfade/context?scope=today | jq .
# → { "data": { "signals": [...] }, "_meta": { ... } }

curl http://localhost:7654/unfade/query?q=caching | jq .
# → { "data": { "results": [...] }, "_meta": { ... } }

cat .unfade/state/server.json | jq .port
# → 7654
```

| Task | Description | File | Status |
|---|---|---|---|
| **UF-050** | HTTP server setup: Hono on `localhost:7654` (configurable via `server.port`, fallback 7655–7660), CORS for local-only, JSON response format, `_meta` envelope middleware, health check endpoint (`/unfade/health`). Bind to `127.0.0.1` only | `src/server/http.ts` | [x] |
| **UF-051** | REST routes: implement 7 JSON API endpoints — `GET /unfade/context`, `GET /unfade/query`, `GET /unfade/decisions`, `GET /unfade/profile`, `GET /unfade/distill/latest`, `GET /unfade/distill/:date`, `POST /unfade/distill`. All routes call Sprint 2A read services, wrap in `_meta` envelope | `src/server/routes/context.ts`, `src/server/routes/query.ts`, `src/server/routes/decisions.ts`, `src/server/routes/profile.ts`, `src/server/routes/distill.ts` | [x] |
| **UF-047** | Context shaper: personalization-aware context delivery — shape raw events based on reasoning profile (exploration depth, domain distribution, AI acceptance rate). High exploration → more alternatives. Domain expert → deeper context in specialty. Missing profile → no shaping (passthrough) | `src/services/personalization/context-shaper.ts` | [x] |
| **UF-048** | Server auto-start: HTTP server starts automatically during `unfade init` (Phase 1 UF-018 step 7). Write `server.json` atomically on startup with port, PID, startedAt, version, transport URLs. Server lifecycle tied to daemon — starts when daemon starts, stops when daemon stops | `src/services/daemon/server-bootstrap.ts` | [x] |
| **UF-049** | `server.json` for MCP Registry: standard MCP server manifest with name (`unfade`), description, version, capabilities list, installation instructions, repository URL. Written to project root for MCP Registry auto-discovery | `server.json` | [x] |

**Agent Directive (Sprint 2B):**

> "Build 5 modules. (1) `src/server/http.ts`: export `createServer(config: UnfadeConfig): Hono` — create Hono app on `config.server.port` (default 7654). Bind to `127.0.0.1` only. Add middleware: CORS (allow localhost only), `_meta` envelope (wrap all JSON responses with `{ data, _meta: { durationMs, degraded, tool } }`), error handler (return JSON errors, never crash). Try ports 7654–7660 if default is occupied. On start, write `server.json` atomically (tmp + rename) with `{ port, pid, startedAt, version, transport: { http, mcp } }`. (2) `src/server/routes/`: one file per resource — `context.ts` (GET /unfade/context?scope=), `query.ts` (GET /unfade/query?q=), `decisions.ts` (GET /unfade/decisions?limit=&domain=), `profile.ts` (GET /unfade/profile), `distill.ts` (GET+POST /unfade/distill). Each route calls the corresponding Sprint 2A read service. (3) `src/services/personalization/context-shaper.ts`: export `shapeContext(events: CaptureEvent[], profile: ReasoningModel): ShapedContext` — reorder and emphasize events based on profile. Never remove events, only reorder. Handle missing/empty profile gracefully (return events unchanged). (4) `src/services/daemon/server-bootstrap.ts`: export `bootstrapServer()` — called from init flow. Starts HTTP server, writes `server.json`. (5) `server.json`: static MCP Registry manifest at project root."

**Strict Contracts:**
- HTTP server binds to `127.0.0.1` ONLY — never `0.0.0.0`
- All JSON responses wrapped in `{ data, _meta }` envelope — including errors
- `server.json` written atomically (tmp + rename) — never partial JSON
- Context shaper NEVER removes events — only reorders and adds emphasis metadata

**server.json schema (written atomically on startup):**
```json
{
  "port": 7654,
  "pid": 12345,
  "startedAt": "2026-04-15T09:00:00Z",
  "version": "0.1.0",
  "transport": {
    "http": "http://127.0.0.1:7654",
    "mcp": "http://127.0.0.1:7654/mcp"
  }
}
```

---

### 6.3 Sprint 2C — MCP Server & IDE Integration

**Objective:** Full MCP server with 5 Resources, 5 Tools, 3 Prompts over stdio transport. Hidden `unfade mcp` command for IDE integration. Streamable HTTP transport mounted on existing Hono server.

**Acid Test:**
```bash
# Stdio test
echo '{"jsonrpc":"2.0","method":"initialize","params":{"capabilities":{}},"id":1}' | unfade mcp
# → MCP initialize response on stdout (JSON-RPC)

# Tool discovery
echo '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":2}' | unfade mcp
# → Lists all 5 tools

# Resource listing
echo '{"jsonrpc":"2.0","method":"resources/list","params":{},"id":3}' | unfade mcp
# → Lists all 5 resources

# Hidden command check
unfade --help | grep -c "mcp"
# → 0 (not listed in help)
```

| Task | Description | File | Status |
|---|---|---|---|
| **UF-042** | MCP server setup: initialize `@modelcontextprotocol/sdk` Server, register capabilities (resources, tools, prompts), handle lifecycle (connect, disconnect, error). Mount Streamable HTTP transport at `/mcp` on existing Hono server | `src/services/mcp/server.ts` | [x] |
| **UF-043** | MCP Resources: implement 5 read-only resources — `unfade://context/recent`, `unfade://context/today`, `unfade://profile`, `unfade://decisions/recent`, `unfade://distill/latest`. Each calls Sprint 2A read services. NEVER throw — return empty content with status metadata when data unavailable | `src/services/mcp/resources.ts` | [x] |
| **UF-044** | MCP Tools: implement 5 executable tools — `unfade_query`, `unfade_distill`, `unfade_profile`, `unfade_context`, `unfade_decisions`. Zod-validated inputs (Sprint 2A schemas), `_meta` envelope responses. Degradation: daemon offline → `{ error: "daemon_offline" }`, not initialized → `{ status: "not_initialized" }` with setup instructions | `src/services/mcp/tools.ts` | [x] |
| **UF-045** | MCP Prompts: implement 3 reasoning framework prompts — `unfade_code_review` (injects developer patterns + past decisions for relevant files), `unfade_architecture` (injects past architectural decisions + trade-off preferences), `unfade_debug` (injects past dead ends + debugging patterns). Each fetches relevant context from read services | `src/services/mcp/prompts.ts` | [x] |
| **UF-086d** | `unfade mcp` hidden command: starts MCP stdio server for IDE integration. Instantiates MCP server with stdio transport, wires up same handlers as Streamable HTTP transport, exits when stdin closes. Registered with Commander but NOT listed in `--help` output. Called by IDE configs: `{ "command": "npx", "args": ["unfade", "mcp"] }`. _(From Zero-Knowledge UX Plan)_ | `src/commands/mcp.ts` | [x] |

**Agent Directive (Sprint 2C):**

> "Build 5 modules. (1) `src/services/mcp/server.ts`: export `createMcpServer()` — initialize MCP Server from `@modelcontextprotocol/sdk`. Register all resources, tools, and prompts. Export `mountMcpHttp(app: Hono)` to mount Streamable HTTP transport at `/mcp` path on the existing Hono server from Sprint 2B. (2) `src/services/mcp/resources.ts`: implement 5 resource handlers. Each calls the corresponding Sprint 2A read service: `unfade://context/recent` → `getRecentContext({ scope: 'last_2h' })`, `unfade://context/today` → `getRecentContext({ scope: 'today' })`, `unfade://profile` → `getProfile()`, `unfade://decisions/recent` → `getDecisions({ limit: 10 })`, `unfade://distill/latest` → read latest distill file. Resources return text content. NEVER throw errors — return `{ content: '', status: 'unavailable' }` when data missing. (3) `src/services/mcp/tools.ts`: implement 5 tool handlers. Each validates input with Sprint 2A Zod schemas, calls read services, wraps in `_meta` envelope. Degradation: check daemon PID before executing — if daemon offline, return `{ error: 'daemon_offline', setup: 'Run unfade to restart' }`. If not initialized, return `{ status: 'not_initialized', setup: 'Run npx unfade' }`. (4) `src/services/mcp/prompts.ts`: implement 3 prompt handlers. `unfade_code_review`: accept `{ diff }`, fetch context for files in diff, inject developer's decision patterns. `unfade_architecture`: accept `{ question }`, fetch related past decisions, inject trade-off preferences. `unfade_debug`: accept `{ error, context }`, fetch past dead ends and debugging sessions. (5) `src/commands/mcp.ts`: Commander command `.command('mcp')` registered but hidden (`.hideHelp()` or similar). Handler: create MCP server, connect to stdio transport, exit when stdin closes. All logging to stderr."

**Strict Contracts:**
- MCP resources NEVER throw — return empty content with metadata when data unavailable
- MCP tools return `_meta` envelope with degradation status
- `unfade mcp` writes ONLY MCP JSON-RPC to stdout — all diagnostics to stderr
- `unfade mcp` NOT listed in `--help` output — IDE integration only
- Both stdio and Streamable HTTP transports share the same handler code

**MCP degradation contract (non-negotiable):**
- Daemon offline → resources return `{ status: "daemon_offline" }`, tools return `{ error: "daemon_offline" }`
- Not initialized → resources return `{ status: "not_initialized" }` with setup instructions
- No distills yet → resources return fingerprint data only, tools return `{ results: [], note: "..." }`
- Never throw, never error — agents must not crash because Unfade is unavailable

---

### 6.4 Sprint 2D — Web UI Pages (htmx)

**Objective:** Server-rendered HTML pages on the existing Hono server. htmx handles interactivity. No JS build step. Settings page includes "Connect AI Tools" section with copy-paste MCP config snippets.

**Acid Test:**
```bash
# Dashboard
curl -s http://localhost:7654/ | grep -c "<html"
# → 1 (returns complete HTML page)

# Distill viewer with htmx re-generate
curl -s http://localhost:7654/distill | grep -c "hx-post"
# → 1+ (htmx re-generate button present)

# Settings — Connect AI Tools
curl -s http://localhost:7654/settings | grep -c "mcpServers"
# → 1+ (MCP config snippets present)

# htmx dynamic update
curl -s -X POST http://localhost:7654/unfade/distill | grep -c "status"
# → 1+ (returns status for htmx swap)
```

| Task | Description | File | Status |
|---|---|---|---|
| **UF-051a-layout** | Base HTML layout: dark theme CSS (inline `<style>` or minimal file), htmx script tag (~14KB CDN or bundled), nav bar (Dashboard \| Distill \| Profile \| Settings), responsive viewport meta. Export `layout(title: string, content: string): string` template function | `src/server/pages/layout.ts` | [x] |
| **UF-051a-dash** | Dashboard page (`GET /`): status indicator (capturing/paused/error using `USER_TERMS`), today's event count, today's decision count, latest distill summary (truncated), reasoning profile quick stats (domains, alt/decision ratio), link to web UI sections | `src/server/pages/dashboard.ts` | [x] |
| **UF-051a-distill** | Distill viewer page (`GET /distill`): date navigation (prev/next day via query param), full distill Markdown rendered as HTML, re-generate button via `hx-post="/unfade/distill"` with `hx-swap="innerHTML"`, empty state for days with no distill | `src/server/pages/distill.ts` | [x] |
| **UF-051a-profile** | Profile visualization page (`GET /profile`): reasoning profile display — decision style metrics, domain distribution, AI acceptance rate, exploration depth, patterns with confidence scores. Read from `profile/reasoning_model.json` via Sprint 2A profile reader | `src/server/pages/profile.ts` | [x] |
| **UF-051a-settings** | Settings page (`GET /settings`): capture engine status display (using `USER_TERMS`), capture source toggles, LLM provider configuration, shell hook reinstall button, "Pause capture" toggle. **"Connect AI Tools" section** (integrates UF-086e): copy-paste MCP config snippets for Claude Code (`~/.claude/settings.json`), Cursor (`.cursor/mcp.json`), Windsurf, and generic MCP clients. Pre-formatted JSON: `{ "command": "npx", "args": ["unfade", "mcp"] }` | `src/server/pages/settings.ts` | [x] |

**Agent Directive (Sprint 2D):**

> "Build 5 page modules. All pages are server-rendered by Hono — return complete HTML strings. No React, no JSX — use template literals or a lightweight HTML builder. (1) `src/server/pages/layout.ts`: export `layout(title, content)` that returns a complete HTML page. Include: `<meta charset='utf-8'>`, `<meta name='viewport'>`, inline dark theme CSS (dark background #1a1a2e, light text #e0e0e0, accent blue #0099ff, monospace font), htmx `<script>` tag (use `https://unpkg.com/htmx.org@2.0.4`), nav bar with links to `/`, `/distill`, `/profile`, `/settings`. (2) `src/server/pages/dashboard.ts`: handler for `GET /` — call `getRecentContext({ scope: 'today' })` and `getProfile()` from Sprint 2A. Render: status badge (using USER_TERMS), event count, decision count, latest distill preview (first 200 chars), profile quick stats. (3) `src/server/pages/distill.ts`: handler for `GET /distill` — read distill Markdown for requested date (default today), render as HTML. Date navigation with `?date=YYYY-MM-DD` query param and prev/next links. Re-generate button: `<button hx-post='/unfade/distill' hx-swap='innerHTML' hx-target='#distill-status'>Re-generate</button>`. (4) `src/server/pages/profile.ts`: handler for `GET /profile` — read reasoning model via Sprint 2A profile reader, render metrics as styled HTML (stat cards, domain list, pattern descriptions). (5) `src/server/pages/settings.ts`: handler for `GET /settings` — show capture engine health status (USER_TERMS), capture source toggles (read-only for v1), LLM provider display. Add 'Connect AI Tools' section with pre-formatted code blocks: Claude Code JSON config (`~/.claude/settings.json` → mcpServers.unfade), Cursor JSON config (`.cursor/mcp.json`), Windsurf config, generic MCP client config. Each shows `{ 'command': 'npx', 'args': ['unfade', 'mcp'] }`. Register all 5 page routes in the Hono app from Sprint 2B."

**Strict Contracts:**
- All pages return complete HTML via `layout()` wrapper — no partial HTML
- htmx attributes handle dynamic updates — no custom JavaScript beyond htmx
- Dark theme CSS is inline or in a single `<style>` tag — no CSS build step
- "Connect AI Tools" snippets use `npx unfade mcp` as the command
- Pages call Sprint 2A read services — no direct `.unfade/` file reading in page handlers
- All user-facing status text uses `USER_TERMS` constants from Phase 1

---

### 6.5 Sprint 2E — CLI Command & Integration Tests

**Objective:** `unfade query` CLI command for terminal-based search. Integration test proving Claude Code ↔ Unfade MCP end-to-end.

**Acid Test:**
```bash
unfade query "caching"
# → Formatted search results in terminal

unfade query "auth" --from 2026-04-01 --to 2026-04-14 --limit 5
# → Filtered results within date range

unfade query "caching" --json | jq .
# → JSON output for scripting
```

| Task | Description | File | Status |
|---|---|---|---|
| **UF-056** | `unfade query` command: CLI interface for the query engine — `unfade query "caching"` with `--from`, `--to`, `--limit` flags, `--json` for JSON output. Reads `server.json` for HTTP API URL, calls `GET /unfade/query?q=...`. Falls back to direct file reading via query engine if server not running. Format results as colored plain text to stderr (default) or JSON to stdout (`--json`) | `src/commands/query.ts` | [x] |
| **UF-057** | Integration test: Claude Code ↔ Unfade MCP — verify MCP server starts via `unfade mcp`, tool listing returns all 5 tools, resource listing returns all 5 resources, `unfade_context` returns structured data, `unfade_query` returns search results. Test MCP degradation: verify graceful response when daemon offline and when not initialized | `test/integration/mcp.test.ts` | [x] |

**Agent Directive (Sprint 2E):**

> "Build 2 modules. (1) `src/commands/query.ts`: Commander command `unfade query <search>` with options `--from` (date string), `--to` (date string), `--limit` (number, default 10), `--json` (boolean). Implementation: read `.unfade/state/server.json` — if server running, call `GET http://127.0.0.1:{port}/unfade/query?q={search}&from={from}&to={to}&limit={limit}`. If server not running (no server.json or connection refused), fall back to direct query via `queryEvents()` from Sprint 2A. Format: without `--json`, print colored results to stderr (date, source, summary per result). With `--json`, print raw JSON to stdout. (2) `test/integration/mcp.test.ts`: integration test that spawns `unfade mcp` as a child process, sends MCP JSON-RPC messages via stdin, validates responses on stdout. Test: initialize → list tools (expect 5) → list resources (expect 5) → call `unfade_context` tool → call `unfade_query` tool → verify `_meta` envelope present. Test degradation: with no `.unfade/` directory, verify tools return `{ status: 'not_initialized' }` instead of crashing."

**Strict Contracts:**
- `unfade query` with `--json` writes to stdout — without `--json` writes to stderr (stdout sacred)
- HTTP fallback: if server unreachable, use direct file read — never show "server not running" error to user
- Integration test spawns real `unfade mcp` process — no mocking of MCP transport

---

### 6.6 Tests (T-103 → T-147)

| Test | What It Validates | File | Sprint |
|---|---|---|---|
| **T-103** | MCP Zod schemas: QueryInputSchema validates correct input | `test/schemas/mcp.test.ts` | 2A |
| **T-104** | MCP Zod schemas: QueryInputSchema rejects invalid input | `test/schemas/mcp.test.ts` | 2A |
| **T-105** | Query engine: keyword search returns relevant events | `test/tools/unfade-query.test.ts` | 2A |
| **T-106** | Query engine: date range filter works correctly | `test/tools/unfade-query.test.ts` | 2A |
| **T-107** | Query engine: empty query returns recent events | `test/tools/unfade-query.test.ts` | 2A |
| **T-108** | Query engine: limit parameter caps results | `test/tools/unfade-query.test.ts` | 2A |
| **T-109** | Context reader: `last_2h` scope filters by timestamp | `test/tools/unfade-context.test.ts` | 2A |
| **T-110** | Context reader: `today` scope returns all today's events | `test/tools/unfade-context.test.ts` | 2A |
| **T-111** | Decisions reader: domain filter returns matching decisions | `test/tools/unfade-decisions.test.ts` | 2A |
| **T-112** | Profile reader: returns reasoning model from file | `test/tools/unfade-profile.test.ts` | 2A |
| **T-113** | Profile reader: missing file returns empty profile with `degraded: true` | `test/tools/unfade-profile.test.ts` | 2A |
| **T-114** | HTTP server: starts on configured port | `test/server/http.test.ts` | 2B |
| **T-115** | HTTP server: health check returns 200 | `test/server/http.test.ts` | 2B |
| **T-116** | HTTP route: `/unfade/context` returns structured events | `test/server/routes/context.test.ts` | 2B |
| **T-117** | HTTP route: `/unfade/query` returns search results | `test/server/routes/query.test.ts` | 2B |
| **T-118** | HTTP route: `/unfade/profile` returns reasoning profile | `test/server/routes/profile.test.ts` | 2B |
| **T-119** | HTTP route: `/unfade/decisions` returns decision list | `test/server/routes/decisions.test.ts` | 2B |
| **T-120** | HTTP route: `/unfade/distill/latest` returns latest distill | `test/server/routes/distill.test.ts` | 2B |
| **T-121** | HTTP route: `POST /unfade/distill` triggers distillation | `test/server/routes/distill.test.ts` | 2B |
| **T-122** | HTTP route: all JSON responses include `_meta` envelope | `test/server/routes/context.test.ts` | 2B |
| **T-123** | Context shaper: high exploration profile gets more alternatives | `test/services/personalization/context-shaper.test.ts` | 2B |
| **T-124** | Context shaper: domain expert gets deeper context in specialty | `test/services/personalization/context-shaper.test.ts` | 2B |
| **T-125** | Context shaper: handles missing profile gracefully (no shaping) | `test/services/personalization/context-shaper.test.ts` | 2B |
| **T-126** | server.json: written atomically on server startup | `test/server/http.test.ts` | 2B |
| **T-127** | MCP server: initializes and accepts connection on stdio | `test/services/mcp/server.test.ts` | 2C |
| **T-128** | MCP server: lists all 5 resources | `test/services/mcp/server.test.ts` | 2C |
| **T-129** | MCP server: lists all 5 tools | `test/services/mcp/server.test.ts` | 2C |
| **T-130** | MCP resource: `unfade://context/recent` returns recent events | `test/services/mcp/resources.test.ts` | 2C |
| **T-131** | MCP resource: `unfade://profile` returns reasoning profile | `test/services/mcp/resources.test.ts` | 2C |
| **T-132** | MCP resource: `unfade://decisions/recent` returns structured decisions | `test/services/mcp/resources.test.ts` | 2C |
| **T-133** | MCP resource: `unfade://distill/latest` returns latest distill | `test/services/mcp/resources.test.ts` | 2C |
| **T-134** | MCP resource: `unfade://context/today` returns today's full context | `test/services/mcp/resources.test.ts` | 2C |
| **T-135** | MCP tool: `unfade_query` returns matching events for keyword | `test/services/mcp/tools.test.ts` | 2C |
| **T-136** | MCP tool: `unfade_context` returns events for given scope | `test/services/mcp/tools.test.ts` | 2C |
| **T-137** | MCP tool: `unfade_profile` returns reasoning model | `test/services/mcp/tools.test.ts` | 2C |
| **T-138** | MCP tool: `unfade_decisions` returns structured decision list | `test/services/mcp/tools.test.ts` | 2C |
| **T-139** | MCP tool: `unfade_distill` triggers manual distillation | `test/services/mcp/tools.test.ts` | 2C |
| **T-140** | MCP tool: all responses include `_meta` envelope | `test/services/mcp/tools.test.ts` | 2C |
| **T-141** | MCP prompt: `unfade_code_review` includes reasoning context | `test/services/mcp/prompts.test.ts` | 2C |
| **T-142** | MCP prompt: `unfade_architecture` includes past decisions | `test/services/mcp/prompts.test.ts` | 2C |
| **T-143** | MCP prompt: `unfade_debug` includes past dead ends | `test/services/mcp/prompts.test.ts` | 2C |
| **T-144** | `unfade mcp` hidden command: starts MCP stdio server and responds to initialize | `test/commands/mcp.test.ts` | 2C |
| **T-145** | `unfade mcp` not listed in `unfade --help` output | `test/commands/mcp.test.ts` | 2C |
| **T-146** | Web UI: `GET /` returns dashboard HTML page with status and distill summary | `test/server/pages/dashboard.test.ts` | 2D |
| **T-147** | Web UI: `GET /distill` returns distill viewer with `hx-post` re-generate button | `test/server/pages/distill.test.ts` | 2D |
| **T-148** | Web UI: `GET /profile` returns profile visualization HTML page | `test/server/pages/profile.test.ts` | 2D |
| **T-149** | Web UI: `GET /settings` returns settings page with "Connect AI Tools" MCP snippets | `test/server/pages/settings.test.ts` | 2D |
| **T-150** | Web UI: layout includes htmx script tag and dark theme CSS | `test/server/pages/layout.test.ts` | 2D |
| **T-151** | `unfade query`: returns formatted results from HTTP API | `test/commands/query.test.ts` | 2E |
| **T-152** | `unfade query --json`: outputs JSON to stdout | `test/commands/query.test.ts` | 2E |
| **T-153** | `unfade query`: falls back to direct file read when server unavailable | `test/commands/query.test.ts` | 2E |
| **T-154** | Integration: Claude Code discovers Unfade MCP tools | `test/integration/mcp.test.ts` | 2E |
| **T-155** | Integration: MCP degradation returns graceful response when not initialized | `test/integration/mcp.test.ts` | 2E |

---

## 7. Success Metrics

| Metric | Current | Target | How to Measure |
|---|---|---|---|
| **MCP tool response time** | N/A | < 100ms for local queries | Tool `_meta.durationMs` |
| **HTTP API response time** | N/A | < 50ms for cached queries | Response timing |
| **Context relevance** | N/A | Context matches actual recent work (qualitative) | Manual review: ask Claude Code "What was I working on yesterday?" with Unfade MCP connected |
| **MCP tool discovery** | N/A | Claude Code auto-discovers all 5 tools | Connect MCP, verify tool listing |
| **MCP resource availability** | N/A | All 5 resources return data | Curl or MCP client test |
| **Context shaping accuracy** | N/A | Shaped context matches profile expectations (qualitative) | Compare raw vs shaped context for high-exploration profile |
| **HTTP endpoint coverage** | N/A | All 7 JSON API endpoints return valid JSON, all 4 web UI pages return valid HTML | Automated HTTP test suite |
| **Test count** | 102+ (Phase 1) | 155+ tests, all passing | `pnpm test` |

---

## 8. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **MCP protocol evolution** | Low | Medium — SDK handles most changes | Pin MCP SDK version. Transport abstraction insulates from protocol changes. Follow MCP spec updates |
| **Stdout contamination** | Low | Critical — breaks MCP | Logger enforces stderr-only. Integration test verifies no stdout leaks. CI check for console.log |
| **Port conflict on 7654** | Low | Low — configurable | `mcp.httpPort` config option. Error message suggests alternative port |
| **Large event files slow queries** | Medium | Medium — response latency | Query engine reads only relevant date-range files. Add file-level index (date → event count) for fast filtering |
| **Context shaping distorts information** | Low | Medium — misleading context | Conservative shaping: never remove information, only reorder and emphasize. Raw context always available via `--raw` flag |
| **MCP Registry listing delays** | Low | Low — doesn't block functionality | Publish `server.json` early. Manual listing process with MCP Registry team |

---

> **Next phase:** [Phase 3: Cards & Terminal Capture](./PHASE_3_CARDS_AND_TERMINAL.md) — Unfade Card generation, terminal capture source, debugging session detection.
