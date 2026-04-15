// FILE: src/services/distill/signal-extractor.ts
// UF-032: Stage 1 — Signal Extractor.
// Parses a day's CaptureEvents into structured reasoning signals.
// No LLM. Never throws.

import type { ExtractedSignals } from "../../schemas/distill.js";
import type { CaptureEvent } from "../../schemas/event.js";
import { logger } from "../../utils/logger.js";

const DOMAIN_MAP: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript/React",
  ".js": "JavaScript",
  ".jsx": "JavaScript/React",
  ".go": "Go",
  ".py": "Python",
  ".rs": "Rust",
  ".java": "Java",
  ".css": "Styles",
  ".html": "Markup",
  ".sql": "Database",
  ".yml": "Config",
  ".yaml": "Config",
  ".json": "Config",
  ".md": "Docs",
  ".sh": "Shell",
  ".dockerfile": "Infrastructure",
};

const FIX_PATTERN = /\b(fix|hotfix|patch|bugfix|repair|resolve)\b/i;
const RAPID_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Extract domains from file extensions.
 */
function domainsFromFiles(files: string[]): string[] {
  const domains = new Set<string>();
  for (const file of files) {
    const dotIdx = file.lastIndexOf(".");
    if (dotIdx === -1) continue;
    const ext = file.slice(dotIdx).toLowerCase();
    const domain = DOMAIN_MAP[ext];
    if (domain) domains.add(domain);
  }
  return Array.from(domains).sort();
}

/**
 * Collect all unique files across events.
 */
function collectFiles(events: CaptureEvent[]): string[] {
  const files = new Set<string>();
  for (const event of events) {
    for (const f of event.content.files ?? []) {
      files.add(f);
    }
  }
  return Array.from(files).sort();
}

/**
 * Count branch names seen across commit events to estimate alternatives.
 * Multiple branches touching the same files → decision with alternatives.
 */
function countBranches(events: CaptureEvent[]): Map<string, Set<string>> {
  const fileToBranches = new Map<string, Set<string>>();
  for (const event of events) {
    if (event.type !== "commit") continue;
    const branch = event.content.branch ?? event.gitContext?.branch;
    if (!branch) continue;
    for (const file of event.content.files ?? []) {
      if (!fileToBranches.has(file)) fileToBranches.set(file, new Set());
      fileToBranches.get(file)?.add(branch);
    }
  }
  return fileToBranches;
}

/**
 * Detect rapid fix commits (debugging sessions).
 * Groups sequential commits with "fix" in summary within a 30-min window.
 */
function detectDebuggingSessions(commits: CaptureEvent[]): ExtractedSignals["debuggingSessions"] {
  const sessions: ExtractedSignals["debuggingSessions"] = [];
  const fixCommits = commits.filter((e) => FIX_PATTERN.test(e.content.summary));

  if (fixCommits.length < 2) return sessions;

  let currentGroup: CaptureEvent[] = [fixCommits[0]];

  for (let i = 1; i < fixCommits.length; i++) {
    const prev = new Date(fixCommits[i - 1].timestamp).getTime();
    const curr = new Date(fixCommits[i].timestamp).getTime();

    if (curr - prev <= RAPID_WINDOW_MS) {
      currentGroup.push(fixCommits[i]);
    } else {
      if (currentGroup.length >= 2) {
        sessions.push({
          eventIds: currentGroup.map((e) => e.id),
          summary: `Debugging session: ${currentGroup.length} fix commits — ${currentGroup[0].content.summary}`,
          fixCount: currentGroup.length,
        });
      }
      currentGroup = [fixCommits[i]];
    }
  }

  if (currentGroup.length >= 2) {
    sessions.push({
      eventIds: currentGroup.map((e) => e.id),
      summary: `Debugging session: ${currentGroup.length} fix commits — ${currentGroup[0].content.summary}`,
      fixCount: currentGroup.length,
    });
  }

  return sessions;
}

/**
 * Extract structured reasoning signals from a day's events.
 * Never throws — returns empty signals on any error.
 */
export function extractSignals(events: CaptureEvent[], date: string): ExtractedSignals {
  try {
    return doExtract(events, date);
  } catch (err) {
    logger.warn("Signal extraction failed, returning empty signals", {
      error: String(err),
    });
    return emptySignals(date);
  }
}

function doExtract(events: CaptureEvent[], date: string): ExtractedSignals {
  const commits = events.filter((e) => e.type === "commit");
  const aiCompletions = events.filter((e) => e.type === "ai-completion");
  const aiRejections = events.filter((e) => e.type === "ai-rejection");
  const branchSwitches = events.filter((e) => e.type === "branch-switch");
  const reverts = events.filter((e) => e.type === "revert");

  const fileToBranches = countBranches(events);
  const allFiles = collectFiles(events);
  const domains = domainsFromFiles(allFiles);

  // --- Decisions: each commit is a decision; count alternatives from branch overlap ---
  const decisions: ExtractedSignals["decisions"] = commits.map((event) => {
    const branch = event.content.branch ?? event.gitContext?.branch;
    const eventFiles = event.content.files ?? [];

    // Count how many branches touch the same files as this commit
    let maxBranches = 0;
    for (const file of eventFiles) {
      const branches = fileToBranches.get(file);
      if (branches && branches.size > maxBranches) {
        maxBranches = branches.size;
      }
    }

    return {
      eventId: event.id,
      summary: event.content.summary,
      branch,
      alternativesCount: Math.max(0, maxBranches - 1),
    };
  });

  // --- Trade-offs: AI rejections indicate the developer chose differently ---
  const tradeOffs: ExtractedSignals["tradeOffs"] = aiRejections.map((event) => ({
    eventId: event.id,
    summary: event.content.summary,
    relatedFiles: event.content.files,
  }));

  // --- Dead ends: reverts, with time-spent estimated from preceding commits ---
  const deadEnds: ExtractedSignals["deadEnds"] = reverts.map((event) => {
    let timeSpentMinutes: number | undefined;

    // Estimate time spent: look for the earliest commit on the same branch
    // before this revert
    const branch = event.content.branch ?? event.gitContext?.branch;
    if (branch) {
      const revertTime = new Date(event.timestamp).getTime();
      const branchCommits = commits.filter((c) => {
        const cBranch = c.content.branch ?? c.gitContext?.branch;
        return cBranch === branch && new Date(c.timestamp).getTime() < revertTime;
      });
      if (branchCommits.length > 0) {
        const earliest = Math.min(...branchCommits.map((c) => new Date(c.timestamp).getTime()));
        timeSpentMinutes = Math.round((revertTime - earliest) / 60_000);
      }
    }

    return {
      revertEventId: event.id,
      summary: event.content.summary,
      timeSpentMinutes,
    };
  });

  // --- Breakthroughs: heuristic — large commits after a period of small ones ---
  const breakthroughs: ExtractedSignals["breakthroughs"] = [];
  if (commits.length >= 3) {
    const sorted = [...commits].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
    for (let i = 2; i < sorted.length; i++) {
      const prevSizes = [
        sorted[i - 2].content.files?.length ?? 0,
        sorted[i - 1].content.files?.length ?? 0,
      ];
      const currSize = sorted[i].content.files?.length ?? 0;
      const avgPrev = (prevSizes[0] + prevSizes[1]) / 2;
      // A commit touching 3x more files than recent average is a breakthrough candidate
      if (avgPrev > 0 && currSize >= avgPrev * 3 && currSize >= 5) {
        breakthroughs.push({
          eventId: sorted[i].id,
          summary: sorted[i].content.summary,
        });
      }
    }
  }

  // --- Debugging sessions ---
  const debuggingSessions = detectDebuggingSessions(commits);

  return {
    date,
    decisions,
    tradeOffs,
    deadEnds,
    breakthroughs,
    debuggingSessions,
    stats: {
      totalEvents: events.length,
      commitCount: commits.length,
      aiCompletions: aiCompletions.length,
      aiRejections: aiRejections.length,
      branchSwitches: branchSwitches.length,
      reverts: reverts.length,
      filesChanged: allFiles,
      domains,
    },
  };
}

function emptySignals(date: string): ExtractedSignals {
  return {
    date,
    decisions: [],
    tradeOffs: [],
    deadEnds: [],
    breakthroughs: [],
    debuggingSessions: [],
    stats: {
      totalEvents: 0,
      commitCount: 0,
      aiCompletions: 0,
      aiRejections: 0,
      branchSwitches: 0,
      reverts: 0,
      filesChanged: [],
      domains: [],
    },
  };
}
