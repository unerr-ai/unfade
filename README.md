<p align="center"><strong>Unfade</strong></p>

<p align="center"><strong>See how you actually think with AI</strong> — not only what you shipped, but how you decided.</p>

<p align="center">
  <a href="#why-unfade">Why Unfade</a> &middot;
  <a href="#install">Install</a> &middot;
  <a href="#first-2-minutes">First 2 minutes</a> &middot;
  <a href="#how-it-works">How it works</a> &middot;
  <a href="#mcp-setup">MCP</a> &middot;
  <a href="#commands">Commands</a> &middot;
  <a href="#enterprise">Enterprise</a> &middot;
  <a href="#faq">FAQ</a>
</p>

<p align="center">
  <a href="https://github.com/unerr-ai/unfade/actions/workflows/ci.yml"><img src="https://github.com/unerr-ai/unfade/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://www.npmjs.com/package/unfade"><img src="https://img.shields.io/npm/v/unfade" alt="npm version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-green" alt="Node >= 20" />
</p>

---

## Why Unfade

Most tools optimize **output** (lines, commits, PRs). In the AI era, output is cheap and **reasoning** is the scarce signal: alternatives you rejected, prompts that steered the model, places where you accepted code without full comprehension.

Unfade is a **local-first continuous intelligence layer** over your real workflow:

- **Passive capture** — git, AI sessions (Cursor, Claude Code, Codex, Aider), optional terminal.
- **Living metrics** — direction density, comprehension proxy, token spend shape, and rolling windows update as the local server materializes events (no “wait until tomorrow’s distill” to see today).
- **Cross-tool memory via MCP** — the same evidence-backed context for every MCP client.
- **Privacy you can prove** — JSONL and Markdown on disk; no accounts, no vendor cloud for core data.

**For builders in India and similar markets:** teams often need **DPDPA-style** assurance that sensitive prompts and repos are not exfiltrated. Unfade’s default posture is **data stays on the machine**; leadership-style exports are designed as **aggregates-first** with explicit consent paths (see `unfade export --leadership` and [ENTERPRISE.md](ENTERPRISE.md)).

## Install

```bash
npx unfade@latest
```

## First 2 minutes

```bash
cd your-project
unfade
```

That's it. Unfade initializes the project, starts the capture engine, and opens a live dashboard at **http://localhost:7654**. Your AI interaction patterns appear within seconds. Press **Ctrl+C** to stop; run `unfade` again to resume exactly where you left off.

**Multiple repos?** Run `unfade add ~/other-project` to register more repos — they all appear in the portfolio dashboard.

**Configure LLM?** Visit **http://localhost:7654/settings** or run `unfade init` for the interactive wizard.

## How It Works

```
1. You work normally.
   Commits, AI sessions, terminal — captured in .unfade/events/*.jsonl

2. The materializer + intelligence layer update continuously.
   SQLite cache, summary.json, optional partial metrics — without blocking on LLM distills.

3. End-of-day (or on demand), distillation enriches the story.
   Markdown distills, profile updates, decision graph — same evidence, deeper narrative.

4. Every MCP client gets your context.
   Claude, Cursor, Windsurf, Codex — query decisions, profile, comprehension, similarity, and more.
```

## Architecture

```
Developer's Machine (Everything Local)
+-----------------------------------------------------------------------+
|  Git / AI / Terminal  -->  Capture engine (Go)  -->  events/*.jsonl |
|                              |                                         |
|                              v                                         |
|                    Materializer + summary.json (TS server)            |
|                              |                                         |
|  MCP + Browser        <--  HTTP + MCP (Hono)  +  SQLite cache         |
+-----------------------------------------------------------------------+
```

## MCP Setup

### Claude Code

```bash
claude mcp add unfade -- npx unfade mcp
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "unfade": {
      "command": "npx",
      "args": ["unfade", "mcp"]
    }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "unfade": {
      "command": "npx",
      "args": ["unfade", "mcp"]
    }
  }
}
```

The MCP server exposes **9 tools** (including query, context, decisions, distill, profile, amplify, similar, **comprehension**, and **log**) plus resources and prompts — all backed by your local `.unfade/` tree.

## Commands

| Command | Description |
|---------|-------------|
| `unfade` | CLI entry / TUI |
| `unfade init` | Scaffold project, daemon, optional autostart |
| `unfade open` | Open local web UI |
| `unfade status` | Capture + summary heartbeat (includes first-run insights when available) |
| `unfade doctor` | Path and health diagnostics |
| `unfade query <search>` | Search reasoning history |
| `unfade distill` | Manual distillation |
| `unfade card [--v3]` | Reasoning Card (v3 adds comprehension / cost hints from live summary) |
| `unfade export` | Portable archive; **`--leadership`** for aggregate CSV pack + methodology |
| `unfade publish` | Static Thinking Graph site |
| `unfade daemon …` | Manage capture engine |

Use `--json` for machine-readable output and `--verbose` for debug logs (stderr).

## Features

- **Continuous signals** — `summary.json`, heatmap APIs, token spend proxy, cost-per-quality hints when pricing is configured.
- **Multi-repo** — registry + portfolio routes when multiple projects are registered.
- **Daily distill & profile** — narrative + structured reasoning model.
- **Unfade Cards** — shareable artifacts (v3 ties in live summary metrics).
- **Open source** — inspect, fork, self-host.

## Enterprise

Org features (team dashboards, SAML, optional cloud index, compliance-oriented bundles) are on the **[enterprise roadmap](ENTERPRISE.md)**. The OSS CLI remains the source of truth for capture and evidence.

## FAQ

**What LLM does it use?**  
Ollama by default. Richer distills: configure OpenAI or Anthropic in `.unfade/config.json`. Core **live** metrics use heuristics and SQLite — LLM is enrichment, not a gate.

**Does it send my data anywhere?**  
No for core operation. Exports are explicit; leadership mode prompts before writing aggregates.

**Cost visibility?**  
Optional `pricing` map in config feeds **token spend proxies** and **cost-per-directed-decision** style fields in `summary.json` (estimates from local metadata, not vendor billing APIs).

**How do I contribute?**  
See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
