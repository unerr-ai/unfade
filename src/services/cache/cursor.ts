// FILE: src/services/cache/cursor.ts
// UF-213: Materializer cursor — tracks byte offset per event file for incremental reads.
// Atomic persistence via tmp+rename. SHA-256 hash of last line for corruption detection.

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { logger } from "../../utils/logger.js";
import { getStateDir } from "../../utils/paths.js";

const CURSOR_FILENAME = "materializer.json";

export interface StreamCursor {
  file: string;
  byteOffset: number;
  lastLineHash: string;
  epoch?: string; // SHA-256 of first 64 bytes — must match .epoch file
  fileSize?: number; // Total file size at cursor save time
}

export interface MaterializerCursor {
  schemaVersion: number;
  streams: Record<string, StreamCursor>;
}

function cursorPath(cwd?: string): string {
  return join(getStateDir(cwd), CURSOR_FILENAME);
}

export function loadCursor(cwd?: string): MaterializerCursor {
  const path = cursorPath(cwd);
  if (!existsSync(path)) {
    return { schemaVersion: 1, streams: {} };
  }
  try {
    const data = JSON.parse(readFileSync(path, "utf-8")) as MaterializerCursor;
    if (data.schemaVersion !== 1) {
      return { schemaVersion: 1, streams: {} };
    }
    return data;
  } catch {
    return { schemaVersion: 1, streams: {} };
  }
}

export function resetCursor(cwd?: string): void {
  const path = cursorPath(cwd);
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // If delete fails, overwrite with empty cursor
    saveCursor({ schemaVersion: 1, streams: {} }, cwd);
  }
}

export function saveCursor(cursor: MaterializerCursor, cwd?: string): void {
  const stateDir = getStateDir(cwd);
  mkdirSync(stateDir, { recursive: true });
  const target = cursorPath(cwd);
  const tmp = join(stateDir, `${CURSOR_FILENAME}.tmp.${process.pid}`);
  writeFileSync(tmp, JSON.stringify(cursor, null, 2), "utf-8");
  renameSync(tmp, target);
}

export function hashLine(line: string): string {
  return createHash("sha256").update(line).digest("hex").slice(0, 16);
}

/**
 * Read the `.epoch` companion file for a given JSONL file.
 * Returns the epoch string (SHA-256 of first 64 bytes) or null if not present.
 */
export function readEpochFile(filePath: string): string | null {
  const epochPath = `${filePath}.epoch`;
  if (!existsSync(epochPath)) return null;
  try {
    return readFileSync(epochPath, "utf-8").trim();
  } catch {
    return null;
  }
}

/**
 * Validate a cursor entry against the actual file content.
 * Returns false if the file was truncated or rewritten (hash mismatch),
 * or if the epoch has changed (file was replaced).
 */
export function isCursorValid(cursor: StreamCursor, filePath: string): boolean {
  const file = basename(filePath);
  if (!existsSync(filePath)) {
    logger.debug("Cursor validation failed: file does not exist", { file });
    return false;
  }

  try {
    // Epoch check: if cursor has an epoch AND the .epoch file exists, they must match
    if (cursor.epoch) {
      const currentEpoch = readEpochFile(filePath);
      if (currentEpoch !== null && currentEpoch !== cursor.epoch) {
        logger.debug("Cursor validation failed: epoch mismatch", {
          file,
          cursorEpoch: cursor.epoch,
          fileEpoch: currentEpoch,
        });
        return false;
      }
    }

    const content = readFileSync(filePath, "utf-8");
    const contentBytes = Buffer.byteLength(content, "utf-8");

    // If the cursor claims a byte offset beyond the actual file size, the file
    // was either truncated or the cursor was saved with an overshoot (see the
    // phantom trailing element bug fix in materializer.ts).
    if (contentBytes < cursor.byteOffset) {
      logger.debug("Cursor validation failed: byteOffset exceeds file size", {
        file,
        contentBytes,
        cursorByteOffset: cursor.byteOffset,
        overshoot: cursor.byteOffset - contentBytes,
      });
      return false;
    }

    const precedingContent = content.slice(0, cursor.byteOffset);
    const lines = precedingContent.split("\n");

    let lastNonEmpty = "";
    for (let i = lines.length - 1; i >= 0; i--) {
      const trimmed = lines[i].trim();
      if (trimmed) {
        lastNonEmpty = trimmed;
        break;
      }
    }

    if (!lastNonEmpty && cursor.byteOffset > 0) {
      logger.debug("Cursor validation failed: no content found before byteOffset", {
        file,
        byteOffset: cursor.byteOffset,
      });
      return false;
    }
    if (!lastNonEmpty) return true;

    const computedHash = hashLine(lastNonEmpty);
    if (computedHash !== cursor.lastLineHash) {
      logger.debug("Cursor validation failed: last-line hash mismatch", {
        file,
        expected: cursor.lastLineHash,
        computed: computedHash,
      });
      return false;
    }

    return true;
  } catch (err) {
    logger.debug("Cursor validation failed: unexpected error", {
      file,
      error: String(err),
    });
    return false;
  }
}
