import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_URL } from "~/renderer/lib/api";
import { useAuth } from "./useAuth";

export type JobStatus = "pending" | "processing" | "completed" | "failed";

export interface JobSummary {
  id: string;
  status: JobStatus;
  audio_key: string;
  audio_duration_sec: number | null;
  summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobDetail extends JobSummary {
  total_chunks: number | null;
  completed_chunks: number | null;
  error: string | null;
}

export interface JobTopic {
  id: string;
  topic_index: number;
  title: string;
  summary: string | null;
  detail: string | null;
  start_sec: number | null;
  end_sec: number | null;
  transcript: string;
}

const JOBS_KEY = ["jobs"] as const;

const authHeaders = (token: string | null): Record<string, string> =>
  token ? { Authorization: `Bearer ${token}` } : {};

// Note: we intentionally do not use the hono client for jobs because its typed
// responses don't cleanly expose a multipart/form-data `POST /api/v1/jobs` — we
// fall back to raw fetch for that endpoint and keep the rest on plain fetch for
// consistency.
export function useJobs() {
  const { token } = useAuth();
  return useQuery<{ jobs: JobSummary[] }>({
    queryKey: [...JOBS_KEY, token],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/v1/jobs`, { headers: authHeaders(token) });
      if (!res.ok) throw new Error(`Failed to list jobs: ${res.status}`);
      return res.json();
    },
    enabled: !!token,
  });
}

// Polls pending / processing jobs every 3 seconds until completed or failed.
export function useJob(jobId: string | null) {
  const { token } = useAuth();
  return useQuery<JobDetail>({
    queryKey: [...JOBS_KEY, "detail", jobId],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/v1/jobs/${jobId}`, { headers: authHeaders(token) });
      if (!res.ok) throw new Error(`Failed to fetch job: ${res.status}`);
      return res.json();
    },
    enabled: !!jobId && !!token,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 3000;
      return data.status === "pending" || data.status === "processing" ? 3000 : false;
    },
  });
}

export function useJobTopics(jobId: string | null, enabled: boolean) {
  const { token } = useAuth();
  return useQuery<{ topics: JobTopic[] }>({
    queryKey: [...JOBS_KEY, "topics", jobId],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/v1/jobs/${jobId}/topics`, {
        headers: authHeaders(token),
      });
      if (!res.ok) throw new Error(`Failed to fetch topics: ${res.status}`);
      return res.json();
    },
    enabled: !!jobId && !!token && enabled,
  });
}

export function useCreateJob() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  return useMutation<JobSummary, Error, { blob: Blob; filename: string }>({
    mutationFn: async ({ blob, filename }) => {
      const form = new FormData();
      form.append("audio", new File([blob], filename, { type: blob.type || "audio/webm" }));
      const res = await fetch(`${API_URL}/api/v1/jobs`, {
        method: "POST",
        headers: authHeaders(token),
        body: form,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Failed to create job (${res.status}): ${text}`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: JOBS_KEY });
    },
  });
}

export function useDeleteJob() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (jobId) => {
      const res = await fetch(`${API_URL}/api/v1/jobs/${jobId}`, {
        method: "DELETE",
        headers: authHeaders(token),
      });
      if (!res.ok) throw new Error(`Failed to delete job: ${res.status}`);
    },
    onSuccess: (_, jobId) => {
      queryClient.invalidateQueries({ queryKey: JOBS_KEY });
      queryClient.removeQueries({ queryKey: [...JOBS_KEY, "detail", jobId] });
      queryClient.removeQueries({ queryKey: [...JOBS_KEY, "topics", jobId] });
    },
  });
}
