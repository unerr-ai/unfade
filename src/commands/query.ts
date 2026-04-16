// FILE: src/commands/query.ts
// UF-056: `unfade query` command — keyword search across reasoning history.
// Reads server.json to call HTTP API; falls back to direct file read.
// Without --json: formatted results to stderr. With --json: raw JSON to stdout.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { QueryOutput } from "../schemas/mcp.js";
import { queryEvents } from "../tools/unfade-query.js";
import { handleCliError } from "../utils/cli-error.js";
import { logger } from "../utils/logger.js";
import { getStateDir } from "../utils/paths.js";

interface QueryCommandOptions {
  from?: string;
  to?: string;
  limit?: string;
  json?: boolean;
}

/**
 * Try to read server.json and return the HTTP base URL if available.
 */
function readServerUrl(): string | null {
  try {
    const serverJsonPath = join(getStateDir(), "server.json");
    if (!existsSync(serverJsonPath)) return null;
    const raw = readFileSync(serverJsonPath, "utf-8");
    const info = JSON.parse(raw);
    if (info?.transport?.http) return info.transport.http;
    return null;
  } catch {
    return null;
  }
}

/**
 * Query via the HTTP API. Returns null if unreachable.
 */
async function queryViaHttp(
  baseUrl: string,
  search: string,
  options: QueryCommandOptions,
): Promise<QueryOutput | null> {
  const params = new URLSearchParams({ q: search });
  if (options.from) params.set("from", options.from);
  if (options.to) params.set("to", options.to);
  if (options.limit) params.set("limit", options.limit);

  try {
    const res = await fetch(`${baseUrl}/unfade/query?${params.toString()}`);
    if (!res.ok) return null;
    return (await res.json()) as QueryOutput;
  } catch {
    // Connection refused, timeout, etc. — fall back silently
    return null;
  }
}

/**
 * Query via direct file read (Sprint 2A query engine).
 */
function queryDirect(search: string, options: QueryCommandOptions): QueryOutput {
  const limit = options.limit ? Number.parseInt(options.limit, 10) : 10;
  const dateRange = options.from || options.to ? { from: options.from, to: options.to } : undefined;

  return queryEvents({
    query: search,
    dateRange,
    limit: Number.isNaN(limit) ? 10 : limit,
  });
}

/**
 * Format query results as colored text for stderr.
 */
function formatResults(result: QueryOutput): void {
  const { results, total } = result.data;

  if (results.length === 0) {
    logger.info("No results found.");
    return;
  }

  logger.info(`Found ${total} result${total === 1 ? "" : "s"}:\n`);

  for (const item of results) {
    const sourceTag = item.source === "distill" ? "[distill]" : "[event]";
    const score = `(${(item.score * 100).toFixed(0)}%)`;
    logger.info(`  ${item.date}  ${sourceTag}  ${score}`);
    logger.info(`    ${item.summary}`);
    if (item.detail) {
      const truncated = item.detail.length > 120 ? `${item.detail.slice(0, 120)}...` : item.detail;
      logger.info(`    ${truncated}`);
    }
    logger.info("");
  }

  if (result._meta.durationMs > 0) {
    logger.info(`  Searched in ${result._meta.durationMs}ms`);
  }
}

/**
 * Execute the `unfade query` command.
 */
export async function queryCommand(search: string, options: QueryCommandOptions): Promise<void> {
  try {
    // Try HTTP API first
    const serverUrl = readServerUrl();
    let result: QueryOutput | null = null;

    if (serverUrl) {
      result = await queryViaHttp(serverUrl, search, options);
    }

    // Fall back to direct file read
    if (!result) {
      result = queryDirect(search, options);
    }

    // Output
    if (options.json) {
      // --json: raw JSON to stdout
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      formatResults(result);
    }
  } catch (err) {
    handleCliError(err, "query");
  }
}
