// Tests for UF-061: Cards web UI page
// T-164, T-167, T-168

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/server/setup-state.js", () => ({
  isSetupComplete: () => true,
  invalidateSetupCache: () => {},
}));

import { createApp } from "../../../src/server/http.js";

let tmpDir: string;
let originalCwd: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../../.tmp-cards-page-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

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
});

afterEach(() => {
  delete process.env.UNFADE_HOME;
  process.chdir(originalCwd);
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe("Cards page (GET /cards)", () => {
  // T-164: renders card preview for today's distill
  it("T-164: renders HTML with card generation form", async () => {
    const app = createApp();
    const res = await app.request("/cards");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<html");
    expect(html).toContain("Unfade Cards");
    expect(html).toContain("Generate Card");
  });

  // T-167: supports date picker for generating cards for any date
  it("T-167: includes date picker input", async () => {
    const app = createApp();
    const res = await app.request("/cards");
    const html = await res.text();
    expect(html).toContain('type="date"');
    expect(html).toContain("card-date");
  });

  // T-168: provides PNG download link after generation
  it("T-168: provides download link for existing cards", async () => {
    // Create a fake card PNG
    const cardsDir = join(tmpDir, ".unfade", "cards");
    mkdirSync(cardsDir, { recursive: true });
    writeFileSync(join(cardsDir, "2026-04-15.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const app = createApp();
    const res = await app.request("/cards");
    const html = await res.text();
    expect(html).toContain("2026-04-15");
    expect(html).toContain("Download");
    expect(html).toContain("/unfade/cards/image/2026-04-15");
  });

  it("includes htmx generate button", async () => {
    const app = createApp();
    const res = await app.request("/cards");
    const html = await res.text();
    expect(html).toContain("hx-post");
    expect(html).toContain("/unfade/cards/generate");
  });

  it("shows empty state when no cards exist", async () => {
    const app = createApp();
    const res = await app.request("/cards");
    const html = await res.text();
    expect(html).toContain("No cards generated yet");
  });

  it("nav bar includes Cards link", async () => {
    const app = createApp();
    const res = await app.request("/cards");
    const html = await res.text();
    expect(html).toContain('href="/cards"');
  });
});
