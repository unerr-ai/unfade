// FILE: src/services/cache/cursor.ts
// UF-213: Materializer cursor — tracks byte offset per event file for incremental reads.
// Atomic persistence via tmp+rename. SHA-256 hash of last line for corruption detection.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getStateDir } from "../../utils/paths.js";

const CURSOR_FILENAME = "materializer.json";

export interface StreamCursor {
  file: string;
  byteOffset: number;
  lastLineHash: string;
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
 * Validate a cursor entry against the actual file content.
 * Returns false if the file was truncated or rewritten (hash mismatch).
 */
export function isCursorValid(cursor: StreamCursor, filePath: string): boolean {
  if (!existsSync(filePath)) return false;

  try {
    const content = readFileSync(filePath, "utf-8");
    if (content.length < cursor.byteOffset) return false;

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

    if (!lastNonEmpty && cursor.byteOffset > 0) return false;
    if (!lastNonEmpty) return true;

    return hashLine(lastNonEmpty) === cursor.lastLineHash;
  } catch {
    return false;
  }
}
