import type { DailyDistill } from "../../schemas/distill.js";
import { logger } from "../../utils/logger.js";

interface OtelConfig {
  endpoint: string;
  headers?: Record<string, string>;
}

interface SpanData {
  traceId: string;
  spanId: string;
  name: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: Array<{
    key: string;
    value: { stringValue?: string; intValue?: string; doubleValue?: number };
  }>;
}

/**
 * Emit OpenTelemetry-compatible spans for human reasoning events.
 * Only emits the human reasoning layer — NOT LLM system metrics.
 *
 * Disabled by default. Enable via config.otel.endpoint.
 * Uses raw OTLP/HTTP JSON export — no heavy SDK dependencies.
 */
export async function emitOtelSpans(
  distill: DailyDistill,
  config: OtelConfig | undefined,
): Promise<void> {
  if (!config?.endpoint) return;

  const spans: SpanData[] = [];
  const traceId = generateHexId(32);
  const sessionStart = new Date(`${distill.date}T00:00:00Z`).getTime() * 1_000_000;
  const sessionEnd = new Date(`${distill.date}T23:59:59Z`).getTime() * 1_000_000;

  spans.push({
    traceId,
    spanId: generateHexId(16),
    name: "unfade.distill",
    startTimeUnixNano: String(sessionStart),
    endTimeUnixNano: String(sessionEnd),
    attributes: [
      { key: "unfade.date", value: { stringValue: distill.date } },
      { key: "unfade.decisions.count", value: { intValue: String(distill.decisions.length) } },
      { key: "unfade.events.processed", value: { intValue: String(distill.eventsProcessed) } },
      { key: "unfade.synthesized_by", value: { stringValue: distill.synthesizedBy ?? "unknown" } },
    ],
  });

  if (distill.directionSummary) {
    const ds = distill.directionSummary;
    spans.push({
      traceId,
      spanId: generateHexId(16),
      name: "unfade.direction_summary",
      startTimeUnixNano: String(sessionStart),
      endTimeUnixNano: String(sessionEnd),
      attributes: [
        { key: "unfade.hds.average", value: { doubleValue: ds.averageHDS } },
        {
          key: "unfade.direction.human_directed",
          value: { intValue: String(ds.humanDirectedCount) },
        },
        {
          key: "unfade.direction.collaborative",
          value: { intValue: String(ds.collaborativeCount) },
        },
        { key: "unfade.direction.llm_directed", value: { intValue: String(ds.llmDirectedCount) } },
      ],
    });
  }

  for (let i = 0; i < distill.decisions.length; i++) {
    const dec = distill.decisions[i];
    const decStart = sessionStart + i * 1_000_000_000;
    spans.push({
      traceId,
      spanId: generateHexId(16),
      name: "unfade.decision",
      startTimeUnixNano: String(decStart),
      endTimeUnixNano: String(decStart + 1_000_000_000),
      attributes: [
        { key: "unfade.decision.text", value: { stringValue: dec.decision } },
        { key: "unfade.decision.domain", value: { stringValue: dec.domain ?? "general" } },
        {
          key: "unfade.decision.alternatives",
          value: { intValue: String(dec.alternativesConsidered ?? 0) },
        },
      ],
    });
  }

  const payload = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: "unfade" } },
            { key: "service.version", value: { stringValue: "0.1.0" } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: "unfade.reasoning", version: "0.1.0" },
            spans,
          },
        ],
      },
    ],
  };

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(config.headers ?? {}),
    };

    const resp = await fetch(`${config.endpoint}/v1/traces`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });

    if (!resp.ok) {
      logger.warn("OTel export failed", { status: resp.status });
    } else {
      logger.debug("OTel spans exported", { count: spans.length });
    }
  } catch (err) {
    logger.debug("OTel export error (non-fatal)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function generateHexId(length: number): string {
  const bytes = new Uint8Array(length / 2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
