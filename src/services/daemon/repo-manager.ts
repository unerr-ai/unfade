// FILE: src/services/daemon/repo-manager.ts
// UF-307: Manages N EmbeddedDaemon + N MaterializerDaemon pairs, one per registered repo.
// Used by unfade-server.ts for startup, hot-add from registry watcher, and graceful shutdown.

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../../config/manager.js";
import { localToday } from "../../utils/date.js";
import { logger } from "../../utils/logger.js";
import { getEventsDir, getProjectDataDir } from "../../utils/paths.js";

/** Generate a short correlation ID for pipeline tick tracing. */
const makeTickId = () => randomBytes(4).toString("hex");

import { MaterializerDaemon } from "../cache/materializer-daemon.js";
import { eventBus } from "../event-bus.js";
import { assignEventsToFeatures, linkRelatedEvents } from "../intelligence/feature-boundary.js";
import { classifyAllUnclassified } from "../intelligence/outcome-classifier.js";
import { appendRecentInsight } from "../intelligence/recent-insights.js";
import { writePartialSnapshot } from "../intelligence/snapshot.js";
import { readSummary } from "../intelligence/summary-writer.js";
import type { RepoEntry } from "../registry/registry.js";
import { type SchedulerHandle, startScheduler } from "../scheduler/scheduler.js";
import { getWorkerPool } from "../workers/pool.js";
import { ensureBinaries } from "./binary.js";
import { EmbeddedDaemon } from "./embedded-daemon.js";
import type { KnowledgeExtractionHook } from "../cache/materializer-daemon.js";

const PARTIAL_SNAPSHOT_INTERVAL_MS = 4 * 3600 * 1000;

/** Emit a launch-progress discovery on the event bus and add to synthesis state. */
function emitLaunchDiscovery(
  stage: import("../event-bus.js").LaunchProgressData["stage"],
  detail: string,
  icon: string,
): void {
  try {
    const { addDiscovery, updateStage } =
      require("../../server/setup-state.js") as typeof import("../../server/setup-state.js");
    addDiscovery({ ts: new Date().toISOString(), message: detail, icon });
    updateStage(stage, detail);
    eventBus.emitBus({
      type: "launch-progress",
      data: { stage, detail, icon },
    });
  } catch {
    // non-fatal — launch progress is purely informational
  }
}

/** Yield to the event loop between heavy processing stages to prevent blocking. */
const yieldToEventLoop = () => new Promise<void>((r) => setImmediate(r));

export interface ManagedRepo {
  entry: RepoEntry;
  daemon: EmbeddedDaemon;
  materializer: MaterializerDaemon;
  scheduler: SchedulerHandle | null;
  lastPartialSnapshotMs: number;
}

export class RepoManager {
  private repos = new Map<string, ManagedRepo>();
  private globalAiDaemon: EmbeddedDaemon | null = null;

  /**
   * Start the single global AI capture daemon.
   * This runs ONE instance that watches all AI tool directories (~/.claude/, Cursor, etc.)
   * and tags events with projectId via registry matching.
   */
  async startGlobalAICapture(): Promise<void> {
    if (this.globalAiDaemon) return;

    try {
      ensureBinaries();
    } catch {
      logger.debug("Global AI capture: binary not available — skipping");
      return;
    }

    this.globalAiDaemon = new EmbeddedDaemon("", {
      captureMode: "ai-global",
      projectId: "global-ai",
      onRestart: (attempt) => {
        logger.warn(`[ai-global] capture restarted (attempt ${attempt})`);
      },
    });
    await this.globalAiDaemon.start();
    logger.debug("Global AI capture daemon started", { pid: this.globalAiDaemon.getPid() });
  }

  /**
   * Stop the global AI capture daemon.
   */
  async stopGlobalAICapture(): Promise<void> {
    if (this.globalAiDaemon) {
      await this.globalAiDaemon.stop();
      this.globalAiDaemon = null;
    }
  }

  /**
   * Add a repo: ensure binaries, start daemon, materializer, and scheduler.
   * Skips repos with monitoring === "paused".
   */
  async addRepo(entry: RepoEntry): Promise<ManagedRepo | null> {
    if (this.repos.has(entry.id)) return this.repos.get(entry.id)!;

    if (entry.monitoring === "paused") {
      logger.debug(`Repo ${entry.label}: monitoring paused — skipping daemon`);
      return null;
    }

    try {
      ensureBinaries();
    } catch {
      logger.debug(`Repo ${entry.label}: binary not available — skipping`);
      return null;
    }

    const daemon = new EmbeddedDaemon(entry.root, {
      projectId: entry.id,
      onRestart: (attempt, repoRoot) => {
        appendRecentInsight(repoRoot, {
          claim: `Capture engine restarted (attempt ${attempt})`,
          insightType: "system",
          severity: "warning",
          metrics: { restartAttempt: attempt },
        });
      },
    });
    await daemon.start();

    // 11A.4: Wait for ingest lock to clear before materializer processes
    await waitForIngestClear(entry.root);

    const repoConfig = loadConfig({ projectDataDir: getProjectDataDir(entry.root) });
    const materializer = createMaterializerForRepo(entry.root, repoConfig);
    await materializer.start();

    const scheduler = startScheduler(repoConfig, entry.root);

    const managed: ManagedRepo = {
      entry,
      daemon,
      materializer,
      scheduler,
      lastPartialSnapshotMs: 0,
    };

    this.repos.set(entry.id, managed);
    logger.debug(`Repo ${entry.label} added to manager`, { pid: daemon.getPid() });
    return managed;
  }

  /**
   * Remove a repo: stop its daemon, materializer, and scheduler.
   */
  async removeRepo(id: string): Promise<void> {
    const managed = this.repos.get(id);
    if (!managed) return;

    // Always remove from map first to prevent concurrent access during cleanup
    this.repos.delete(id);

    try {
      managed.scheduler?.stop();
      managed.materializer.stop();
      await managed.daemon.stop();
    } finally {
      // Ensure materializer DB is closed even if daemon.stop() throws
      try {
        await managed.materializer.close();
      } catch (err) {
        logger.debug(`Materializer close failed for ${managed.entry.label}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /**
   * Get all managed repos.
   */
  getAll(): Map<string, ManagedRepo> {
    return this.repos;
  }

  /**
   * Get a managed repo by ID.
   */
  get(id: string): ManagedRepo | undefined {
    return this.repos.get(id);
  }

  /**
   * Number of managed repos.
   */
  get size(): number {
    return this.repos.size;
  }

  /**
   * Get per-repo health status for the health endpoint.
   */
  getHealthStatus(): Array<{
    id: string;
    label: string;
    root: string;
    daemonPid: number | null;
    daemonRunning: boolean;
    daemonRestartCount: number;
    daemonUptimeMs: number;
    materializerLagMs: number;
  }> {
    const statuses: ReturnType<RepoManager["getHealthStatus"]> = [];
    for (const [id, managed] of this.repos) {
      statuses.push({
        id,
        label: managed.entry.label,
        root: managed.entry.root,
        daemonPid: managed.daemon.getPid(),
        daemonRunning: managed.daemon.isRunning(),
        daemonRestartCount: managed.daemon.getRestartCount(),
        daemonUptimeMs: managed.daemon.getUptimeMs(),
        materializerLagMs: managed.materializer.getLagMs(),
      });
    }
    return statuses;
  }

  /**
   * Graceful shutdown of all repos: schedulers → materializers → daemons.
   */
  async shutdownAll(): Promise<void> {
    for (const [, managed] of this.repos) {
      managed.scheduler?.stop();
    }

    for (const [, managed] of this.repos) {
      try {
        await managed.materializer.triggerNow();
      } catch {
        // best effort
      }
      managed.materializer.stop();
    }

    const stopPromises: Promise<void>[] = [];
    for (const [, managed] of this.repos) {
      stopPromises.push(managed.daemon.stop());
    }
    stopPromises.push(this.stopGlobalAICapture());
    await Promise.all(stopPromises);

    for (const [, managed] of this.repos) {
      await managed.materializer.close();
    }

    try {
      const { CozoManager } = await import("../substrate/cozo-manager.js");
      await CozoManager.close();
    } catch {
      // non-fatal
    }

    this.repos.clear();
  }
}

/**
 * Wait for the Go daemon's ingest lock to clear before starting materialization.
 * Checks the global events dir (not per-project).
 */
async function waitForIngestClear(_repoRoot: string, timeoutMs = 30_000): Promise<void> {
  const lockPath = join(getEventsDir(), ".ingest.lock");
  if (!existsSync(lockPath)) return;

  logger.debug("Waiting for ingest lock to clear");
  const deadline = Date.now() + timeoutMs;
  while (existsSync(lockPath) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
  }

  if (existsSync(lockPath)) {
    logger.debug("Ingest lock still present after timeout — materializer will defer per-tick");
  }
}

const INCREMENTAL_DISTILL_INTERVAL_MS = 5 * 60 * 1000; // 5 min throttle

/**
 * Map an AnalyzerResult to a user-friendly insight preview for the onboarding feed.
 */
function makeInsightPreview(
  result: import("../intelligence/analyzers/index.js").AnalyzerResult,
): import("../../server/setup-state.js").InsightPreview | null {
  const d = result.data;
  const ts = result.updatedAt || new Date().toISOString();

  const map: Record<string, { title: string; icon: string; extract: () => string }> = {
    efficiency: {
      title: "Efficiency Score",
      icon: "⚡",
      extract: () => {
        const aes = d.aes ?? d.score;
        return aes != null ? `AES: ${aes}` : "Analysis complete";
      },
    },
    velocity: {
      title: "Development Velocity",
      icon: "🚀",
      extract: () => {
        const epd = d.eventsPerDay ?? d.decisionsPerDay;
        return epd != null ? `${epd} events/day` : "Velocity measured";
      },
    },
    comprehension: {
      title: "Codebase Comprehension",
      icon: "🧭",
      extract: () => {
        const overall = d.overall ?? d.score;
        return overall != null ? `${overall}% coverage` : "Comprehension mapped";
      },
    },
    "commit-analysis": {
      title: "Commit Analysis",
      icon: "📊",
      extract: () => {
        const count = d.totalCommits ?? d.commitCount;
        return count != null ? `${count} commits analyzed` : "Commits analyzed";
      },
    },
    "expertise-map": {
      title: "Expertise Map",
      icon: "🗺️",
      extract: () => {
        const domains = d.domains ?? d.expertDomains;
        const count = Array.isArray(domains) ? domains.length : (d.domainCount ?? null);
        return count != null ? `${count} expert domains` : "Expertise mapped";
      },
    },
    "maturity-assessment": {
      title: "Vehicle Maturity",
      icon: "🏎️",
      extract: () => {
        const phase = d.phase ?? d.maturityPhase;
        return phase != null ? `Phase ${phase}` : "Maturity assessed";
      },
    },
    "prompt-patterns": {
      title: "Prompt Patterns",
      icon: "🔍",
      extract: () => {
        const count = d.totalPatterns ?? d.patternCount;
        return count != null ? `${count} patterns detected` : "Patterns analyzed";
      },
    },
  };

  const entry = map[result.analyzer];
  if (!entry) return null;

  return {
    ts,
    analyzer: result.analyzer,
    title: entry.title,
    headline: entry.extract(),
    icon: entry.icon,
  };
}

/**
 * Create the knowledge extraction hook for the materializer.
 * Lazy-initializes the KnowledgeExtractionConfig on first call (CozoDB, LLM, embeddings).
 * Non-fatal: if initialization fails, extraction is silently skipped.
 */
function createKnowledgeExtractionHook(
  _repoRoot: string,
  config: ReturnType<typeof loadConfig>,
): KnowledgeExtractionHook {
  let knowledgeConfig: import("../knowledge/extractor.js").KnowledgeExtractionConfig | null = null;
  let initAttempted = false;

  return {
    async run(analytics, limit = 50) {
      if (!initAttempted) {
        initAttempted = true;
        try {
          const { getUnextractedEvents } = await import("../knowledge/extraction-tracker.js");
          const { extractKnowledge, loadCaptureEventsForExtraction } = await import("../knowledge/extractor.js");
          const { CozoManager } = await import("../substrate/cozo-manager.js");
          const { createLLMProvider } = await import("../distill/providers/ai.js");
          const { loadEmbeddingModel } = await import("../knowledge/embedding.js");

          const cozo = await CozoManager.getInstance();
          const llmResult = await createLLMProvider(config);
          const embeddingModel = await loadEmbeddingModel();

          knowledgeConfig = {
            llmConfig: llmResult ? {
              model: llmResult.model,
              provider: llmResult.provider,
              modelName: llmResult.modelName,
              concurrency: 3,
              timeoutMs: 60_000,
            } : null,
            embeddingModel,
            cozo,
            analytics,
          };

          logger.debug("Knowledge extraction initialized", {
            llmProvider: llmResult?.provider ?? "none",
            embeddingsAvailable: !!embeddingModel,
          });
        } catch (err) {
          logger.debug("Knowledge extraction initialization failed (non-fatal)", {
            error: err instanceof Error ? err.message : String(err),
          });
          return 0;
        }
      }

      if (!knowledgeConfig) return 0;

      // Update analytics handle (may change between ticks)
      knowledgeConfig.analytics = analytics;

      const { getUnextractedEvents } = await import("../knowledge/extraction-tracker.js");
      const { extractKnowledge, loadCaptureEventsForExtraction } = await import("../knowledge/extractor.js");

      const unextracted = await getUnextractedEvents(analytics, limit);
      if (unextracted.length === 0) return 0;

      const eventIds = unextracted.map((e) => e.eventId);
      const events = await loadCaptureEventsForExtraction(analytics, eventIds);
      if (events.length === 0) return 0;

      const result = await extractKnowledge(events, knowledgeConfig);
      return result.eventsProcessed + result.eventsDeferred;
    },
  };
}

/**
 * Create the global materializer. All artifacts write to ~/.unfade/ (no repoRoot override).
 * Profile, graph, amplification → ~/.unfade/ (global).
 * Intelligence, distills, metrics → ~/.unfade/ (global for now; Sprint 14E adds per-project routing).
 */
function createMaterializerForRepo(
  _repoRoot: string,
  config: ReturnType<typeof loadConfig>,
): MaterializerDaemon {
  let lastPartialMs = 0;
  let engine: import("../intelligence/engine.js").IntelligenceScheduler | null = null;
  let lastIncrementalDistillMs = 0;

  let materializationDiscoveryEmitted = false;
  const pipelineStartMs = Date.now();
  const MIN_DAEMON_WARM_UP_MS = 15_000; // Give Go daemon time to capture events

  return new MaterializerDaemon({
    intervalMs: 2000,
    knowledgeExtraction: createKnowledgeExtractionHook(repoRoot, config),
    onMaterializeProgress: (info) => {
      try {
        const { updateSynthesisProgress, updateStage } =
          require("../../server/setup-state.js") as typeof import("../../server/setup-state.js");
        const matPercent = Math.min(100, Math.round((info.filesProcessed / info.filesTotal) * 100));
        updateSynthesisProgress({ materializationPercent: matPercent });
        updateStage(
          "Materializing",
          `Building your reasoning timeline (${info.filesProcessed}/${info.filesTotal})`,
        );
        eventBus.emitBus({
          type: "launch-progress",
          data: {
            stage: "materializing",
            detail: `Processing ${info.currentFile} (${info.filesProcessed}/${info.filesTotal})`,
            icon: "📦",
            data: { filesProcessed: info.filesProcessed, filesTotal: info.filesTotal },
          },
        });
      } catch {
        // non-fatal
      }
    },
    onTick: async function onTick(newRows, materializerCache) {
      // Always update synthesis progress, even when newRows is 0.
      // This ensures the banner transitions through phases correctly.
      try {
        const { loadCursor } = await import("../cache/cursor.js");
        const {
          updateSynthesisProgress,
          getSynthesisProgress,
          checkIntelligenceCompletion,
          addDiscovery,
          confirmZeroEvents,
        } = await import("../../server/setup-state.js");
        const current = getSynthesisProgress();

        // Update materialization percent (always, so intelligence phase can also advance)
        if (current.phase === "materializing" || current.phase === "analyzing") {
          const cursor = loadCursor();
          const streamKeys = Object.keys(cursor.streams);
          if (streamKeys.length === 0) {
            // Only confirm zero events after warmup period — the Go daemon
            // needs time to capture and write JSONL files to ~/.unfade/events/
            if (Date.now() - pipelineStartMs >= MIN_DAEMON_WARM_UP_MS) {
              confirmZeroEvents();
              updateSynthesisProgress({
                materializationPercent: 100,
                processedEvents: 0,
                totalEvents: 0,
              });
            }
          } else {
            let processedBytes = 0;
            let totalBytes = 0;
            for (const stream of Object.values(cursor.streams)) {
              processedBytes += stream.byteOffset;
              totalBytes += stream.fileSize ?? stream.byteOffset;
            }
            const matPercent =
              totalBytes > 0 ? Math.min(100, Math.round((processedBytes / totalBytes) * 100)) : 100;
            updateSynthesisProgress({
              materializationPercent: matPercent,
              processedEvents: processedBytes,
              totalEvents: totalBytes,
            });

            // Emit a discovery when materialization starts making progress
            if (!materializationDiscoveryEmitted && matPercent > 0) {
              materializationDiscoveryEmitted = true;
              addDiscovery({
                ts: new Date().toISOString(),
                message: `Capturing ${totalBytes > 1024 * 1024 ? `${Math.round(totalBytes / 1024 / 1024)} MB` : `${totalBytes > 0 ? Math.round(totalBytes / 1024) : 0} KB`} of collaboration history`,
                icon: "📦",
              });
            }
          }
        }

        // Track intelligence file counts for UI display — but do NOT update
        // intelligencePercent here. The scheduler progress callback (Stage 3)
        // is the sole authority for intelligencePercent. Updating it here from
        // file-existence causes a race: materialization hits 100% → phase becomes
        // "analyzing" → stale intelligence files report 100% → "complete" fires
        // before the scheduler even runs.
        if (current.phase === "materializing" || current.phase === "analyzing") {
          const completion = checkIntelligenceCompletion();
          updateSynthesisProgress({
            coreFilesTotal: completion.total,
            coreFilesComplete: completion.complete,
          });
        }
      } catch {
        // non-fatal — progress display only
      }

      // Skip pipeline if no new rows AND intelligence is already complete.
      // But if intelligence files are missing, force a pipeline run even with 0 new rows
      // so intelligence can be generated from already-materialized data.
      if (newRows <= 0) {
        try {
          const { checkIntelligenceCompletion } = await import("../../server/setup-state.js");
          const completion = checkIntelligenceCompletion();
          if (completion.complete >= completion.total) return;
          // Intelligence files missing — check if cache has data to process
          const db = await materializerCache.getDb();
          if (!db) return;
          const countResult = await db.exec("SELECT COUNT(*) FROM events");
          const eventCount = (countResult[0]?.values[0]?.[0] as number) ?? 0;
          if (eventCount === 0) return;
          // Fall through to run the pipeline on existing data
          logger.debug("Intelligence incomplete, running pipeline on existing data", {
            complete: completion.complete,
            total: completion.total,
            eventCount,
          });
        } catch {
          return;
        }
      }

      // Use the materializer's own CacheManager — same DB handles that just
      // wrote the materialized data. No extra connections, no resource leak.
      const db = await materializerCache.getDb();
      if (!db) return;

      const analyticsDb = materializerCache.analytics ?? db;

      const tickId = makeTickId();
      const tickStartMs = Date.now();
      const tickStartMem = process.memoryUsage();
      logger.info(`[pipeline:${tickId}] === onTick START === newRows=${newRows}`, {
        tickId,
        heapUsedMB: Math.round(tickStartMem.heapUsed / 1024 / 1024),
        rssMB: Math.round(tickStartMem.rss / 1024 / 1024),
      });

      // --- Stage 1: Extraction status tracking + feature detection ---
      // Mark new events as pending extraction for the knowledge pipeline
      let pendingExtractionCount = 0;
      try {
        const compStartMs = Date.now();
        const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const recentResult = await db.exec(
          `SELECT id, source, metadata FROM events
           WHERE ts >= ? AND source IN ('ai-session', 'mcp-active')
             AND id NOT IN (SELECT event_id FROM extraction_status)
           LIMIT 100`,
          [cutoff],
        );

        if (recentResult[0]?.values.length) {
          const statuses = recentResult[0].values.map((row) => ({
            eventId: row[0] as string,
            projectId: "",
            status: "pending" as const,
          }));
          pendingExtractionCount = statuses.length;
          if (statuses.length > 0) {
            await getWorkerPool().upsertExtractionStatus(statuses);
            emitLaunchDiscovery(
              "extraction",
              `Queued ${statuses.length} sessions for knowledge extraction`,
              "🎯",
            );
          }
        }

        logger.info(`[pipeline:${tickId}] Extraction: ${pendingExtractionCount} queued`, {
          tickId,
          elapsedMs: Date.now() - compStartMs,
        });
      } catch (err) {
        logger.warn(`[pipeline:${tickId}] Extraction status tracking failed`, {
          tickId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Feature boundary detection and event linking → SQLite (operational)
      let featureCount = 0;
      try {
        const featStartMs = Date.now();
        const recentIds = await db.exec(
          `SELECT id FROM events WHERE id NOT IN (SELECT event_id FROM event_features) ORDER BY ts DESC LIMIT ?`,
          [Math.min(newRows + 10, 500)],
        );
        const unlinkedIds = (recentIds[0]?.values ?? []).map((r) => r[0] as string);
        featureCount = unlinkedIds.length;
        if (unlinkedIds.length > 0) {
          assignEventsToFeatures(db, unlinkedIds);
          emitLaunchDiscovery(
            "features",
            `Found ${unlinkedIds.length} distinct work streams in your history`,
            "🔍",
          );
          linkRelatedEvents(db, unlinkedIds);
          emitLaunchDiscovery("links", `Connected ${unlinkedIds.length} related decisions`, "🔗");
        }
        logger.info(`[pipeline:${tickId}] Features: ${featureCount} events linked`, {
          tickId,
          elapsedMs: Date.now() - featStartMs,
        });
      } catch (err) {
        logger.warn(`[pipeline:${tickId}] Feature detection failed`, {
          tickId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // --- Stage 2: Session metrics + summary + classification ---
      logger.info(`[pipeline:${tickId}] Stage 1 complete`, {
        tickId,
        pendingExtractionCount,
        featureCount,
        elapsedMs: Date.now() - tickStartMs,
        heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      });
      await yieldToEventLoop();

      // Materialize session metrics → DuckDB
      try {
        const sessStartMs = Date.now();
        const { materializeSessionMetrics } = await import(
          "../intelligence/session-materializer.js"
        );
        const sessCount = await materializeSessionMetrics(analyticsDb);
        logger.info(`[pipeline:${tickId}] Session metrics: ${sessCount} sessions`, {
          tickId,
          elapsedMs: Date.now() - sessStartMs,
        });
      } catch (err) {
        logger.warn(`[pipeline:${tickId}] Session metrics failed`, {
          tickId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Summary snapshot + insights (reads from summary.json written by engine)
      try {
        const summary = readSummary();
        if (summary) {
          const now = Date.now();
          if (now - lastPartialMs >= PARTIAL_SNAPSHOT_INTERVAL_MS) {
            const today = localToday();
            writePartialSnapshot(today, {
              directionDensity: summary.directionDensity24h,
              comprehensionScore: summary.comprehensionScore,
              eventCount: summary.eventCount24h,
              topDomain: summary.topDomain,
            });
            lastPartialMs = now;
          }

          appendRecentInsight(undefined, {
            claim: `${newRows} new events indexed; direction ${summary.directionDensity24h}%`,
            insightType: "materializer_tick",
            severity: "info",
            metrics: {
              newRows,
              directionDensity24h: summary.directionDensity24h,
              comprehensionScore: summary.comprehensionScore,
              costPerDirectedDecision: summary.costPerDirectedDecision,
            },
          });
        }
      } catch (err) {
        logger.warn(`[pipeline:${tickId}] Summary/snapshot failed`, {
          tickId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Prompt type classification → DuckDB (16B.1)
      let promptClassified = 0;
      try {
        const promptClassStartMs = Date.now();
        const { classifyUnclassifiedEvents } = await import("../intelligence/prompt-classifier.js");
        promptClassified = (await classifyUnclassifiedEvents(analyticsDb)) ?? 0;
        logger.info(`[pipeline:${tickId}] Prompt classification: ${promptClassified} events`, {
          tickId,
          elapsedMs: Date.now() - promptClassStartMs,
        });
        if (promptClassified > 0) {
          emitLaunchDiscovery(
            "classification",
            `Identified ${promptClassified} ways you communicate with AI`,
            "📊",
          );
        }
      } catch (err) {
        logger.warn(`[pipeline:${tickId}] Prompt classification failed`, {
          tickId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Prompt chain analysis → DuckDB (16B.3)
      let chainCount = 0;
      try {
        const chainStartMs = Date.now();
        const { analyzeUnanalyzedChains } = await import("../intelligence/prompt-chain.js");
        chainCount = await analyzeUnanalyzedChains(analyticsDb, null);
        logger.info(`[pipeline:${tickId}] Prompt chains: ${chainCount}`, {
          tickId,
          elapsedMs: Date.now() - chainStartMs,
        });
      } catch (err) {
        logger.warn(`[pipeline:${tickId}] Prompt chain analysis failed`, {
          tickId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Prompt→response correlation → DuckDB (16B.4)
      let corrCount = 0;
      try {
        const corrStartMs = Date.now();
        const { computeAndStoreCorrelations } = await import(
          "../intelligence/prompt-response-synthesis.js"
        );
        corrCount = await computeAndStoreCorrelations(analyticsDb);
        logger.info(`[pipeline:${tickId}] Prompt-response correlation: ${corrCount}`, {
          tickId,
          elapsedMs: Date.now() - corrStartMs,
        });
      } catch (err) {
        logger.warn(`[pipeline:${tickId}] Prompt-response correlation failed`, {
          tickId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Outcome classification → SQLite
      let outcomeCount = 0;
      try {
        const outcomeStartMs = Date.now();
        outcomeCount = await classifyAllUnclassified(db);
        logger.info(`[pipeline:${tickId}] Outcome classification: ${outcomeCount} events`, {
          tickId,
          elapsedMs: Date.now() - outcomeStartMs,
        });
        emitLaunchDiscovery(
          "classification",
          "Measured the impact of your AI-assisted decisions",
          "✅",
        );
      } catch (err) {
        logger.warn(`[pipeline:${tickId}] Outcome classification failed`, {
          tickId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // --- Stage 3: Intelligence scheduler (heaviest stage) ---
      logger.info(`[pipeline:${tickId}] Stage 2 complete`, {
        tickId,
        promptClassified,
        chainCount,
        corrCount,
        outcomeCount,
        elapsedMs: Date.now() - tickStartMs,
        heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      });
      await yieldToEventLoop();

      // IntelligenceScheduler → DAG-ordered processing → ~/.unfade/intelligence/
      try {
        if (!engine) {
          const { IntelligenceScheduler } = await import("../intelligence/engine.js");
          const { allAnalyzers } = await import("../intelligence/analyzers/all.js");
          // Use 0 throttle on first run (setup/initial build), then 10s for subsequent ticks
          engine = new IntelligenceScheduler({ minIntervalMs: 0 });
          for (const analyzer of allAnalyzers) {
            engine.register(analyzer);
          }
        }
        const schedulerCtx = {
          repoRoot: "",
          analytics: analyticsDb,
          operational: db,
          config: config as unknown as Record<string, unknown>,
        };
        const schedulerResult = await engine.processEvents(schedulerCtx, (info) => {
          try {
            const { updateSynthesisProgress, updateStage } =
              require("../../server/setup-state.js") as typeof import("../../server/setup-state.js");
            const pct = Math.min(
              100,
              Math.round(((info.index + (info.phase === "complete" ? 1 : 0)) / info.total) * 100),
            );
            updateSynthesisProgress({ intelligencePercent: pct });
            const ANALYZER_SEMANTIC_NAMES: Record<string, string> = {
              efficiency: "Measuring how you collaborate with AI",
              velocity: "Tracking your development momentum",
              comprehension: "Understanding how deeply you engage with code",
              "commit-analysis": "Reading your commit story",
              "expertise-map": "Charting your expertise domains",
              "maturity-assessment": "Assessing your AI collaboration maturity",
              "prompt-patterns": "Decoding your communication patterns",
              "cost-attribution": "Analyzing your AI investment patterns",
              "decision-replay": "Tracing your decision history",
              rejections: "Understanding your code review patterns",
            };
            if (info.phase === "starting") {
              const semanticName =
                ANALYZER_SEMANTIC_NAMES[info.analyzerName] ?? `Analyzing ${info.analyzerName}`;
              updateStage("Intelligence", `${semanticName} (${info.index + 1}/${info.total})`);
              eventBus.emitBus({
                type: "launch-progress",
                data: {
                  stage: "intelligence",
                  detail: `Analyzing ${info.analyzerName} (${info.index + 1}/${info.total})`,
                  icon: "🧠",
                  data: { analyzer: info.analyzerName, index: info.index, total: info.total },
                },
              });
            }
          } catch {
            // non-fatal
          }
        });

        // After first successful run, restore normal 10s throttle
        engine.setMinInterval(10_000);

        // Now that the scheduler has finished, check file-based completion.
        // This is the SAFE place to do it — after all analyzers have run.
        // (The pre-pipeline file check intentionally does NOT set intelligencePercent
        // to avoid racing with phase transitions.)
        try {
          const { checkIntelligenceCompletion: postCheck, updateSynthesisProgress: postUpdate } =
            require("../../server/setup-state.js") as typeof import("../../server/setup-state.js");
          const postCompletion = postCheck();
          postUpdate({
            intelligencePercent: postCompletion.percent,
            coreFilesComplete: postCompletion.complete,
            coreFilesTotal: postCompletion.total,
          });
        } catch {
          // non-fatal
        }

        logger.info(`[pipeline:${tickId}] Stage 3 (intelligence) complete`, {
          tickId,
          nodesProcessed: schedulerResult.nodesProcessed,
          nodesCascaded: schedulerResult.nodesCascaded,
          totalEventsInBatch: schedulerResult.totalEventsInBatch,
          resultsCount: schedulerResult.results.length,
          elapsedMs: Date.now() - tickStartMs,
          heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        });

        // Generate insight previews for the onboarding feed
        if (schedulerResult.nodesProcessed > 0) {
          try {
            const { addInsight, addDiscovery } = await import("../../server/setup-state.js");
            for (const result of schedulerResult.results) {
              const preview = makeInsightPreview(result);
              if (preview) addInsight(preview);
            }
            if (schedulerResult.nodesProcessed > 0) {
              addDiscovery({
                ts: new Date().toISOString(),
                message: `Your intelligence profile gained ${schedulerResult.nodesProcessed} new dimension${schedulerResult.nodesProcessed > 1 ? "s" : ""}`,
                icon: "🧠",
              });
            }
          } catch (err) {
            logger.warn(`[pipeline:${tickId}] Insight preview generation failed`, {
              tickId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        if (schedulerResult.results.length > 0) {
          const { getActionRunner } = await import("../actions/index.js");
          const runner = getActionRunner();
          await runner.fire("intelligence_update", {
            repoRoot: undefined as unknown as string,
            config: config as unknown as import("../../schemas/config.js").UnfadeConfig,
            trigger: "intelligence_update" as const,
          });

          // Dynamic cross-analyzer correlation discovery
          try {
            const crossStartMs = Date.now();
            const { discoverCorrelations } = await import("../intelligence/cross-analyzer.js");
            await discoverCorrelations(engine.getChangedAnalyzers(), schedulerCtx);
            logger.info(`[pipeline:${tickId}] Cross-analyzer correlation complete`, {
              tickId,
              elapsedMs: Date.now() - crossStartMs,
            });
          } catch (err) {
            logger.warn(`[pipeline:${tickId}] Cross-analyzer correlation failed`, {
              tickId,
              error: err instanceof Error ? err.message : String(err),
            });
          }

          // --- Stage 4: Semantic Substrate ---
          logger.info(`[pipeline:${tickId}] Starting Stage 4 (substrate)`, {
            tickId,
            elapsedMs: Date.now() - tickStartMs,
            heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          });
          await yieldToEventLoop();

          // Semantic Substrate — analyzer-driven entity production (SUB-7)
          if (schedulerResult.nodesProcessed > 0) {
            try {
              const { CozoManager } = await import("../substrate/cozo-manager.js");
              const { SubstrateEngine } = await import("../substrate/substrate-engine.js");
              const { DiagnosticAccumulator } = await import(
                "../substrate/diagnostic-accumulator.js"
              );
              const { diagnosticStream } = await import("../intelligence/diagnostic-stream.js");
              const graphDb = await CozoManager.getInstance();
              const substrate = new SubstrateEngine(graphDb);

              let contributions = schedulerResult.entityContributions ?? [];

              if (contributions.length === 0) {
                const { buildAllContributions } = await import("../substrate/entity-mapper.js");
                contributions = await buildAllContributions(analyticsDb, "");
              }

              const activeDiags = diagnosticStream.getActive();
              if (activeDiags.length > 0) {
                const accumulator = new DiagnosticAccumulator();
                const diagContributions = accumulator.accumulateWithEntities(activeDiags);
                contributions.push(...diagContributions);
              }
              let graphDirty = false;
              if (contributions.length > 0) {
                const subIngestStartMs = Date.now();
                emitLaunchDiscovery(
                  "substrate",
                  `Weaving ${contributions.length} insights into your knowledge graph`,
                  "🕸️",
                );
                logger.info(
                  `[pipeline:${tickId}] Substrate ingesting ${contributions.length} entities`,
                  { tickId },
                );
                const upserted = await substrate.ingest(contributions);
                if (upserted > 0) graphDirty = true;
                await substrate.propagate();
                logger.info(`[pipeline:${tickId}] Substrate ingest+propagate complete`, {
                  tickId,
                  upserted,
                  elapsedMs: Date.now() - subIngestStartMs,
                });

                if (graphDirty) {
                  try {
                    const { runGenerationDepth } = await import("../substrate/generation-depth.js");
                    await runGenerationDepth(substrate);
                  } catch (err) {
                    logger.warn(`[pipeline:${tickId}] Generation depth failed`, {
                      tickId,
                      error: err instanceof Error ? err.message : String(err),
                    });
                  }
                }
              }

              // Graph context: only write when graph changed
              if (graphDirty) {
                try {
                  const { getGraphContextForSession } = await import(
                    "../substrate/graph-queries.js"
                  );
                  const { writeFileSync, renameSync, mkdirSync } = await import("node:fs");
                  const { join } = await import("node:path");
                  const { getIntelligenceDir } = await import("../../utils/paths.js");
                  const graphCtx = await getGraphContextForSession(substrate, "");
                  if (graphCtx) {
                    const dir = getIntelligenceDir();
                    mkdirSync(dir, { recursive: true });
                    const target = join(dir, "graph-context.json");
                    const tmp = `${target}.tmp.${process.pid}`;
                    writeFileSync(tmp, JSON.stringify(graphCtx, null, 2), "utf-8");
                    renameSync(tmp, target);
                  }
                } catch (err) {
                  logger.warn(`[pipeline:${tickId}] Graph context write failed`, {
                    tickId,
                    error: err instanceof Error ? err.message : String(err),
                  });
                }
              }
            } catch (err) {
              logger.warn(`[pipeline:${tickId}] Substrate stage failed`, {
                tickId,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }

          // Cross-project intelligence
          try {
            const crossProjStartMs = Date.now();
            const { runCrossProjectIntelligence } = await import(
              "../intelligence/cross-project.js"
            );
            await runCrossProjectIntelligence();
            logger.info(`[pipeline:${tickId}] Cross-project intelligence complete`, {
              tickId,
              elapsedMs: Date.now() - crossProjStartMs,
            });
          } catch (err) {
            logger.warn(`[pipeline:${tickId}] Cross-project intelligence failed`, {
              tickId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      } catch (err) {
        logger.warn(`[pipeline:${tickId}] Intelligence stage failed`, {
          tickId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Incremental distill → ~/.unfade/distills/ (global, 5 min throttle)
      if (Date.now() - lastIncrementalDistillMs > INCREMENTAL_DISTILL_INTERVAL_MS) {
        try {
          const distillStartMs = Date.now();
          logger.info(`[pipeline:${tickId}] Starting incremental distill`, { tickId });
          const { distillIncremental } = await import("../distill/distiller.js");
          const today = localToday();
          await distillIncremental(today);
          lastIncrementalDistillMs = Date.now();
          logger.info(`[pipeline:${tickId}] Incremental distill complete`, {
            tickId,
            elapsedMs: Date.now() - distillStartMs,
          });
        } catch (err) {
          logger.warn(`[pipeline:${tickId}] Incremental distill failed`, {
            tickId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Weekly digest schedule check
      try {
        const { getActionRunner } = await import("../actions/index.js");
        const runner = getActionRunner();
        const actionCtx = {
          repoRoot: undefined as unknown as string,
          config: config as unknown as import("../../schemas/config.js").UnfadeConfig,
          trigger: "schedule_weekly" as const,
        };
        await runner.fire("schedule_weekly", actionCtx);
      } catch (err) {
        logger.warn(`[pipeline:${tickId}] Weekly digest check failed`, {
          tickId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      const tickEndMem = process.memoryUsage();
      logger.info(`[pipeline:${tickId}] === onTick END ===`, {
        tickId,
        totalElapsedMs: Date.now() - tickStartMs,
        heapUsedMB: Math.round(tickEndMem.heapUsed / 1024 / 1024),
        rssMB: Math.round(tickEndMem.rss / 1024 / 1024),
      });
    },
  });
}
