// FILE: src/services/substrate/diagnostic-accumulator.ts
// Promotes recurring diagnostics into persistent pattern entities.
// When the same diagnostic (analyzer + scope + feature) fires N times,
// it crosses the accumulation threshold and becomes a first-class pattern
// entity in the graph — making it queryable, connectable, and durable.

import type { Diagnostic } from "../intelligence/diagnostic-stream.js";
import type { EntityContribution } from "./substrate-engine.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PROMOTION_THRESHOLD = 5;
const COOLDOWN_CYCLES = 3;

// ---------------------------------------------------------------------------
// Accumulator state
// ---------------------------------------------------------------------------

interface AccumulationBucket {
  analyzer: string;
  messagePrefix: string;
  featureHint: string | null;
  count: number;
  firstSeen: string;
  lastSeen: string;
  relatedEventIds: string[];
  diagnosticType: Diagnostic["type"];
  cooldownRemaining: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class DiagnosticAccumulator {
  private buckets = new Map<string, AccumulationBucket>();

  /**
   * Process a batch of diagnostics. Groups by (analyzer, message prefix, feature),
   * increments counts, and returns EntityContributions for any that cross the
   * promotion threshold.
   */
  accumulate(diagnostics: Diagnostic[]): EntityContribution[] {
    const promoted: EntityContribution[] = [];

    for (const diag of diagnostics) {
      const key = bucketKey(diag);
      const existing = this.buckets.get(key);

      if (existing) {
        existing.count++;
        existing.lastSeen = diag.createdAt;
        for (const eid of diag.relatedEventIds) {
          if (!existing.relatedEventIds.includes(eid)) {
            existing.relatedEventIds.push(eid);
            if (existing.relatedEventIds.length > 50) {
              existing.relatedEventIds = existing.relatedEventIds.slice(-50);
            }
          }
        }
      } else {
        this.buckets.set(key, {
          analyzer: diag.analyzer,
          messagePrefix: extractPrefix(diag.message),
          featureHint: diag.projectId ?? null,
          count: 1,
          firstSeen: diag.createdAt,
          lastSeen: diag.createdAt,
          relatedEventIds: [...diag.relatedEventIds],
          diagnosticType: diag.type,
          cooldownRemaining: 0,
        });
      }

      const bucket = this.buckets.get(key)!;

      if (bucket.cooldownRemaining > 0) {
        bucket.cooldownRemaining--;
        continue;
      }

      if (bucket.count >= PROMOTION_THRESHOLD && bucket.count % PROMOTION_THRESHOLD === 0) {
        promoted.push(promoteToPattern(bucket));
        bucket.count = 0;
        bucket.cooldownRemaining = COOLDOWN_CYCLES;
      }
    }

    return promoted;
  }

  /**
   * Accumulate diagnostics and also produce diagnostic entities for the graph.
   * Each diagnostic becomes a `diagnostic` entity; patterns emerge from accumulation.
   */
  accumulateWithEntities(diagnostics: Diagnostic[]): EntityContribution[] {
    const contributions: EntityContribution[] = [];

    for (const diag of diagnostics) {
      contributions.push({
        entityId: `diag-${diag.id}`,
        entityType: "diagnostic",
        projectId: diag.projectId ?? "",
        analyzerName: diag.analyzer,
        stateFragment: {
          type: diag.type,
          scope: diag.scope,
          message: diag.message,
          actionable: diag.actionable,
          action: diag.action ?? null,
          confidence: diag.confidence,
          createdAt: diag.createdAt,
          expiresAt: diag.expiresAt,
        },
        relationships: diag.relatedEventIds.slice(0, 5).map((eventId) => ({
          targetEntityId: `wu-${eventId}`,
          type: "applies-to" as const,
          weight: diag.confidence,
          evidence: `diagnostic:${diag.type}`,
        })),
      });
    }

    const promoted = this.accumulate(diagnostics);
    contributions.push(...promoted);

    return contributions;
  }

  get bucketCount(): number {
    return this.buckets.size;
  }

  getBucketStats(): Array<{
    key: string;
    count: number;
    promoted: boolean;
  }> {
    return [...this.buckets.entries()].map(([key, bucket]) => ({
      key,
      count: bucket.count,
      promoted: bucket.count >= PROMOTION_THRESHOLD,
    }));
  }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function bucketKey(diag: Diagnostic): string {
  const prefix = extractPrefix(diag.message);
  return `${diag.analyzer}::${prefix}::${diag.projectId ?? "global"}`;
}

function extractPrefix(message: string): string {
  const truncated = message.slice(0, 60).toLowerCase().trim();
  return truncated.replace(/[^a-z0-9 -]/g, "").replace(/\s+/g, "-");
}

function promoteToPattern(bucket: AccumulationBucket): EntityContribution {
  const patternId = `pat-${bucket.analyzer}-${bucket.messagePrefix.slice(0, 20)}`.replace(
    /[^a-z0-9-]/g,
    "",
  );

  return {
    entityId: patternId,
    entityType: "pattern",
    projectId: bucket.featureHint ?? "",
    analyzerName: "diagnostic-accumulator",
    stateFragment: {
      name: `Recurring: ${bucket.messagePrefix}`,
      sourceAnalyzer: bucket.analyzer,
      occurrences: bucket.count,
      firstSeen: bucket.firstSeen,
      lastSeen: bucket.lastSeen,
      diagnosticType: bucket.diagnosticType,
      promotedAt: new Date().toISOString(),
      evidenceEventCount: bucket.relatedEventIds.length,
    },
    relationships: bucket.featureHint
      ? [
          {
            targetEntityId: bucket.featureHint,
            type: "applies-to",
            weight: Math.min(1, bucket.count / 10),
            evidence: `accumulated-${bucket.count}-diagnostics`,
          },
        ]
      : [],
  };
}
