# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-04-16

### Added

- CLI entry point with Commander.js (`unfade`, `unfade init`, `unfade open`, `unfade query`, `unfade distill`, `unfade export`, `unfade publish`, `unfade daemon`)
- Passive capture engine (Go binary) for git commits, AI sessions, and terminal commands
- Daily distillation pipeline with fallback structured summaries (no LLM required)
- MCP server with 7 tools (`unfade_query`, `unfade_context`, `unfade_decisions`, `unfade_profile`, `unfade_distill`, `unfade_similar`, `unfade_amplify`), 5 resources, 3 prompts
- Reasoning profile builder with pattern detection and domain tracking
- Unfade Cards — shareable PNG images of daily reasoning (satori + resvg)
- Thinking Graph — static site generator with decision density heatmap
- TUI dashboard with Ink (React) — status, distill summary, quick actions
- Web UI with Hono HTTP server
- `--json` flag for machine-readable output on `query`, `distill`, `export`
- Config migration infrastructure (v1 to v2)
- ClawHub skill package (`skills/unfade-memory/`)
- MCP Registry manifest (`server.json`)
- E2E integration test covering init, capture, distill, query, card, publish
- Cross-session amplification (connecting related decisions across days)
- Personalized distills with reasoning style analysis

[Unreleased]: https://github.com/unerr-ai/unfade/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/unerr-ai/unfade/releases/tag/v0.1.0
