// FILE: src/services/knowledge/segmenter.ts
// Structural topic segmentation for developer-AI conversations.
// Splits multi-topic conversations into coherent segments using 4 signals:
//   1. File-path discontinuity — module boundaries
//   2. Explicit discourse markers — "now let's", "switching to", etc.
//   3. Tool-use cluster gaps — long text gaps between tool-heavy sections
//   4. Temporal gaps — > 5 minute pause between turns
//
// Segments < 3 turns are merged into their nearest neighbor.
// Non-conversation events (git, terminal) produce a single segment.

import type { ConversationSegment, SegmentMethod } from "../../schemas/knowledge.js";
import type { Turn } from "./turn-parser.js";

/** Minimum turns for a segment to survive independently (below this → merge). */
const MIN_SEGMENT_TURNS = 3;

/** Timestamp gap in milliseconds that triggers a boundary (5 minutes). */
const TEMPORAL_GAP_MS = 5 * 60 * 1000;

/** Number of consecutive non-tool turns that constitutes a "cluster gap". */
const TOOL_CLUSTER_GAP = 3;

/**
 * Discourse markers in user turns that signal an explicit topic switch.
 * Ordered by specificity — longest patterns first to avoid partial matches.
 */
const DISCOURSE_MARKERS = [
  /\bdifferent\s+topic\b/i,
  /\bmoving\s+on\s+to\b/i,
  /\bswitching\s+to\b/i,
  /\bnow\s+let['']?s\b/i,
  /\balso\s+need\s+to\b/i,
  /\bback\s+to\s+the\b/i,
  /\bseparately\b/i,
  /\bnext[,:]?\s/i,
];

/**
 * Segment a conversation's turns into topically coherent segments.
 *
 * For conversations with structured turns (AI sessions), applies 4-signal
 * structural segmentation. For non-conversation events or very short
 * conversations (< MIN_SEGMENT_TURNS), returns a single segment.
 */
export function segmentConversation(
  turns: Turn[],
  episodeId: string,
): ConversationSegment[] {
  if (turns.length === 0) return [];

  // Short conversations or non-conversation events → single segment
  if (turns.length < MIN_SEGMENT_TURNS) {
    return [buildSegment(episodeId, turns, 0, turns.length - 1, "structural")];
  }

  // Detect boundary indices using all 4 signals
  const boundaries = detectBoundaries(turns);

  // Split turns at boundaries into raw segments
  const rawSegments = splitAtBoundaries(turns, boundaries);

  // Merge undersized segments into neighbors
  const merged = mergeSmallSegments(rawSegments);

  // Build ConversationSegment records
  return merged.map((range, i) =>
    buildSegment(episodeId, turns, range[0], range[1], "structural"),
  );
}

// ─── Boundary Detection ──────────────────────────────────────────────────────

/** Returns sorted, deduplicated turn indices where a new segment should begin. */
function detectBoundaries(turns: Turn[]): number[] {
  const boundarySet = new Set<number>();

  for (let i = 1; i < turns.length; i++) {
    const prev = turns[i - 1];
    const curr = turns[i];

    // Signal 1: File-path discontinuity
    if (hasFileDiscontinuity(prev, curr)) {
      boundarySet.add(i);
    }

    // Signal 2: Explicit discourse markers (user turns only)
    if (curr.role === "user" && hasDiscourseMarker(curr.content)) {
      boundarySet.add(i);
    }

    // Signal 4: Temporal gap > 5 minutes
    if (hasTemporalGap(prev, curr)) {
      boundarySet.add(i);
    }
  }

  // Signal 3: Tool-use cluster gaps (requires wider window)
  const toolGapBoundaries = detectToolClusterGaps(turns);
  for (const b of toolGapBoundaries) {
    boundarySet.add(b);
  }

  return Array.from(boundarySet).sort((a, b) => a - b);
}

/**
 * Signal 1: File-path discontinuity.
 * Returns true when the two turns reference files in different modules
 * (no common parent directory within 2 levels).
 */
function hasFileDiscontinuity(prev: Turn, curr: Turn): boolean {
  const prevFiles = gatherFiles(prev);
  const currFiles = gatherFiles(curr);

  // No files on either side → no signal
  if (prevFiles.length === 0 || currFiles.length === 0) return false;

  const prevModules = new Set(prevFiles.map(getModulePath));
  const currModules = new Set(currFiles.map(getModulePath));

  // Check if ANY module overlaps within 2 directory levels
  for (const pm of prevModules) {
    for (const cm of currModules) {
      if (modulesShareParent(pm, cm)) return false;
    }
  }

  return true;
}

/** Extract the module path (first 2 directory segments) from a file path. */
function getModulePath(filePath: string): string {
  const parts = filePath.replace(/^\//, "").split("/");
  return parts.slice(0, Math.min(2, parts.length)).join("/");
}

/** Check if two module paths share a common parent within 2 directory levels. */
function modulesShareParent(a: string, b: string): boolean {
  if (a === b) return true;
  const aParts = a.split("/");
  const bParts = b.split("/");
  // Share at least the first directory component
  return aParts.length > 0 && bParts.length > 0 && aParts[0] === bParts[0];
}

/** Collect all files from a turn (both referenced and modified). */
function gatherFiles(turn: Turn): string[] {
  const files: string[] = [];
  if (turn.filesReferenced) files.push(...turn.filesReferenced);
  if (turn.filesModified) files.push(...turn.filesModified);
  return files;
}

/**
 * Signal 2: Explicit discourse markers.
 * Returns true if the content contains any topic-switch phrase.
 */
function hasDiscourseMarker(content: string): boolean {
  return DISCOURSE_MARKERS.some((re) => re.test(content));
}

/**
 * Signal 3: Tool-use cluster gaps.
 * Detects boundaries where there's a gap of > TOOL_CLUSTER_GAP pure-text turns
 * between tool-using sections, AND the file targets shift.
 */
function detectToolClusterGaps(turns: Turn[]): number[] {
  const boundaries: number[] = [];

  let lastToolTurnIdx = -1;
  let lastToolFiles: string[] = [];

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    const hasTools = turn.toolUse && turn.toolUse.length > 0;

    if (hasTools) {
      const currentFiles = gatherFiles(turn);

      if (lastToolTurnIdx >= 0) {
        const gap = i - lastToolTurnIdx - 1;

        if (gap > TOOL_CLUSTER_GAP && currentFiles.length > 0 && lastToolFiles.length > 0) {
          // Check if file targets shifted
          const prevModules = new Set(lastToolFiles.map(getModulePath));
          const currModules = new Set(currentFiles.map(getModulePath));
          let overlap = false;
          for (const pm of prevModules) {
            if (currModules.has(pm)) { overlap = true; break; }
          }
          if (!overlap) {
            // Boundary at the first non-tool turn after the last tool turn
            boundaries.push(lastToolTurnIdx + 1);
          }
        }
      }

      lastToolTurnIdx = i;
      lastToolFiles = currentFiles;
    }
  }

  return boundaries;
}

/**
 * Signal 4: Temporal gap > 5 minutes.
 * Returns true if both turns have timestamps and the gap exceeds the threshold.
 */
function hasTemporalGap(prev: Turn, curr: Turn): boolean {
  if (!prev.timestamp || !curr.timestamp) return false;

  const prevMs = new Date(prev.timestamp).getTime();
  const currMs = new Date(curr.timestamp).getTime();

  if (Number.isNaN(prevMs) || Number.isNaN(currMs)) return false;

  return currMs - prevMs > TEMPORAL_GAP_MS;
}

// ─── Segment Construction ────────────────────────────────────────────────────

/** Split turns into ranges at the given boundary indices. */
function splitAtBoundaries(turns: Turn[], boundaries: number[]): Array<[number, number]> {
  if (boundaries.length === 0) {
    return [[0, turns.length - 1]];
  }

  const ranges: Array<[number, number]> = [];
  let start = 0;

  for (const boundary of boundaries) {
    if (boundary > start) {
      ranges.push([start, boundary - 1]);
    }
    start = boundary;
  }

  // Final segment
  if (start < turns.length) {
    ranges.push([start, turns.length - 1]);
  }

  return ranges;
}

/**
 * Merge segments with fewer than MIN_SEGMENT_TURNS turns into their nearest neighbor.
 * Small segments merge into the preceding segment if one exists, else the following.
 */
function mergeSmallSegments(ranges: Array<[number, number]>): Array<[number, number]> {
  if (ranges.length <= 1) return ranges;

  const merged: Array<[number, number]> = [];

  for (let i = 0; i < ranges.length; i++) {
    const [start, end] = ranges[i];
    const turnCount = end - start + 1;

    if (turnCount < MIN_SEGMENT_TURNS && merged.length > 0) {
      // Merge into previous segment
      merged[merged.length - 1][1] = end;
    } else if (turnCount < MIN_SEGMENT_TURNS && i + 1 < ranges.length) {
      // No previous segment — merge into next by expanding next's start
      ranges[i + 1][0] = start;
    } else {
      merged.push([start, end]);
    }
  }

  return merged;
}

/** Build a ConversationSegment from a turn range. */
function buildSegment(
  episodeId: string,
  turns: Turn[],
  startIdx: number,
  endIdx: number,
  method: SegmentMethod,
): ConversationSegment {
  const segmentTurns = turns.slice(startIdx, endIdx + 1);

  // Collect all files in scope
  const filesSet = new Set<string>();
  for (const turn of segmentTurns) {
    if (turn.filesReferenced) turn.filesReferenced.forEach((f) => filesSet.add(f));
    if (turn.filesModified) turn.filesModified.forEach((f) => filesSet.add(f));
  }
  const filesInScope = Array.from(filesSet).sort();

  // Derive module-level classification from file paths
  const moduleSet = new Set<string>();
  for (const f of filesInScope) {
    moduleSet.add(getModulePath(f));
  }
  const modulesInScope = Array.from(moduleSet).sort();

  // Heuristic topic label from files/modules or first user turn content
  const topicLabel = deriveTopicLabel(segmentTurns, modulesInScope);

  // Summary from user turn content (first user turn's opening + scope)
  const summary = deriveSummary(segmentTurns, filesInScope);

  // Segment index derived from startIdx position relative to episode
  const segmentIndex = startIdx === 0 ? 0 : startIdx;

  return {
    segmentId: `${episodeId}:seg-${startIdx}`,
    episodeId,
    turnRange: [startIdx, endIdx],
    topicLabel,
    summary,
    filesInScope,
    modulesInScope,
    segmentMethod: method,
  };
}

/**
 * Derive a heuristic topic label from the segment's turns and modules.
 * Uses modules if available, otherwise extracts from the first user turn.
 */
function deriveTopicLabel(turns: Turn[], modules: string[]): string {
  if (modules.length > 0) {
    return modules.length <= 3
      ? modules.join(", ")
      : `${modules.slice(0, 3).join(", ")} (+${modules.length - 3} more)`;
  }

  // Fall back to first user turn content (truncated)
  const firstUser = turns.find((t) => t.role === "user");
  if (firstUser) {
    const text = firstUser.content.trim();
    // Take first sentence or first 80 chars
    const sentenceEnd = text.search(/[.!?\n]/);
    if (sentenceEnd > 0 && sentenceEnd <= 80) {
      return text.slice(0, sentenceEnd).trim();
    }
    return text.length > 80 ? `${text.slice(0, 77)}...` : text;
  }

  return "conversation segment";
}

/**
 * Derive a brief summary of what was discussed in this segment.
 * Combines user intent (from user turns) with scope (from files).
 */
function deriveSummary(turns: Turn[], filesInScope: string[]): string {
  const userTurns = turns.filter((t) => t.role === "user");
  const parts: string[] = [];

  if (userTurns.length > 0) {
    // Take opening of first user turn
    const firstContent = userTurns[0].content.trim();
    const truncated = firstContent.length > 200
      ? `${firstContent.slice(0, 197)}...`
      : firstContent;
    parts.push(truncated);
  }

  if (filesInScope.length > 0) {
    const fileList = filesInScope.length <= 5
      ? filesInScope.join(", ")
      : `${filesInScope.slice(0, 5).join(", ")} (+${filesInScope.length - 5} more)`;
    parts.push(`Files: ${fileList}`);
  }

  return parts.join(" | ") || "no content";
}
