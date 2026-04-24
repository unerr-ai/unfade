import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "@/lib/api";

function interpretDirection(density: number): string {
  if (density >= 70) return "You steer confidently — high human direction";
  if (density >= 40) return "Balanced collaboration — shared steering";
  return "AI is leading — consider more deliberate prompting";
}

export function useSummary() {
  const query = useQuery({
    queryKey: ["summary"],
    queryFn: api.summary,
    staleTime: 10_000,
  });

  const enriched = useMemo(() => {
    const d = query.data;
    if (!d) return null;
    return {
      ...d,
      interpretation: interpretDirection(d.directionDensity24h),
      freshness: {
        updatedAt: d.updatedAt,
        isLive: true,
      },
    };
  }, [query.data]);

  return { ...query, data: enriched };
}
