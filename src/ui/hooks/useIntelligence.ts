import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "@/lib/api";
import { vsPriorPeriod } from "@/lib/comparisons";

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
    const d = query.data;
    if (!d) return null;
    const history = (d.history ?? []).map((h) => ({ date: h.date, value: h.aes }));
    return {
      ...d,
      interpretation: interpretAES(d.aes),
      comparison: vsPriorPeriod(history, 7),
      freshness: { updatedAt: d.updatedAt ?? new Date().toISOString(), isLive: false },
      confidenceInfo: { level: d.confidence, basis: `${d.history?.length ?? 0} data points` },
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
    const d = query.data;
    if (!d) return null;
    const overall = d.overall ?? 0;
    return {
      ...d,
      interpretation:
        overall >= 70
          ? "Strong understanding — you comprehend what AI produces"
          : overall >= 40
            ? "Moderate — some blind spots in your codebase"
            : "Low comprehension — high risk of accepting code you don't understand",
      freshness: { updatedAt: new Date().toISOString(), isLive: false },
      confidenceInfo: { level: d.confidence ?? "low", basis: "module coverage" },
    };
  }, [query.data]);

  return { ...query, data: enriched };
}

export function useCosts(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["intelligence", "costs"],
    queryFn: api.intelligence.costs,
    staleTime: 60_000,
    enabled: options?.enabled ?? true,
  });
}

export function useVelocity(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["intelligence", "velocity"],
    queryFn: api.intelligence.velocity,
    staleTime: 60_000,
    enabled: options?.enabled ?? true,
  });
}

export function usePromptPatterns(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["intelligence", "prompt-patterns"],
    queryFn: api.intelligence.promptPatterns,
    staleTime: 120_000,
    enabled: options?.enabled ?? true,
  });
}

export function useAutonomy(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["intelligence", "autonomy"],
    queryFn: api.intelligence.autonomy,
    staleTime: 60_000,
    enabled: options?.enabled ?? true,
  });
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
