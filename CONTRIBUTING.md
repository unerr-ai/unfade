# Contributing to Unfade

Thanks for your interest in contributing! Unfade is a local-first CLI tool — contributions that keep it fast, private, and simple are especially welcome.

## Getting Started

### Prerequisites

- **Node.js** >= 20
- **pnpm** >= 10 ([installation](https://pnpm.io/installation))
- **Go** >= 1.25 — only if you change the capture engine under `daemon/` (build from source or run Go tests)

### Clone and install

```bash
git clone https://github.com/unerr-ai/unfade.git
cd unfade   # or your clone directory name
pnpm install
```

`pnpm install` links workspace packages (including optional `@unfade/daemon-*` stubs under `packages/`) and refreshes the lockfile.

### Initial build

The published CLI entry is the bundled ESM output:

```bash
pnpm build      # tsdown → dist/cli.mjs (+ chunks)
```

After a successful build you can invoke the CLI without installing from npm:

```bash
pnpm exec node dist/cli.mjs --help
```

### Optional: global CLI via `pnpm link`

To use the `unfade` command from any directory (same mechanism many Node projects document for local package testing):

```bash
# From the repository root, after pnpm install && pnpm build
pnpm link --global
```

Your PATH must include pnpm’s global bin directory. Then run `unfade` / `unfade --help` like a normal install.

To remove the link when you are done:

```bash
pnpm unlink --global unfade
```

**Note:** `pnpm link --global` points your global `unfade` binary at **this checkout**. After `git pull` or local edits, run `pnpm build` again so `dist/` matches your sources. If something still behaves like an old build, see **Restart the local HTTP server** below.

### After you change code (rebuild and refresh)

1. **Rebuild TypeScript output**

   ```bash
   pnpm build
   ```

2. **Restart the local HTTP server (when testing the web UI or API)**  
   A process that already passed `/unfade/health` keeps serving the **code it loaded at startup**. Rebuilding `dist/` does not hot-swap that process.

   From a project that has `.unfade/` (or using the built CLI from the repo):

   ```bash
   unfade server stop
   # or, without a global link:
   pnpm exec node dist/cli.mjs server stop
   ```

   Then start the stack again (for example `unfade`, `unfade open`, or `pnpm exec node dist/cli.mjs`).

3. **Watch mode (TypeScript only)**  
   For rapid iteration on TS/MCP/UI code without running `pnpm build` each time:

   ```bash
   pnpm dev    # tsx watch src/entrypoints/cli.ts
   ```

   Use `pnpm build` before opening a PR so CI matches your final bundle.

### Quality checks

```bash
pnpm test         # Vitest
pnpm lint         # Biome
pnpm typecheck    # TypeScript --noEmit
```

A good pre-push habit:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

### Go capture engine (optional)

If you work on `daemon/`:

```bash
cd daemon
go build -o ../.unfade/bin/unfaded ./cmd/unfaded      # example: write into a dev .unfade/bin
go build -o ../.unfade/bin/unfade-send ./cmd/unfade-send
go test ./...
```

Cross-compiled platform packages (for release layout) use `pnpm run build:daemon` from the repo root; CI runs the same script. A `Makefile` may also exist under `daemon/` — prefer `go test` / `go vet` for consistency with CI.

## Project Structure

```
unfade/
├── src/                    # TypeScript CLI, MCP server, HTTP/web UI, services
│   ├── commands/           # CLI command handlers
│   ├── server/             # Hono app, routes, server-rendered pages
│   ├── schemas/            # Zod schemas (data contracts)
│   ├── services/           # Distillation, capture, cards, init, etc.
│   ├── tools/              # MCP tool implementations
│   └── entrypoints/        # CLI entry (bundled to dist/cli.mjs)
├── packages/               # Workspace: optional @unfade/daemon-* packages
├── daemon/                 # Go capture engine (git, AI sessions, terminal)
├── scripts/                # e.g. daemon cross-compile helper
├── test/                   # Tests (layout mirrors src/ where applicable)
├── skills/                 # ClawHub skill package
├── dist/                   # Build output (gitignored); from pnpm build
└── .unfade/                # Runtime data in a dev project (not in git)
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
