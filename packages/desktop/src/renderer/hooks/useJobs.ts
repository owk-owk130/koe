import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_URL } from "~/renderer/lib/api";
import { chunkAudioBlob } from "~/renderer/lib/audio-chunker";
import { useAuth } from "./useAuth";

// Phase-aware statuses produced by the two-phase orchestrator.
export type JobStatus =
  | "pending"
  | "transcribing"
  | "transcribed"
  | "analyzing"
  | "completed"
  | "transcribe_failed"
  | "analyze_failed";

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
// fall back to raw fetch for that endpoint (Desktop sends pre-split chunks +
// JSON meta), and keep the rest on plain fetch for consistency.
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

// Statuses where the orchestrator is still actively progressing the job.
// Used to keep polling until the job lands in a terminal state.
const IN_PROGRESS_STATUSES: ReadonlySet<JobStatus> = new Set([
  "pending",
  "transcribing",
  "analyzing",
]);

// Polls non-terminal jobs every 3 seconds until they finish or fail.
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
      return IN_PROGRESS_STATUSES.has(data.status) ? 3000 : false;
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

export interface JobTranscript {
  text: string;
  segments: { text: string; start_sec: number; end_sec: number }[];
}

// The raw Whisper transcript persisted to R2 during the transcribe phase.
// Available once the job reaches `transcribed` (i.e. before topic analysis
// finishes) so users can read the unfiltered transcription independently of
// Gemini's topic-level summaries.
export function useJobTranscript(jobId: string | null, enabled: boolean) {
  const { token } = useAuth();
  return useQuery<JobTranscript>({
    queryKey: [...JOBS_KEY, "transcript", jobId],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/v1/jobs/${jobId}/transcript`, {
        headers: authHeaders(token),
      });
      if (!res.ok) throw new Error(`Failed to fetch transcript: ${res.status}`);
      return res.json();
    },
    enabled: !!jobId && !!token && enabled,
    // Jobs that haven't reached the transcribed phase legitimately return 404.
    // Skip React Query's default retry so opening such jobs doesn't hammer the endpoint.
    retry: false,
  });
}

// Splits the recorded audio into ≤60s WAV chunks client-side and uploads them
// alongside a JSON meta describing each chunk's timeline plus the original
// recording (preserved as-is for later playback). The Worker writes chunks
// straight to R2 and drives Whisper from the DurableObject (see
// packages/api/src/processor.ts); chunks are deleted server-side once the
// transcript is committed, leaving only the original behind.
// Fetches the original recording from the API. We cache the Blob (not an
// object URL) because consumers create their own URL via URL.createObjectURL
// and revoke it on unmount; caching a URL would let revoked URLs leak across
// remounts within gcTime, breaking playback when the same job is reopened.
// Lazy: only runs when `enabled` flips true so we don't pull MB-sized
// recordings for jobs the user never plays.
export function useJobAudio(jobId: string | null, enabled: boolean) {
  const { token } = useAuth();
  return useQuery<Blob>({
    queryKey: [...JOBS_KEY, "audio", jobId],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/v1/jobs/${jobId}/audio`, {
        headers: authHeaders(token),
      });
      if (!res.ok) throw new Error(`Failed to fetch audio: ${res.status}`);
      return res.blob();
    },
    enabled: !!jobId && !!token && enabled,
    staleTime: Infinity,
    gcTime: 5 * 60 * 1000,
  });
}

export function useCreateJob() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  return useMutation<JobSummary, Error, Blob>({
    mutationFn: async (blob) => {
      const chunks = await chunkAudioBlob(blob);
      if (chunks.length === 0) {
        throw new Error("音声が短すぎてチャンクに分割できませんでした");
      }

      const form = new FormData();
      form.append(
        "chunks_meta",
        JSON.stringify(
          chunks.map((c) => ({ index: c.index, startSec: c.startSec, endSec: c.endSec })),
        ),
      );
      const totalDuration = chunks[chunks.length - 1].endSec;
      form.append("duration_sec", String(totalDuration));

      const originalExt = mimeToExt(blob.type);
      form.append(
        "original",
        new File([blob], `original.${originalExt}`, {
          type: blob.type || "application/octet-stream",
        }),
      );

      for (const chunk of chunks) {
        form.append(
          `chunk_${chunk.index}`,
          new File([chunk.blob], `chunk_${chunk.index}.wav`, { type: "audio/wav" }),
        );
      }

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

// Recording produces audio/webm via MediaRecorder; file picks come in as the
// platform-default MIME (audio/mpeg etc). The server uses the same mapping
// to choose the stored extension, so we keep both sides in sync here.
const mimeToExt = (mime: string): string => {
  const m = mime.split(";")[0]?.trim().toLowerCase();
  switch (m) {
    case "audio/webm":
      return "webm";
    case "audio/mpeg":
      return "mp3";
    case "audio/mp4":
    case "audio/m4a":
      return "m4a";
    case "audio/wav":
    case "audio/x-wav":
      return "wav";
    case "audio/ogg":
      return "ogg";
    default:
      return "webm";
  }
};

// Re-runs the analyze phase for a job whose transcript has already been
// persisted. Only valid when the job is in `transcribed` or `analyze_failed`;
// the API rejects other states with 409.
export function useReanalyzeJob() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (jobId) => {
      const res = await fetch(`${API_URL}/api/v1/jobs/${jobId}/analyze`, {
        method: "POST",
        headers: authHeaders(token),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Failed to re-analyze job (${res.status}): ${text}`);
      }
    },
    onSuccess: (_, jobId) => {
      queryClient.invalidateQueries({ queryKey: [...JOBS_KEY, "detail", jobId] });
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
