// FILE: src/services/personalization/profile-accumulator.ts
// Continuous profile accumulator — updates the developer reasoning profile
// sub-daily from analyzer outputs. The daily distill still produces the
// highest-quality profile update via LLM synthesis, but the profile is
// no longer stale between distills. Debounced: writes at most once per minute.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../../utils/logger.js";
import { getProfileDir } from "../../utils/paths.js";
import type {
  IncrementalAnalyzer,
  IncrementalState,
  NewEventBatch,
  UpdateResult,
} from "../intelligence/incremental-state.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProfileAccumulatorState {
  decisionStyle: {
    avgHds: number;
    avgSpecificity: number;
    avgModificationDepth: number;
    totalEvents: number;
  };
  domainDistribution: Record<string, number>;
  patterns: Array<{ pattern: string; confidence: number; detectedAt: string }>;
  maturityPhase: number | null;
  lastWriteMs: number;
  updatedAt: string;
}

interface ProfileAccumulatorOutput {
  decisionStyle: ProfileAccumulatorState["decisionStyle"];
  domainDistribution: Array<{ domain: string; eventCount: number }>;
  topPatterns: Array<{ pattern: string; confidence: number }>;
  maturityPhase: number | null;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_WRITE_INTERVAL_MS = 60_000;

// ---------------------------------------------------------------------------
// IncrementalAnalyzer
// ---------------------------------------------------------------------------

export const profileAccumulatorAnalyzer: IncrementalAnalyzer<
  ProfileAccumulatorState,
  ProfileAccumulatorOutput
> = {
  name: "profile-accumulator",
  outputFile: "profile-accumulator.json",
  eventFilter: { sources: ["ai-session", "mcp-active"] },
  dependsOn: ["efficiency", "window-aggregator"],
  minDataPoints: 5,

  async initialize(_ctx): Promise<IncrementalState<ProfileAccumulatorState>> {
    const existing = loadExistingProfile();
    return {
      value: {
        decisionStyle: existing?.decisionStyle ?? {
          avgHds: 0,
          avgSpecificity: 0,
          avgModificationDepth: 0,
          totalEvents: 0,
        },
        domainDistribution: existing?.domainDistribution ?? {},
        patterns: existing?.patterns ?? [],
        maturityPhase: null,
        lastWriteMs: 0,
        updatedAt: new Date().toISOString(),
      },
      watermark: "",
      eventCount: 0,
      updatedAt: new Date().toISOString(),
    };
  },

  async update(state, batch, _ctx): Promise<UpdateResult<ProfileAccumulatorState>> {
    if (batch.events.length === 0) return { state, changed: false };

    const style = { ...state.value.decisionStyle };
    const domains = { ...state.value.domainDistribution };

    for (const evt of batch.events) {
      style.totalEvents++;
      if (evt.humanDirectionScore != null) {
        style.avgHds = runningAvg(style.avgHds, evt.humanDirectionScore, style.totalEvents);
      }
      if (evt.promptSpecificity != null) {
        style.avgSpecificity = runningAvg(
          style.avgSpecificity,
          evt.promptSpecificity,
          style.totalEvents,
        );
      }

      const domain = evt.domain ?? "general";
      domains[domain] = (domains[domain] ?? 0) + 1;
    }

    const patterns = detectPatterns(style, domains, batch);

    const now = Date.now();
    const shouldWrite = now - state.value.lastWriteMs >= MIN_WRITE_INTERVAL_MS;
    const lastWriteMs = shouldWrite ? now : state.value.lastWriteMs;

    if (shouldWrite) {
      writeProfileUpdate(style, domains, patterns);
    }

    return {
      state: {
        value: {
          decisionStyle: style,
          domainDistribution: domains,
          patterns,
          maturityPhase: state.value.maturityPhase,
          lastWriteMs,
          updatedAt: new Date().toISOString(),
        },
        watermark: batch.events[batch.events.length - 1].ts,
        eventCount: state.eventCount + batch.events.length,
        updatedAt: new Date().toISOString(),
      },
      changed: shouldWrite,
      changeMagnitude: shouldWrite ? 0.1 : 0,
    };
  },

  derive(state): ProfileAccumulatorOutput {
    const domainEntries = Object.entries(state.value.domainDistribution)
      .map(([domain, count]) => ({ domain, eventCount: count }))
      .sort((a, b) => b.eventCount - a.eventCount);

    return {
      decisionStyle: state.value.decisionStyle,
      domainDistribution: domainEntries,
      topPatterns: state.value.patterns.slice(0, 10),
      maturityPhase: state.value.maturityPhase,
      updatedAt: state.value.updatedAt,
    };
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runningAvg(current: number, newValue: number, count: number): number {
  return current + (newValue - current) / count;
}

function detectPatterns(
  style: ProfileAccumulatorState["decisionStyle"],
  domains: Record<string, number>,
  _batch: NewEventBatch,
): ProfileAccumulatorState["patterns"] {
  const patterns: ProfileAccumulatorState["patterns"] = [];
  const now = new Date().toISOString();

  if (style.avgHds > 0.6 && style.totalEvents >= 20) {
    patterns.push({
      pattern: "High-direction developer: consistently steers AI output",
      confidence: Math.min(0.95, style.totalEvents / 100),
      detectedAt: now,
    });
  }

  if (style.avgSpecificity > 0.7 && style.totalEvents >= 10) {
    patterns.push({
      pattern: "Precise prompter: uses constraints and specific references",
      confidence: Math.min(0.9, style.totalEvents / 50),
      detectedAt: now,
    });
  }

  const topDomains = Object.entries(domains).sort((a, b) => b[1] - a[1]);
  if (topDomains.length >= 2 && topDomains[0][1] > topDomains[1][1] * 2) {
    patterns.push({
      pattern: `Domain specialist: concentrated in ${topDomains[0][0]}`,
      confidence: 0.7,
      detectedAt: now,
    });
  }

  return patterns;
}

function loadExistingProfile(): Partial<ProfileAccumulatorState> | null {
  try {
    const profileDir = getProfileDir();
    const path = join(profileDir, "reasoning_model.json");
    if (!existsSync(path)) return null;
    const data = JSON.parse(readFileSync(path, "utf-8"));
    return {
      decisionStyle: data.decisionStyle,
      domainDistribution: data.domainDistribution
        ? Object.fromEntries(
            data.domainDistribution.map((d: { domain: string; eventCount?: number }) => [
              d.domain,
              d.eventCount ?? 1,
            ]),
          )
        : undefined,
      patterns: data.patterns,
    };
  } catch {
    return null;
  }
}

function writeProfileUpdate(
  style: ProfileAccumulatorState["decisionStyle"],
  domains: Record<string, number>,
  patterns: ProfileAccumulatorState["patterns"],
): void {
  try {
    const profileDir = getProfileDir();
    mkdirSync(profileDir, { recursive: true });
    const path = join(profileDir, "reasoning_model.json");

    let existing: Record<string, unknown> = {};
    if (existsSync(path)) {
      try {
        existing = JSON.parse(readFileSync(path, "utf-8"));
      } catch {
        existing = {};
      }
    }

    const updated = {
      ...existing,
      version: 2,
      decisionStyle: style,
      domainDistribution: Object.entries(domains)
        .map(([domain, count]) => ({ domain, eventCount: count, depth: "emerging" }))
        .sort((a, b) => b.eventCount - a.eventCount),
      patterns: patterns.map((p) => ({
        pattern: p.pattern,
        confidence: p.confidence,
        detectedAt: p.detectedAt,
        recurring: true,
      })),
      lastAccumulatorUpdate: new Date().toISOString(),
    };

    const tmp = `${path}.tmp.${process.pid}`;
    writeFileSync(tmp, JSON.stringify(updated, null, 2), "utf-8");
    renameSync(tmp, path);
  } catch (err) {
    logger.debug("Profile accumulator write failed (non-fatal)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
