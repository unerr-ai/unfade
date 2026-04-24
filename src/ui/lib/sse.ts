import { toast } from "sonner";
import type { CapturedEvent } from "@/types/events";
import type { HealthEvent } from "@/types/health";
import type { SummaryJson } from "@/types/summary";
import { queryClient } from "./query-client";

type SSECallback = (type: string, data: unknown) => void;
let eventSource: EventSource | null = null;
let listeners: SSECallback[] = [];

export function connectSSE() {
  if (eventSource) return;
  eventSource = new EventSource("/api/stream");

  eventSource.addEventListener("summary", (e) => {
    try {
      const data = JSON.parse(e.data) as SummaryJson;
      queryClient.setQueryData(["summary"], data);
      notify("summary", data);
    } catch {
      /* corrupt payload */
    }
  });

  eventSource.addEventListener("health", (e) => {
    try {
      const data = JSON.parse(e.data) as HealthEvent;
      const prevHealth = queryClient.getQueryData<HealthEvent>(["health", "sse"]);
      queryClient.setQueryData(["health", "sse"], data);
      if (prevHealth?.daemonAlive && !data.daemonAlive) {
        toast.error("Daemon stopped");
      } else if (prevHealth && !prevHealth.daemonAlive && data.daemonAlive) {
        toast.success("Daemon connected");
      }
      notify("health", data);
    } catch {
      /* corrupt payload */
    }
  });

  eventSource.addEventListener("event", (e) => {
    try {
      const data = JSON.parse(e.data) as CapturedEvent;
      queryClient.setQueryData<CapturedEvent[]>(["events", "live"], (prev) =>
        [...(prev ?? []), data].slice(-200),
      );
      notify("event", data);
    } catch {
      /* corrupt payload */
    }
  });

  eventSource.addEventListener("intelligence", (e) => {
    try {
      const data = JSON.parse(e.data) as { type?: string };
      // Scope invalidation: if the event specifies which analyzer changed,
      // only invalidate that key instead of nuking all intelligence queries.
      if (data.type) {
        queryClient.invalidateQueries({ queryKey: ["intelligence", data.type] });
      } else {
        // Fallback: stagger invalidation to avoid request storm.
        // Invalidate high-priority queries immediately, others after a delay.
        queryClient.invalidateQueries({ queryKey: ["intelligence", "narratives"] });
        queryClient.invalidateQueries({ queryKey: ["intelligence", "maturity-assessment"] });
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ["intelligence"] });
        }, 5_000);
      }
      notify("intelligence", data);
    } catch {
      /* corrupt payload */
    }
  });

  eventSource.onerror = () => {
    toast.error("SSE disconnected — reconnecting…");
    eventSource?.close();
    eventSource = null;
    setTimeout(connectSSE, 3000);
  };
}

export function disconnectSSE() {
  eventSource?.close();
  eventSource = null;
}

export function onSSE(cb: SSECallback) {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
  };
}

function notify(type: string, data: unknown) {
  for (const cb of listeners) cb(type, data);
}

export function isSSEConnected(): boolean {
  return eventSource?.readyState === EventSource.OPEN;
}
