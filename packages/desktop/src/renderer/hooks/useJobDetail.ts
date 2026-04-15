import { useQuery } from "@tanstack/react-query";
import { createApiClient } from "@koe/shared";
import { useAuth } from "./useAuth";

const API_URL = "http://localhost:8787";
const api = createApiClient(API_URL);

export function useJobDetail(jobId: string | null) {
  const { token } = useAuth();

  const jobQuery = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api.getJob(token!, jobId!),
    enabled: !!token && !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "pending" || status === "processing" ? 3000 : false;
    },
  });

  const topicsQuery = useQuery({
    queryKey: ["topics", jobId],
    queryFn: () => api.getTopics(token!, jobId!),
    enabled: !!token && !!jobId && jobQuery.data?.status === "completed",
  });

  return {
    job: jobQuery.data ?? null,
    topics: topicsQuery.data?.topics ?? [],
    loading: jobQuery.isLoading,
    error: jobQuery.error?.message ?? null,
  };
}
