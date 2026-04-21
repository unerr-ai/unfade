// Tests for UF-061: Card generation API routes
// T-165, T-166

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/server/http.js";
import { invalidateSetupCache } from "../../../src/server/setup-state.js";

let tmpDir: string;
let originalCwd: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../../.tmp-cards-route-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

function writeDistill(dir: string, date: string, content: string): void {
  const distillsDir = join(dir, ".unfade", "distills");
  mkdirSync(distillsDir, { recursive: true });
  writeFileSync(join(distillsDir, `${date}.md`), content, "utf-8");
}

const SAMPLE_DISTILL = `# Daily Distill — 2026-04-15

> A productive day.

- **Events processed:** 10
- **Synthesized by:** claude-sonnet-4-20250514

## Decisions

- **Use satori for rendering** [rendering] (3 alternatives considered)
  _Best fit for CLI_

## Dead Ends

- **Tried puppeteer** (~20 min)

## Domains

rendering
`;

beforeAll(() => {
  originalCwd = process.cwd();
});

afterAll(() => {
  process.chdir(originalCwd);
});

beforeEach(() => {
  tmpDir = makeTmpDir();
  process.chdir(tmpDir);
  process.env.UNFADE_HOME = join(tmpDir, ".unfade");
  mkdirSync(join(tmpDir, ".unfade", "state"), { recursive: true });
  writeFileSync(
    join(tmpDir, ".unfade", "state", "setup-status.json"),
    '{"setupCompleted":true}',
    "utf-8",
  );
  invalidateSetupCache();
});

afterEach(() => {
  delete process.env.UNFADE_HOME;
  process.chdir(originalCwd);
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe("POST /unfade/cards/generate", () => {
  // T-165: generates PNG for specific date
  it("T-165: generates card PNG and returns _meta envelope", async () => {
    writeDistill(tmpDir, "2026-04-15", SAMPLE_DISTILL);

    const app = createApp();
    const res = await app.request("/unfade/cards/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: "2026-04-15" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe("generated");
    expect(body.data.date).toBe("2026-04-15");
    expect(body.data.size).toBeGreaterThan(0);
    expect(body._meta.tool).toBe("unfade-cards");
    expect(body._meta.degraded).toBe(false);
    expect(typeof body._meta.durationMs).toBe("number");

    // Verify PNG file was written
    const cardPath = join(tmpDir, ".unfade", "cards", "2026-04-15.png");
    expect(existsSync(cardPath)).toBe(true);
  }, 30000);

  // T-166: handles missing distill with helpful error
  it("T-166: generates card even for missing distill (empty card)", async () => {
    const app = createApp();
    const res = await app.request("/unfade/cards/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: "2026-01-01" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    // Card is still generated with empty data
    expect(body.data.status).toBe("generated");
    expect(body._meta.degraded).toBe(false);
  }, 30000);

  it("returns 400 for invalid date format", async () => {
    const app = createApp();
    const res = await app.request("/unfade/cards/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: "not-a-date" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body._meta.degraded).toBe(true);
  });

  it("returns 400 for missing date", async () => {
    const app = createApp();
    const res = await app.request("/unfade/cards/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });
});

describe("GET /unfade/cards/image/:date", () => {
  it("returns PNG for existing card", async () => {
    const cardsDir = join(tmpDir, ".unfade", "cards");
    mkdirSync(cardsDir, { recursive: true });
    // Write a minimal valid PNG
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    writeFileSync(join(cardsDir, "2026-04-15.png"), pngHeader);

    const app = createApp();
    const res = await app.request("/unfade/cards/image/2026-04-15");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("returns 404 for missing card", async () => {
    const app = createApp();
    const res = await app.request("/unfade/cards/image/2026-01-01");
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid date format", async () => {
    const app = createApp();
    const res = await app.request("/unfade/cards/image/invalid");
    expect(res.status).toBe(400);
  });
});
