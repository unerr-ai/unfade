# Manual launch E2E checklist

Run this once before tagging a release (after `pnpm build`). Use a **throwaway clone** or temp directory so hooks and autostart do not touch your main dev machine unless intended.

## Preconditions

- Node ≥ 20, `git`, optional Ollama (or set `UNFADE_SKIP_OLLAMA_GUARD=1` for distill-only checks).
- Built CLI: `pnpm build` → use `node dist/cli.mjs` from repo root, **or** `npx unfade@latest` from npm.

## Journey

1. **Clean project**
   ```bash
   mkdir -p /tmp/unfade-e2e && cd /tmp/unfade-e2e && git init
   ```

2. **Init**
   ```bash
   node /path/to/unfade-cli/dist/cli.mjs init
   ```
   - Expect `.unfade/` created, daemon binary present or download progress, optional shell hooks prompt.

3. **Daemon / capture**
   - Confirm process: `node …/dist/cli.mjs daemon status` (or `unfade daemon status`).
   - Append a test event (optional): touch a file, commit, or rely on AI log parsers if you have fixture logs.

4. **Status / first-run**
   ```bash
   node …/dist/cli.mjs status
   ```
   - Expect paths, capture summary, and when enough **today** events exist, first-run style hints.

5. **Dashboard**
   ```bash
   node …/dist/cli.mjs open
   ```
   - Page loads; `summary.json` drives first paint; SSE may show `insight` after materializer ticks if `insights/recent.jsonl` is being written.

6. **Doctor**
   ```bash
   node …/dist/cli.mjs doctor
   ```
   - Expect rows for data dir, daemon, server, registry where applicable.

7. **Teardown (optional)**
   ```bash
   node …/dist/cli.mjs reset --yes
   ```

## Automated overlap

`test/integration/e2e.test.ts` exercises **init → events → distill → query → card → publish** in a temp git repo with mocked paths (no LLM). CI green + this checklist = launch gate.
