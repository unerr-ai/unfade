<p align="center"><strong>unfade</strong></p>

<p align="center">Your AI tools forget how you think. Unfade remembers.</p>

<p align="center">
  <a href="#install">Install</a> &middot;
  <a href="#how-it-works">How it works</a> &middot;
  <a href="#mcp-setup">MCP Setup</a> &middot;
  <a href="#commands">Commands</a> &middot;
  <a href="#faq">FAQ</a>
</p>

<p align="center">
  <a href="https://github.com/unerr-ai/unfade/actions/workflows/ci.yml"><img src="https://github.com/unerr-ai/unfade/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://www.npmjs.com/package/unfade"><img src="https://img.shields.io/npm/v/unfade" alt="npm version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-green" alt="Node >= 20" />
</p>

---

Unfade passively captures engineering reasoning from your git commits, AI sessions, and terminal activity. It distills them into daily summaries, builds a reasoning profile, and injects context into every AI tool via MCP — so your AI pair programmers remember what you were working on yesterday, and *how you think*.

Everything runs locally. No cloud. No accounts. Plain text you can inspect and grep.

## Install

```bash
npx unfade
```

First run scaffolds `.unfade/`, starts the capture engine, and begins watching. Nothing to configure.

## How It Works

```
1. You code normally.
   Git commits, AI chats, terminal commands — captured invisibly.

2. At end of day, Unfade distills your reasoning.
   Decisions, trade-offs, dead ends, breakthroughs — summarized locally.

3. Tomorrow, your AI tools remember yesterday.
   Claude, Cursor, Windsurf — any MCP client gets your reasoning context.

4. Over time, Unfade builds your reasoning identity.
   The Thinking Graph renders your decision patterns as a visual profile.
```

## Architecture

```
Developer's Machine (Everything Local)
+-----------------------------------------------------------------------+
|                                                                       |
|  Developer Workflow              Unfade System                        |
|  +-----------+                  +-------------------------------+     |
|  | Git       |--fs events----->| Capture Engine (Go, ~12MB)    |     |
|  | AI Tools  |--log tailing--->|   Git watcher, AI session      |     |
|  | Terminal  |--preexec------->|   watcher, terminal receiver   |     |
|  +-----------+                  +------+------------------------+     |
|                                        | writes                       |
|                                        v                              |
|                                 .unfade/ Data Substrate               |
|                                   events/   (JSONL)                   |
|                                   distills/ (Markdown)                |
|                                   profile/  (JSON)                    |
|                                   graph/    (JSONL+JSON)              |
|                                        | reads                        |
|                                        v                              |
|  MCP Consumers                  +-------------------------------+     |
|  +-----------+                  | Unfade Server (TypeScript)    |     |
|  | Cursor    |<--MCP stdio----->|   MCP Server + HTTP API       |     |
|  | Claude    |                  |   7 tools, 5 resources,       |     |
|  | Windsurf  |                  |   3 prompts                   |     |
|  +-----------+                  +-------------------------------+     |
|                                                                       |
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

Once connected, your AI tools gain 7 MCP tools for querying your reasoning history, getting context, reviewing past decisions, and more.

## Commands

| Command | Description |
|---|---|
| `unfade` | TUI dashboard (auto-initializes on first run) |
| `unfade open` | Open web UI in browser |
| `unfade query <search>` | Search reasoning history |
| `unfade distill` | Trigger manual distillation |
| `unfade export` | Export `.unfade/` as portable archive |
| `unfade publish` | Generate Thinking Graph static site |
| `unfade daemon status` | Show capture engine status |
| `unfade daemon stop` | Stop the capture engine |

All commands support `--json` for machine-readable output and `--verbose` for debug output.

## Features

- **Passive capture** — git commits, AI sessions, terminal commands. No manual logging.
- **Daily distill** — locally-generated reasoning summaries: decisions, trade-offs, dead ends.
- **MCP server** — every AI tool gets your reasoning context via stdio or HTTP.
- **Personalization** — learns your decision patterns, domain expertise, reasoning style.
- **Thinking Graph** — static site with decision density heatmap, domain evolution, reasoning profile.
- **Unfade Cards** — shareable OG images of your daily reasoning.
- **Local-first** — all data stays on your machine. Plain text. Inspectable. Greppable.

## FAQ

**What LLM does it use?**
Ollama by default (fully local). No LLM is required — Unfade works without one using structured summaries. Configure OpenAI or Anthropic in `.unfade/config.json` for richer distills.

**Does it send my data anywhere?**
No. Everything runs locally. Events are plain JSONL files on disk. There are no network calls, no telemetry, no accounts.

**How much disk space does it use?**
Roughly 1-5 MB per month depending on activity. Events are compact JSONL, distills are short Markdown.

**Can I delete my data?**
`rm -rf .unfade/` removes everything. There is no cloud sync, no remote backup, nothing to revoke.

**Does it work without git?**
Partially. Git commit capture requires a git repo, but AI session and terminal capture work anywhere.

**How do I contribute?**
See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

[MIT](LICENSE)
