// FILE: src/services/intelligence/intelligence-snapshots.ts
// Multi-granularity intelligence state: hourly snapshots of key intelligence
// metrics enable sub-daily trend detection. Manages the snapshot directory
// lifecycle with automatic rotation (keep last 168 = 7 days of hourly).

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { logger } from "../../utils/logger.js";
import { getIntelligenceDir } from "../../utils/paths.js";
import type { AnalyzerContext } from "./analyzers/index.js";
import type {
  IncrementalAnalyzer,
  IncrementalState,
  NewEventBatch,
  UpdateResult,
} from "./incremental-state.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HourlySnapshot {
  hour: string;
  directionDensity: number | null;
  comprehensionScore: number | null;
  eventCount: number;
  loopRisk: number | null;
  efficiency: number | null;
  topDomain: string | null;
  activeSessionCount: number;
}

interface SnapshotState {
  lastSnapshotHour: string;
  snapshots: HourlySnapshot[];
  updatedAt: string;
}

type SnapshotOutput = {
  snapshots: HourlySnapshot[];
  latestHour: string;
  totalSnapshots: number;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_SNAPSHOTS = 168;
const SNAPSHOTS_DIR = "snapshots";

// ---------------------------------------------------------------------------
// IncrementalAnalyzer
// ---------------------------------------------------------------------------

export const intelligenceSnapshotAnalyzer: IncrementalAnalyzer<SnapshotState, SnapshotOutput> = {
  name: "intelligence-snapshots",
  outputFile: "intelligence-snapshots.json",
  eventFilter: { sources: ["ai-session", "mcp-active", "git"] },
  dependsOn: ["window-aggregator", "efficiency", "session-intelligence"],
  minDataPoints: 1,

  async initialize(ctx): Promise<IncrementalState<SnapshotState>> {
    const existing = loadExistingSnapshots();
    return {
      value: {
        lastSnapshotHour: "",
        snapshots: existing,
        updatedAt: new Date().toISOString(),
      },
      watermark: "",
      eventCount: 0,
      updatedAt: new Date().toISOString(),
    };
  },

  async update(state, batch, ctx): Promise<UpdateResult<SnapshotState>> {
    if (batch.events.length === 0) return { state, changed: false };

    const currentHour = new Date().toISOString().slice(0, 13);
    if (currentHour === state.value.lastSnapshotHour) {
      return { state, changed: false };
    }

    const snapshot = await buildSnapshot(currentHour, ctx);
    const snapshots = [...state.value.snapshots, snapshot];
    if (snapshots.length > MAX_SNAPSHOTS) {
      snapshots.splice(0, snapshots.length - MAX_SNAPSHOTS);
    }

    writeSnapshotFile(snapshot);
    pruneOldSnapshots();

    return {
      state: {
        value: {
          lastSnapshotHour: currentHour,
          snapshots,
          updatedAt: new Date().toISOString(),
        },
        watermark: batch.events[batch.events.length - 1].ts,
        eventCount: state.eventCount + batch.events.length,
        updatedAt: new Date().toISOString(),
      },
      changed: true,
      changeMagnitude: 0.05,
    };
  },

  derive(state): SnapshotOutput {
    return {
      snapshots: state.value.snapshots,
      latestHour: state.value.lastSnapshotHour,
      totalSnapshots: state.value.snapshots.length,
      updatedAt: state.value.updatedAt,
    };
  },
};

// ---------------------------------------------------------------------------
// Snapshot construction
// ---------------------------------------------------------------------------

async function buildSnapshot(hour: string, ctx: AnalyzerContext): Promise<HourlySnapshot> {
  let directionDensity: number | null = null;
  const comprehensionScore: number | null = null;
  let eventCount = 0;
  let loopRisk: number | null = null;
  let efficiency: number | null = null;
  const topDomain: string | null = null;
  let activeSessionCount = 0;

  try {
    const windowState = ctx.dependencyStates?.get("window-aggregator");
    if (windowState) {
      const windows = (
        windowState.value as {
          windows?: Record<string, { directionDensity?: number; eventCount?: number }>;
        }
      )?.windows;
      if (windows?.["1h"]) {
        directionDensity = windows["1h"].directionDensity ?? null;
        eventCount = windows["1h"].eventCount ?? 0;
      }
    }

    const effState = ctx.dependencyStates?.get("efficiency");
    if (effState) {
      const effVal = effState.value as { output?: { aes?: number } };
      efficiency = effVal?.output?.aes ?? null;
    }

    const sessionState = ctx.dependencyStates?.get("session-intelligence");
    if (sessionState) {
      const sessions = (sessionState.value as { sessions?: Record<string, { loopRisk?: number }> })
        ?.sessions;
      if (sessions) {
        const sessionValues = Object.values(sessions);
        activeSessionCount = sessionValues.length;
        const risks = sessionValues.map((s) => s.loopRisk ?? 0).filter((r) => r > 0);
        loopRisk = risks.length > 0 ? risks.reduce((s, v) => s + v, 0) / risks.length : null;
      }
    }
  } catch {
    // non-fatal
  }

  return {
    hour,
    directionDensity,
    comprehensionScore,
    eventCount,
    loopRisk,
    efficiency,
    topDomain,
    activeSessionCount,
  };
}

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

function getSnapshotsDir(): string {
  const dir = join(getIntelligenceDir(), SNAPSHOTS_DIR);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeSnapshotFile(snapshot: HourlySnapshot): void {
  try {
    const dir = getSnapshotsDir();
    const filename = `${snapshot.hour.replace(/:/g, "-")}.json`;
    const target = join(dir, filename);
    const tmp = `${target}.tmp.${process.pid}`;
    writeFileSync(tmp, JSON.stringify(snapshot, null, 2), "utf-8");
    renameSync(tmp, target);
  } catch (err) {
    logger.debug("Failed to write hourly snapshot", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function loadExistingSnapshots(): HourlySnapshot[] {
  try {
    const dir = getSnapshotsDir();
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort();
    return files.slice(-MAX_SNAPSHOTS).map((f) => {
      const raw = readFileSync(join(dir, f), "utf-8");
      return JSON.parse(raw) as HourlySnapshot;
    });
  } catch {
    return [];
  }
}

function pruneOldSnapshots(): void {
  try {
    const dir = getSnapshotsDir();
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort();
    if (files.length <= MAX_SNAPSHOTS) return;
    for (const f of files.slice(0, files.length - MAX_SNAPSHOTS)) {
      try {
        unlinkSync(join(dir, f));
      } catch {
        // non-fatal
      }
    }
  } catch {
    // non-fatal
  }
}
