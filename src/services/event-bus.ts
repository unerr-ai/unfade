// FILE: src/services/event-bus.ts
// UF-473: Process-wide event bus for push-based SSE.
// Replaces mtime polling — materializer emits, SSE route subscribes.

import { EventEmitter } from "node:events";

export type BusEvent =
  | { type: "summary"; data: unknown }
  | { type: "event"; data: unknown }
  | { type: "intelligence"; data: unknown };

class UnfadeEventBus extends EventEmitter {
  emitBus(event: BusEvent): void {
    this.emit("bus", event);
  }

  onBus(listener: (event: BusEvent) => void): void {
    this.on("bus", listener);
  }

  offBus(listener: (event: BusEvent) => void): void {
    this.off("bus", listener);
  }
}

export const eventBus = new UnfadeEventBus();
eventBus.setMaxListeners(100);
