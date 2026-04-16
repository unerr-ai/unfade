# unfade-memory

> Persistent reasoning memory for AI agents. Your AI tools remember what you were working on yesterday — and how you think.

---

## What it does

Unfade passively captures your engineering reasoning from git commits, AI sessions, and terminal activity. It distills this into queryable knowledge and builds a compounding developer identity profile. When connected via MCP, every AI tool you use gets persistent memory of your prior decisions, trade-offs, and reasoning patterns — without you re-explaining anything.

## Features

- **Reasoning capture** — Invisible background capture from git, AI sessions, and terminal
- **Daily Distill** — Auto-generated reasoning summaries: decisions, trade-offs, dead ends, breakthroughs
- **Reasoning Fingerprint** — Your developer identity built from reasoning patterns, not commit counts
- **Cross-tool context** — Every AI tool gets your recent reasoning via MCP, no copy-paste
- **Personalized search** — Find past decisions weighted by your domain expertise and reasoning style
- **Cross-temporal connections** — Discover how today's decisions relate to past reasoning
- **Thinking Graph** — Visual profile: decision density heatmap, domain distribution, reasoning depth

## Setup

```bash
npx unfade
```

That's it. The capture engine, local server, and shell hooks start automatically. No cloud account, no API keys required for basic use.

### Optional: LLM-powered distillation

For richer reasoning summaries, configure a local LLM:

```bash
# Ollama (recommended, free, local)
ollama pull llama3.2
```

Or set an API key for cloud providers:

```bash
export OPENAI_API_KEY=sk-...
# or
export ANTHROPIC_API_KEY=sk-ant-...
```

## MCP Tools

When connected via MCP, these tools are available to any AI agent:

| Tool | Description |
|---|---|
| `unfade_query` | Search across your reasoning history — distills, events, decisions |
| `unfade_context` | Get recent reasoning context — what you were working on and why |
| `unfade_decisions` | List recent engineering decisions with rationale and trade-offs |
| `unfade_profile` | Get your reasoning profile — decision style, domain expertise, patterns |
| `unfade_distill` | Trigger manual distillation — synthesize today's reasoning into a summary |
| `unfade_similar` | Search past decisions for analogous reasoning |
| `unfade_amplify` | Detect cross-temporal connections between past and current reasoning |

## MCP Configuration

### Claude Code / Claude Desktop

Add to your MCP settings:

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

## Example Usage

**AI agent asks for context before making a suggestion:**
> "Use `unfade_context` to see what the developer was working on recently, then `unfade_profile` to understand their reasoning style before suggesting an approach."

**AI agent checks for prior art before proposing a new solution:**
> "Use `unfade_similar` with the current problem description to find if the developer has solved something analogous before."

**AI agent adapts to the developer's preferences:**
> "Use `unfade_profile` to check domain expertise and trade-off preferences. A developer who favors performance over simplicity should get different suggestions than one who favors simplicity."

## Privacy

All data stays local. Unfade writes to `.unfade/` in your project directory — plain text, inspectable, greppable. Nothing leaves your machine unless you explicitly run `unfade publish` to generate a shareable static site.

## Learn more

- Repository: https://github.com/anthropics/unfade
- Website: https://unfade.dev
