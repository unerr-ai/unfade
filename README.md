<div align="center">

# unfade

**See how you actually think with AI — not just what you shipped, but how you decided.**

[![CI](https://github.com/unerr-ai/unfade/actions/workflows/ci.yml/badge.svg)](https://github.com/unerr-ai/unfade/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/unfade)](https://www.npmjs.com/package/unfade)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node >= 20](https://img.shields.io/badge/node-%3E%3D20-green)

[Why Unfade](#why-unfade) · [Quick Start](#quick-start) · [How It Works](#how-it-works) · [MCP Integration](#mcp-integration) · [Commands](#commands) · [FAQ](#faq)

</div>

---

Most tools measure **output** — lines, commits, PRs. In the AI era, output is cheap. **Reasoning is the scarce signal**: which alternatives you rejected, where you steered the model, what you accepted without full comprehension.

Unfade is a local-first intelligence layer that passively captures your reasoning from git, AI sessions (Claude Code, Cursor, Codex, Aider), and terminal — then makes it queryable, shareable, and available to every tool via MCP.

```
Everything stays on your machine. JSONL and Markdown on disk. No accounts. No cloud.
```

## Why Unfade

- **Passive capture** — zero-config hooks into git and AI sessions. No workflow changes.
- **Living metrics** — direction density, comprehension proxy, token spend, rolling windows. Updates in real-time, not "wait until tomorrow."
- **Cross-tool memory via MCP** — 13 tools that give every MCP client (Claude, Cursor, Windsurf, Codex) evidence-backed context about how you work.
- **Daily distills** — end-of-day reasoning summaries: decisions, trade-offs, dead ends, domain movements.
- **Developer identity** — a reasoning profile that compounds over time. Not commit counts — thinking patterns.
- **Privacy you can prove** — all data is local plain text. Exports are explicit and consent-gated.

## Quick Start

```bash
npx unfade@latest
```

```bash
cd your-project
unfade
```

That's it. Unfade initializes the project, starts the capture engine, and opens a live dashboard at **http://localhost:7654**. Your AI interaction patterns appear within seconds.

Press `Ctrl+C` to stop. Run `unfade` again to resume exactly where you left off.

```bash
# Register additional repos
unfade add ~/other-project

# Configure LLM (Ollama default, or OpenAI/Anthropic for richer distills)
# Visit http://localhost:7654/settings or run:
unfade init
```

## How It Works

```
You work normally
  │
  ├─ Git commits ──────┐
  ├─ AI sessions ──────┤──▶  Capture Engine (Go)  ──▶  ~/.unfade/events/*.jsonl
  └─ Terminal ─────────┘          │
                                  ▼
                        Materializer (TypeScript)
                           │            │
                    SQLite (FTS,     DuckDB (analytics,
                    point lookups)   time-series)
                           │            │
                           ▼            ▼
                    HTTP Dashboard + MCP Server
                    http://localhost:7654
```

**Source of truth:** append-only JSONL event files. Both databases are derived caches — fully rebuildable with `unfade doctor --rebuild-cache`.

## MCP Integration

### Claude Code

```bash
claude mcp add unfade -- npx unfade mcp
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "unfade": { "command": "npx", "args": ["unfade", "mcp"] }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "unfade": { "command": "npx", "args": ["unfade", "mcp"] }
  }
}
```

### Available MCP Tools

| Tool | What it does |
|------|-------------|
| `unfade_query` | Search across reasoning history |
| `unfade_context` | Get recent reasoning context for the current task |
| `unfade_decisions` | List recent engineering decisions with rationale |
| `unfade_profile` | Reasoning profile — decision style, expertise, patterns |
| `unfade_comprehension` | Per-module comprehension scores |
| `unfade_efficiency` | AI Efficiency Score (direction density, modification rate) |
| `unfade_costs` | Estimated AI cost attribution |
| `unfade_coach` | Domain-specific prompt coaching suggestions |
| `unfade_similar` | Find analogous past decisions |
| `unfade_amplify` | Detect cross-temporal reasoning connections |
| `unfade_distill` | Trigger on-demand distillation |
| `unfade_log` | Log a structured reasoning event |
| `unfade_tag` | Tag recent AI conversation events |

## Commands

| Command | Description |
|---------|-------------|
| `unfade` | Start server, dashboard, capture engine |
| `unfade init` | Interactive setup wizard |
| `unfade add <path>` | Register another repo for tracking |
| `unfade status` | Today's reasoning metrics and identity snapshot |
| `unfade query <search>` | Search reasoning history |
| `unfade distill` | Manual distillation (supports `--date`, `--backfill`) |
| `unfade history` | Query event history (`--domain`, `--feature`, `--last`) |
| `unfade card` | Generate a Reasoning Card (`--v3` for live metrics) |
| `unfade savings` | Estimated time/cost savings from MCP context injections |
| `unfade doctor` | Diagnose system health (`--rebuild-cache`, `--verify-pipeline`) |
| `unfade export` | Portable archive (`--leadership` for aggregate CSV pack) |
| `unfade publish` | Generate static Thinking Graph site |
| `unfade ingest` | Ingest historical AI session data |
| `unfade prompt` | Metric badge for shell prompt integration |
| `unfade daemon` | Capture engine management (`status`, `stop`, `restart`) |

All commands support `--json` for machine-readable output and `--verbose` for debug logs.

## Intelligence Dashboard

The web UI at `localhost:7654` provides 9 intelligence views:

| View | What you learn |
|------|---------------|
| **Overview** | AI Efficiency Score, maturity phase, top-line metrics |
| **Comprehension** | Per-module understanding heatmap, blind spots |
| **Velocity** | Dual velocity (human vs AI-assisted), trend analysis |
| **Cost** | Token spend attribution, cost-per-decision estimates |
| **Patterns & Coach** | Recurring reasoning patterns, coaching suggestions |
| **Autonomy** | Independence index, dependency heatmap, skill trajectory |
| **Maturity** | 7-dimension maturity model, phase progression |
| **Git & Expertise** | File ownership, churn analysis, AI-git correlations |
| **Narratives** | Diagnostic summaries, prescriptions, executive view |

## Data Privacy

Unfade's default posture is **data stays on the machine**:

- All capture data lives in `~/.unfade/` as plain-text JSONL and Markdown
- No accounts, no telemetry, no vendor cloud for core operation
- LLM calls (for distills) go only to providers you explicitly configure
- Leadership exports use aggregates-first design with explicit consent
- DPDPA/GDPR-friendly: no sensitive prompt exfiltration by default

## FAQ

**What LLM does it use?**
Ollama by default. Configure OpenAI or Anthropic at `http://localhost:7654/settings` for richer distills. Core live metrics use heuristics and SQL — LLM is enrichment, not a gate.

**Does it send my data anywhere?**
No. Exports are explicit. Leadership mode prompts before writing aggregates.

**How much does it cost to run?**
Zero for core operation. Optional LLM distills use minimal tokens (~5-10 per day with Ollama). Cloud providers cost cents/day at typical usage.

**Can I use it across multiple repos?**
Yes. `unfade add ~/path` registers repos. The dashboard shows cross-project intelligence and per-project drill-downs.

**How do I contribute?**
See [CONTRIBUTING.md](CONTRIBUTING.md).

## Enterprise

Team dashboards, SAML, optional cloud index, and compliance-oriented bundles are on the [enterprise roadmap](ENTERPRISE.md). The open-source CLI remains the source of truth for capture and evidence.

## License

[MIT](LICENSE)
