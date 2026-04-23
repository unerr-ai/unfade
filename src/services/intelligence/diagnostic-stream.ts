// FILE: src/services/intelligence/diagnostic-stream.ts
// Real-time diagnostic emission system. Any analyzer can emit diagnostics
// during update(). The stream maintains a ring buffer of active diagnostics
// with auto-expiry. Consumers (MCP, dashboard SSE) subscribe for new entries.

import { createHash } from "node:crypto";

export interface Diagnostic {
  id: string;
  type: "observation" | "warning" | "recommendation";
  scope: "event" | "session" | "hour" | "day";
  analyzer: string;
  message: string;
  actionable: boolean;
  action?: string;
  confidence: number;
  expiresAt: string;
  createdAt: string;
  relatedEventIds: string[];
  projectId?: string;
}

type DiagnosticListener = (d: Diagnostic) => void;

const MAX_ACTIVE_DIAGNOSTICS = 100;
const DEFAULT_TTL_MS: Record<Diagnostic["scope"], number> = {
  event: 5 * 60 * 1000,
  session: 30 * 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
};

class DiagnosticStreamImpl {
  private diagnostics: Diagnostic[] = [];
  private listeners = new Set<DiagnosticListener>();

  emit(partial: Omit<Diagnostic, "id" | "createdAt" | "expiresAt"> & { expiresAt?: string }): void {
    const now = new Date();
    const ttl = DEFAULT_TTL_MS[partial.scope] ?? DEFAULT_TTL_MS.hour;

    const diagnostic: Diagnostic = {
      ...partial,
      id: createHash("sha256")
        .update(`${partial.analyzer}:${partial.message}:${now.toISOString()}`)
        .digest("hex")
        .slice(0, 12),
      createdAt: now.toISOString(),
      expiresAt: partial.expiresAt ?? new Date(now.getTime() + ttl).toISOString(),
    };

    this.diagnostics.push(diagnostic);

    if (this.diagnostics.length > MAX_ACTIVE_DIAGNOSTICS) {
      this.diagnostics = this.diagnostics.slice(-MAX_ACTIVE_DIAGNOSTICS);
    }

    for (const listener of this.listeners) {
      try {
        listener(diagnostic);
      } catch {
        // listener errors must not crash the stream
      }
    }
  }

  getActive(filter?: { scope?: string; project?: string; analyzer?: string }): Diagnostic[] {
    const now = new Date().toISOString();

    return this.diagnostics.filter((d) => {
      if (d.expiresAt < now) return false;
      if (filter?.scope && d.scope !== filter.scope) return false;
      if (filter?.project && d.projectId !== filter.project) return false;
      if (filter?.analyzer && d.analyzer !== filter.analyzer) return false;
      return true;
    });
  }

  subscribe(callback: DiagnosticListener): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  prune(): number {
    const now = new Date().toISOString();
    const before = this.diagnostics.length;
    this.diagnostics = this.diagnostics.filter((d) => d.expiresAt >= now);
    return before - this.diagnostics.length;
  }

  get size(): number {
    return this.diagnostics.length;
  }

  get activeCount(): number {
    const now = new Date().toISOString();
    return this.diagnostics.filter((d) => d.expiresAt >= now).length;
  }
}

export const diagnosticStream = new DiagnosticStreamImpl();
export type { DiagnosticStreamImpl as DiagnosticStream };
