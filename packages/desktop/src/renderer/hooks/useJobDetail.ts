import { useQuery } from "@tanstack/react-query";
import { parseResponse } from "@koe/shared";
import { useAuth } from "./useAuth";
import { useApiClient } from "./useApiClient";

export function useJobDetail(jobId: string | null) {
  const { token } = useAuth();
  const client = useApiClient();

  const jobQuery = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => parseResponse(client.api.v1.jobs[":id"].$get({ param: { id: jobId! } })),
    enabled: !!token && !!jobId,
    refetchInterval: ({ state }) => {
      const status = state.data?.status;
      return status === "pending" || status === "processing" ? 3000 : false;
    },
  });

  const topicsQuery = useQuery({
    queryKey: ["topics", jobId],
    queryFn: () => parseResponse(client.api.v1.jobs[":id"].topics.$get({ param: { id: jobId! } })),
    enabled: !!token && !!jobId && jobQuery.data?.status === "completed",
  });

  return {
    job: jobQuery.data ?? null,
    topics: topicsQuery.data?.topics ?? [],
    loading: jobQuery.isLoading,
    error: jobQuery.error?.message ?? null,
  };
}
