// Tests for UF-058/UF-060: Card generator and rendering pipeline
// T-156 through T-161

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { extractCardData, generateCard } from "../../../src/services/card/generator.js";

let tmpDir: string;
let originalCwd: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../../.tmp-card-gen-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

function writeDistill(dir: string, date: string, content: string): string {
  const distillsDir = join(dir, ".unfade", "distills");
  mkdirSync(distillsDir, { recursive: true });
  const path = join(distillsDir, `${date}.md`);
  writeFileSync(path, content, "utf-8");
  return path;
}

const SAMPLE_DISTILL = `# Daily Distill — 2026-04-15

> Productive day focused on card rendering pipeline.

- **Events processed:** 42
- **Synthesized by:** claude-sonnet-4-20250514

## Decisions

- **Use satori for JSX-to-SVG rendering** [rendering] (3 alternatives considered)
  _Chose satori over puppeteer for lightweight CLI usage_
- **Dark theme with #1a1a2e background** [design] (2 alternatives considered)
  _Dark theme matches developer tooling aesthetic_
- **Cache fonts locally after first download** [performance] (4 alternatives considered)
  _Avoids repeated CDN calls on every card generation_
- **Use flexbox-only layout for satori compat** [rendering] (2 alternatives considered)
  _satori does not support CSS grid_

## Trade-offs

- **Local rendering vs hosted service**
  Chose: local rendering · Rejected: hosted cloud service

## Dead Ends

- **Tried canvas-based rendering** (~15 min)
  _Resolution: Abandoned in favor of satori JSX approach_
- **Attempted WOFF2 font loading** (~10 min)
  _Resolution: satori only supports TTF/OTF/WOFF, switched to WOFF_

## Domains

rendering, design, performance
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
});

afterEach(() => {
  delete process.env.UNFADE_HOME;
  process.chdir(originalCwd);
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe("extractCardData", () => {
  // T-156: parses distill and extracts top 3 decisions
  it("T-156: extracts top 3 decisions from distill markdown", () => {
    const path = writeDistill(tmpDir, "2026-04-15", SAMPLE_DISTILL);
    const data = extractCardData(path);

    expect(data.decisions).toHaveLength(3);
    expect(data.decisions[0]).toContain("satori");
    expect(data.decisions[1]).toContain("Dark theme");
    expect(data.decisions[2]).toContain("Cache fonts");
    expect(data.decisionCount).toBe(4); // all 4 decisions counted
  });

  // T-157: extracts domain tags from decisions
  it("T-157: extracts domain tags from decisions and Domains section", () => {
    const path = writeDistill(tmpDir, "2026-04-15", SAMPLE_DISTILL);
    const data = extractCardData(path);

    expect(data.domains.length).toBeGreaterThan(0);
    expect(data.domains.length).toBeLessThanOrEqual(3);
    expect(data.domains).toContain("rendering");
    expect(data.domains).toContain("design");
    expect(data.domains).toContain("performance");
  });

  // T-158: calculates reasoning depth score
  it("T-158: calculates reasoning depth as avg alternatives per decision", () => {
    const path = writeDistill(tmpDir, "2026-04-15", SAMPLE_DISTILL);
    const data = extractCardData(path);

    // 3 + 2 + 4 + 2 = 11 alternatives / 4 decisions = 2.75
    expect(data.reasoningDepth).toBeCloseTo(2.75, 1);
  });

  // T-159: handles distill with no decisions gracefully
  it("T-159: returns empty CardData for missing distill", () => {
    const data = extractCardData("/nonexistent/path.md");

    expect(data.decisions).toEqual([]);
    expect(data.domains).toEqual([]);
    expect(data.reasoningDepth).toBe(0);
    expect(data.deadEnds).toBe(0);
    expect(data.decisionCount).toBe(0);
    expect(data.aiModifiedPct).toBe(0);
  });

  it("extracts dead ends count", () => {
    const path = writeDistill(tmpDir, "2026-04-15", SAMPLE_DISTILL);
    const data = extractCardData(path);

    expect(data.deadEnds).toBe(2);
  });

  it("extracts date from distill header", () => {
    const path = writeDistill(tmpDir, "2026-04-15", SAMPLE_DISTILL);
    const data = extractCardData(path);

    expect(data.date).toBe("2026-04-15");
  });

  it("returns empty CardData for empty file", () => {
    const path = writeDistill(tmpDir, "2026-04-15", "");
    const data = extractCardData(path);

    expect(data.decisions).toEqual([]);
    expect(data.decisionCount).toBe(0);
  });

  it("never throws on malformed markdown", () => {
    const path = writeDistill(
      tmpDir,
      "2026-04-15",
      "garbage\n\n## Decisions\n\n- not a decision\n- **incomplete",
    );
    expect(() => extractCardData(path)).not.toThrow();
  });
});

describe("generateCard", () => {
  // T-160: produces valid PNG file
  it("T-160: produces a valid PNG buffer", async () => {
    writeDistill(tmpDir, "2026-04-15", SAMPLE_DISTILL);
    const png = await generateCard("2026-04-15");

    expect(png).toBeInstanceOf(Buffer);
    expect(png.length).toBeGreaterThan(0);
    // PNG magic bytes
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50); // P
    expect(png[2]).toBe(0x4e); // N
    expect(png[3]).toBe(0x47); // G

    // Verify file was written
    const cardPath = join(tmpDir, ".unfade", "cards", "2026-04-15.png");
    expect(existsSync(cardPath)).toBe(true);
  }, 30000);

  // T-161: PNG dimensions are OG-compatible (1200x630)
  it("T-161: PNG dimensions are 1200x630", async () => {
    writeDistill(tmpDir, "2026-04-15", SAMPLE_DISTILL);
    const png = await generateCard("2026-04-15");

    // Read width and height from PNG IHDR chunk
    // IHDR starts at byte 16 (after signature + IHDR length + type)
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);

    expect(width).toBe(1200);
    expect(height).toBe(630);
  }, 30000);

  it("generates card for missing distill without throwing", async () => {
    const png = await generateCard("2026-01-01");
    expect(png).toBeInstanceOf(Buffer);
    expect(png.length).toBeGreaterThan(0);
  }, 30000);

  it("card file size is under 500KB", async () => {
    writeDistill(tmpDir, "2026-04-15", SAMPLE_DISTILL);
    const png = await generateCard("2026-04-15");

    expect(png.length).toBeLessThan(500 * 1024);
  }, 30000);
});
