// T-419: Shell uses viewport + width constraints (mobile-first CSS in src/styles/input.css)
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/server/http.js";
import { invalidateSetupCache } from "../../../src/server/setup-state.js";

let tmpDir: string;

function makeTmpDir(): string {
  const dir = join(
    import.meta.dirname ?? ".",
    `../../.tmp-responsive-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

const shellPaths = ["/", "/intelligence", "/decisions", "/projects", "/live", "/distill"];

beforeEach(() => {
  tmpDir = makeTmpDir();
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
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe("Responsive shell (T-419)", () => {
  it("source CSS defines 1023px / 767px breakpoints for sidebar and mobile menu", () => {
    const cssPath = join(import.meta.dirname, "../../../src/styles/input.css");
    const css = readFileSync(cssPath, "utf-8");
    expect(css).toContain("max-width: 1023px");
    expect(css).toContain("max-width: 767px");
    expect(css).toContain("mobile-menu-btn");
  });

  it("main routes include viewport meta and flex min-width containment", async () => {
    const app = createApp();
    for (const path of shellPaths) {
      const res = await app.request(path);
      expect(res.status, path).toBe(200);
      const html = await res.text();
      expect(html, path).toContain('name="viewport"');
      expect(html, path).toMatch(/min-w-0|overflow-hidden/);
    }
  });
});
