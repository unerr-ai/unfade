import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: api.projects.list,
    staleTime: 30_000,
  });
}

export function useRepos() {
  return useQuery({
    queryKey: ["repos"],
    queryFn: api.repos.list,
    staleTime: 30_000,
  });
}

export function useDiscoverProjects() {
  return useQuery({
    queryKey: ["projects", "discover"],
    queryFn: api.projects.discover,
    enabled: false,
  });
}

export function useAddProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => api.projects.add(path),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["repos"] });
    },
  });
}

export function useProjectAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: "pause" | "resume" | "restart" }) => {
      if (action === "pause") return api.projects.pause(id);
      if (action === "resume") return api.projects.resume(id);
      return api.projects.restart(id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}
