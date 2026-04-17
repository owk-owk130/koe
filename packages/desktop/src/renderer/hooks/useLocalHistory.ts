import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { LocalJobDetailPayload, LocalJobSummary } from "~/shared/ipc-channels";

const HISTORY_KEY = ["local-history"] as const;

export function useLocalHistory() {
  return useQuery<LocalJobSummary[]>({
    queryKey: HISTORY_KEY,
    queryFn: () => window.electronAPI.listHistory(),
  });
}

export function useLocalJobDetail(jobId: string | null) {
  return useQuery<LocalJobDetailPayload | null>({
    queryKey: ["local-history", jobId],
    queryFn: () => (jobId ? window.electronAPI.getHistoryJob(jobId) : Promise.resolve(null)),
    enabled: !!jobId,
  });
}

export function useInvalidateLocalHistory() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: HISTORY_KEY });
}
