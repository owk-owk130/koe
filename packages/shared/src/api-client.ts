import { hc, type InferResponseType } from "hono/client";
import type { AppType } from "@koe/api";

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

// --- 外部から名前で import される型のみ export ---

const $api = hc<AppType>("");

export type DeviceCodeResponse = InferResponseType<typeof $api.auth.device.$get>;
export type Job = InferResponseType<typeof $api.api.v1.jobs.$get>["jobs"][number];
export type Topic = InferResponseType<
  typeof $api.api.v1.jobs[":id"]["topics"]["$get"]
>["topics"][number];
export type TranscribeResponse = InferResponseType<typeof $api.api.v1.transcribe.$post>;

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
    // hc ベース — 返り値型は res.json() から自動推論
    async getDeviceCode() {
      const res = await client().auth.device.$get();
      await throwIfError(res);
      return res.json();
    },

    async pollToken(deviceCode: string) {
      const res = await client().auth.token.$post({
        json: { device_code: deviceCode },
      });
      if (res.status === 428) return null;
      await throwIfError(res);
      return res.json();
    },

    async listJobs(token: string, params?: { limit?: number; offset?: number }) {
      const res = await client(token).api.v1.jobs.$get({
        query: {
          limit: params?.limit?.toString(),
          offset: params?.offset?.toString(),
        },
      });
      await throwIfError(res);
      return res.json();
    },

    async getJob(token: string, id: string) {
      const res = await client(token).api.v1.jobs[":id"].$get({
        param: { id },
      });
      await throwIfError(res);
      return res.json();
    },

    async getTopics(token: string, jobId: string) {
      const res = await client(token).api.v1.jobs[":id"].topics.$get({
        param: { id: jobId },
      });
      await throwIfError(res);
      return res.json();
    },

    // FormData — hc がリクエストボディ型を推論できないため手動 fetch
    // 返り値型は InferResponseType で付与
    async createJob(token: string, file: File) {
      const form = new FormData();
      form.append("audio", file);
      const res = await fetch(`${baseUrl}/api/v1/jobs`, {
        method: "POST",
        headers: authHeaders(token),
        body: form,
      });
      await throwIfError(res);
      return (await res.json()) as InferResponseType<typeof $api.api.v1.jobs.$post, 201>;
    },

    async transcribe(file: File, token?: string) {
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
      return (await res.json()) as TranscribeResponse;
    },

    async initiateUpload(token: string, filename: string) {
      const res = await fetch(`${baseUrl}/api/v1/uploads`, {
        method: "POST",
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({ filename }),
      });
      await throwIfError(res);
      return (await res.json()) as InferResponseType<typeof $api.api.v1.uploads.$post>;
    },

    async uploadPart(token: string, uploadId: string, partNumber: number, key: string, body: Blob) {
      const res = await fetch(
        `${baseUrl}/api/v1/uploads/${uploadId}/parts/${partNumber}?key=${encodeURIComponent(key)}`,
        {
          method: "PUT",
          headers: authHeaders(token),
          body,
        },
      );
      await throwIfError(res);
      return (await res.json()) as InferResponseType<
        typeof $api.api.v1.uploads[":uploadId"]["parts"][":partNumber"]["$put"]
      >;
    },

    async completeUpload(
      token: string,
      uploadId: string,
      key: string,
      parts: { part_number: number; etag: string }[],
    ) {
      const res = await fetch(`${baseUrl}/api/v1/uploads/${uploadId}/complete`, {
        method: "POST",
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({ key, parts }),
      });
      await throwIfError(res);
      return (await res.json()) as InferResponseType<
        typeof $api.api.v1.uploads[":uploadId"]["complete"]["$post"]
      >;
    },

    async abortUpload(token: string, uploadId: string, key: string) {
      const res = await fetch(
        `${baseUrl}/api/v1/uploads/${uploadId}?key=${encodeURIComponent(key)}`,
        {
          method: "DELETE",
          headers: authHeaders(token),
        },
      );
      await throwIfError(res);
      return (await res.json()) as InferResponseType<typeof $api.api.v1.uploads[":uploadId"]["$delete"]>;
    },
  };
}
