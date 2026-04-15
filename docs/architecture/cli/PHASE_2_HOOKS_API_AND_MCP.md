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
> **Last updated:** 2026-04-14

---

## Table of Contents

- [1. Business Justification](#1-business-justification)
- [2. The Problem](#2-the-problem)
- [3. Research](#3-research)
- [4. Architecture](#4-architecture)
- [5. Design Principles](#5-design-principles)
- [6. Implementation Plan](#6-implementation-plan)
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

---

## 5b. Execution Guide (Day 2: Memory Layer — MCP + HTTP API + Web UI)

> **Sourced from:** Master Execution Blueprint — consolidated tasks with acid tests, strict contracts, and agent directives for AI-agent-driven execution.

### Acid Test

```
# MCP test: Claude Code auto-discovers Unfade context
claude-code --mcp-config '{"unfade": {"command": "unfade", "args": ["mcp-stdio"]}}'
> "What was I working on yesterday?"
→ Agent returns context from unfade://context/recent

# HTTP test
curl http://localhost:7654/context | jq .
→ Returns recent reasoning signals

# Web UI test
open http://localhost:7654
→ Dashboard renders with today's distill + profile summary

# CLI test
unfade query "caching" | head
→ Returns matching decisions
```

### Strict Contracts

**server.json (written atomically by `unfade server` on startup):**

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

**HTTP API endpoints (all JSON, all GET except where noted):**

```
GET  /context              → { signals: CaptureEvent[], last_updated: ISO-8601 }
GET  /context/for?file=X   → { signals: CaptureEvent[], file: string }
GET  /query?q=X            → { results: Decision[], query: string }
GET  /decisions             → { decisions: Decision[], total: number }
GET  /profile               → ReasoningModel
POST /distill               → { status: "started" | "already_running" }
```

**MCP surface (5 Resources, 5 Tools, 3 Prompts):**

Resources return text content, never throw errors:
```
unfade://context/recent     → Last 2 hours of reasoning signals
unfade://context/for/{file} → All reasoning about a specific file
unfade://profile            → Developer's reasoning profile
unfade://decisions/recent   → Recent decisions with rationale
unfade://domains            → Domain expertise map
```

Tools return JSON:
```
unfade_query(query: string)   → { results: Decision[] }
unfade_amplify()              → { insights: Connection[] }    // Placeholder until Phase 4
unfade_similar(context: str)  → { similar: Decision[] }       // Placeholder until Phase 4
unfade_ask(question: string)  → { answer: string }            // Placeholder until Phase 4
unfade_distill()              → { status: string }
```

**Query Engine consistency model:**
- Single-file consistency: atomic writes (tmp + rename for JSON, O_APPEND for JSONL)
- Cross-file eventual consistency: seconds of staleness is acceptable
- Every response includes `last_updated` timestamp
- No read locks — read whatever is on disk

### Consolidated Tasks (4) with Agent Directives

#### Task 2.1: Query Engine + HTTP API

Build the query engine that reads `.unfade/` files and the Hono HTTP server that exposes it as a JSON API.

**Agent directive:** "Build `src/server/query-engine.ts` — a class that reads from `.unfade/` directories: `getRecentContext(hours: number)` reads events JSONL, `getContextForFile(file: string)` filters events by file path, `queryDecisions(query: string)` does keyword search on decisions.jsonl, `getProfile()` reads reasoning_model.json, `getDecisions()` reads decisions.jsonl, `getDomains()` reads domains.json. Each method returns the data + `last_updated` (file mtime). Build `src/server/http.ts` — Hono server on `config.server.port` (default 7654, fallback 7655–7660). Register routes in `src/server/routes/` — one file per endpoint. Write `server.json` atomically on startup. All routes bind to `config.server.host` (default 127.0.0.1)."

#### Task 2.2: MCP Server

Expose the same query engine data as MCP Resources, Tools, and Prompts via both stdio and Streamable HTTP transports.

**Agent directive:** "Build `src/mcp/resources.ts`, `src/mcp/tools.ts`, `src/mcp/prompts.ts`. Build `src/server/mcp.ts` — MCP server setup using @modelcontextprotocol/sdk. Register all 5 resources, 5 tools, 3 prompts. Resources NEVER throw errors — return empty content with status metadata when data is unavailable. Build `src/commands/mcp-stdio.ts` — a separate CLI entry point (`unfade mcp-stdio`) that instantiates the MCP server with stdio transport, wires up the same handlers, and exits when stdin closes. The Streamable HTTP transport is mounted at `/mcp` on the existing Hono server. Both transports share the same resource/tool/prompt handler code."

**MCP degradation contract (non-negotiable):**
- Daemon offline → resources return `{ status: "daemon_offline" }`, tools return `{ error: "daemon_offline" }`
- Not initialized → resources return `{ status: "not_initialized" }` with setup instructions
- No distills yet → resources return fingerprint data only, tools return `{ results: [], note: "..." }`
- Never throw, never error — agents must not crash because Unfade is unavailable

#### Task 2.3: Web UI (htmx)

Server-rendered HTML pages on the same Hono server. htmx handles interactivity — no JS build step.

**Agent directive:** "Build `src/server/pages/layout.ts` — base HTML template: dark theme CSS (inline or minimal file), htmx script tag (~14KB CDN or bundled), nav bar (Dashboard | Distill | Profile | Settings). Build 4 page handlers in `src/server/pages/`: `dashboard.ts` (GET / — status, today's distill summary, event count), `distill.ts` (GET /distill — distill viewer with date navigation, re-generate button via `hx-post='/distill'`), `profile.ts` (GET /profile — reasoning profile visualization), `settings.ts` (GET /settings — daemon status, capture source toggles, LLM provider config). All pages are server-rendered by Hono — return complete HTML. htmx attributes handle dynamic updates: `hx-get`, `hx-post`, `hx-trigger`, `hx-swap`. No React, no JSX — pure template strings or a lightweight HTML builder."

#### Task 2.4: CLI Commands (`query`, `open`)

Search reasoning history from the terminal and open the web UI in a browser.

**Agent directive:** "Build `src/commands/query.ts` — `unfade query 'search term'`. Reads `server.json` for the HTTP API URL, calls `GET /query?q=...`, formats results as plain text to stdout (pipeable). If server is not running, fall back to direct file reading via the query engine. Build `src/commands/open.ts` — `unfade open`. Reads `server.json` for the port, opens `http://127.0.0.1:{port}` in the default browser using `open` (macOS) or `xdg-open` (Linux)."

## 6. Implementation Plan

### Sprint 4: MCP Server

> **Goal:** Unfade exposed as MCP server. Any MCP-compatible agent discovers and queries reasoning context.

| Task | Description | File | Status |
|---|---|---|---|
| **UF-042** | MCP server setup: initialize `@modelcontextprotocol/sdk` Server with stdio transport, register capabilities (resources, tools, prompts), handle lifecycle (connect, disconnect, error) | `src/services/mcp/server.ts` | [ ] |
| **UF-043** | MCP Resources: implement 5 read-only resources — `unfade://context/recent`, `unfade://context/today`, `unfade://profile`, `unfade://decisions/recent`, `unfade://distill/latest` — each reads from `.unfade/` files | `src/services/mcp/resources.ts` | [ ] |
| **UF-044** | MCP Tools: implement 5 executable tools — `unfade_query`, `unfade_distill`, `unfade_profile`, `unfade_context`, `unfade_decisions` — with Zod-validated inputs and `_meta` envelope responses | `src/services/mcp/tools.ts` | [ ] |
| **UF-045** | MCP Prompts: implement 3 reasoning framework prompts — `unfade_code_review`, `unfade_architecture`, `unfade_debug` — each injects relevant context from reasoning history | `src/services/mcp/prompts.ts` | [ ] |
| **UF-046** | MCP Zod schemas: input/output schemas for all MCP tools — `QueryInputSchema`, `ContextInputSchema`, `DecisionsInputSchema`, and corresponding output schemas | `src/schemas/mcp.ts` | [ ] |
| **UF-047** | Context shaper: personalization-aware context delivery — shape raw events based on reasoning profile (exploration depth, domain distribution, AI acceptance rate) | `src/services/personalization/context-shaper.ts` | [ ] |
| **UF-048** | Server auto-start: MCP and HTTP servers start automatically with daemon via `unfade init`. Server always available on `localhost:7654`. MCP stdio transport configured via `server.json` — agents connect directly | `src/services/daemon/server-bootstrap.ts` | [ ] |
| **UF-049** | `server.json` for MCP Registry: standard MCP server manifest with name, description, capabilities, installation instructions | `server.json` | [ ] |

### Sprint 5: HTTP API

> **Goal:** HTTP API running for custom integrations. Query engine for searching across events and distills.

| Task | Description | File | Status |
|---|---|---|---|
| **UF-050** | HTTP server setup: Hono on `localhost:7654`, CORS for local-only, JSON response format, `_meta` envelope on all responses, health check endpoint. Serves both JSON API and HTML pages (web UI) | `src/server/http.ts` | [ ] |
| **UF-051** | REST routes: implement `/unfade/context`, `/unfade/query`, `/unfade/decisions`, `/unfade/profile`, `/unfade/distill/latest`, `/unfade/distill/:date`, `/unfade/health` | `src/server/routes.ts` | [ ] |
| **UF-051a** | Web UI pages: server-rendered HTML with htmx. Base layout (htmx script, nav, dark theme CSS), dashboard (`GET /`), distill viewer + history + re-generate (`GET /distill`), reasoning profile visualization (`GET /profile`), daemon control + LLM config + capture sources (`GET /settings`) | `src/server/pages/layout.ts`, `src/server/pages/dashboard.ts`, `src/server/pages/distill.ts`, `src/server/pages/profile.ts`, `src/server/pages/settings.ts` | [ ] |
| **UF-052** | Query engine: keyword + date range search over JSONL events and Markdown distills — returns ranked results with relevance scores | `src/tools/unfade-query.ts` | [ ] |
| **UF-053** | Context tool: recent context retrieval with scope filtering (last_2h, today, this_week) and optional project filter | `src/tools/unfade-context.ts` | [ ] |
| **UF-054** | Decisions tool: list recent decisions with domain filter, alternatives count, trade-off summaries | `src/tools/unfade-decisions.ts` | [ ] |
| **UF-055** | Profile tool: retrieve full reasoning profile — decision style, domain distribution, patterns with confidence | `src/tools/unfade-profile.ts` | [ ] |
| **UF-056** | `unfade query` command: CLI interface for the query engine — `unfade query "caching"` with `--from`, `--to`, `--limit` flags | `src/commands/query.ts` | [ ] |
| **UF-057** | Integration test: Claude Code ↔ Unfade MCP — add Unfade to Claude Code MCP config, verify tool discovery and context retrieval | `test/integration/mcp.test.ts` | [ ] |

### Tests

| Test | What It Validates | File |
|---|---|---|
| **T-089** | MCP server: initializes and accepts connection on stdio | `test/services/mcp/server.test.ts` |
| **T-090** | MCP server: lists all 5 resources | `test/services/mcp/server.test.ts` |
| **T-091** | MCP server: lists all 5 tools | `test/services/mcp/server.test.ts` |
| **T-092** | MCP resource: `unfade://context/recent` returns recent events | `test/services/mcp/resources.test.ts` |
| **T-093** | MCP resource: `unfade://profile` returns reasoning profile | `test/services/mcp/resources.test.ts` |
| **T-094** | MCP resource: `unfade://decisions/recent` returns structured decisions | `test/services/mcp/resources.test.ts` |
| **T-095** | MCP resource: `unfade://distill/latest` returns latest distill | `test/services/mcp/resources.test.ts` |
| **T-096** | MCP resource: `unfade://context/today` returns today's full context | `test/services/mcp/resources.test.ts` |
| **T-097** | MCP tool: `unfade_query` returns matching events for keyword | `test/services/mcp/tools.test.ts` |
| **T-098** | MCP tool: `unfade_query` respects date range filter | `test/services/mcp/tools.test.ts` |
| **T-099** | MCP tool: `unfade_context` returns events for given scope | `test/services/mcp/tools.test.ts` |
| **T-100** | MCP tool: `unfade_profile` returns reasoning model | `test/services/mcp/tools.test.ts` |
| **T-101** | MCP tool: `unfade_decisions` returns structured decision list | `test/services/mcp/tools.test.ts` |
| **T-102** | MCP tool: `unfade_distill` triggers manual distillation | `test/services/mcp/tools.test.ts` |
| **T-103** | MCP tool: all responses include `_meta` envelope | `test/services/mcp/tools.test.ts` |
| **T-104** | MCP prompt: `unfade_code_review` includes reasoning context | `test/services/mcp/prompts.test.ts` |
| **T-105** | MCP prompt: `unfade_architecture` includes past decisions | `test/services/mcp/prompts.test.ts` |
| **T-106** | MCP prompt: `unfade_debug` includes past dead ends | `test/services/mcp/prompts.test.ts` |
| **T-107** | MCP Zod schemas: QueryInputSchema validates correct input | `test/schemas/mcp.test.ts` |
| **T-108** | MCP Zod schemas: QueryInputSchema rejects invalid input | `test/schemas/mcp.test.ts` |
| **T-109** | Context shaper: high exploration profile gets more alternatives | `test/services/personalization/context-shaper.test.ts` |
| **T-110** | Context shaper: domain expert gets deeper context in specialty | `test/services/personalization/context-shaper.test.ts` |
| **T-111** | Context shaper: handles missing profile gracefully (no shaping) | `test/services/personalization/context-shaper.test.ts` |
| **T-112** | HTTP server: starts on configured port | `test/services/http/server.test.ts` |
| **T-113** | HTTP server: health check returns 200 | `test/services/http/server.test.ts` |
| **T-114** | HTTP route: `/unfade/context` returns structured events | `test/services/http/routes.test.ts` |
| **T-115** | HTTP route: `/unfade/query` returns search results | `test/services/http/routes.test.ts` |
| **T-116** | HTTP route: `/unfade/profile` returns reasoning profile | `test/services/http/routes.test.ts` |
| **T-117** | HTTP route: `/unfade/decisions` returns decision list | `test/services/http/routes.test.ts` |
| **T-118** | HTTP route: `/unfade/distill/latest` returns latest distill | `test/services/http/routes.test.ts` |
| **T-119** | HTTP route: `POST /unfade/distill` triggers distillation | `test/services/http/routes.test.ts` |
| **T-120** | Query engine: keyword search returns relevant events | `test/tools/unfade-query.test.ts` |
| **T-121** | Query engine: date range filter works correctly | `test/tools/unfade-query.test.ts` |
| **T-122** | Query engine: empty query returns recent events | `test/tools/unfade-query.test.ts` |
| **T-123** | Query engine: limit parameter caps results | `test/tools/unfade-query.test.ts` |
| **T-124** | Integration: Claude Code discovers Unfade MCP tools | `test/integration/mcp.test.ts` |
| **T-125** | Integration: MCP context retrieval returns structured data | `test/integration/mcp.test.ts` |
| **T-126** | Web UI: `GET /` returns dashboard HTML page | `test/server/pages/dashboard.test.ts` |
| **T-127** | Web UI: `GET /distill` returns distill viewer HTML page | `test/server/pages/distill.test.ts` |
| **T-128** | Web UI: `GET /profile` returns profile visualization HTML page | `test/server/pages/profile.test.ts` |
| **T-129** | Web UI: `GET /settings` returns settings HTML page | `test/server/pages/settings.test.ts` |
| **T-130** | Web UI: `hx-post="/distill"` returns HTML fragment for re-distill | `test/server/pages/distill.test.ts` |

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
| **Test count** | 88 (Phase 1) | 130+ tests, all passing | `pnpm test` |

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
