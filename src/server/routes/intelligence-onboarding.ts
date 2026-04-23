// FILE: src/server/routes/intelligence-onboarding.ts
// UF-116: Intelligence onboarding — computes progress toward each intelligence metric.
// Returns "N more days/sessions until X" for each capability not yet calibrated.

import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { getEventsDir, getProjectDataDir } from "../../utils/paths.js";

export const onboardingRoutes = new Hono();

interface OnboardingProgress {
  capability: string;
  ready: boolean;
  current: number;
  required: number;
  unit: string;
  hint: string;
}

onboardingRoutes.get("/api/intelligence/onboarding", async (c) => {
  const dataDir = getProjectDataDir();
  const eventsDir = getEventsDir();
  const intelligenceDir = join(dataDir, "intelligence");

  const totalEvents = await countTotalEvents(eventsDir);
  const totalDays = countEventDays(eventsDir);

  const progress: OnboardingProgress[] = [
    {
      capability: "AI Efficiency Score",
      ready: existsSync(join(intelligenceDir, "efficiency.json")),
      current: totalEvents,
      required: 5,
      unit: "AI interactions",
      hint: totalEvents >= 5 ? "Ready!" : `${5 - totalEvents} more AI interactions needed`,
    },
    {
      capability: "Cost Attribution",
      ready: existsSync(join(intelligenceDir, "costs.json")),
      current: totalEvents,
      required: 3,
      unit: "AI interactions",
      hint:
        totalEvents >= 3
          ? "Configure pricing in Settings for estimates"
          : `${3 - totalEvents} more interactions`,
    },
    {
      capability: "Comprehension Radar",
      ready: existsSync(join(intelligenceDir, "comprehension.json")),
      current: totalEvents,
      required: 5,
      unit: "AI interactions",
      hint: totalEvents >= 5 ? "Ready!" : `${5 - totalEvents} more interactions`,
    },
    {
      capability: "Prompt Coach",
      ready: existsSync(join(intelligenceDir, "prompt-patterns.json")),
      current: totalEvents,
      required: 10,
      unit: "AI interactions",
      hint:
        totalEvents >= 10
          ? "Ready!"
          : `${10 - totalEvents} more interactions for pattern detection`,
    },
    {
      capability: "Loop Detector",
      ready: existsSync(join(intelligenceDir, "rejections.idx.json")),
      current: totalEvents,
      required: 5,
      unit: "AI interactions",
      hint: "Activates when low-direction patterns are detected",
    },
    {
      capability: "Reasoning Velocity",
      ready: existsSync(join(intelligenceDir, "velocity.json")),
      current: totalDays,
      required: 14,
      unit: "days of data",
      hint: totalDays >= 14 ? "Ready!" : `${14 - totalDays} more days until velocity trends appear`,
    },
    {
      capability: "Blind Spot Alerts",
      ready: existsSync(join(intelligenceDir, "alerts.json")),
      current: totalDays,
      required: 14,
      unit: "days of data",
      hint:
        totalDays >= 14
          ? "Monitoring for sustained patterns"
          : `${14 - totalDays} more days until alerts activate`,
    },
    {
      capability: "Decision Replay",
      ready: existsSync(join(intelligenceDir, "replays.json")),
      current: totalDays,
      required: 30,
      unit: "days of data",
      hint:
        totalDays >= 30
          ? "Cross-temporal matching active"
          : `${30 - totalDays} more days until replay suggestions appear`,
    },
  ];

  return c.json({
    totalEvents,
    totalDays,
    progress,
    overallReadiness: Math.round((progress.filter((p) => p.ready).length / progress.length) * 100),
  });
});

async function countTotalEvents(eventsDir: string): Promise<number> {
  if (!existsSync(eventsDir)) return 0;
  try {
    let total = 0;
    const files = readdirSync(eventsDir).filter((f) => f.endsWith(".jsonl"));
    for (const file of files) {
      const content = await readFile(join(eventsDir, file), "utf-8");
      total += content.split("\n").filter((l) => l.trim()).length;
    }
    return total;
  } catch {
    return 0;
  }
}

function countEventDays(eventsDir: string): number {
  if (!existsSync(eventsDir)) return 0;
  try {
    return readdirSync(eventsDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).length;
  } catch {
    return 0;
  }
}
