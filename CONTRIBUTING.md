# Contributing to Unfade

Thanks for your interest in contributing! Unfade is a local-first CLI tool — contributions that keep it fast, private, and simple are especially welcome.

## Getting Started

### Prerequisites

- **Node.js** >= 20
- **pnpm** >= 10
- **Go** >= 1.25 (only if working on the capture engine in `daemon/`)

### Setup

```bash
git clone https://github.com/unerr-ai/unfade.git
cd unfade
pnpm install
pnpm build
```

### Running

```bash
pnpm dev          # Watch mode (auto-reload on changes)
pnpm test         # Run all tests
pnpm lint         # Check formatting and lint rules
pnpm typecheck    # TypeScript type checking
```

### Go Capture Engine (optional)

```bash
cd daemon
make all          # Build unfaded + unfade-send
make test         # Run Go tests
```

## Project Structure

```
unfade/
├── src/                    # TypeScript CLI (commands, MCP server, TUI, services)
│   ├── commands/           # CLI command handlers
│   ├── components/         # Ink (React) TUI components
│   ├── schemas/            # Zod schemas (single source of truth for all data contracts)
│   ├── services/           # Business logic (distillation, capture, cards, site generation)
│   ├── tools/              # MCP tool implementations
│   └── entrypoints/        # CLI entry point
├── daemon/                 # Go capture engine (watches git, AI sessions, terminal)
├── test/                   # Tests (mirrors src/ structure)
├── skills/                 # ClawHub skill package
└── .unfade/                # Runtime data directory (created by `unfade`, never committed)
```

**How the pieces connect:** The Go capture engine writes JSONL events to `.unfade/events/`. The TypeScript CLI reads those events for distillation, querying, and MCP serving. The `.unfade/` directory is the communication bus between the two.

## Making Changes

### Before You Start

- Search [existing issues](https://github.com/unerr-ai/unfade/issues) — someone may already be working on it.
- For significant changes, open an issue first to discuss the approach.

### Code Conventions

- **stdout is sacred.** Only MCP JSON-RPC goes to stdout. Use `logger.info()` / `logger.error()` from `src/utils/logger.ts` for all output. Never use `console.log()`.
- **Zod schemas are the source of truth.** All data contracts live in `src/schemas/`. Every schema exports both the Zod schema and the inferred TypeScript type.
- **ESM imports.** All imports must use `.js` extensions. Use `node:` prefix for Node.js built-ins (`node:path`, `node:fs`).
- **Tests mirror source.** `test/<path>/<name>.test.ts` corresponds to `src/<path>/<name>.ts`.

### Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add weekly reasoning summary
fix: handle empty distill gracefully
docs: clarify MCP setup for Windsurf
test: add coverage for backfill edge case
refactor: simplify signal extraction pipeline
chore: update dependencies
```

### Pull Requests

1. Fork and create a branch from `main`.
2. Make your changes with tests.
3. Run the full check suite:
   ```bash
   pnpm lint && pnpm typecheck && pnpm test && pnpm build
   ```
4. Open a PR with a clear description of *what* and *why*.
5. Reference any related issues.

### What Makes a Good PR

- Focused scope — one feature or fix per PR.
- Tests included for new behavior.
- No unrelated changes (formatting, refactoring) mixed in.
- Passes all CI checks.

## Reporting Bugs

Use the [bug report template](https://github.com/unerr-ai/unfade/issues/new?template=bug-report.yml). Include:

- Unfade version (`unfade --version`)
- Operating system
- Steps to reproduce
- Expected vs actual behavior

## Suggesting Features

Use the [feature request template](https://github.com/unerr-ai/unfade/issues/new?template=feature-request.yml). Describe the problem you're trying to solve, not just the solution you want.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold it.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
