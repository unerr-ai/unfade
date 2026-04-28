// FILE: src/server/routes/decision-detail.ts
// UF-240: Decision archaeology — GET /api/decisions/:index returns a decision
// with linked evidence events (conversation excerpts from the original AI session).
// Falls back to keyword match if no explicit evidence_event_ids.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { readEvents } from "../../services/capture/event-store.js";
import { findRepoById, loadRegistry } from "../../services/registry/registry.js";
import { getGraphDir } from "../../utils/paths.js";

export const decisionDetailRoutes = new Hono();

interface DecisionRecord {
  date: string;
  decision: string;
  rationale?: string;
  domain?: string;
  alternativesConsidered?: number;
  humanDirectionScore?: number;
  directionClassification?: string;
  projectId?: string;
  evidenceEventIds?: string[];
  /** Snake_case alias (some exports / older lines) */
  evidence_event_ids?: string[];
}

interface EvidenceEvent {
  id: string;
  timestamp: string;
  source: string;
  type: string;
  summary: string;
  detail?: string;
  branch?: string;
  files?: string[];
  conversationTitle?: string;
}

// GET /api/decisions/:index — single decision with evidence (current project)
decisionDetailRoutes.get("/api/decisions/:index", async (c) => {
  const index = Number.parseInt(c.req.param("index"), 10);
  if (Number.isNaN(index) || index < 0) {
    return c.json({ error: "Invalid decision index" }, 400);
  }

  const decisions = await loadDecisions();
  if (index >= decisions.length) {
    return c.json({ error: "Decision not found" }, 404);
  }

  const decision = decisions[index];
  const evidence = resolveEvidence(decision);
  const projectName = resolveProjectName(decision.projectId);

  return c.json({
    index,
    decision,
    evidence,
    projectName,
  });
});

// GET /api/repos/:id/decisions/:index — decision with evidence for a specific repo
decisionDetailRoutes.get("/api/repos/:repoId/decisions/:index", async (c) => {
  const repoId = c.req.param("repoId");
  const index = Number.parseInt(c.req.param("index"), 10);

  const repo = findRepoById(repoId);
  if (!repo) return c.json({ error: "Repo not found" }, 404);

  if (Number.isNaN(index) || index < 0) {
    return c.json({ error: "Invalid decision index" }, 400);
  }

  const decisions = await loadDecisions(repo.root);
  if (index >= decisions.length) {
    return c.json({ error: "Decision not found" }, 404);
  }

  const decision = decisions[index];
  const evidence = resolveEvidence(decision, repo.root);

  return c.json({
    repoId,
    repoLabel: repo.label,
    index,
    decision,
    evidence,
  });
});

async function loadDecisions(cwd?: string): Promise<DecisionRecord[]> {
  const filePath = join(getGraphDir(cwd), "decisions.jsonl");
  if (!existsSync(filePath)) return [];

  const content = (await readFile(filePath, "utf-8")).trim();
  if (!content) return [];

  const decisions: DecisionRecord[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const raw = JSON.parse(trimmed) as DecisionRecord & { evidence_event_ids?: string[] };
      if (!raw.evidenceEventIds?.length && raw.evidence_event_ids?.length) {
        raw.evidenceEventIds = raw.evidence_event_ids;
      }
      decisions.push(raw);
    } catch {
      // skip malformed
    }
  }
  return decisions;
}

function resolveEvidence(decision: DecisionRecord, cwd?: string): EvidenceEvent[] {
  if (decision.evidenceEventIds && decision.evidenceEventIds.length > 0) {
    return resolveByIds(decision.evidenceEventIds, decision.date, cwd);
  }

  return resolveByKeyword(decision, cwd);
}

function resolveByIds(ids: string[], date: string, cwd?: string): EvidenceEvent[] {
  const events = readEvents(date, cwd);
  const idSet = new Set(ids);

  return events.filter((e) => idSet.has(e.id)).map((e) => enrichEvidenceEvent(e));
}

function resolveByKeyword(decision: DecisionRecord, cwd?: string): EvidenceEvent[] {
  const events = readEvents(decision.date, cwd);
  if (events.length === 0) return [];

  const keywords = `${decision.decision} ${decision.rationale ?? ""}`
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 4)
    .slice(0, 10);

  if (keywords.length === 0) return [];

  const scored: Array<{ event: (typeof events)[0]; score: number }> = [];
  for (const e of events) {
    const text = `${e.content.summary} ${e.content.detail ?? ""}`.toLowerCase();
    let hits = 0;
    for (const kw of keywords) {
      if (text.includes(kw)) hits++;
    }
    if (hits >= 2) {
      scored.push({ event: e, score: hits });
    }
  }

  return scored.sort((a, b) => b.score - a.score).map((s) => enrichEvidenceEvent(s.event));
}

function enrichEvidenceEvent(e: ReturnType<typeof readEvents>[number]): EvidenceEvent {
  const meta = e.metadata ?? {};
  return {
    id: e.id,
    timestamp: e.timestamp,
    source: e.source,
    type: e.type,
    summary: e.content.summary,
    detail: e.content.detail?.slice(0, 500),
    branch: e.content.branch ?? e.gitContext?.branch,
    files: e.content.files?.slice(0, 20),
    conversationTitle:
      typeof meta.conversation_title === "string" ? meta.conversation_title : undefined,
  };
}

function resolveProjectName(projectId: string | undefined): string | undefined {
  if (!projectId) return undefined;
  try {
    const registry = loadRegistry();
    const repo = registry.repos.find((r) => r.id === projectId);
    return repo?.label;
  } catch {
    return undefined;
  }
}
