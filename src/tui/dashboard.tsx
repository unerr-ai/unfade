// FILE: src/tui/dashboard.tsx
// UF-019: TUI dashboard orchestrator.
// On mount: detectState(). If not_initialized → run init, then show dashboard.
// If daemon_stopped → silently restart, then show dashboard.
// Otherwise → show dashboard.
// CRITICAL: Renders to stderr — stdout is sacred for MCP.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "ink";
import type React from "react";
import { useEffect, useState } from "react";
import { openInBrowser } from "../commands/open.js";
import { DashboardView, type PersonalizationLevel } from "../components/DashboardView.js";
import { loadConfig } from "../config/manager.js";
import type { UnfadeConfig } from "../schemas/config.js";
import type { DailyDistill } from "../schemas/distill.js";
import { countEvents } from "../services/capture/event-store.js";
import { distill } from "../services/distill/distiller.js";
import type { ReasoningProfile } from "../services/personalization/profile-builder.js";
import { detectState, type StateDetails } from "../state/detector.js";
import { logger } from "../utils/logger.js";
import { getDistillsDir, getProfileDir } from "../utils/paths.js";

// ---------------------------------------------------------------------------
// Data loaders
// ---------------------------------------------------------------------------

/**
 * Find the most recent distill file (not just today's).
 * Returns parsed DailyDistill or null.
 */
function loadLatestDistill(cwd?: string): DailyDistill | null {
  const distillsDir = getDistillsDir(cwd);
  if (!existsSync(distillsDir)) return null;

  let files: string[];
  try {
    files = readdirSync(distillsDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort()
      .reverse();
  } catch {
    return null;
  }

  if (files.length === 0) return null;

  // Try to load the companion JSON (distills may also store .json alongside .md)
  // Fallback: parse the markdown for basic info
  const latestDate = files[0].replace(".md", "");

  // Check if there's a JSONL graph entry we can use for structured data
  // For now, read the markdown and extract what we can
  const mdPath = join(distillsDir, files[0]);
  try {
    const content = readFileSync(mdPath, "utf-8");
    return parseDistillMarkdown(content, latestDate);
  } catch {
    return null;
  }
}

/**
 * Parse a distill markdown file back into a DailyDistill.
 * Extracts structured data from the markdown format written by distiller.ts.
 */
function parseDistillMarkdown(content: string, date: string): DailyDistill {
  const lines = content.split("\n");

  // Extract summary from blockquote
  let summary = "";
  const decisions: DailyDistill["decisions"] = [];
  const tradeOffs: NonNullable<DailyDistill["tradeOffs"]> = [];
  const deadEnds: NonNullable<DailyDistill["deadEnds"]> = [];
  const breakthroughs: NonNullable<DailyDistill["breakthroughs"]> = [];
  const patterns: string[] = [];
  let eventsProcessed = 0;
  let synthesizedBy: "llm" | "fallback" = "fallback";
  let currentSection = "";

  for (const line of lines) {
    // Summary (blockquote)
    if (line.startsWith("> ")) {
      summary = line.slice(2).trim();
      continue;
    }

    // Events processed
    const eventsMatch = line.match(/\*\*Events processed:\*\*\s*(\d+)/);
    if (eventsMatch) {
      eventsProcessed = Number.parseInt(eventsMatch[1], 10);
      continue;
    }

    // Synthesized by
    const synthMatch = line.match(/\*\*Synthesized by:\*\*\s*(\w+)/);
    if (synthMatch) {
      synthesizedBy = synthMatch[1] === "llm" ? "llm" : "fallback";
      continue;
    }

    // Section headers
    if (line.startsWith("## ")) {
      currentSection = line.slice(3).trim().toLowerCase();
      continue;
    }

    // Decision items
    if (currentSection === "decisions" && line.startsWith("- **")) {
      const match = line.match(/^- \*\*(.+?)\*\*/);
      if (match) {
        decisions.push({ decision: match[1], rationale: "" });
      }
      continue;
    }

    // Decision rationale (indented italic following a decision)
    if (currentSection === "decisions" && line.match(/^\s+_(.+)_$/) && decisions.length > 0) {
      const match = line.match(/^\s+_(.+)_$/);
      if (match) {
        decisions[decisions.length - 1].rationale = match[1];
      }
      continue;
    }

    // Trade-off items
    if (currentSection === "trade-offs" && line.startsWith("- **")) {
      const match = line.match(/^- \*\*(.+?)\*\*/);
      if (match) {
        tradeOffs.push({ tradeOff: match[1], chose: "", rejected: "" });
      }
      continue;
    }

    // Dead end items
    if (currentSection === "dead ends" && line.startsWith("- **")) {
      const match = line.match(/^- \*\*(.+?)\*\*/);
      if (match) {
        deadEnds.push({ description: match[1] });
      }
      continue;
    }

    // Breakthrough items
    if (currentSection === "breakthroughs" && line.startsWith("- **")) {
      const match = line.match(/^- \*\*(.+?)\*\*/);
      if (match) {
        breakthroughs.push({ description: match[1] });
      }
      continue;
    }

    // Pattern items
    if (currentSection === "patterns" && line.startsWith("- ")) {
      patterns.push(line.slice(2).trim());
    }
  }

  return {
    date,
    summary: summary || "Daily reasoning summary",
    decisions,
    tradeOffs: tradeOffs.length > 0 ? tradeOffs : undefined,
    deadEnds: deadEnds.length > 0 ? deadEnds : undefined,
    breakthroughs: breakthroughs.length > 0 ? breakthroughs : undefined,
    patterns: patterns.length > 0 ? patterns : undefined,
    eventsProcessed,
    synthesizedBy,
  };
}

/**
 * Load reasoning profile and compute personalization level.
 */
function loadPersonalizationLevel(cwd?: string): PersonalizationLevel {
  const profileDir = getProfileDir(cwd);
  const profilePath = join(profileDir, "reasoning_model.json");

  if (!existsSync(profilePath)) {
    return { level: 0, label: "New", distillCount: 0 };
  }

  try {
    const profile = JSON.parse(readFileSync(profilePath, "utf-8")) as ReasoningProfile;
    const count = profile.distillCount;

    // Level thresholds: 0=New, 1=Learning(1-2), 2=Developing(3-6), 3=Established(7-14), 4=Deep(15-29), 5=Expert(30+)
    let level: number;
    let label: string;
    if (count === 0) {
      level = 0;
      label = "New";
    } else if (count <= 2) {
      level = 1;
      label = "Learning";
    } else if (count <= 6) {
      level = 2;
      label = "Developing";
    } else if (count <= 14) {
      level = 3;
      label = "Established";
    } else if (count <= 29) {
      level = 4;
      label = "Deep";
    } else {
      level = 5;
      label = "Expert";
    }

    return { level, label, distillCount: count };
  } catch {
    return { level: 0, label: "New", distillCount: 0 };
  }
}

// ---------------------------------------------------------------------------
// App component
// ---------------------------------------------------------------------------

function App({ config }: { config: UnfadeConfig }): React.ReactElement | null {
  const [state, setState] = useState<StateDetails | null>(null);
  const [todayEventCount, setTodayEventCount] = useState(0);
  const [latestDistill, setLatestDistill] = useState<DailyDistill | null>(null);
  const [personalization, setPersonalization] = useState<PersonalizationLevel>({
    level: 0,
    label: "New",
    distillCount: 0,
  });

  useEffect(() => {
    // Detect state
    const detected = detectState({ skipLlmCheck: true });
    setState(detected);

    // Load dashboard data
    const today = new Date().toISOString().slice(0, 10);
    setTodayEventCount(countEvents(today));
    setLatestDistill(loadLatestDistill());
    setPersonalization(loadPersonalizationLevel());
  }, []);

  if (!state) {
    return null;
  }

  return (
    <DashboardView
      state={state}
      todayEventCount={todayEventCount}
      latestDistill={latestDistill}
      personalizationLevel={personalization}
      onDistill={async () => {
        const today = new Date().toISOString().slice(0, 10);
        const result = await distill(today, config);
        if (result) {
          setLatestDistill(result.distill);
          setTodayEventCount(countEvents(today));
          setPersonalization(loadPersonalizationLevel());
          return result.distill;
        }
        logger.info("No events today. Nothing to distill.");
        return null;
      }}
      onOpenWeb={() => {
        const url = `http://localhost:${config.mcp.httpPort}`;
        openInBrowser(url);
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Launch the TUI dashboard.
 * Detects state, handles routing (init if needed), renders to stderr.
 */
export async function launchDashboard(): Promise<void> {
  const state = detectState({ skipLlmCheck: true });

  // If not initialized, run init first
  if (state.state === "not_initialized") {
    const { runInit } = await import("../services/init/runner.js");
    await runInit(process.cwd());
  }

  const config = loadConfig();

  // CRITICAL: Render to stderr — stdout is sacred for MCP
  const instance = render(<App config={config} />, {
    stdout: process.stderr,
    stderr: process.stderr,
  });

  await instance.waitUntilExit();
}
