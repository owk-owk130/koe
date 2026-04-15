import { useQuery, useQueryClient } from "@tanstack/react-query";
import { parseResponse } from "@koe/shared";
import { useAuth } from "./useAuth";
import { useApiClient } from "./useApiClient";

export function useJobs() {
  const { token } = useAuth();
  const client = useApiClient();

  const query = useQuery({
    queryKey: ["jobs"],
    queryFn: () => parseResponse(client.api.v1.jobs.$get()),
    enabled: !!token,
    refetchInterval: ({ state }) => {
      const jobs = state.data?.jobs;
      const hasActive = jobs?.some((j) => j.status === "pending" || j.status === "processing");
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
