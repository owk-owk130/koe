import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createApiClient } from "@koe/shared";
import { useAuth } from "./useAuth";

const API_URL = "http://localhost:8787";
const api = createApiClient(API_URL);

export function useJobs() {
  const { token } = useAuth();

  const query = useQuery({
    queryKey: ["jobs"],
    queryFn: () => api.listJobs(token!),
    enabled: !!token,
    refetchInterval: ({ state }) => {
      const jobs = state.data?.jobs;
      const hasActive = jobs?.some(
        (j) => j.status === "pending" || j.status === "processing",
      );
      return hasActive ? 5000 : false;
    },
  });

  return {
    jobs: query.data?.jobs ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
  };
}

export function useInvalidateJobs() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["jobs"] });
}
