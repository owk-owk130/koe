import { hc } from "hono/client";
import type { AppType } from "@koe/api";
import type { InferResponseType } from "hono/client";

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

async function throwIfError(res: { ok: boolean; status: number; json(): Promise<unknown> }) {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: { code?: string; message?: string } }
      | null;
    const err = body?.error;
    throw new ApiError(err?.code ?? "UNKNOWN", err?.message ?? "Unknown error", res.status);
  }
}

// --- 型 export（hc クライアントから推論） ---

type Client = ReturnType<typeof hc<AppType>>;

export type DeviceCodeResponse = InferResponseType<Client["auth"]["device"]["$get"]>;
export type TokenResponse = InferResponseType<Client["auth"]["token"]["$post"], 200>;
export type JobListResponse = InferResponseType<Client["api"]["v1"]["jobs"]["$get"]>;
export type Job = JobListResponse["jobs"][number];
export type JobDetailResponse = InferResponseType<Client["api"]["v1"]["jobs"][":id"]["$get"]>;
export type TopicsResponse = InferResponseType<
  Client["api"]["v1"]["jobs"][":id"]["topics"]["$get"]
>;
export type Topic = TopicsResponse["topics"][number];
export type CreateJobResponse = InferResponseType<Client["api"]["v1"]["jobs"]["$post"], 201>;
export type TranscribeResponse = InferResponseType<Client["api"]["v1"]["transcribe"]["$post"]>;
export type InitiateUploadResponse = InferResponseType<Client["api"]["v1"]["uploads"]["$post"]>;
export type UploadPartResponse = InferResponseType<
  Client["api"]["v1"]["uploads"][":uploadId"]["parts"][":partNumber"]["$put"]
>;
export type CompleteUploadResponse = InferResponseType<
  Client["api"]["v1"]["uploads"][":uploadId"]["complete"]["$post"]
>;
export type AbortUploadResponse = InferResponseType<
  Client["api"]["v1"]["uploads"][":uploadId"]["$delete"]
>;

// --- API クライアント ---

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export function createApiClient(baseUrl: string) {
  function client(token?: string) {
    return hc<AppType>(baseUrl, {
      headers: token ? authHeaders(token) : {},
    });
  }

  return {
    async getDeviceCode(): Promise<DeviceCodeResponse> {
      const res = await client().auth.device.$get();
      await throwIfError(res);
      return res.json();
    },

    async pollToken(deviceCode: string): Promise<TokenResponse | null> {
      const res = await client().auth.token.$post({
        json: { device_code: deviceCode },
      });
      if (res.status === 428) return null;
      await throwIfError(res);
      return res.json() as Promise<TokenResponse>;
    },

    async listJobs(
      token: string,
      params?: { limit?: number; offset?: number },
    ): Promise<JobListResponse> {
      const res = await client(token).api.v1.jobs.$get({
        query: {
          limit: params?.limit?.toString(),
          offset: params?.offset?.toString(),
        },
      });
      await throwIfError(res);
      return res.json();
    },

    async getJob(token: string, id: string): Promise<JobDetailResponse> {
      const res = await client(token).api.v1.jobs[":id"].$get({
        param: { id },
      });
      await throwIfError(res);
      return res.json();
    },

    async getTopics(token: string, jobId: string): Promise<TopicsResponse> {
      const res = await client(token).api.v1.jobs[":id"].topics.$get({
        param: { id: jobId },
      });
      await throwIfError(res);
      return res.json();
    },

    // FormData endpoints — hc はリクエストボディ型を推論できないため手動 fetch
    async createJob(token: string, file: File): Promise<CreateJobResponse> {
      const form = new FormData();
      form.append("audio", file);
      const res = await fetch(`${baseUrl}/api/v1/jobs`, {
        method: "POST",
        headers: authHeaders(token),
        body: form,
      });
      await throwIfError(res);
      return res.json() as Promise<CreateJobResponse>;
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
      await throwIfError(res);
      return res.json() as Promise<TranscribeResponse>;
    },

    // Uploads — json body / query を使う routes も手動 fetch（バリデータなしで hc 型推論不可）
    async initiateUpload(token: string, filename: string): Promise<InitiateUploadResponse> {
      const res = await fetch(`${baseUrl}/api/v1/uploads`, {
        method: "POST",
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({ filename }),
      });
      await throwIfError(res);
      return res.json() as Promise<InitiateUploadResponse>;
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
      await throwIfError(res);
      return res.json() as Promise<UploadPartResponse>;
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
      await throwIfError(res);
      return res.json() as Promise<CompleteUploadResponse>;
    },

    async abortUpload(
      token: string,
      uploadId: string,
      key: string,
    ): Promise<AbortUploadResponse> {
      const res = await fetch(
        `${baseUrl}/api/v1/uploads/${uploadId}?key=${encodeURIComponent(key)}`,
        {
          method: "DELETE",
          headers: authHeaders(token),
        },
      );
      await throwIfError(res);
      return res.json() as Promise<AbortUploadResponse>;
    },
  };
}
