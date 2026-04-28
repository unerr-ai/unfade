import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "@/lib/api";
import { vsPriorPeriod } from "@/lib/comparisons";
import type { Correlation } from "@/types/intelligence";

// ─── Enriched Response Unwrapper ────────────────────────────────────────────

interface EnrichedMeta {
  freshness?: { updatedAt: string; dataPoints: number; confidence: string } | null;
  correlations?: Correlation[];
  evidenceAvailable?: boolean;
  durationMs?: number;
}

function unwrapEnriched<T>(raw: unknown): { data: T; meta: EnrichedMeta } | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if ("data" in obj && "_meta" in obj) {
    return { data: obj.data as T, meta: (obj._meta as EnrichedMeta) ?? {} };
  }
  return { data: raw as T, meta: {} };
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

function interpretAES(aes: number): string {
  if (aes >= 80) return "High-performance — engine and driver in sync";
  if (aes >= 60) return "Effective — room to tighten gear shifts";
  if (aes >= 40) return "Developing — transmission slipping in some domains";
  return "Bare engine — heavy AI dependency, low direction";
}

export function useEfficiency(options?: { enabled?: boolean }) {
  const query = useQuery({
    queryKey: ["intelligence", "efficiency"],
    queryFn: api.intelligence.efficiency,
    staleTime: 60_000,
    enabled: options?.enabled ?? true,
  });

  const enriched = useMemo(() => {
    const result = unwrapEnriched<Record<string, unknown>>(query.data);
    if (!result) return null;
    const d = result.data;
    const aes = (d.aes as number) ?? 0;
    const history = ((d.history as Array<{ date: string; aes: number }>) ?? []).map((h) => ({
      date: h.date,
      value: h.aes,
    }));
    return {
      ...d,
      interpretation: interpretAES(aes),
      comparison: vsPriorPeriod(history, 7),
      freshness: result.meta.freshness
        ? { updatedAt: result.meta.freshness.updatedAt, isLive: false }
        : { updatedAt: (d.updatedAt as string) ?? new Date().toISOString(), isLive: false },
      confidenceInfo: { level: (d.confidence as string) ?? "low", basis: `${history.length} data points` },
      correlations: result.meta.correlations ?? [],
      evidenceAvailable: result.meta.evidenceAvailable ?? false,
    };
  }, [query.data]);

  return { ...query, data: enriched };
}

export function useComprehension(options?: { enabled?: boolean }) {
  const query = useQuery({
    queryKey: ["intelligence", "comprehension"],
    queryFn: api.intelligence.comprehension,
    staleTime: 60_000,
    enabled: options?.enabled ?? true,
  });

  const enriched = useMemo(() => {
    const result = unwrapEnriched<Record<string, unknown>>(query.data);
    if (!result) return null;
    const d = result.data;
    const overall = (d.overall as number) ?? 0;
    return {
      ...d,
      interpretation:
        overall >= 70
          ? "Strong understanding — you comprehend what AI produces"
          : overall >= 40
            ? "Moderate — some blind spots in your codebase"
            : "Low comprehension — high risk of accepting code you don't understand",
      freshness: result.meta.freshness
        ? { updatedAt: result.meta.freshness.updatedAt, isLive: false }
        : { updatedAt: new Date().toISOString(), isLive: false },
      confidenceInfo: { level: (d.confidence as string) ?? "low", basis: "module coverage" },
      correlations: result.meta.correlations ?? [],
      evidenceAvailable: result.meta.evidenceAvailable ?? false,
    };
  }, [query.data]);

  return { ...query, data: enriched };
}

export function useCosts(options?: { enabled?: boolean }) {
  const query = useQuery({
    queryKey: ["intelligence", "costs"],
    queryFn: api.intelligence.costs,
    staleTime: 60_000,
    enabled: options?.enabled ?? true,
  });

  const enriched = useMemo(() => {
    const result = unwrapEnriched<Record<string, unknown>>(query.data);
    if (!result) return null;
    return {
      ...result.data,
      correlations: result.meta.correlations ?? [],
      evidenceAvailable: result.meta.evidenceAvailable ?? false,
      freshness: result.meta.freshness
        ? { updatedAt: result.meta.freshness.updatedAt, isLive: false }
        : undefined,
    };
  }, [query.data]);

  return { ...query, data: enriched };
}

export function useVelocity(options?: { enabled?: boolean }) {
  const query = useQuery({
    queryKey: ["intelligence", "velocity"],
    queryFn: api.intelligence.velocity,
    staleTime: 60_000,
    enabled: options?.enabled ?? true,
  });

  const enriched = useMemo(() => {
    const result = unwrapEnriched<Record<string, unknown>>(query.data);
    if (!result) return null;
    return {
      ...result.data,
      correlations: result.meta.correlations ?? [],
      evidenceAvailable: result.meta.evidenceAvailable ?? false,
      freshness: result.meta.freshness
        ? { updatedAt: result.meta.freshness.updatedAt, isLive: false }
        : undefined,
    };
  }, [query.data]);

  return { ...query, data: enriched };
}

export function usePromptPatterns(options?: { enabled?: boolean }) {
  const query = useQuery({
    queryKey: ["intelligence", "prompt-patterns"],
    queryFn: api.intelligence.promptPatterns,
    staleTime: 120_000,
    enabled: options?.enabled ?? true,
  });

  const enriched = useMemo(() => {
    const result = unwrapEnriched<Record<string, unknown>>(query.data);
    if (!result) return null;
    return {
      ...result.data,
      correlations: result.meta.correlations ?? [],
      evidenceAvailable: result.meta.evidenceAvailable ?? false,
      freshness: result.meta.freshness
        ? { updatedAt: result.meta.freshness.updatedAt, isLive: false }
        : undefined,
    };
  }, [query.data]);

  return { ...query, data: enriched };
}

export function useAutonomy(options?: { enabled?: boolean }) {
  const query = useQuery({
    queryKey: ["intelligence", "autonomy"],
    queryFn: api.intelligence.autonomy,
    staleTime: 60_000,
    enabled: options?.enabled ?? true,
  });

  const enriched = useMemo(() => {
    const result = unwrapEnriched<Record<string, unknown>>(query.data);
    if (!result) return null;
    return {
      ...result.data,
      correlations: result.meta.correlations ?? [],
      evidenceAvailable: result.meta.evidenceAvailable ?? false,
    };
  }, [query.data]);

  return { ...query, data: enriched };
}

export function useMaturity(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["intelligence", "maturity-assessment"],
    queryFn: api.intelligence.maturityAssessment,
    staleTime: 120_000,
    enabled: options?.enabled ?? true,
  });
}

export function useNarratives(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["intelligence", "narratives"],
    queryFn: api.intelligence.narratives,
    staleTime: 60_000,
    enabled: options?.enabled ?? true,
  });
}

export function useCorrelations(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["intelligence", "correlations"],
    queryFn: api.intelligence.correlations,
    staleTime: 60_000,
    enabled: options?.enabled ?? true,
  });
}
