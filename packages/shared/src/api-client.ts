export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_url: string;
  expires_in: number;
  interval: number;
}

export interface TokenResponse {
  token: string;
  user: { id: string; email: string; name: string | null };
}

export interface Job {
  id: string;
  status: string;
  audio_key: string;
  created_at: string;
  updated_at: string;
}

export interface JobListResponse {
  jobs: Job[];
}

export interface JobDetailResponse {
  id: string;
  status: string;
  audio_key: string;
  audio_duration_sec: number | null;
  total_chunks: number | null;
  completed_chunks: number;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface Topic {
  id: string;
  topic_index: number;
  title: string;
  summary: string | null;
  start_sec: number | null;
  end_sec: number | null;
  transcript: string;
}

export interface TopicsResponse {
  topics: Topic[];
}

export interface CreateJobResponse {
  id: string;
  status: string;
  audio_key: string;
  created_at: string;
}

export interface TranscribeResponse {
  transcript: {
    text: string;
    segments: { text: string; start_sec: number; end_sec: number }[];
  };
  topics: {
    index: number;
    title: string;
    summary: string;
    start_sec: number;
    end_sec: number;
    transcript: string;
  }[];
}

export interface InitiateUploadResponse {
  upload_id: string;
  key: string;
  job_id: string;
}

export interface UploadPartResponse {
  part_number: number;
  etag: string;
}

export interface CompleteUploadResponse {
  key: string;
  status: string;
}

export interface AbortUploadResponse {
  status: string;
}

async function handleResponse<T>(res: Response): Promise<T> {
  const body = await res.json();
  if (!res.ok) {
    const err = body?.error;
    throw new ApiError(err?.code ?? "UNKNOWN", err?.message ?? "Unknown error", res.status);
  }
  return body as T;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export function createApiClient(baseUrl: string) {
  return {
    async getDeviceCode(): Promise<DeviceCodeResponse> {
      const res = await fetch(`${baseUrl}/auth/device`, { method: "GET" });
      return handleResponse<DeviceCodeResponse>(res);
    },

    async pollToken(deviceCode: string): Promise<TokenResponse | null> {
      const res = await fetch(`${baseUrl}/auth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_code: deviceCode }),
      });
      if (res.status === 428) return null;
      return handleResponse<TokenResponse>(res);
    },

    async listJobs(
      token: string,
      params?: { limit?: number; offset?: number },
    ): Promise<JobListResponse> {
      const query = new URLSearchParams();
      if (params?.limit != null) query.set("limit", String(params.limit));
      if (params?.offset != null) query.set("offset", String(params.offset));
      const qs = query.toString();
      const res = await fetch(`${baseUrl}/api/v1/jobs${qs ? `?${qs}` : ""}`, {
        headers: authHeaders(token),
      });
      return handleResponse<JobListResponse>(res);
    },

    async getJob(token: string, id: string): Promise<JobDetailResponse> {
      const res = await fetch(`${baseUrl}/api/v1/jobs/${id}`, {
        headers: authHeaders(token),
      });
      return handleResponse<JobDetailResponse>(res);
    },

    async getTopics(token: string, jobId: string): Promise<TopicsResponse> {
      const res = await fetch(`${baseUrl}/api/v1/jobs/${jobId}/topics`, {
        headers: authHeaders(token),
      });
      return handleResponse<TopicsResponse>(res);
    },

    async createJob(token: string, file: File): Promise<CreateJobResponse> {
      const form = new FormData();
      form.append("audio", file);
      const res = await fetch(`${baseUrl}/api/v1/jobs`, {
        method: "POST",
        headers: authHeaders(token),
        body: form,
      });
      return handleResponse<CreateJobResponse>(res);
    },

    async transcribe(file: File, token?: string): Promise<TranscribeResponse> {
      const form = new FormData();
      form.append("audio", file);
      const headers: Record<string, string> = {};
      if (token) Object.assign(headers, authHeaders(token));
      const res = await fetch(`${baseUrl}/api/v1/transcribe`, {
        method: "POST",
        headers,
        body: form,
      });
      return handleResponse<TranscribeResponse>(res);
    },

    async initiateUpload(token: string, filename: string): Promise<InitiateUploadResponse> {
      const res = await fetch(`${baseUrl}/api/v1/uploads`, {
        method: "POST",
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({ filename }),
      });
      return handleResponse<InitiateUploadResponse>(res);
    },

    async uploadPart(
      token: string,
      uploadId: string,
      partNumber: number,
      key: string,
      body: Blob,
    ): Promise<UploadPartResponse> {
      const res = await fetch(
        `${baseUrl}/api/v1/uploads/${uploadId}/parts/${partNumber}?key=${encodeURIComponent(key)}`,
        {
          method: "PUT",
          headers: authHeaders(token),
          body,
        },
      );
      return handleResponse<UploadPartResponse>(res);
    },

    async completeUpload(
      token: string,
      uploadId: string,
      key: string,
      parts: { part_number: number; etag: string }[],
    ): Promise<CompleteUploadResponse> {
      const res = await fetch(`${baseUrl}/api/v1/uploads/${uploadId}/complete`, {
        method: "POST",
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({ key, parts }),
      });
      return handleResponse<CompleteUploadResponse>(res);
    },

    async abortUpload(token: string, uploadId: string, key: string): Promise<AbortUploadResponse> {
      const res = await fetch(
        `${baseUrl}/api/v1/uploads/${uploadId}?key=${encodeURIComponent(key)}`,
        {
          method: "DELETE",
          headers: authHeaders(token),
        },
      );
      return handleResponse<AbortUploadResponse>(res);
    },
  };
}
