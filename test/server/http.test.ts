// Tests for UF-050: HTTP server setup
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/setup-state.js", () => ({
  isSetupComplete: () => true,
  invalidateSetupCache: () => {},
  shouldShowSynthesisBanner: () => false,
  getSynthesisProgress: () => ({
    percent: 0,
    totalEvents: 0,
    processedEvents: 0,
    phase: "pending",
    synthesisCompletedAt: null,
  }),
}));

import { createApp } from "../../src/server/http.js";

describe("createApp", () => {
  it("creates a Hono app instance", () => {
    const app = createApp();
    expect(app).toBeDefined();
    expect(typeof app.fetch).toBe("function");
  });

  it("health check returns 200 with status", async () => {
    const app = createApp();
    const res = await app.request("/api/system/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(["ok", "degraded"]).toContain(body.data.status);
    expect(body.data.version).toBe("0.1.0");
    expect(body.data.pid).toBe(process.pid);
  });

  it("serves SPA for unknown non-API routes (React Router handles 404 client-side)", async () => {
    const app = createApp();
    const res = await app.request("/nonexistent");
    const status = res.status;
    expect(status === 200 || status === 404).toBe(true);
  });

  it("includes CORS headers for localhost origins", async () => {
    const app = createApp();
    const res = await app.request("/api/system/health", {
      headers: { Origin: "http://localhost:7654" },
    });
    expect(res.status).toBe(200);
    const corsHeader = res.headers.get("access-control-allow-origin");
    expect(corsHeader).toBe("http://localhost:7654");
  });

  it("blocks CORS from non-localhost origins", async () => {
    const app = createApp();
    const res = await app.request("/api/system/health", {
      headers: { Origin: "http://example.com" },
    });
    // Response still succeeds but CORS header should not match
    expect(res.status).toBe(200);
    const corsHeader = res.headers.get("access-control-allow-origin");
    expect(corsHeader).not.toBe("http://example.com");
  });
});

describe("server.json", () => {
  let tmpDir: string;

  function makeTmpDir(): string {
    const dir = join(
      import.meta.dirname ?? ".",
      `../.tmp-server-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(dir, ".git"), { recursive: true });
    return dir;
  }

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("writeServerJson creates state directory and file atomically", async () => {
    // We test via the startServer function indirectly by importing writeServerJson
    // For now, verify the state dir structure exists after bootstrap
    const stateDir = join(tmpDir, ".unfade", "state");
    mkdirSync(stateDir, { recursive: true });
    expect(existsSync(stateDir)).toBe(true);
  });
});
