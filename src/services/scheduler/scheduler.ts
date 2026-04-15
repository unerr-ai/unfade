// FILE: src/services/scheduler/scheduler.ts
// UF-036: Scheduler — cron-like distillation trigger.
// Configurable time (default 18:00 local), jitter ±5 min.
// Runs within daemon process via setTimeout chain.
// Skip zero-event days silently.

import type { UnfadeConfig } from "../../schemas/config.js";
import { logger } from "../../utils/logger.js";
import { countEvents } from "../capture/event-store.js";
import { distill } from "../distill/distiller.js";

const JITTER_RANGE_MS = 5 * 60 * 1000; // ±5 minutes

export interface SchedulerHandle {
  /** Cancel the next scheduled distill. */
  stop: () => void;
  /** ISO string of the next scheduled trigger time. */
  nextTrigger: string;
}

/**
 * Parse the schedule time from config.distill.schedule.
 * Supports cron "0 18 * * *" (extracts hour/minute) or simple "HH:MM".
 * Returns [hour, minute].
 */
function parseScheduleTime(schedule: string): [number, number] {
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
 * Add random jitter of ±5 minutes (uniform).
 */
function addJitter(): number {
  return Math.floor(Math.random() * JITTER_RANGE_MS * 2) - JITTER_RANGE_MS;
}

/**
 * Compute ms until the next trigger time (today or tomorrow).
 */
function msUntilTrigger(hour: number, minute: number): { ms: number; target: Date } {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);

  // If the target time already passed today, schedule for tomorrow
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }

  // Add jitter
  const jitter = addJitter();
  const triggerTime = new Date(target.getTime() + jitter);
  const ms = triggerTime.getTime() - now.getTime();

  return { ms: Math.max(ms, 1000), target: triggerTime };
}

/**
 * Start the distillation scheduler.
 * Computes next trigger from config, sets timeout, chains to next day on completion.
 * Returns a handle to stop the scheduler.
 */
export function startScheduler(config: UnfadeConfig, cwd?: string): SchedulerHandle {
  const [hour, minute] = parseScheduleTime(config.distill.schedule);
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let nextTriggerDate: Date;

  function scheduleNext(): void {
    if (stopped) return;

    const { ms, target } = msUntilTrigger(hour, minute);
    nextTriggerDate = target;

    logger.debug("Scheduled next distill", {
      trigger: target.toISOString(),
      msUntil: ms,
    });

    timerId = setTimeout(async () => {
      if (stopped) return;

      const today = new Date().toISOString().slice(0, 10);

      // Skip zero-event days — silence is correct
      const eventCount = countEvents(today, cwd);
      if (eventCount === 0) {
        logger.debug("Zero events today, skipping scheduled distill", { date: today });
      } else {
        try {
          await distill(today, config, { cwd });
          logger.debug("Scheduled distillation complete", { date: today });
        } catch (err) {
          logger.error("Scheduled distillation failed", {
            date: today,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Reschedule for next day
      scheduleNext();
    }, ms);
  }

  scheduleNext();

  return {
    stop: () => {
      stopped = true;
      if (timerId) clearTimeout(timerId);
    },
    get nextTrigger() {
      return nextTriggerDate?.toISOString() ?? "unknown";
    },
  };
}

export { parseScheduleTime };
