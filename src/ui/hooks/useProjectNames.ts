import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/** Shared hook: resolves projectId → human-readable name from the project registry. */
export function useProjectNames() {
  const { data } = useQuery({
    queryKey: ["projects"],
    queryFn: api.projects.list,
    staleTime: 60_000,
  });

  const nameMap = new Map<string, string>();
  if (data?.projects) {
    for (const p of data.projects) {
      nameMap.set(p.id, p.label ?? p.root);
    }
  }

  return {
    resolve: (id?: string) => (id ? (nameMap.get(id) ?? id) : undefined),
    nameMap,
  };
}
