// FILE: src/server/routes/substrate.ts
// Sprint 15G UF-450: Substrate query endpoints (graph neighborhood, trajectories, topology).
// Reads from ~/.unfade/intelligence/substrate-*.json files written by substrate engine.

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

function jsonOr202(
  c: { json: (data: unknown, status?: number) => Response },
  data: unknown,
) {
  if (!data)
    return c.json(
      { status: "warming_up", message: "Substrate engine is building the knowledge graph." },
      202,
    );
  return c.json(data);
}

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

  return c.json({ entityId: id, neighbors: entity.neighbors ?? [], _source: "substrate-topology.json" });
});

substrateRoutes.get("/api/substrate/trajectories", async (c) =>
  jsonOr202(c, await readSubstrateFile("substrate-trajectories.json")),
);

substrateRoutes.get("/api/substrate/topology", async (c) =>
  jsonOr202(c, await readSubstrateFile("substrate-topology.json")),
);
