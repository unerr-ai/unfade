# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Unfade** is an open-source CLI tool that passively captures engineering reasoning from developer workflows (git, AI sessions, terminal), distills it into queryable knowledge, and builds a compounding developer identity profile.

The project is currently in the **pre-code, product strategy phase**. No source code exists yet — only product strategy documents in `docs/product/`.

### Core Value Propositions
- **Passive reasoning capture** from git commits, AI sessions, and terminal activity
- **Cross-tool context injection** via MCP server — makes every AI tool aware of prior reasoning without re-explaining
- **Daily Distill** — auto-generated reasoning summaries (decisions, trade-offs, dead ends)
- **Thinking Graph / Unfade Cards** — visual developer identity based on reasoning patterns, not commit counts
- **Local-first, privacy-first** — all data stays local, plain text, inspectable

### Key Product Documents
- `docs/product/unfade.md` — Full product strategy (problem space, research, architecture, competitive landscape, build sequencing)
- `docs/product/unfade_support.md` — Synthesis of themes, competitive analysis, gaps, and prioritization

### Architecture (Planned)
Three-layer design:
1. **Capture + Substrate** — Passive daemon observing git/terminal/AI sessions, local vector graph, Unfade Hooks API, MCP server for cross-tool context injection
2. **Distillation** — Daily reasoning summaries, pattern extraction, connection surfacing
3. **Identity** — Unfade Cards (shareable artifacts), Thinking Graph (visual reasoning profile), hiring signal

### Strategic Context
- Designed as MCP-native (Model Context Protocol) — protocol-level integration, not per-tool plugins
- Related to but independent from "unerr" (structural codebase intelligence); Unfade focuses on *human reasoning* intelligence
- Primary competitive gap: no existing tool captures reasoning (not notes, not recordings, not metrics) and makes it queryable + shareable
