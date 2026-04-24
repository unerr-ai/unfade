// FILE: src/services/intelligence/session-intelligence.ts
// Per-session real-time intelligence. Tracks active sessions with phase
// history, loop risk, direction trend, and suggested actions. Emits
// diagnostics when loopRisk > 0.7 or direction falls for > 5 events.

import { diagnosticStream } from "./diagnostic-stream.js";
import type { IncrementalAnalyzer, IncrementalState, UpdateResult } from "./incremental-state.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionIntelligence {
  sessionId: string;
  currentPhase: string;
  phaseHistory: Array<{ phase: string; startedAt: string; duration: number }>;
  loopRisk: number;
  directionTrend: "rising" | "stable" | "falling";
  directionHistory: number[];
  turnCount: number;
  suggestedAction: string | null;
  lastUpdated: string;
}

interface SessionIntelligenceState {
  sessions: Record<string, SessionIntelligence>;
  updatedAt: string;
}

type SessionIntelligenceOutput = {
  activeSessions: SessionIntelligence[];
  totalTracked: number;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_TRACKED_SESSIONS = 50;
const LOOP_RISK_THRESHOLD = 0.7;
const FALLING_DIRECTION_WINDOW = 5;
const SESSION_STALE_MS = 4 * 3600 * 1000;

// ---------------------------------------------------------------------------
// IncrementalAnalyzer
// ---------------------------------------------------------------------------

export const sessionIntelligenceAnalyzer: IncrementalAnalyzer<
  SessionIntelligenceState,
  SessionIntelligenceOutput
> = {
  name: "session-intelligence",
  outputFile: "session-intelligence.json",
  eventFilter: { sources: ["ai-session", "mcp-active"] },
  minDataPoints: 1,

  async initialize(_ctx): Promise<IncrementalState<SessionIntelligenceState>> {
    return {
      value: { sessions: {}, updatedAt: new Date().toISOString() },
      watermark: "",
      eventCount: 0,
      updatedAt: new Date().toISOString(),
    };
  },

  async update(state, batch, _ctx): Promise<UpdateResult<SessionIntelligenceState>> {
    if (batch.events.length === 0) return { state, changed: false };

    const sessions = { ...state.value.sessions };
    const now = new Date();
    let anyChanged = false;

    for (const evt of batch.events) {
      if (!evt.sessionId) continue;

      const sid = evt.sessionId;
      const existing = sessions[sid];
      const phase = evt.executionPhase ?? "unknown";
      const hds = evt.humanDirectionScore ?? 0.5;

      if (!existing) {
        sessions[sid] = {
          sessionId: sid,
          currentPhase: phase,
          phaseHistory: [{ phase, startedAt: evt.ts, duration: 0 }],
          loopRisk: 0,
          directionTrend: "stable",
          directionHistory: [hds],
          turnCount: 1,
          suggestedAction: null,
          lastUpdated: evt.ts,
        };
        anyChanged = true;
        continue;
      }

      existing.turnCount++;
      existing.lastUpdated = evt.ts;
      existing.directionHistory.push(hds);
      if (existing.directionHistory.length > 20) {
        existing.directionHistory = existing.directionHistory.slice(-20);
      }

      if (phase !== existing.currentPhase) {
        const lastPhase = existing.phaseHistory[existing.phaseHistory.length - 1];
        if (lastPhase) {
          lastPhase.duration = new Date(evt.ts).getTime() - new Date(lastPhase.startedAt).getTime();
        }
        existing.phaseHistory.push({ phase, startedAt: evt.ts, duration: 0 });
        existing.currentPhase = phase;
      }

      existing.loopRisk = computeLoopRisk(existing);
      existing.directionTrend = computeDirectionTrend(existing.directionHistory);
      existing.suggestedAction = deriveSuggestedAction(existing);

      if (existing.loopRisk > LOOP_RISK_THRESHOLD) {
        diagnosticStream.emit({
          type: "warning",
          scope: "session",
          analyzer: "session-intelligence",
          message: `Session ${sid.slice(0, 8)} has elevated loop risk (${Math.round(existing.loopRisk * 100)}%)`,
          actionable: true,
          action: existing.suggestedAction ?? "Consider stepping back to plan before continuing",
          confidence: existing.loopRisk,
          relatedEventIds: [evt.id],
          projectId: evt.projectId,
        });
      }

      if (
        existing.directionTrend === "falling" &&
        existing.directionHistory.length >= FALLING_DIRECTION_WINDOW
      ) {
        diagnosticStream.emit({
          type: "observation",
          scope: "session",
          analyzer: "session-intelligence",
          message: `Direction trending down in session ${sid.slice(0, 8)} — ${existing.directionHistory.length} events with declining HDS`,
          actionable: true,
          action: "Try adding more constraints or breaking the task into smaller steps",
          confidence: 0.6,
          relatedEventIds: [evt.id],
          projectId: evt.projectId,
        });
      }

      anyChanged = true;
    }

    pruneStale(sessions, now);

    return {
      state: {
        value: { sessions, updatedAt: now.toISOString() },
        watermark: batch.events[batch.events.length - 1].ts,
        eventCount: state.eventCount + batch.events.length,
        updatedAt: now.toISOString(),
      },
      changed: anyChanged,
      changeMagnitude: anyChanged ? 0.1 : 0,
    };
  },

  derive(state): SessionIntelligenceOutput {
    const active = Object.values(state.value.sessions)
      .filter((s) => {
        const age = Date.now() - new Date(s.lastUpdated).getTime();
        return age < SESSION_STALE_MS;
      })
      .sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime());

    return {
      activeSessions: active,
      totalTracked: Object.keys(state.value.sessions).length,
      updatedAt: state.value.updatedAt,
    };
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeLoopRisk(session: SessionIntelligence): number {
  let risk = 0;

  if (session.turnCount > 10) risk += 0.2;
  if (session.turnCount > 20) risk += 0.2;

  if (session.directionTrend === "falling") risk += 0.3;

  const recentHds = session.directionHistory.slice(-5);
  const avgRecent = recentHds.reduce((s, v) => s + v, 0) / recentHds.length;
  if (avgRecent < 0.3) risk += 0.2;
  if (avgRecent < 0.15) risk += 0.1;

  const phaseChanges = session.phaseHistory.length;
  if (phaseChanges >= 4) risk += 0.1;

  return Math.min(1, risk);
}

function computeDirectionTrend(history: number[]): "rising" | "stable" | "falling" {
  if (history.length < 3) return "stable";

  const recent = history.slice(-FALLING_DIRECTION_WINDOW);
  if (recent.length < 3) return "stable";

  let rising = 0;
  let falling = 0;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i] > recent[i - 1] + 0.05) rising++;
    else if (recent[i] < recent[i - 1] - 0.05) falling++;
  }

  if (falling >= recent.length * 0.6) return "falling";
  if (rising >= recent.length * 0.6) return "rising";
  return "stable";
}

function deriveSuggestedAction(session: SessionIntelligence): string | null {
  if (session.loopRisk > 0.8) {
    return "This session shows strong loop patterns. Try writing a test case first, or step back to plan the approach before continuing.";
  }
  if (session.loopRisk > 0.5 && session.currentPhase === "debugging") {
    return "Debugging with declining direction. Consider isolating the problem in a minimal reproduction before iterating.";
  }
  if (session.directionTrend === "falling" && session.turnCount > 8) {
    return "Direction has been declining. Try adding explicit constraints to your prompts, or break the task into smaller sub-tasks.";
  }
  return null;
}

function pruneStale(sessions: Record<string, SessionIntelligence>, now: Date): void {
  const staleThreshold = now.getTime() - SESSION_STALE_MS;
  const entries = Object.entries(sessions);
  if (entries.length <= MAX_TRACKED_SESSIONS) return;

  const sorted = entries.sort(
    ([, a], [, b]) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime(),
  );
  for (const [key] of sorted.slice(MAX_TRACKED_SESSIONS)) {
    delete sessions[key];
  }
  for (const [key, session] of Object.entries(sessions)) {
    if (new Date(session.lastUpdated).getTime() < staleThreshold) {
      delete sessions[key];
    }
  }
}
