// FILE: src/services/intelligence/analyzers/index.ts
// UF-100: Pluggable analyzer interface for the Intelligence Engine.

export interface AnalyzerContext {
  repoRoot: string;
  db: {
    run(sql: string, params?: unknown[]): void;
    exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
  };
  config: Record<string, unknown>;
}

export interface AnalyzerResult {
  analyzer: string;
  updatedAt: string;
  data: Record<string, unknown>;
  insightCount: number;
}

export interface Analyzer {
  name: string;
  outputFile: string;
  minDataPoints: number;
  run(ctx: AnalyzerContext): Promise<AnalyzerResult>;
}
