// FILE: src/services/scheduler/scheduler.ts
// UF-036: Scheduler — cron-based distillation trigger using Croner.
// Configurable time (default 18:00 local), jitter ±5 min.
// Skip zero-event days silently.

import { Cron } from "croner";
import type { UnfadeConfig } from "../../schemas/config.js";
import { logBuffer } from "../logs/ring-buffer.js";
import { logger } from "../../utils/logger.js";
import { countEvents } from "../capture/event-store.js";
import { distill } from "../distill/distiller.js";
import { getDistillsDir, getEventsDir } from "../../utils/paths.js";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

const JITTER_RANGE_MS = 5 * 60 * 1000; // ±5 minutes

export interface SchedulerHandle {
  /** Cancel the scheduled distill job. */
  stop: () => void;
  /** ISO string of the next scheduled trigger time. */
  nextTrigger: string;
}

/**
 * Parse the schedule time from config.distill.schedule.
 * Supports cron "0 18 * * *" (extracts hour/minute) or simple "HH:MM".
 * Returns [hour, minute].
 */
export function parseScheduleTime(schedule: string): [number, number] {
  // Simple HH:MM format
  const hmMatch = schedule.match(/^(\d{1,2}):(\d{2})$/);
  if (hmMatch) {
    return [Number.parseInt(hmMatch[1], 10), Number.parseInt(hmMatch[2], 10)];
  }

  // Cron format: "min hour * * *"
  const parts = schedule.trim().split(/\s+/);
  if (parts.length >= 2) {
    const minute = Number.parseInt(parts[0], 10);
    const hour = Number.parseInt(parts[1], 10);
    if (!Number.isNaN(hour) && !Number.isNaN(minute)) {
      return [hour, minute];
    }
  }

  // Default: 18:00
  logger.warn("Could not parse schedule, defaulting to 18:00", { schedule });
  return [18, 0];
}

/**
 * Convert config schedule string to a valid cron pattern for Croner.
 */
function toCronPattern(schedule: string): string {
  // If already a valid 5-part cron, use directly
  const parts = schedule.trim().split(/\s+/);
  if (parts.length === 5 && !Number.isNaN(Number(parts[0])) && !Number.isNaN(Number(parts[1]))) {
    return schedule.trim();
  }

  // HH:MM → "0 HH MM * * *" (Croner supports seconds)
  const [hour, minute] = parseScheduleTime(schedule);
  return `${minute} ${hour} * * *`;
}

/**
 * Start the distillation scheduler using Croner.
 * Returns a handle to stop the scheduler.
 */
export function startScheduler(config: UnfadeConfig, cwd?: string): SchedulerHandle {
  const cronPattern = toCronPattern(config.distill.schedule);

  const job = new Cron(cronPattern, { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }, async () => {
    // Apply jitter: delay ±5 minutes randomly
    const jitter = Math.floor(Math.random() * JITTER_RANGE_MS * 2) - JITTER_RANGE_MS;
    if (jitter > 0) {
      await new Promise((r) => setTimeout(r, jitter));
    }

    const today = new Date().toISOString().slice(0, 10);

    // Skip zero-event days
    const eventCount = countEvents(today, cwd);
    if (eventCount === 0) {
      logger.debug("Zero events today, skipping scheduled distill", { date: today });
      logBuffer.append("scheduler", "debug", `Zero events for ${today}, skipping distill`);
      return;
    }

    // Skip if distill is already fresh
    if (isDistillFresh(today, cwd)) {
      logger.debug("Distill already exists with no new events since, skipping", { date: today });
      logBuffer.append("scheduler", "info", `Distill for ${today} already fresh, skipping`);
      return;
    }

    try {
      await distill(today, config, { cwd });
      logger.debug("Scheduled distillation complete", { date: today });
      logBuffer.append("scheduler", "info", `Distill completed for ${today}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Scheduled distillation failed", { date: today, error: msg });
      logBuffer.append("scheduler", "error", `Distill failed for ${today}: ${msg}`);
    }
  });

  logger.debug("Scheduler started", {
    pattern: cronPattern,
    nextRun: job.nextRun()?.toISOString() ?? "unknown",
  });

  return {
    stop: () => job.stop(),
    get nextTrigger() {
      return job.nextRun()?.toISOString() ?? "unknown";
    },
  };
}

/**
 * Check if a distill for the given date already exists AND no new events have arrived since.
 */
function isDistillFresh(date: string, cwd?: string): boolean {
  try {
    const distillPath = join(getDistillsDir(cwd), `${date}.md`);
    if (!existsSync(distillPath)) return false;

    const distillMtime = statSync(distillPath).mtimeMs;

    const eventsPath = join(getEventsDir(cwd), `${date}.jsonl`);
    if (!existsSync(eventsPath)) return true; // distill exists, no events file — fresh
    const eventsMtime = statSync(eventsPath).mtimeMs;

    return eventsMtime <= distillMtime;
  } catch {
    return false;
  }
}
