// T-445/T-446/T-447: Sprint 15G substrate endpoints
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/server/http.js";
import { invalidateSetupCache } from "../../../src/server/setup-state.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(
    import.meta.dirname ?? ".",
    `../../.tmp-substrate-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(join(tmpDir, ".git"), { recursive: true });
  process.env.UNFADE_HOME = join(tmpDir, ".unfade");
  mkdirSync(join(tmpDir, ".unfade", "state"), { recursive: true });
  mkdirSync(join(tmpDir, ".unfade", "intelligence"), { recursive: true });
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

describe("Substrate API endpoints (Sprint 15G)", () => {
  it("GET /api/substrate/topology returns 202 when file missing", async () => {
    const app = createApp();
    const res = await app.request("/api/substrate/topology");
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe("warming_up");
  });

  it("GET /api/substrate/topology returns data when file exists", async () => {
    writeFileSync(
      join(tmpDir, ".unfade", "intelligence", "substrate-topology.json"),
      JSON.stringify({ hubs: ["auth"], clusters: 3, entities: [{ id: "e1", neighbors: ["e2"] }] }),
    );
    const app = createApp();
    const res = await app.request("/api/substrate/topology");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hubs).toContain("auth");
  });

  it("GET /api/substrate/trajectories returns 202 when file missing", async () => {
    const app = createApp();
    const res = await app.request("/api/substrate/trajectories");
    expect(res.status).toBe(202);
  });

  it("GET /api/substrate/entity/:id/neighborhood returns entity data", async () => {
    writeFileSync(
      join(tmpDir, ".unfade", "intelligence", "substrate-topology.json"),
      JSON.stringify({
        entities: [{ id: "dec-42", neighbors: [{ id: "feat-7", type: "caused" }] }],
      }),
    );
    const app = createApp();
    const res = await app.request("/api/substrate/entity/dec-42/neighborhood");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entityId).toBe("dec-42");
    expect(body.neighbors.length).toBe(1);
  });

  it("GET /api/substrate/entity/:id/neighborhood returns 404 for unknown entity", async () => {
    writeFileSync(
      join(tmpDir, ".unfade", "intelligence", "substrate-topology.json"),
      JSON.stringify({ entities: [{ id: "dec-42" }] }),
    );
    const app = createApp();
    const res = await app.request("/api/substrate/entity/unknown/neighborhood");
    expect(res.status).toBe(404);
  });
});
