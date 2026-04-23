// T-417 / T-475 / T-476: SSE route — push path via eventBus (no summary.json mtime polling loop)
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/server/http.js";

let tmpDir: string;

function writeMinimalSummary(): void {
  const stateDir = join(tmpDir, ".unfade", "state");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    join(stateDir, "summary.json"),
    JSON.stringify({
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      freshnessMs: 0,
      directionDensity24h: 0,
      eventCount24h: 1,
      comprehensionScore: null,
      topDomain: null,
      toolMix: {},
      reasoningVelocityProxy: null,
      firstRunComplete: false,
    }),
    "utf-8",
  );
}

beforeEach(() => {
  tmpDir = join(
    import.meta.dirname ?? ".",
    `../../.tmp-stream-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(join(tmpDir, ".git"), { recursive: true });
  process.env.UNFADE_HOME = join(tmpDir, ".unfade");
  writeMinimalSummary();
});

afterEach(() => {
  delete process.env.UNFADE_HOME;
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

const streamSrcPath = join(import.meta.dirname, "../../../src/server/routes/stream.ts");
const summaryWriterPath = join(
  import.meta.dirname,
  "../../../src/services/intelligence/summary-writer.ts",
);

describe("GET /api/stream (UF-473 push transport)", () => {
  it("subscribes to eventBus and does not poll summary.json on an interval", () => {
    const src = readFileSync(streamSrcPath, "utf-8");
    expect(src).toContain("eventBus.onBus");
    expect(src).toContain("eventBus.offBus");
    expect(src).not.toMatch(/setInterval\([\s\S]{0,400}summary\.json/s);
  });

  it("emits summary onto the bus from summary-writer after atomic write", () => {
    const src = readFileSync(summaryWriterPath, "utf-8");
    expect(src).toContain('eventBus.emitBus({ type: "summary", data: summary })');
  });

  it("returns text/event-stream and streams initial SSE frames", async () => {
    const app = createApp();
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 3000);
    const res = await app.request("/api/stream", {
      headers: { Accept: "text/event-stream" },
      signal: ac.signal,
    });
    clearTimeout(t);
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct.includes("text/event-stream")).toBe(true);
    const reader = res.body?.getReader();
    expect(reader).toBeTruthy();
    const { value } = await reader!.read();
    const chunk = value ? new TextDecoder().decode(value) : "";
    expect(chunk.length).toBeGreaterThan(0);
    expect(chunk.includes("event:") || chunk.includes("data:")).toBe(true);
    await reader!.cancel();
  });
});
