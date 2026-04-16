// Tests for UF-051: GET /unfade/decisions route
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/server/http.js";

let tmpDir: string;
let originalCwd: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../../.tmp-dec-route-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

function writeDistillMd(dir: string, date: string, content: string): void {
  const distillsDir = join(dir, ".unfade", "distills");
  mkdirSync(distillsDir, { recursive: true });
  writeFileSync(join(distillsDir, `${date}.md`), content, "utf-8");
}

const distillWithDecisions = [
  "# Daily Distill — 2026-04-15",
  "",
  "> Built auth and caching",
  "",
  "## Decisions",
  "",
  "- **Added auth module** [backend]",
  "  _Security requirement_",
  "",
  "- **Chose Redis for caching** [infrastructure]",
  "  _Low latency needed_",
].join("\n");

beforeAll(() => {
  originalCwd = process.cwd();
});

afterAll(() => {
  process.chdir(originalCwd);
});

beforeEach(() => {
  tmpDir = makeTmpDir();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe("GET /unfade/decisions", () => {
  it("returns decisions from distill files", async () => {
    writeDistillMd(tmpDir, "2026-04-15", distillWithDecisions);

    const app = createApp();
    const res = await app.request("/unfade/decisions");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.decisions.length).toBe(2);
    expect(body._meta.tool).toBe("unfade-decisions");
  });

  it("filters by domain", async () => {
    writeDistillMd(tmpDir, "2026-04-15", distillWithDecisions);

    const app = createApp();
    const res = await app.request("/unfade/decisions?domain=backend");
    const body = await res.json();
    expect(body.data.decisions.length).toBe(1);
    expect(body.data.decisions[0].decision).toBe("Added auth module");
  });

  it("respects limit parameter", async () => {
    writeDistillMd(tmpDir, "2026-04-15", distillWithDecisions);

    const app = createApp();
    const res = await app.request("/unfade/decisions?limit=1");
    const body = await res.json();
    expect(body.data.decisions.length).toBe(1);
    expect(body.data.total).toBe(2);
  });

  it("returns degraded when no data exists", async () => {
    const app = createApp();
    const res = await app.request("/unfade/decisions");
    const body = await res.json();
    expect(body._meta.degraded).toBe(true);
  });
});
