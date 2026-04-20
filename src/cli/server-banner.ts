// FILE: src/cli/server-banner.ts
// UF-302 + UF-319: Server banner — Vite-style startup + shutdown progress.
// All output to stderr (stdout is sacred for MCP).

import { theme, writeBlank, writeLine } from "./ui.js";

const VERSION = "0.1.0";

export function printServerHeader(): void {
  writeBlank();
  writeLine(`  ${theme.brand("Unfade")} ${theme.muted(`v${VERSION}`)}`);
  writeBlank();
}

export function printInitStep(message: string): void {
  writeLine(`  ${theme.accent("◆")} ${message}`);
}

export function printRepoStarted(label: string, pid: number): void {
  writeLine(
    `  ${theme.success("●")} ${theme.bold(label)} ${theme.muted(`capture engine pid ${pid}`)}`,
  );
}

export function printRepoResuming(label: string, eventCount: number): void {
  writeLine(
    `  ${theme.success("●")} ${theme.bold(label)} ${theme.muted(`resuming (${eventCount} events processed)`)}`,
  );
}

export function printServerReady(port: number, repoCount: number): void {
  writeBlank();
  writeLine(`  ${theme.muted("Dashboard:")}  ${theme.cyan(`http://localhost:${port}`)}`);
  writeLine(`  ${theme.muted("MCP:")}        ${theme.cyan(`http://localhost:${port}/mcp`)}`);
  writeLine(`  ${theme.muted("Repos:")}      ${theme.bold(String(repoCount))} registered`);
  writeBlank();
  writeLine(
    `  ${theme.muted("Watching")} ${theme.bold(String(repoCount))} ${theme.muted(`repo${repoCount !== 1 ? "s" : ""}.`)} ${theme.muted("Ctrl+C to stop.")}`,
  );
  writeBlank();
}

// --- Shutdown progress ---

export function printShutdownStart(): void {
  writeBlank();
}

export function printShutdownStep(message: string): void {
  writeLine(`  ${theme.muted("◆")} ${message}`);
}

export function printShutdownCursorSaved(label: string, byteOffset: number): void {
  writeLine(`  ${theme.muted("◆")} ${label}: cursor saved at byte ${byteOffset.toLocaleString()}`);
}

export function printShutdownDaemonStopped(label: string, pid: number | null): void {
  writeLine(`  ${theme.muted("◆")} ${label}: capture engine stopped${pid ? ` (pid ${pid})` : ""}`);
}

export function printShutdownComplete(): void {
  writeLine(`  ${theme.success("✓")} ${theme.muted("Unfade stopped cleanly.")}`);
  writeBlank();
}
