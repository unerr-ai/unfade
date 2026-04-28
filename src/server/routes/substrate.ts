// Substrate API routes — IP-9.3: entity exploration + existing topology/trajectory endpoints.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { getIntelligenceDir } from "../../utils/paths.js";

export const substrateRoutes = new Hono();

async function readSubstrateFile(filename: string): Promise<unknown | null> {
  const path = join(getIntelligenceDir(), filename);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return null;
  }
}

function jsonOr202(c: { json: (data: unknown, status?: number) => Response }, data: unknown) {
  if (!data)
    return c.json(
      { status: "warming_up", message: "Substrate engine is building the knowledge graph." },
      202,
    );
  return c.json(data);
}

// ─── IP-9.3: Entity Exploration ─────────────────────────────────────────────

substrateRoutes.get("/api/substrate/explore/:entityId", async (c) => {
  const entityId = c.req.param("entityId");

  const topology = await readSubstrateFile("substrate-topology.json");
  if (!topology || typeof topology !== "object") {
    return c.json({
      data: {
        entityId,
        entity: null,
        neighbors: [],
        evidenceEventIds: [],
      },
      _meta: { tool: "substrate-explore", source: "file", found: false },
    });
  }

  const entities = (topology as Record<string, unknown>).entities as
    | Array<{
        id: string;
        type?: string;
        state?: Record<string, unknown>;
        confidence?: number;
        neighbors?: Array<{ id: string; type: string; weight: number }>;
      }>
    | undefined;

  if (!entities) {
    return c.json({
      data: { entityId, entity: null, neighbors: [], evidenceEventIds: [] },
      _meta: { tool: "substrate-explore", source: "file", found: false },
    });
  }

  const entity = entities.find((e) => e.id === entityId);
  if (!entity) {
    return c.json({ error: `Entity "${entityId}" not found` }, 404);
  }

  const state = entity.state ?? {};
  const evidenceEventIds = Array.isArray(state.evidenceEventIds)
    ? (state.evidenceEventIds as string[])
    : [];

  return c.json({
    data: {
      entityId,
      entity: {
        id: entity.id,
        type: entity.type ?? "unknown",
        name: (state.name as string) ?? entity.id,
        domain: (state.domain as string) ?? "general",
        confidence: entity.confidence ?? 0.5,
        state,
      },
      neighbors: entity.neighbors ?? [],
      evidenceEventIds,
    },
    _meta: { tool: "substrate-explore", source: "file", found: true },
  });
});

// ─── Existing Topology/Trajectory Endpoints ─────────────────────────────────

substrateRoutes.get("/api/substrate/entity/:id/neighborhood", async (c) => {
  const id = c.req.param("id");
  const topology = await readSubstrateFile("substrate-topology.json");
  if (!topology || typeof topology !== "object") return jsonOr202(c, null);

  const entities = (topology as Record<string, unknown>).entities as
    | Array<{ id: string; neighbors?: unknown[] }>
    | undefined;
  if (!entities) return jsonOr202(c, null);

  const entity = entities.find((e) => e.id === id);
  if (!entity) return c.json({ error: "Entity not found" }, 404);

  return c.json({
    entityId: id,
    neighbors: entity.neighbors ?? [],
    _source: "substrate-topology.json",
  });
});

substrateRoutes.get("/api/substrate/trajectories", async (c) =>
  jsonOr202(c, await readSubstrateFile("substrate-trajectories.json")),
);

substrateRoutes.get("/api/substrate/topology", async (c) =>
  jsonOr202(c, await readSubstrateFile("substrate-topology.json")),
);
